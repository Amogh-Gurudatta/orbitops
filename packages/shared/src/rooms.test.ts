import { describe, expect, it } from 'vitest';
import { MAX_ROOMS_PER_CLIENT } from './constants.js';
import {
  FLEET_ROOM,
  SYSTEM_ROOM,
  SubscribeRequest,
  alertsRoom,
  alertsSatRoom,
  alertsSeverityRoom,
  groupRoom,
  parseRoom,
  satRoom,
  systemRoom,
} from './rooms.js';

describe('room builders', () => {
  it('build canonical names', () => {
    expect(satRoom(25544)).toBe('sat:25544');
    expect(groupRoom('weather')).toBe('group:weather');
    expect(FLEET_ROOM).toBe('fleet');
    expect(alertsRoom()).toBe('alerts:all');
    expect(alertsSeverityRoom('WARNING')).toBe('alerts:sev:WARNING');
    expect(alertsSatRoom(25544)).toBe('alerts:sat:25544');
    expect(systemRoom()).toBe(SYSTEM_ROOM);
    expect(SYSTEM_ROOM).toBe('system');
  });
});

describe('parseRoom', () => {
  it('round-trips every builder', () => {
    expect(parseRoom(satRoom(25544))).toEqual({ kind: 'sat', satId: 25544 });
    expect(parseRoom(groupRoom('comms'))).toEqual({ kind: 'group', group: 'comms' });
    expect(parseRoom(FLEET_ROOM)).toEqual({ kind: 'fleet' });
    expect(parseRoom(SYSTEM_ROOM)).toEqual({ kind: 'system' });
    expect(parseRoom(alertsRoom())).toEqual({ kind: 'alerts-all' });
    expect(parseRoom(alertsSeverityRoom('CAUTION'))).toEqual({
      kind: 'alerts-severity',
      severity: 'CAUTION',
    });
    expect(parseRoom(alertsSatRoom(7))).toEqual({ kind: 'alerts-sat', satId: 7 });
  });

  it.each([
    '',
    'sat:',
    'sat:abc',
    'sat:-1',
    'sat:1:2',
    'group:nope',
    'alerts:sev:LOW',
    'alerts:sat:x',
    'admin',
    'system:1',
    'fleet:1',
  ])('rejects %j', (name) => {
    expect(parseRoom(name)).toBeNull();
  });
});

describe('SubscribeRequest', () => {
  it('accepts rooms with an allowed rate', () => {
    expect(SubscribeRequest.safeParse({ rooms: ['sat:1'], hz: 5 }).success).toBe(true);
    expect(SubscribeRequest.safeParse({ rooms: [] }).success).toBe(true);
  });

  it('rejects bad rates, extra keys and too many rooms', () => {
    expect(SubscribeRequest.safeParse({ rooms: ['sat:1'], hz: 3 }).success).toBe(false);
    expect(SubscribeRequest.safeParse({ rooms: [], x: 1 }).success).toBe(false);
    const rooms = Array.from({ length: MAX_ROOMS_PER_CLIENT + 1 }, (_, i) => `sat:${i}`);
    expect(SubscribeRequest.safeParse({ rooms }).success).toBe(false);
  });
});
