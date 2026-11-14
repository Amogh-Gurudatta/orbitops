import type { AlertRule, TelemetryFrame } from '@orbitops/shared';
import { describe, expect, it } from 'vitest';
import {
  type AlertTransition,
  type AnomalyEngine,
  DEFAULT_RULES,
  createAnomalyEngine,
} from './index.js';
import { frame } from './testFrames.js';

const SAT = 25544;
const STEP_MS = 100;

/** Feeds `count` copies of a frame at STEP_MS spacing from `startTs`; returns transitions and the next ts. */
function feed(
  engine: AnomalyEngine,
  f: TelemetryFrame,
  count: number,
  startTs: number,
  satId = SAT,
) {
  const transitions: AlertTransition[] = [];
  let ts = startTs;
  for (let i = 0; i < count; i++, ts += STEP_MS) transitions.push(...engine.evaluate(satId, f, ts));
  return { transitions, next: ts };
}

function rule(id: string): AlertRule {
  return structuredClone(DEFAULT_RULES.find((r) => r.id === id)!);
}

const engineWith = (ids: string[], opts = {}) => createAnomalyEngine(ids.map(rule), opts);

describe('hysteresis through the engine', () => {
  it('opens after 3 consecutive breaches, not before', () => {
    const engine = engineWith(['tcs.panelOverTemp']);
    const hot = frame({ panelTempC: 75 });
    expect(feed(engine, hot, 2, 0).transitions).toEqual([]);
    expect(engine.evaluate(SAT, frame(), 200)).toEqual([]); // streak broken
    const { transitions } = feed(engine, hot, 3, 300);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      kind: 'open',
      key: `${SAT}:tcs.panelOverTemp`,
      satId: SAT,
      ruleId: 'tcs.panelOverTemp',
      subsystem: 'TCS',
      severity: 'CAUTION',
      value: 75,
      threshold: 70,
      count: 1,
      ts: 500,
    });
    expect(transitions[0]!.message).toContain('75');
  });

  it('resolves only after 3 consecutive samples back past the clear point', () => {
    const engine = engineWith(['tcs.panelOverTemp']);
    const { next } = feed(engine, frame({ panelTempC: 75 }), 3, 0);
    // 66 C is inside the hysteresis band (clear point is 63 C): nothing happens.
    expect(feed(engine, frame({ panelTempC: 66 }), 10, next).transitions).toEqual([]);
    const cleared = feed(engine, frame({ panelTempC: 60 }), 3, next + 1000);
    expect(cleared.transitions).toHaveLength(1);
    expect(cleared.transitions[0]).toMatchObject({ kind: 'resolve', value: 60, count: 1 });
  });

  it('skips null metrics without tripping or clearing', () => {
    const engine = engineWith(['comm.linkLossInPass', 'tcs.panelOverTemp']);
    const { next } = feed(engine, frame({ panelTempC: 75 }), 3, 0);
    // Rules on non-null metrics keep their state; nothing here is null for panelTempC anyway.
    expect(
      engine.evaluate(SAT, frame({ panelTempC: 75, rssiDbm: null, elevDeg: null }), next),
    ).toEqual([]);
  });
});

describe('cooldown', () => {
  it('suppresses re-opening for cooldownMs after a resolve, then opens immediately', () => {
    const engine = engineWith(['tcs.panelOverTemp'], {
      cooldownMs: 60_000,
      updateIntervalMs: 1_000_000,
    });
    const hot = frame({ panelTempC: 75 });
    const cool = frame({ panelTempC: 50 });
    const at = (f: TelemetryFrame, ts: number) => engine.evaluate(SAT, f, ts);

    [0, 1000, 2000].forEach((t) => at(hot, t)); // opens at 2000
    const resolved = [3000, 4000, 5000].flatMap((t) => at(cool, t));
    expect(resolved.map((t) => t.kind)).toEqual(['resolve']);

    const reopened: number[] = [];
    for (let t = 6000; t <= 70_000; t += 1000) {
      for (const tr of at(hot, t)) if (tr.kind === 'open') reopened.push(t);
    }
    expect(reopened).toEqual([65_000]); // resolve at 5000 + 60 s
  });
});

