// REST API integration tests: role enforcement, history + live dedup contract, rollups, alerts, commands,
// chaos relay and admin management, against a real server and MongoDB (harness: see testing/harness.ts).
import { afterAll, beforeAll, describe, expect } from 'vitest';
import mongoose from 'mongoose';
import type { Socket } from 'socket.io-client';
import { COMMAND, INGEST_BATCH, NS_INGEST, type IngestAck } from '@orbitops/shared';
import { createRollupJob } from './jobs/rollups.js';
import { connected, createHarness, DEVICE_KEY, emitWithAck, sleep } from './testing/harness.js';
import { event, frame } from './testing/factories.js';

const SAT_HISTORY = 25544;
const SAT_ALERTS = 48274;
const SAT_RULES_OFF = 43013;
const SAT_RULES_ON = 41866;
const FIRST_SEQ = 1000;
const POINTS = 300;

const harness = createHarness();
const { api, integration, login, open } = harness;
const fleetSize = () => harness.server.context.catalog.size;

beforeAll(() => harness.start());
afterAll(() => harness.stop());

let device: Socket | undefined;
async function connectDevice(): Promise<Socket> {
  if (!device) {
    device = open(NS_INGEST, { auth: { apiKey: DEVICE_KEY } });
    await connected(device);
  }
  return device;
}

async function ingest(satId: number, events: ReturnType<typeof event>[]): Promise<IngestAck> {
  return emitWithAck<IngestAck>(await connectDevice(), INGEST_BATCH, {
    sourceId: `sat-${satId}`,
    events,
  });
}

const telemetryCount = (satId: number) =>
  mongoose.connection.db?.collection('telemetry').countDocuments({ 'meta.satId': satId });

/** 300 samples, 100 ms apart, ending about now; seq FIRST_SEQ..FIRST_SEQ+299. */
const historyStart = Date.now() - 40_000;
let seeded: Promise<void> | undefined;
function seedHistory(): Promise<void> {
  seeded ??= (async () => {
    const events = Array.from({ length: POINTS }, (_, i) =>
      event(
        FIRST_SEQ + i,
        historyStart + i * 100,
        frame({ batSoc: 0.9 - i * 0.0001, panelTempC: 30 + (i % 50) * 0.1 }),
      ),
    );
    expect(await ingest(SAT_HISTORY, events)).toMatchObject({ accepted: POINTS });
    await expect.poll(() => telemetryCount(SAT_HISTORY), { timeout: 8000 }).toBe(POINTS);
  })();
  return seeded;
}

