// Composition root: wires every service together and starts the HTTP + Socket.IO servers.
// Kept separate from index.ts (signals, process exit) so integration tests can boot a real instance.
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NS_ALERTS, NS_INGEST, NS_TELEMETRY, SERVER_STATS, SYSTEM_ROOM } from '@orbitops/shared';
import { AlertManager } from './alerts/manager.js';
import { loadRules } from './alerts/rules.js';
import { createAnomalyEngine } from './anomaly/index.js';
import { createApp } from './app.js';
import { createTokenService } from './auth/tokens.js';
import { SatelliteCatalog } from './catalog.js';
import type { Config } from './config.js';
import type { ServerContext } from './context.js';
import { connectDb, disconnectDb, ensureCollections, nativeDb, TELEMETRY } from './db/index.js';
import { createDeviceRateLimiter } from './ingest/rateLimit.js';
import { IngestPipeline } from './ingest/pipeline.js';
import type { Logger } from './logger.js';
import { StatsCollector } from './metrics/collector.js';
import { createPrometheusRegistry } from './metrics/prometheus.js';
import { Device } from './models/device.js';
import { bootstrapIfEmpty } from './seed/bootstrap.js';
import { StateStore } from './state/store.js';
import { loadBootMarks } from './store/bootMarks.js';
import { TelemetryWriter, type InsertTarget } from './store/writer.js';
import { createAlertEmitter, registerAlertsNamespace } from './ws/alertsNamespace.js';
import { Broadcaster } from './ws/broadcaster.js';
import { ClientRegistry } from './ws/clients.js';
import { createIoServer } from './ws/io.js';
import { createDeviceGateway, registerIngestNamespace } from './ws/ingestNamespace.js';
import { registerTelemetryNamespace } from './ws/telemetryNamespace.js';

export interface RunningServer {
  port: number;
  httpServer: HttpServer;
  context: ServerContext;
  stop(): Promise<void>;
}

export interface StartOptions {
  /** Overrides the login rate limit (tests). */
  loginLimitPerMinute?: number;
}

export async function startServer(
  config: Config,
  log: Logger,
  options: StartOptions = {},
): Promise<RunningServer> {
  await connectDb(config.mongoUri);
  await ensureCollections({ rawTtlHours: config.rawTtlHours });
  if (config.seedDemo) await bootstrapIfEmpty({ deviceApiKey: config.deviceApiKey, log });

  const catalog = new SatelliteCatalog();
  await catalog.load();
  if (catalog.size === 0)
    log.warn('satellite catalogue is empty: all ingest will be rejected (run `npm run seed`)');

  const instanceId = randomUUID();
  const stats = new StatsCollector();
  const state = new StateStore(catalog.groupOf);
  const anomaly = createAnomalyEngine(await loadRules(log));

  const telemetryCollection = nativeDb().collection(TELEMETRY);
  const writer = new TelemetryWriter(
    telemetryCollection as unknown as InsertTarget,
    { persistHz: config.persistHz },
    {
      onFlush: (ms, docs) => stats.recordFlush(ms, docs),
      onDrop: (count) => stats.inc('dropped', count),
      onError: (err, docs) => log.error({ err, docs }, 'telemetry flush failed; batch dropped'),
    },
  );
  const marks = await loadBootMarks(telemetryCollection, writer);
  log.info({ satellites: marks }, 'loaded last persisted telemetry marks');

  const io = createIoServer(config);
  const telemetryNsp = io.of(NS_TELEMETRY);
  const alertsNsp = io.of(NS_ALERTS);
  const ingestNsp = io.of(NS_INGEST);

  const alerts = new AlertManager(createAlertEmitter(alertsNsp), instanceId, log);
  const gateway = createDeviceGateway(ingestNsp);
  const registry = new ClientRegistry();
  const tokens = createTokenService(config.jwtSecret);

  const pipeline = new IngestPipeline({
    now: Date.now,
    limiter: createDeviceRateLimiter({
      eventsPerSec: config.deviceEventsPerSec,
      burstEvents: config.deviceBurstEvents,
    }),
    state,
    anomaly,
    groupOf: catalog.groupOf,
    persist: (sample) => void writer.offer(sample),
    onTransitions: (transitions) => alerts.handleTransitions(transitions),
    counters: stats,
    writerFill: () => writer.fillRatio,
  });

  stats.setProviders({
    clients: () => ({
      telemetry: telemetryNsp.sockets.size,
      alerts: alertsNsp.sockets.size,
      ingest: ingestNsp.sockets.size,
    }),
    queueDepth: () => writer.depth,
    slowConsumers: () => registry.slowCount,
  });

  registerIngestNamespace(ingestNsp, {
    pipeline,
    gateway,
    log,
    lookup: async (keyHash) => {
      const doc = await Device.findOne({ keyHash }).lean();
      return (
        doc && {
          id: doc._id.toString(),
          name: doc.name,
          keyHash: doc.keyHash,
          allowedSources: doc.allowedSources,
        }
      );
    },
    touchDevice: async (id) =>
      void (await Device.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } })),
  });
  registerTelemetryNamespace(telemetryNsp, { tokens, state, registry, stats });
  registerAlertsNamespace(alertsNsp, tokens);

  const broadcaster = new Broadcaster({
    nsp: telemetryNsp,
    state,
    registry,
    counters: stats,
    onSlowConsumer: (socketId) => log.warn({ socketId }, 'slow consumer downgraded to fleet feed'),
  });

  const context: ServerContext = {
    config,
    log,
    tokens,
    catalog,
    state,
    writer,
    anomaly,
    alerts,
    gateway,
    stats,
    metrics: createPrometheusRegistry(stats),
    isReady: () => mongoose.connection.readyState === 1,
  };
  const httpServer = createServer(createApp(context, options));
  io.attach(httpServer);

  writer.start();
  broadcaster.start();
  alerts.startChangeStream();
  const pipelineTimer = setInterval(() => pipeline.tick(), 50);
  const secondTimer = setInterval(() => {
    alerts.handleTransitions(anomaly.checkStale(Date.now()));
    telemetryNsp.volatile.to(SYSTEM_ROOM).emit(SERVER_STATS, stats.tick());
  }, 1000);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;
  log.info({ port, instanceId }, 'OrbitOps server listening');

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      clearInterval(pipelineTimer);
      clearInterval(secondTimer);
      broadcaster.stop();
      await io.close();
      httpServer.closeAllConnections();
      await writer.stop();
      await alerts.stop();
      stats.stop();
      await disconnectDb();
      log.info('shutdown complete');
    })());

  return { port, httpServer, context, stop };
}