describe('update throttling', () => {
  it('emits at most one update per interval with a growing count', () => {
    const engine = engineWith(['tcs.panelOverTemp'], { updateIntervalMs: 5_000 });
    const { transitions } = feed(engine, frame({ panelTempC: 75 }), 130, 0); // 13 s at 10 Hz
    expect(transitions.map((t) => t.kind)).toEqual(['open', 'update', 'update']);
    const [, first, second] = transitions;
    expect(first!.ts - transitions[0]!.ts).toBe(5000); // opened at 200 ms, first update 5 s later
    expect(second!.ts - first!.ts).toBe(5000);
    expect(second!.count).toBeGreaterThan(first!.count);
  });

  it('stays quiet when the count has not changed', () => {
    const engine = engineWith(['tcs.panelOverTemp'], { updateIntervalMs: 5_000 });
    const { next } = feed(engine, frame({ panelTempC: 75 }), 3, 0);
    // In the hysteresis band the alert stays open but accrues nothing.
    expect(feed(engine, frame({ panelTempC: 66 }), 200, next).transitions).toEqual([]);
  });
});

describe('default domain rules', () => {
  /** Trips a rule with `bad`, checks the open transition, then resolves it with `good`. */
  function tripAndResolve(ruleId: string, bad: TelemetryFrame, good: TelemetryFrame, samples = 3) {
    const engine = engineWith([ruleId]);
    const opened = feed(engine, bad, samples, 0);
    expect(opened.transitions.map((t) => [t.kind, t.ruleId])).toEqual([['open', ruleId]]);
    const closed = feed(engine, good, samples, opened.next);
    expect(closed.transitions.map((t) => [t.kind, t.ruleId])).toEqual([['resolve', ruleId]]);
    return opened.transitions[0]!;
  }

  it('eps.lowSocEclipse: battery below 20% while in shadow', () => {
    const open = tripAndResolve(
      'eps.lowSocEclipse',
      frame({ batSoc: 0.182, shadow: 1 }),
      frame({ batSoc: 0.5, shadow: 1 }),
    );
    expect(open).toMatchObject({
      subsystem: 'EPS',
      severity: 'WARNING',
      message: 'Battery 18.2% during eclipse (limit 20%)',
    });
  });

  it('eps.lowSocEclipse: does not trip in sunlight, and resolves when eclipse ends', () => {
    const engine = engineWith(['eps.lowSocEclipse']);
    expect(feed(engine, frame({ batSoc: 0.15, shadow: 0 }), 10, 0).transitions).toEqual([]);
    const opened = feed(engine, frame({ batSoc: 0.15, shadow: 1 }), 3, 2000);
    expect(opened.transitions[0]!.kind).toBe('open');
    const closed = feed(engine, frame({ batSoc: 0.15, shadow: 0 }), 3, opened.next);
    expect(closed.transitions[0]!.kind).toBe('resolve');
  });

  it('eps.socCritical: battery below 10%', () => {
    const open = tripAndResolve('eps.socCritical', frame({ batSoc: 0.05 }), frame({ batSoc: 0.3 }));
    expect(open).toMatchObject({ severity: 'WARNING', value: 0.05, threshold: 0.1 });
  });

  it('tcs.panelOverTemp (CAUTION at 70 C) and the critical rule (WARNING at 85 C)', () => {
    const caution = tripAndResolve(
      'tcs.panelOverTemp',
      frame({ panelTempC: 72 }),
      frame({ panelTempC: 40 }),
    );
    expect(caution.severity).toBe('CAUTION');
    const warning = tripAndResolve(
      'tcs.panelOverTempCritical',
      frame({ panelTempC: 90 }),
      frame({ panelTempC: 40 }),
    );
    expect(warning.severity).toBe('WARNING');

    const both = createAnomalyEngine(DEFAULT_RULES);
    const ruleIds = feed(both, frame({ panelTempC: 90 }), 3, 0)
      .transitions.map((t) => t.ruleId)
      .sort();
    expect(ruleIds).toEqual(['tcs.panelOverTemp', 'tcs.panelOverTempCritical']);
  });

  it('tcs.obcOverTemp: OBC above 55 C', () => {
    const open = tripAndResolve(
      'tcs.obcOverTemp',
      frame({ obcTempC: 60 }),
      frame({ obcTempC: 30 }),
    );
    expect(open.severity).toBe('CAUTION');
  });

  it('comm.linkLossInPass: station in view but no link (null RSSI or below -125 dBm)', () => {
    const open = tripAndResolve(
      'comm.linkLossInPass',
      frame({ elevDeg: 30, rssiDbm: null }),
      frame({ elevDeg: 30, rssiDbm: -100 }),
      10,
    );
    expect(open).toMatchObject({ subsystem: 'COMM', severity: 'CAUTION', value: null });
    tripAndResolve(
      'comm.linkLossInPass',
      frame({ elevDeg: 30, rssiDbm: -140 }),
      frame({ elevDeg: 30, rssiDbm: -100 }),
      10,
    );
  });

  it('comm.linkLossInPass: ignores low elevation and no-station frames', () => {
    const engine = engineWith(['comm.linkLossInPass']);
    expect(feed(engine, frame({ elevDeg: 5, rssiDbm: null }), 50, 0).transitions).toEqual([]);
    expect(
      feed(engine, frame({ elevDeg: null, rssiDbm: null, stationId: null }), 50, 5000).transitions,
    ).toEqual([]);
  });

  it('adcs.tumble: attitude rate above 2 deg/s', () => {
    const open = tripAndResolve(
      'adcs.tumble',
      frame({ attRateDps: 3.5 }),
      frame({ attRateDps: 0.1 }),
    );
    expect(open).toMatchObject({ subsystem: 'ADCS', severity: 'WARNING' });
  });

  it('eps.busCurrentAnomaly: z-score spike on bus current after warm-up', () => {
    const engine = engineWith(['eps.busCurrentAnomaly']);
    const noisy = (i: number) => frame({ busA: 1.5 + 0.05 * Math.sin(i) });
    let ts = 0;
    for (let i = 0; i < 200; i++, ts += STEP_MS)
      expect(engine.evaluate(SAT, noisy(i), ts)).toEqual([]);
    const opened = feed(engine, frame({ busA: 6 }), 3, ts);
    expect(opened.transitions).toHaveLength(1);
    expect(opened.transitions[0]).toMatchObject({
      kind: 'open',
      severity: 'ADVISORY',
      subsystem: 'EPS',
    });
    let resolved: AlertTransition[] = [];
    let t = opened.next;
    for (let i = 0; i < 10 && resolved.length === 0; i++, t += STEP_MS)
      resolved = engine.evaluate(SAT, noisy(i), t);
    expect(resolved[0]?.kind).toBe('resolve');
  });

  it('eps.socDropRate: fast discharge, but not a slow one', () => {
    const slow = engineWith(['eps.socDropRate']);
    let ts = 0;
    for (let i = 0; i < 100; i++, ts += STEP_MS) {
      expect(slow.evaluate(SAT, frame({ batSoc: 0.8 - i * 0.00001 }), ts)).toEqual([]);
    }
    const engine = engineWith(['eps.socDropRate']);
    const transitions: AlertTransition[] = [];
    ts = 0;
    for (let i = 0; i < 40; i++, ts += STEP_MS)
      transitions.push(...engine.evaluate(SAT, frame({ batSoc: 0.8 - i * 0.0005 }), ts));
    expect(transitions.map((t) => t.kind)).toEqual(['open']); // -0.005 per second vs the -0.002 limit
    expect(transitions[0]).toMatchObject({ severity: 'CAUTION', threshold: -0.002 });
    const steady = feed(engine, frame({ batSoc: 0.7 }), 40, ts);
    expect(steady.transitions.map((t) => t.kind)).toContain('resolve');
  });
});

