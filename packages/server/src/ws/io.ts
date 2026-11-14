// Socket.IO server factory. The shared msgpack parser MUST match the one every client passes.
import { Server } from 'socket.io';
import { socketParser } from '@orbitops/shared';
import type { Config } from '../config.js';

export const MAX_HTTP_BUFFER_BYTES = 256 * 1024;

/** Created detached from any HTTP server; call `io.attach(httpServer)` once Express is ready. */
export function createIoServer(config: Pick<Config, 'clientOrigins'>): Server {
  return new Server({
    parser: socketParser,
    cors: { origin: config.clientOrigins, credentials: true },
    maxHttpBufferSize: MAX_HTTP_BUFFER_BYTES,
    transports: ['websocket', 'polling'],
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
  });
}