describe('authentication and roles', () => {
  integration('rejects unauthenticated requests with 401', async () => {
    for (const path of [
      '/satellites',
      '/ground-stations',
      '/passes?satId=25544',
      '/telemetry/latest',
      '/alerts',
      '/alert-rules',
      '/commands',
      '/analytics/heatmap',
      '/system/stats',
      '/users',
      '/devices',
    ]) {
      expect((await api(path)).status, path).toBe(401);
    }
  });

  integration('viewers cannot ack, resolve, command, tune rules or toggle chaos', async () => {
    const cookie = await login('viewer@orbitops.dev');
    const attempts: [string, string, unknown][] = [
      ['POST', '/alerts/000000000000000000000000/ack', undefined],
      ['POST', '/alerts/000000000000000000000000/resolve', undefined],
      ['POST', '/commands', { satId: SAT_HISTORY, kind: 'safe_mode' }],
      ['PUT', '/alert-rules/tcs.panelOverTemp', { enabled: false }],
      [
        'PUT',
        '/system/chaos',
        { enabled: true, duplicateRate: 0, reorderRate: 0, malformedRate: 0 },
      ],
      ['GET', '/users', undefined],
      ['POST', '/devices', { name: 'x' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api(path, { cookie, method, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  integration('operators may act on alerts and commands but not on admin resources', async () => {
    const cookie = await login('operator@orbitops.dev');
    expect(
      (
        await api('/alert-rules/tcs.panelOverTemp', {
          cookie,
          method: 'PUT',
          body: { enabled: true },
        })
      ).status,
    ).toBe(403);
    expect((await api('/system/chaos', { cookie, method: 'PUT', body: {} })).status).toBe(403);
    expect((await api('/users', { cookie })).status).toBe(403);
  });
});

describe('fleet', () => {
  integration(
    'lists satellites, one satellite with its latest snapshot, and stations',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      const { body } = await api('/satellites', { cookie });
      expect(body.satellites).toHaveLength(fleetSize());
      expect(body.satellites[0]).toMatchObject({
        satId: expect.any(Number),
        line1: expect.any(String),
      });
      const iss = body.satellites.find((s: { satId: number }) => s.satId === SAT_HISTORY);
      expect(['NOMINAL', 'CAUTION', 'WARNING']).toContain(iss.status);
      const untouched = body.satellites.find((s: { satId: number }) => s.satId === 20580);
      expect(untouched?.status ?? 'STALE').toBe('STALE');

      const detail = await api(`/satellites/${SAT_HISTORY}`, { cookie });
      expect(detail.body.satellite.satId).toBe(SAT_HISTORY);
      expect(detail.body.latest).toMatchObject({ s: SAT_HISTORY, q: FIRST_SEQ + POINTS - 1 });
      expect((await api('/satellites/999999', { cookie })).status).toBe(404);
      expect((await api('/satellites/abc', { cookie })).status).toBe(400);

      const stations = await api('/ground-stations', { cookie });
      expect(stations.body.stations).toHaveLength(16);
      expect(stations.body.stations[0]).not.toHaveProperty('loc');
      const latest = await api('/telemetry/latest', { cookie });
      expect(latest.body.snapshots.some((s: { s: number }) => s.s === SAT_HISTORY)).toBe(true);
    },
  );

  integration('predicts passes and validates the horizon', async () => {
    const cookie = await login('viewer@orbitops.dev');
    const { status, body } = await api(`/passes?satId=${SAT_HISTORY}&stationId=WALL&hours=48`, {
      cookie,
    });
    expect(status).toBe(200);
    expect(body.passes.length).toBeGreaterThanOrEqual(4);
    for (const pass of body.passes) {
      expect(pass).toMatchObject({ satId: SAT_HISTORY, stationId: 'WALL' });
      expect(pass.aos).toBeLessThan(pass.los);
      expect(pass.los - pass.aos).toBeLessThan(15 * 60_000);
    }
    expect((await api(`/passes?satId=${SAT_HISTORY}&hours=49`, { cookie })).status).toBe(400);
    expect((await api(`/passes?satId=${SAT_HISTORY}&stationId=NOPE`, { cookie })).status).toBe(404);
    expect((await api('/passes', { cookie })).status).toBe(400);
  });
});

describe('telemetry history', () => {
  const metrics = 'batSoc,panelTempC';

  integration(
    'returns aligned columns and a lastSeq equal to the highest persisted seq',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      const from = historyStart - 1000;
      const { status, body } = await api(
        `/telemetry?satId=${SAT_HISTORY}&from=${from}&to=${Date.now() + 1000}&metrics=${metrics}`,
        { cookie },
      );
      expect(status).toBe(200);
      expect(body).toMatchObject({ satId: SAT_HISTORY, source: 'raw' });
      expect(body.t).toHaveLength(POINTS);
      expect(Object.keys(body.series)).toEqual(['batSoc', 'panelTempC']);
      expect(body.series.batSoc).toHaveLength(POINTS);
      expect(body.series.panelTempC).toHaveLength(POINTS);
      expect(body.t).toEqual([...body.t].sort((a: number, b: number) => a - b));
      expect(body.lastSeq).toBe(FIRST_SEQ + POINTS - 1);
      expect(Math.abs(body.serverTime - Date.now())).toBeLessThan(5000);
    },
  );

  integration(
    'dedup contract: lastSeq is bounded by the queried range, not by live state',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      // The live state already holds seq FIRST_SEQ+299, but the range ends after the 16th sample.
      const to = historyStart + 15 * 100;
      const { body } = await api(
        `/telemetry?satId=${SAT_HISTORY}&from=${historyStart - 1}&to=${to}&metrics=batSoc`,
        { cookie },
      );
      expect(body.t).toHaveLength(16);
      expect(body.lastSeq).toBe(FIRST_SEQ + 15);
      // An empty range has nothing to dedup against: -1 keeps every live point.
      const empty = await api(
        `/telemetry?satId=${SAT_HISTORY}&from=${historyStart - 60_000}&to=${historyStart - 30_000}&metrics=batSoc`,
        { cookie },
      );
      expect(empty.body).toMatchObject({ t: [], lastSeq: -1 });
    },
  );

  integration(
    'respects maxPoints while keeping every column aligned and the last point',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      const { body } = await api(
        `/telemetry?satId=${SAT_HISTORY}&from=${historyStart - 1000}&to=${Date.now()}&metrics=${metrics}&maxPoints=50`,
        { cookie },
      );
      expect(body.t.length).toBeLessThanOrEqual(50);
      expect(body.t.length).toBeGreaterThanOrEqual(10);
      expect(body.series.batSoc).toHaveLength(body.t.length);
      expect(body.series.panelTempC).toHaveLength(body.t.length);
      expect(body.t.at(-1)).toBe(historyStart + (POINTS - 1) * 100);
      expect(body.lastSeq).toBe(FIRST_SEQ + POINTS - 1);
    },
  );

  integration('validates query parameters', async () => {
    const cookie = await login('viewer@orbitops.dev');
    const get = (query: string) => api(`/telemetry?${query}`, { cookie });
    expect((await get(`satId=${SAT_HISTORY}`)).status).toBe(400); // metrics required
    expect((await get(`satId=${SAT_HISTORY}&metrics=nope`)).body.error).toBe('unsupported_metrics');
    expect((await get(`satId=${SAT_HISTORY}&metrics=batSoc&maxPoints=99999`)).status).toBe(400);
    expect((await get(`satId=${SAT_HISTORY}&metrics=batSoc&from=5&to=5`)).status).toBe(400);
    expect((await get(`satId=999999&metrics=batSoc`)).status).toBe(404);
    // eclipseFrac only exists in rollups.
    expect((await get(`satId=${SAT_HISTORY}&metrics=eclipseFrac`)).status).toBe(400);
  });

  integration('serves ranges over two hours from rollups, with min/max bands', async () => {
    await seedHistory();
    const cookie = await login('viewer@orbitops.dev');
    const job = createRollupJob(harness.server.context.log);
    const now = Date.now();
    await job.aggregateRange(
      Math.floor((historyStart - 60_000) / 60_000) * 60_000,
      Math.floor(now / 60_000) * 60_000 + 60_000,
    );

    const { status, body } = await api(
      `/telemetry?satId=${SAT_HISTORY}&from=${now - 3 * 3_600_000}&to=${now + 60_000}&metrics=batSoc,eclipseFrac&bands=1`,
      { cookie },
    );
    expect(status).toBe(200);
    expect(body.source).toBe('rollup');
    expect(body.t.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(body.series).sort()).toEqual([
      'batSoc',
      'batSoc:max',
      'batSoc:min',
      'eclipseFrac',
    ]);
    for (const column of Object.values<number[]>(body.series))
      expect(column).toHaveLength(body.t.length);
    expect(body.series['batSoc:min'][0]).toBeLessThanOrEqual(body.series.batSoc[0]);
    expect(body.series['batSoc:max'][0]).toBeGreaterThanOrEqual(body.series.batSoc[0]);
    expect(body.series.eclipseFrac[0]).toBe(0);
    expect(body.lastSeq).toBe(FIRST_SEQ + POINTS - 1);
    // Metrics that are not rolled up are rejected for long ranges.
    expect(
      (
        await api(`/telemetry?satId=${SAT_HISTORY}&from=${now - 3 * 3_600_000}&metrics=lat`, {
          cookie,
        })
      ).status,
    ).toBe(400);
  });
});

describe('analytics', () => {
  integration(
    'heatmap is a satellites x buckets matrix with null gaps, ordered by group then id',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      const now = Date.now();
      const { status, body } = await api(
        `/analytics/heatmap?metric=batSoc&from=${now - 3_600_000}&to=${now + 60_000}&bucketMin=5`,
        { cookie },
      );
      expect(status).toBe(200);
      expect(body.satIds).toHaveLength(fleetSize());
      expect(body.buckets.length).toBeGreaterThanOrEqual(12);
      expect(body.values).toHaveLength(fleetSize());
      for (const row of body.values) expect(row).toHaveLength(body.buckets.length);
      for (let i = 1; i < body.buckets.length; i++) {
        expect(body.buckets[i] - body.buckets[i - 1]).toBe(5 * 60_000);
      }
      const row = body.values[body.satIds.indexOf(SAT_HISTORY)] as (number | null)[];
      expect(row.some((v) => typeof v === 'number')).toBe(true);
      expect(row.some((v) => v === null)).toBe(true);
      const sats = (await api('/satellites', { cookie })).body.satellites as {
        satId: number;
        group: string;
      }[];
      const groupOf = new Map(sats.map((s) => [s.satId, s.group]));
      const groups = (body.satIds as number[]).map((id) => groupOf.get(id));
      expect(new Set(groups).size).toBeGreaterThan(1);
      expect(
        groups
          .join()
          .split(',')
          .filter((g, i, all) => g !== all[i - 1]).length,
      ).toBe(new Set(groups).size); // each group is contiguous

      const tooWide = await api(`/analytics/heatmap?from=${now - 8 * 24 * 3_600_000}&to=${now}`, {
        cookie,
      });
      expect(tooWide.status).toBe(400);
      expect((await api('/analytics/heatmap?metric=nope', { cookie })).status).toBe(400);
    },
  );

  integration(
    'summary reports min/avg/max, eclipse fraction, alert count and a baseline',
    async () => {
      await seedHistory();
      const cookie = await login('viewer@orbitops.dev');
      const now = Date.now();
      const { status, body } = await api(
        `/analytics/summary?satId=${SAT_HISTORY}&from=${now - 2 * 3_600_000}&to=${now + 60_000}`,
        { cookie },
      );
      expect(status).toBe(200);
      const { batSoc } = body.metrics;
      expect(batSoc.min).toBeLessThanOrEqual(batSoc.avg);
      expect(batSoc.avg).toBeLessThanOrEqual(batSoc.max);
      expect(body.eclipseFrac).toBe(0);
      expect(typeof body.alertCount).toBe('number');
      expect(body.baseline.batSoc.avg).toHaveLength(body.baseline.batSoc.t.length);
      expect(body.baseline.batSoc.min).toHaveLength(body.baseline.batSoc.t.length);
      expect(body.baseline.batSoc.max).toHaveLength(body.baseline.batSoc.t.length);
      expect((await api('/analytics/summary', { cookie })).status).toBe(400);
    },
  );
});

describe('alerts', () => {
  integration('lists, filters, paginates, acknowledges and resolves', async () => {
    const viewer = await login('viewer@orbitops.dev');
    const operator = await login('operator@orbitops.dev');
    const now = Date.now();
    await ingest(
      SAT_ALERTS,
      Array.from({ length: 6 }, (_, i) =>
        event(5000 + i, now - 1000 + i, frame({ panelTempC: 95 })),
      ),
    );
    await expect
      .poll(
        async () =>
          (await api(`/alerts?satId=${SAT_ALERTS}&state=open`, { cookie: viewer })).body.alerts
            .length,
        {
          timeout: 5000,
        },
      )
      .toBeGreaterThan(0);

    const open = (await api(`/alerts?satId=${SAT_ALERTS}&state=open`, { cookie: viewer })).body
      .alerts[0];
    expect(open).toMatchObject({ satId: SAT_ALERTS, state: 'open' });

    const acked = await api(`/alerts/${open.id}/ack`, { cookie: operator, method: 'POST' });
    expect(acked.status).toBe(200);
    expect(acked.body.alert).toMatchObject({
      id: open.id,
      state: 'acked',
      ackedBy: 'operator@orbitops.dev',
    });
    const resolved = await api(`/alerts/${open.id}/resolve`, { cookie: operator, method: 'POST' });
    expect(resolved.body.alert).toMatchObject({ id: open.id, state: 'resolved' });

    const byState = await api(`/alerts?satId=${SAT_ALERTS}&state=resolved`, { cookie: viewer });
    expect(byState.body.alerts.map((a: { id: string }) => a.id)).toContain(open.id);
    const bySeverity = await api(`/alerts?severity=ADVISORY`, { cookie: viewer });
    for (const alert of bySeverity.body.alerts) expect(alert.severity).toBe('ADVISORY');

    const firstPage = await api(`/alerts?satId=${SAT_ALERTS}&limit=1`, { cookie: viewer });
    expect(firstPage.body.alerts).toHaveLength(1);
    const cursor = firstPage.body.alerts[0].openedAt;
    const next = await api(`/alerts?satId=${SAT_ALERTS}&limit=100&before=${cursor}`, {
      cookie: viewer,
    });
    expect(next.body.alerts.every((a: { openedAt: number }) => a.openedAt < cursor)).toBe(true);
    const iso = await api(
      `/alerts?before=${encodeURIComponent(new Date(now + 60_000).toISOString())}`,
      {
        cookie: viewer,
      },
    );
    expect(iso.status).toBe(200);

    expect((await api('/alerts?limit=501', { cookie: viewer })).status).toBe(400);
    expect((await api('/alerts?state=bogus', { cookie: viewer })).status).toBe(400);
    expect((await api('/alerts/not-an-id/ack', { cookie: operator, method: 'POST' })).status).toBe(
      404,
    );
  });

  integration('admins tune rules and the change hot-reloads into the engine', async () => {
    const admin = await login('admin@orbitops.dev');
    const viewer = await login('viewer@orbitops.dev');
    const rules = await api('/alert-rules', { cookie: viewer });
    expect(rules.body.rules.length).toBeGreaterThanOrEqual(8);

    const put = (id: string, body: unknown) =>
      api(`/alert-rules/${id}`, { cookie: admin, method: 'PUT', body });
    expect((await put('nope', { enabled: false })).status).toBe(404);
    expect((await put('tcs.panelOverTemp', {})).status).toBe(400);
    expect((await put('tcs.panelOverTemp', { threshold: 'hot' })).status).toBe(400);
    expect((await put('tcs.panelOverTemp', { metric: 'batSoc' })).status).toBe(400); // not editable

    const temp = ['tcs.panelOverTemp', 'tcs.panelOverTempCritical'];
    for (const id of temp)
      expect((await put(id, { enabled: false })).body.rule.enabled).toBe(false);
    const changed = await put('tcs.panelOverTemp', { threshold: 72, samples: 4 });
    expect(changed.body.rule).toMatchObject({ id: 'tcs.panelOverTemp', threshold: 72, samples: 4 });

    const now = Date.now();
    const hot = (satId: number) =>
      ingest(
        satId,
        Array.from({ length: 8 }, (_, i) =>
          event(7000 + i, now - 1000 + i, frame({ panelTempC: 95 })),
        ),
      );
    await hot(SAT_RULES_OFF);
    await sleep(1000);
    const none = await api(`/alerts?satId=${SAT_RULES_OFF}`, { cookie: viewer });
    expect(none.body.alerts.filter((a: { ruleId: string }) => temp.includes(a.ruleId))).toEqual([]);

    for (const id of temp) await put(id, { enabled: true });
    await hot(SAT_RULES_ON);
    await expect
      .poll(
        async () =>
          (await api(`/alerts?satId=${SAT_RULES_ON}`, { cookie: viewer })).body.alerts.some(
            (a: { ruleId: string }) => temp.includes(a.ruleId),
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    await put('tcs.panelOverTemp', { threshold: 70, samples: 1 });
  });
});

describe('commands and chaos', () => {
  integration('audits a command and relays it to the connected device', async () => {
    const operator = await login('operator@orbitops.dev');
    const viewer = await login('viewer@orbitops.dev');
    const socket = await connectDevice();
    const received = new Promise<Record<string, unknown>>((resolve) =>
      socket.once(COMMAND, resolve),
    );

    const body = { satId: SAT_HISTORY, kind: 'inject_fault', fault: 'battery' };
    expect(
      (
        await api('/commands', {
          cookie: operator,
          method: 'POST',
          body: { satId: SAT_HISTORY, kind: 'inject_fault' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/commands', {
          cookie: operator,
          method: 'POST',
          body: { ...body, satId: 999999 },
        })
      ).status,
    ).toBe(404);

    const res = await api('/commands', { cookie: operator, method: 'POST', body });
    expect(res.status).toBe(202);
    expect(res.body.command).toMatchObject({
      satId: SAT_HISTORY,
      kind: 'inject_fault',
      fault: 'battery',
      issuedBy: 'operator@orbitops.dev',
      status: 'sent',
    });
    expect(res.body.command.id).toEqual(expect.any(String));
    // Relayed payload is exactly the shared Command (the simulator parses it with a strict schema).
    expect(await received).toStrictEqual({
      satId: SAT_HISTORY,
      kind: 'inject_fault',
      fault: 'battery',
    });

    const listed = await api(`/commands?satId=${SAT_HISTORY}`, { cookie: viewer });
    expect(listed.body.commands[0]).toMatchObject({ id: res.body.command.id });
  });

  integration('chaos config is stored, readable by anyone and pushed to devices', async () => {
    const admin = await login('admin@orbitops.dev');
    const viewer = await login('viewer@orbitops.dev');
    const socket = await connectDevice();
    const config = { enabled: true, duplicateRate: 0.25, reorderRate: 0.5, malformedRate: 0.125 };
    const pushed = new Promise<unknown>((resolve) => socket.once('chaos', resolve));

    expect(
      (
        await api('/system/chaos', {
          cookie: admin,
          method: 'PUT',
          body: { ...config, duplicateRate: 2 },
        })
      ).status,
    ).toBe(400);
    const res = await api('/system/chaos', { cookie: admin, method: 'PUT', body: config });
    expect(res.body).toEqual({ chaos: config });
    expect(await pushed).toEqual(config);
    expect((await api('/system/chaos', { cookie: viewer })).body).toEqual({ chaos: config });
    await api('/system/chaos', {
      cookie: admin,
      method: 'PUT',
      body: { ...config, enabled: false },
    });
  });

  integration('exposes pipeline statistics', async () => {
    const { body } = await api('/system/stats', { cookie: await login('viewer@orbitops.dev') });
    expect(body).toMatchObject({
      ingest: { accepted: expect.any(Number) },
      clients: { ingest: expect.any(Number) },
      memory: { rssMb: expect.any(Number) },
    });
  });
});

describe('admin', () => {
  integration('manages users', async () => {
    const admin = await login('admin@orbitops.dev');
    const create = (body: unknown) => api('/users', { cookie: admin, method: 'POST', body });
    const valid = {
      email: 'new.person@orbitops.dev',
      name: 'New Person',
      password: 'orbitops',
      role: 'operator',
    };

    const made = await create(valid);
    expect(made.status).toBe(201);
    expect(made.body.user).toMatchObject({ email: valid.email, role: 'operator' });
    expect(JSON.stringify(made.body)).not.toContain('passwordHash');
    expect((await create(valid)).status).toBe(409);
    expect((await create({ ...valid, email: 'not-an-email' })).status).toBe(400);
    expect((await create({ ...valid, email: 'x@y.dev', password: 'short' })).status).toBe(400);
    expect(await login(valid.email)).toContain('oo_at=');

    const list = await api('/users', { cookie: admin });
    expect(list.body.users.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');

    const patched = await api(`/users/${made.body.user.id}`, {
      cookie: admin,
      method: 'PATCH',
      body: { role: 'viewer' },
    });
    expect(patched.body.user.role).toBe('viewer');
    expect(
      (
        await api(`/users/${made.body.user.id}`, {
          cookie: admin,
          method: 'PATCH',
          body: { role: 'root' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api('/users/000000000000000000000000', {
          cookie: admin,
          method: 'PATCH',
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(404);
    const self = list.body.users.find((u: { email: string }) => u.email === 'admin@orbitops.dev');
    expect(
      (await api(`/users/${self.id}`, { cookie: admin, method: 'PATCH', body: { role: 'viewer' } }))
        .status,
    ).toBe(400);
  });

  integration('issues device keys once, stores only the hash, and revokes them', async () => {
    const admin = await login('admin@orbitops.dev');
    const created = await api('/devices', {
      cookie: admin,
      method: 'POST',
      body: { name: 'test-rig' },
    });
    expect(created.status).toBe(201);
    const { key, device: info } = created.body;
    expect(key).toMatch(/^oo_dev_/);
    expect(info).toMatchObject({ name: 'test-rig', allowedSources: ['*'] });

    const list = await api('/devices', { cookie: admin });
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body.devices.some((d: { id: string }) => d.id === info.id)).toBe(true);
    const stored = await mongoose.connection.collection('devices').findOne({ name: 'test-rig' });
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/);

    const rig = open(NS_INGEST, { auth: { apiKey: key } });
    await connected(rig);
    expect((await api(`/devices/${info.id}`, { cookie: admin, method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await api(`/devices/${info.id}`, { cookie: admin, method: 'DELETE' })).status).toBe(
      404,
    );
    const revoked = open(NS_INGEST, { auth: { apiKey: key } });
    await expect(connected(revoked)).rejects.toThrow('unauthorized');
  });
});
