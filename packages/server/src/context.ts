// The service container built at boot and handed to the HTTP app, so route modules added later
// (satellites, telemetry, alerts, commands, analytics, system, users, devices) can reach every service.
import type { AnomalyEngine } from './anomaly/index.js';
import type { AlertManager } from './alerts/manager.js';
import type { TokenService } from './auth/tokens.js';
import type { SatelliteCatalog } from './catalog.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { StatsCollector } from './metrics/collector.js';
import type { Registry } from '@prometheus-io/client';
import type { StateStore } from './state/store.js';
import type { TelemetryWriter } from './store/writer.js';
import type { DeviceGateway } from './ws/ingestNamespace.js';

export interface ServerContext {
  config: Config;
  log: Logger;
  tokens: TokenService;
  catalog: SatelliteCatalog;
  state: StateStore;
  writer: TelemetryWriter;
  anomaly: AnomalyEngine;
  alerts: AlertManager;
  gateway: DeviceGateway;
  stats: StatsCollector;
  metrics: Registry;
  /** True once Mongo is connected; backs /healthz. */
  isReady(): boolean;
}
