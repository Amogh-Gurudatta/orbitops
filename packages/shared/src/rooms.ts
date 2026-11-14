// Room name builders/parsers. Every client subscription request is validated through parseRoom.
import { z } from 'zod';
import { ALLOWED_SUB_HZ, MAX_ROOMS_PER_CLIENT, SAT_GROUPS, type SatGroup } from './constants.js';
import { SEVERITIES, type Severity } from './alerts.js';

export const FLEET_ROOM = 'fleet';
export const ALERTS_ALL_ROOM = 'alerts:all';

export const satRoom = (satId: number): string => `sat:${satId}`;
export const groupRoom = (group: SatGroup): string => `group:${group}`;
export const alertsRoom = (): string => ALERTS_ALL_ROOM;
export const alertsSeverityRoom = (severity: Severity): string => `alerts:sev:${severity}`;
export const alertsSatRoom = (satId: number): string => `alerts:sat:${satId}`;

export type ParsedRoom =
  | { kind: 'fleet' }
  | { kind: 'sat'; satId: number }
  | { kind: 'group'; group: SatGroup }
  | { kind: 'alerts-all' }
  | { kind: 'alerts-severity'; severity: Severity }
  | { kind: 'alerts-sat'; satId: number };

const SAT_ID = /^\d{1,9}$/;
const isGroup = (v: string): v is SatGroup => (SAT_GROUPS as readonly string[]).includes(v);
const isSeverity = (v: string): v is Severity => (SEVERITIES as readonly string[]).includes(v);

/** Returns null for anything that is not a well-formed room name. */
export function parseRoom(name: string): ParsedRoom | null {
  if (name === FLEET_ROOM) return { kind: 'fleet' };
  if (name === ALERTS_ALL_ROOM) return { kind: 'alerts-all' };

  const parts = name.split(':');
  const [head, second, third] = parts;
  if (head === 'sat' && parts.length === 2 && second !== undefined && SAT_ID.test(second)) {
    return { kind: 'sat', satId: Number(second) };
  }
  if (head === 'group' && parts.length === 2 && second !== undefined && isGroup(second)) {
    return { kind: 'group', group: second };
  }
  if (head === 'alerts' && parts.length === 3 && third !== undefined) {
    if (second === 'sev' && isSeverity(third)) return { kind: 'alerts-severity', severity: third };
    if (second === 'sat' && SAT_ID.test(third)) return { kind: 'alerts-sat', satId: Number(third) };
  }
  return null;
}

export const SubscribeRequest = z.strictObject({
  rooms: z.array(z.string().min(1).max(64)).max(MAX_ROOMS_PER_CLIENT),
  hz: z.literal(ALLOWED_SUB_HZ).optional(),
});
export type SubscribeRequest = z.infer<typeof SubscribeRequest>;
