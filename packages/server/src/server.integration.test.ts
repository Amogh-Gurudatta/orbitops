// End-to-end test against a real MongoDB replica set: HTTP + Socket.IO on an ephemeral port, real msgpack
// parser, a device client ingesting and subscribers receiving (harness: see testing/harness.ts).
import { afterAll, beforeAll, describe, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  ALERT,
  INGEST_BATCH,
  NS_ALERTS,
  NS_INGEST,
  NS_TELEMETRY,
  SUB,
  TM_DELTA,
  TM_SNAPSHOT,
  type IngestAck,
  type TmDelta,
} from '@orbitops/shared';
import { connected, createHarness, DEVICE_KEY, emitWithAck, sleep } from './testing/harness.js';
import { event, frame } from './testing/factories.js';

const SAT_A = 25544;
const SAT_B = 48274;

const harness = createHarness();
const { open, login, integration } = harness;
const baseUrl = () => harness.baseUrl;

beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe('server integration', () => {
  integration('serves health, metrics and rejects bad credentials', async () => {
    expect((await fetch(`${baseUrl()}/healthz`)).status).toBe(200);
    expect(await (await fetch(`${baseUrl()}/metrics`)).text()).toContain(
      'orbitops_ingest_accepted_total',
    );
    const bad = await fetch(`${baseUrl()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@orbitops.dev', password: 'nope' }),
    });
    expect(bad.status).toBe(401);
    const invalid = await fetch(`${baseUrl()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(invalid.status).toBe(400);
  });

  integration('session lifecycle: me, refresh, socket-token, logout', async () => {
    const cookie = await login('operator@orbitops.dev');
    const me = await fetch(`${baseUrl()}/api/v1/auth/me`, { headers: { cookie } });
    expect(((await me.json()) as { user: unknown }).user).toMatchObject({
      email: 'operator@orbitops.dev',
      role: 'operator',
    });
    expect((await fetch(`${baseUrl()}/api/v1/auth/me`)).status).toBe(401);
    const socketToken = await fetch(`${baseUrl()}/api/v1/auth/socket-token`, {
      headers: { cookie },
    });
    const { token } = (await socketToken.json()) as { token: unknown };
    expect(typeof token).toBe('string');
    const logout = await fetch(`${baseUrl()}/api/v1/auth/logout`, { method: 'POST' });
    expect(logout.status).toBe(204);
  });

  integration('rejects unauthenticated sockets on every namespace', async () => {
    for (const [ns, auth] of [
      [NS_TELEMETRY, {}],
      [NS_ALERTS, {}],
      [NS_INGEST, { apiKey: 'wrong-key-123456' }],
    ] as const) {
      const socket = open(ns, { auth });
      await expect(connected(socket)).rejects.toThrow('unauthorized');
    }
  });

  integration('delivers deltas to the subscribed room only and reports duplicates', async () => {
    const cookie = await login('viewer@orbitops.dev');
    const subscriberA = open(NS_TELEMETRY, { extraHeaders: { cookie } });
    const subscriberB = open(NS_TELEMETRY, { extraHeaders: { cookie } });
    const device = open(NS_INGEST, { auth: { apiKey: DEVICE_KEY } });
    await Promise.all([connected(subscriberA), connected(subscriberB), connected(device)]);

    const deltasA: TmDelta[] = [];
    const deltasB: TmDelta[] = [];
    const snapshotsA: unknown[] = [];
    subscriberA.on(TM_DELTA, (batch: TmDelta[]) => deltasA.push(...batch));
    subscriberB.on(TM_DELTA, (batch: TmDelta[]) => deltasB.push(...batch));
    subscriberA.on(TM_SNAPSHOT, (snaps: unknown[]) => snapshotsA.push(...snaps));
    expect(await emitWithAck(subscriberA, SUB, { rooms: [`sat:${SAT_A}`] })).toEqual({
      ok: true,
      rooms: [`sat:${SAT_A}`],
    });
    await emitWithAck(subscriberB, SUB, { rooms: [`sat:${SAT_B}`] });
    expect(await emitWithAck(subscriberB, SUB, { rooms: ['sat:../etc'] })).toMatchObject({
      ok: false,
    });

    const now = Date.now();
    const batch = {
      sourceId: `sat-${SAT_A}`,
      events: [event(1000, now, frame({ lat: 33 })), event(1001, now + 1, frame({ lat: 34 }))],
    };
    expect(await emitWithAck<IngestAck>(device, INGEST_BATCH, batch)).toEqual({
      ok: true,
      accepted: 2,
      duplicates: 0,
      rejected: 0,
    });

    await expect.poll(() => deltasA.length, { timeout: 3000 }).toBeGreaterThan(0);
    expect(deltasA.at(-1)).toMatchObject({ s: SAT_A, q: 1001, d: { a: 34 } });
    await sleep(500);
    expect(deltasB).toEqual([]);

    const again = await emitWithAck<IngestAck>(device, INGEST_BATCH, batch);
    expect(again).toMatchObject({ ok: true, accepted: 0, duplicates: 2 });

    // A late subscriber gets a snapshot of the current state first.
    const lateSubscriber = open(NS_TELEMETRY, { extraHeaders: { cookie } });
    await connected(lateSubscriber);
    const snaps = new Promise<{ s: number; q: number }[]>((resolve) =>
      lateSubscriber.once(TM_SNAPSHOT, resolve),
    );
    await emitWithAck(lateSubscriber, SUB, { rooms: [`sat:${SAT_A}`] });
    expect(await snaps).toMatchObject([{ s: SAT_A, q: 1001 }]);
    expect(snapshotsA).toHaveLength(0); // subscribed before any data existed
  });

  integration('persists telemetry, opens alerts and relays them to alert subscribers', async () => {
    const cookie = await login('viewer@orbitops.dev');
    const alertsSocket = open(NS_ALERTS, { extraHeaders: { cookie } });
    const device = open(NS_INGEST, { auth: { apiKey: DEVICE_KEY } });
    await Promise.all([connected(alertsSocket), connected(device)]);
    const opened: { satId: number; ruleId: string; state: string }[] = [];
    alertsSocket.on(ALERT, (alert) => opened.push(alert));
    await emitWithAck(alertsSocket, SUB, { rooms: ['alerts:all'] });

    const now = Date.now();
    const events = Array.from({ length: 6 }, (_, i) =>
      event(5000 + i, now + i, frame({ panelTempC: 95 })),
    );
    await emitWithAck(device, INGEST_BATCH, { sourceId: `sat-${SAT_B}`, events });

    await expect.poll(() => opened.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(opened[0]).toMatchObject({ satId: SAT_B, state: 'open' });
    await expect
      .poll(
        () =>
          mongoose.connection.db?.collection('telemetry').countDocuments({ 'meta.satId': SAT_B }),
        {
          timeout: 5000,
        },
      )
      .toBeGreaterThan(0);
    expect(
      await mongoose.connection.collection('alerts').countDocuments({ satId: SAT_B }),
    ).toBeGreaterThan(0);
  });
});