describe('stale detection (obc.stale)', () => {
  it('opens after the silence limit, throttles updates, and resolves when data resumes', () => {
    const engine = engineWith(['obc.stale'], { updateIntervalMs: 5_000 });
    engine.evaluate(SAT, frame(), 0);
    expect(engine.checkStale(5_000)).toEqual([]);
    expect(engine.checkStale(10_000)).toEqual([]); // exactly at the limit is not yet stale
    const opened = engine.checkStale(11_000);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      kind: 'open',
      key: `${SAT}:obc.stale`,
      subsystem: 'OBC',
      severity: 'CAUTION',
      value: 11_000,
      threshold: 10_000,
    });
    expect(opened[0]!.message).toBe('No telemetry for 11 s (limit 10 s)');
    expect(engine.checkStale(12_000)).toEqual([]);
    const updated = engine.checkStale(16_000);
    expect(updated.map((t) => t.kind)).toEqual(['update']);

    const resumed = engine.evaluate(SAT, frame(), 17_000);
    expect(resumed.map((t) => [t.kind, t.ruleId])).toEqual([['resolve', 'obc.stale']]);
    expect(engine.checkStale(18_000)).toEqual([]);
  });

  it('honours the staleAfterMs option', () => {
    const engine = engineWith(['obc.stale'], { staleAfterMs: 2_000 });
    engine.evaluate(SAT, frame(), 0);
    expect(engine.checkStale(3_000)[0]?.kind).toBe('open');
  });

  it('only flags satellites that have reported, and each one separately', () => {
    const engine = engineWith(['obc.stale']);
    engine.evaluate(1, frame(), 0);
    engine.evaluate(2, frame(), 9_000);
    const opened = engine.checkStale(12_000);
    expect(opened.map((t) => t.satId)).toEqual([1]);
  });
});

