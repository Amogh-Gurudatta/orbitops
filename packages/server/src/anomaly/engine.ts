// The anomaly engine: one small state machine per (satellite, rule) that turns detector output
// into alert lifecycle transitions.
//
//   open    - detector tripped (after `samples` consecutive breaches) and the key is not cooling
//             down from a recent resolve
//   update  - alert still breaching; at most one per updateIntervalMs, only if the count moved
//   resolve - detector cleared (after `samples` consecutive clear samples), or rule disabled
//
// All time comes from the arguments (event timestamps / `now`), never from a clock, so the
// engine is deterministic. State is created lazily and rule changes are picked up per sample.
import {
  type AlertRule,
  type Severity,
  type Subsystem,
  type TelemetryFrame,
  alertKey,
} from '@orbitops/shared';
import {
  DEFAULT_SAMPLES,
  type Detection,
  type Detector,
  Hysteresis,
  createRocDetector,
  createThresholdDetector,
  createZScoreDetector,
} from './detectors.js';
import { createDomainDetector, describeAlert, isKnownDomainRule } from './domainRules.js';

export interface AlertTransition {
  kind: 'open' | 'update' | 'resolve';
  key: string;
  satId: number;
  ruleId: string;
  subsystem: Subsystem;
  severity: Severity;
  message: string;
  value: number | null;
  threshold: number | null;
  ts: number;
  count: number;
}

export interface AnomalyEngine {
  evaluate(satId: number, frame: TelemetryFrame, ts: number): AlertTransition[];
  /** Call about once per second; also flushes resolves caused by `setRules`. */
  checkStale(now: number): AlertTransition[];
  setRules(rules: AlertRule[]): void;
}

