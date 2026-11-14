// Socket.IO namespace middleware: JWT users for /telemetry and /alerts, API-key devices for /ingest.
import type { Socket } from 'socket.io';
import { ACCESS_COOKIE, parseCookieHeader } from './cookies.js';
import { authenticateDeviceKey, type DeviceLookup } from './deviceKey.js';
import type { TokenService } from './tokens.js';

type Next = (err?: Error) => void;

export function userSocketAuth(tokens: TokenService) {
  return async (socket: Socket, next: Next): Promise<void> => {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const fromAuth = typeof auth?.token === 'string' ? auth.token : undefined;
    const fromCookie = parseCookieHeader(socket.handshake.headers.cookie)[ACCESS_COOKIE];
    // A socket-token (60s) is accepted for non-browser clients; browsers use the access cookie.
    const user =
      (await tokens.verify(fromAuth, 'socket')) ??
      (await tokens.verify(fromAuth, 'access')) ??
      (await tokens.verify(fromCookie, 'access'));
    if (!user) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.user = user;
    next();
  };
}

export function deviceSocketAuth(lookup: DeviceLookup) {
  return async (socket: Socket, next: Next): Promise<void> => {
    const auth = socket.handshake.auth as { apiKey?: unknown } | undefined;
    const device = await authenticateDeviceKey(auth?.apiKey, lookup);
    if (!device) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.device = device;
    next();
  };
}
