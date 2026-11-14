// Simulator entry point: load catalog, create one agent per satellite, sample them all from a single
// timer, hand samples to the ingest transport, and log a status line every 10 s.
import { SatelliteAgent, SimClock } from './agent.js';
import {
  loadGroundStations,
  loadSatelliteSnapshot,
  refreshTles,
  selectSatellites,
} from './catalog.js';
import { Chaos } from './chaos.js';
import { loadConfig } from './config.js';
import { IngestTransport } from './transport.js';

const STATUS_INTERVAL_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const stations = loadGroundStations();

  let satellites = selectSatellites(loadSatelliteSnapshot(), config.satIds, config.shard);
  if (satellites.length === 0)
    throw new Error('No satellites selected (check SIM_SATS / SIM_SHARD)');
  if (config.tleRefresh) {
    const refresh = await refreshTles(satellites);
    satellites = refresh.satellites;
    console.info(
      `[sim] TLE refresh: ${refresh.refreshed}/${satellites.length} updated from CelesTrak`,
    );
  }
  if (!config.deviceApiKey)
    console.warn('[sim] DEVICE_API_KEY is empty; the server will refuse the connection');

  const clock = new SimClock(config.timeScale);
  const agents = new Map<number, SatelliteAgent>();
  for (const sat of satellites) {
    try {
      agents.set(sat.noradId, new SatelliteAgent(sat, stations, clock, 1 / config.hz));
    } catch (error) {
      console.warn(`[sim] skipping ${sat.noradId} ${sat.name}: ${String(error)}`);
    }
  }

  const chaos = new Chaos();
  const transport = new IngestTransport({
    serverUrl: config.serverUrl,
    apiKey: config.deviceApiKey,
    chaos,
    onCommand: (command) => {
      const agent = agents.get(command.satId);
      if (!agent) return; // another shard's satellite
      agent.handleCommand(command);
      console.info(
        `[sim] command ${command.kind}${command.fault ? `:${command.fault}` : ''} -> ${agent.name}`,
      );
    },
  });
  let lastError = '';
  transport.on('connect', () => console.info(`[sim] connected to ${config.serverUrl}`));
  transport.on('disconnect', (reason) => console.warn(`[sim] disconnected: ${String(reason)}`));
  transport.on('connect_error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) console.warn(`[sim] connect error: ${message}`);
    lastError = message;
  });
  transport.start();

  const sampleTimer = setInterval(() => {
    const wallMs = Date.now();
    for (const agent of agents.values()) {
      const event = agent.sample(wallMs);
      if (event) transport.enqueue(agent.sourceId, event);
    }
  }, 1000 / config.hz);

  let prevSent = 0;
  const statusTimer = setInterval(() => {
    const s = transport.stats;
    const perSec = ((s.eventsSent - prevSent) / (STATUS_INTERVAL_MS / 1000)).toFixed(0);
    prevSent = s.eventsSent;
    console.info(
      `[sim] sats=${agents.size} ${transport.connected ? 'up' : 'DOWN'} sent=${perSec}/s ` +
        `acks ok=${s.acksOk} rejected=${s.acksRejected} timeouts=${s.ackTimeouts} ` +
        `buffered=${transport.buffered} dropped=${s.dropped}`,
    );
    if (chaos.enabled) {
      const c = chaos.counts;
      console.info(
        `[sim] chaos injected duplicates=${c.duplicates} reordered=${c.reordered} malformed=${c.malformed}`,
      );
    }
  }, STATUS_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(sampleTimer);
    clearInterval(statusTimer);
    transport.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  console.info(
    `[sim] ${agents.size} satellites (shard ${config.shard.index}/${config.shard.count}) at ${config.hz} Hz, ` +
      `time scale ${config.timeScale}x -> ${config.serverUrl}`,
  );
}

main().catch((error: unknown) => {
  console.error('[sim] fatal:', error);
  process.exit(1);
});