export interface AnomalyEngineOptions {
  /** After a resolve, the same alert key may not re-open for this long. Default 60 s. */
  cooldownMs?: number;
  /** Minimum spacing of 'update' transitions per alert. Default 5 s. */
  updateIntervalMs?: number;
  /** Overrides the threshold of 'stale' rules (default: the rule's own threshold, 10 s). */
  staleAfterMs?: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5_000;

/** A rule plus what the engine derived from it; replaced (new identity) when the rule changes. */
interface CompiledRule {
  rule: AlertRule;
  signature: string;
  /** Null for 'stale' rules, which are driven by `checkStale` instead of by frames. */
  makeDetector: (() => Detector) | null;
}

interface RuleState {
  compiled: CompiledRule;
  readonly satId: number;
  readonly key: string;
  detector: Detector | null;
  hysteresis: Hysteresis;
  count: number;
  emittedCount: number;
  lastUpdateTs: number;
  lastResolveTs: number;
  value: number | null;
  limit: number;
}

interface SatState {
  lastSeen: number;
  rules: Map<string, RuleState>;
}

function detectorFactory(rule: AlertRule): (() => Detector) | null {
  switch (rule.kind) {
    case 'threshold':
      return () => createThresholdDetector(rule);
    case 'zscore':
      return () => createZScoreDetector(rule);
    case 'roc':
      return () => createRocDetector(rule);
    case 'domain':
      return () => createDomainDetector(rule)!;
    case 'stale':
      return null;
  }
}

/** Enabled, understood rules only. Reuses `previous` when the rule is unchanged. */
function compile(rule: AlertRule, previous: CompiledRule | undefined): CompiledRule | null {
  if (!rule.enabled) return null;
  if (rule.kind === 'domain' && !isKnownDomainRule(rule.id)) return null;
  const signature = JSON.stringify(rule);
  if (previous?.signature === signature) return previous;
  return { rule, signature, makeDetector: detectorFactory(rule) };
}

function samplesFor(rule: AlertRule): number {
  return rule.kind === 'stale' ? 1 : (rule.samples ?? DEFAULT_SAMPLES);
}

export function createAnomalyEngine(
  initialRules: AlertRule[],
  opts: AnomalyEngineOptions = {},
): AnomalyEngine {
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const updateIntervalMs = opts.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;

  let compiledById = new Map<string, CompiledRule>();
  let frameRules: CompiledRule[] = [];
  let staleRules: CompiledRule[] = [];
  const sats = new Map<number, SatState>();
  /** Resolves produced by setRules, delivered with the next evaluate / checkStale result. */
  let pending: AlertTransition[] = [];
  let latestTs = 0;

  const silence: Detection = { breach: false, clear: false, value: 0, limit: 0 };
  const FRESH: Detection = { breach: false, clear: true, value: 0, limit: 0 };

  function newState(satId: number, compiled: CompiledRule): RuleState {
    return {
      compiled,
      satId,
      key: alertKey(satId, compiled.rule.id),
      detector: compiled.makeDetector?.() ?? null,
      hysteresis: new Hysteresis(samplesFor(compiled.rule)),
      count: 0,
      emittedCount: 0,
      lastUpdateTs: 0,
      lastResolveTs: Number.NEGATIVE_INFINITY,
      value: null,
      limit: compiled.rule.threshold,
    };
  }

  /** The rule changed under an existing state: new detector and window, same open alert. */
  function rebind(state: RuleState, compiled: CompiledRule): void {
    state.compiled = compiled;
    state.detector = compiled.makeDetector?.() ?? null;
    state.hysteresis = new Hysteresis(samplesFor(compiled.rule), state.hysteresis.open);
  }

  function transition(
    kind: AlertTransition['kind'],
    state: RuleState,
    ts: number,
    message?: string,
  ): AlertTransition {
    const { rule } = state.compiled;
    return {
      kind,
      key: state.key,
      satId: state.satId,
      ruleId: rule.id,
      subsystem: rule.subsystem,
      severity: rule.severity,
      message: message ?? describeAlert(rule, state.value, state.limit),
      value: state.value,
      threshold: state.limit,
      ts,
      count: state.count,
    };
  }

  /** Feed one detection into a state machine and push any resulting transition. */
  function advance(
    state: RuleState,
    detection: Detection,
    ts: number,
    out: AlertTransition[],
  ): void {
    const change = state.hysteresis.step(detection, ts - state.lastResolveTs >= cooldownMs);
    if (change === 'open') {
      state.count = 1;
      state.emittedCount = 1;
      state.lastUpdateTs = ts;
      state.value = detection.value;
      state.limit = detection.limit;
      out.push(transition('open', state, ts));
    } else if (change === 'close') {
      state.lastResolveTs = ts;
      state.value = detection.value;
      state.limit = detection.limit;
      out.push(transition('resolve', state, ts, `${state.compiled.rule.name} cleared`));
    } else if (state.hysteresis.open) {
      if (detection.breach) {
        state.count += 1;
        state.value = detection.value;
        state.limit = detection.limit;
      }
      if (state.count !== state.emittedCount && ts - state.lastUpdateTs >= updateIntervalMs) {
        state.emittedCount = state.count;
        state.lastUpdateTs = ts;
        out.push(transition('update', state, ts));
      }
    }
  }

  function stateFor(sat: SatState, satId: number, compiled: CompiledRule): RuleState {
    let state = sat.rules.get(compiled.rule.id);
    if (!state) {
      state = newState(satId, compiled);
      sat.rules.set(compiled.rule.id, state);
    } else if (state.compiled !== compiled) {
      rebind(state, compiled);
    }
    return state;
  }

  function takePending(): AlertTransition[] {
    if (pending.length === 0) return [];
    const flushed = pending;
    pending = [];
    return flushed;
  }

  function staleLimitMs(compiled: CompiledRule): number {
    return opts.staleAfterMs ?? compiled.rule.threshold;
  }

  function setRules(rules: AlertRule[]): void {
    const next = new Map<string, CompiledRule>();
    for (const rule of rules) {
      const compiled = compile(rule, compiledById.get(rule.id));
      if (compiled) next.set(rule.id, compiled);
    }
    compiledById = next;
    const all = [...next.values()];
    frameRules = all.filter((c) => c.makeDetector !== null);
    staleRules = all.filter((c) => c.makeDetector === null);

    for (const sat of sats.values()) {
      for (const [ruleId, state] of sat.rules) {
        if (next.has(ruleId)) continue;
        if (state.hysteresis.open) {
          pending.push(
            transition('resolve', state, latestTs, `${state.compiled.rule.name} rule disabled`),
          );
        }
        sat.rules.delete(ruleId);
      }
    }
  }

  function evaluate(satId: number, frame: TelemetryFrame, ts: number): AlertTransition[] {
    const out = takePending();
    if (ts > latestTs) latestTs = ts;
    let sat = sats.get(satId);
    if (!sat) {
      sat = { lastSeen: ts, rules: new Map() };
      sats.set(satId, sat);
    } else if (ts > sat.lastSeen) {
      sat.lastSeen = ts;
    }

    // Data is flowing again: any stale alert for this satellite resolves immediately.
    for (const compiled of staleRules) {
      const state = sat.rules.get(compiled.rule.id);
      if (state?.hysteresis.open) advance(state, FRESH, ts, out);
    }

    for (const compiled of frameRules) {
      const state = stateFor(sat, satId, compiled);
      const detection = state.detector?.observe(frame, ts);
      if (detection) advance(state, detection, ts, out);
    }
    return out;
  }

  function checkStale(now: number): AlertTransition[] {
    const out = takePending();
    if (now > latestTs) latestTs = now;
    for (const [satId, sat] of sats) {
      const silentMs = now - sat.lastSeen;
      for (const compiled of staleRules) {
        const limit = staleLimitMs(compiled);
        const stale = silentMs > limit;
        const existing = sat.rules.get(compiled.rule.id);
        if (!stale && !existing?.hysteresis.open) continue;
        silence.breach = stale;
        silence.clear = !stale;
        silence.value = silentMs;
        silence.limit = limit;
        advance(stateFor(sat, satId, compiled), silence, now, out);
      }
    }
    return out;
  }

  setRules(initialRules);
  return { evaluate, checkStale, setRules };
}
