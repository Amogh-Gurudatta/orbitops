// /ingest (device API key): simulators push telemetry batches and receive operator commands and chaos config.
import type { Namespace } from 'socket.io';
import {
  CHAOS_DEFAULTS,
  COMMAND,
  INGEST_BATCH,
  type ChaosConfig,
  Command,
  type IngestAck,
} from '@orbitops/shared';
import { deviceSocketAuth } from '../auth/socketAuth.js';
import type { DeviceIdentity, DeviceLookup } from '../auth/deviceKey.js';
import type { IngestPipeline } from '../ingest/pipeline.js';
import type { Logger } from '../logger.js';

/** Server -> device event carrying the current ChaosConfig. */
export const CHAOS_EVENT = 'chaos';


export interface DeviceGateway {
  /** Emits to every connected device; simulators ignore satellites they do not own. Returns device count. */
  sendCommandToDevices(command: Command): number;
  /** Stores the config (sent to devices that connect later) and pushes it to connected devices. */
  broadcastChaos(config: ChaosConfig): void;
  currentChaos(): ChaosConfig;
  connectedDevices(): number;
}

export function createDeviceGateway(nsp: Namespace): DeviceGateway {
  let chaos: ChaosConfig = { ...CHAOS_DEFAULTS };
  return {
    sendCommandToDevices(command) {
      // Devices validate with the strict shared Command schema, so send exactly its fields (no audit metadata).
      nsp.emit(COMMAND, Command.parse(command));
      return nsp.sockets.size;
    },
    broadcastChaos(config) {
      chaos = config;
      nsp.emit(CHAOS_EVENT, config);
    },
    currentChaos: () => chaos,
    connectedDevices: () => nsp.sockets.size,
  };
}

export interface IngestNamespaceDeps {
  lookup: DeviceLookup;
  pipeline: IngestPipeline;
  gateway: DeviceGateway;
  log: Logger;
  /** Records the device's last-seen time (fire and forget). */
  touchDevice(deviceId: string): Promise<void>;
}

const FAILED_ACK: IngestAck = {
  ok: false,
  accepted: 0,
  duplicates: 0,
  rejected: 0,
  retryAfterMs: 1000,
};

export function registerIngestNamespace(nsp: Namespace, deps: IngestNamespaceDeps): void {
  const { pipeline, gateway, log } = deps;
  nsp.use(deviceSocketAuth(deps.lookup));

  nsp.on('connection', (socket) => {
    const device = socket.data.device as DeviceIdentity;
    log.info({ device: device.name, socket: socket.id }, 'device connected');
    deps.touchDevice(device.id).catch((err: unknown) => log.warn({ err }, 'touchDevice failed'));
    // The simulator never asks for chaos state, so send it on connect.
    socket.emit(CHAOS_EVENT, gateway.currentChaos());

    socket.on(INGEST_BATCH, async (payload: unknown, ack?: unknown) => {
      if (typeof ack !== 'function') return;
      try {
        ack(await pipeline.ingest(device, payload));
      } catch (err) {
        log.error({ err }, 'ingest failed');
        ack(FAILED_ACK);
      }
    });

    socket.on('disconnect', () => log.info({ device: device.name }, 'device disconnected'));
  });
}
