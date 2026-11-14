// /alerts (JWT): clients subscribe to alert rooms and receive reliable (non-volatile) ALERT / ALERT_UPDATE events.
import type { Namespace } from 'socket.io';
import {
  ALERT,
  ALERT_UPDATE,
  alertsRoom,
  alertsSatRoom,
  alertsSeverityRoom,
  type Alert,
  type ParsedRoom,
} from '@orbitops/shared';
import { userSocketAuth } from '../auth/socketAuth.js';
import type { TokenService } from '../auth/tokens.js';
import type { AlertEmitter } from '../alerts/manager.js';
import { attachSubscriptionHandlers } from './subscriptions.js';

const allowsAlertRoom = (room: ParsedRoom): boolean =>
  room.kind === 'alerts-all' || room.kind === 'alerts-severity' || room.kind === 'alerts-sat';

export function createAlertEmitter(nsp: Namespace): AlertEmitter {
  const rooms = (alert: Alert) => [
    alertsRoom(),
    alertsSeverityRoom(alert.severity),
    alertsSatRoom(alert.satId),
  ];
  return {
    opened: (alert) => void nsp.to(rooms(alert)).emit(ALERT, alert),
    updated: (alert) => void nsp.to(rooms(alert)).emit(ALERT_UPDATE, alert),
  };
}

export function registerAlertsNamespace(nsp: Namespace, tokens: TokenService): void {
  nsp.use(userSocketAuth(tokens));
  nsp.on('connection', (socket) => {
    attachSubscriptionHandlers(socket, { allows: allowsAlertRoom });
  });
}