describe('setRules', () => {
  it('disabling a rule resolves its open alerts (delivered on the next call) and silences it', () => {
    const engine = createAnomalyEngine([rule('tcs.panelOverTemp'), rule('adcs.tumble')]);
    feed(engine, frame({ panelTempC: 75, attRateDps: 3 }), 3, 0);
    engine.setRules([rule('adcs.tumble'), { ...rule('tcs.panelOverTemp'), enabled: false }]);
    const flushed = engine.checkStale(1000);
    expect(flushed.map((t) => [t.kind, t.ruleId])).toEqual([['resolve', 'tcs.panelOverTemp']]);
    expect(flushed[0]!.message).toContain('disabled');
    expect(feed(engine, frame({ panelTempC: 75, attRateDps: 3 }), 10, 2000).transitions).toEqual(
      [],
    );
    expect(engine.checkStale(5000)).toEqual([]);
  });

  it('a retuned threshold applies to the next sample while the alert stays open', () => {
    const engine = createAnomalyEngine([rule('tcs.panelOverTemp')]);
    const { next } = feed(engine, frame({ panelTempC: 75 }), 3, 0);
    engine.setRules([{ ...rule('tcs.panelOverTemp'), threshold: 100 }]);
    const { transitions } = feed(engine, frame({ panelTempC: 75 }), 3, next);
    expect(transitions.map((t) => t.kind)).toEqual(['resolve']);
  });

  it('ignores unknown domain rule ids and re-enabled rules work again', () => {
    const unknown: AlertRule = { ...rule('eps.lowSocEclipse'), id: 'custom.unknown' };
    const engine = createAnomalyEngine([unknown]);
    expect(feed(engine, frame({ batSoc: 0.01, shadow: 1 }), 5, 0).transitions).toEqual([]);
    engine.setRules([rule('adcs.tumble')]);
    expect(feed(engine, frame({ attRateDps: 5 }), 3, 1000).transitions[0]?.kind).toBe('open');
  });

  it('generic kinds work for any metric (admin-made rule)', () => {
    const custom: AlertRule = {
      id: 'custom.propLow',
      name: 'Propellant low',
      subsystem: 'PROP',
      severity: 'ADVISORY',
      kind: 'threshold',
      metric: 'propKg',
      op: '<',
      threshold: 2,
      samples: 2,
      enabled: true,
    };
    const engine = createAnomalyEngine([custom]);
    const { transitions } = feed(engine, frame({ propKg: 1.5 }), 2, 0);
    expect(transitions[0]).toMatchObject({
      kind: 'open',
      subsystem: 'PROP',
      message: 'Propellant low: propKg 1.5 < 2',
    });
  });
});

describe('performance', () => {
  it('evaluates 65 satellites x 600 samples with all default rules well under 200 ms', () => {
    const engine = createAnomalyEngine(DEFAULT_RULES);
    const frames = Array.from({ length: 600 }, (_, i) =>
      frame({
        batSoc: 0.8 - (i % 50) * 0.0001,
        busA: 1.5 + 0.05 * Math.sin(i),
        panelTempC: 30 + (i % 20),
        shadow: i % 100 < 30 ? 1 : 0,
      }),
    );
    // Warm the JIT so the measurement reflects steady state, as in a long-running server.
    const warm = createAnomalyEngine(DEFAULT_RULES);
    for (let i = 0; i < 600; i++) warm.evaluate(1, frames[i]!, i * STEP_MS);

    const start = performance.now();
    for (let i = 0; i < 600; i++) {
      for (let sat = 0; sat < 65; sat++) engine.evaluate(40000 + sat, frames[i]!, i * STEP_MS);
    }
    expect(performance.now() - start).toBeLessThan(200);
  });
});
