// Spacecraft-specific knowledge: the default rule set, predicates for rules that need more than
// one metric (kind 'domain', looked up by rule id), and human-readable alert messages.
//
// Thresholds, severity, clearRatio and samples always come from the AlertRule, so an admin can
// tune them; only the gating logic (e.g. "while in eclipse") lives here.
import type { AlertRule, TelemetryFrame } from '@orbitops/shared';
import { type Detection, type Detector, Limit, judge } from './detectors.js';

/** Fraction of the solar disc hidden by Earth above which we call it eclipse. */
export const ECLIPSE_SHADOW = 0.5;
/** A ground station counts as "in view" above this elevation. */
export const IN_PASS_ELEVATION_DEG = 10;

export const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'eps.lowSocEclipse',
    name: 'Low battery in eclipse',
    subsystem: 'EPS',
    severity: 'WARNING',
    kind: 'domain',
    metric: 'batSoc',
    op: '<',
    threshold: 0.2,
    enabled: true,
  },
  {
    id: 'eps.socCritical',
    name: 'Battery critical',
    subsystem: 'EPS',
    severity: 'WARNING',
    kind: 'threshold',
    metric: 'batSoc',
    op: '<',
    threshold: 0.1,
    enabled: true,
  },
  {
    id: 'tcs.panelOverTemp',
    name: 'Solar panel over-temperature',
    subsystem: 'TCS',
    severity: 'CAUTION',
    kind: 'threshold',
    metric: 'panelTempC',
    op: '>',
    threshold: 70,
    enabled: true,
  },
  {
    id: 'tcs.panelOverTempCritical',
    name: 'Solar panel critical over-temperature',
    subsystem: 'TCS',
    severity: 'WARNING',
    kind: 'threshold',
    metric: 'panelTempC',
    op: '>',
    threshold: 85,
    enabled: true,
  },
  {
    id: 'tcs.obcOverTemp',
    name: 'OBC over-temperature',
    subsystem: 'TCS',
    severity: 'CAUTION',
    kind: 'threshold',
    metric: 'obcTempC',
    op: '>',
    threshold: 55,
    enabled: true,
  },
  {
    id: 'comm.linkLossInPass',
    name: 'No link during pass',
    subsystem: 'COMM',
    severity: 'CAUTION',
    kind: 'domain',
    metric: 'rssiDbm',
    op: '<',
    threshold: -125,
    samples: 10,
    enabled: true,
  },
  {
    id: 'adcs.tumble',
    name: 'Attitude tumble',
    subsystem: 'ADCS',
    severity: 'WARNING',
    kind: 'threshold',
    metric: 'attRateDps',
    op: '>',
    threshold: 2,
    enabled: true,
  },
  {
    id: 'eps.busCurrentAnomaly',
    name: 'Bus current anomaly',
    subsystem: 'EPS',
    severity: 'ADVISORY',
    kind: 'zscore',
    metric: 'busA',
    op: '>',
    // 5 sigma: at 4 sigma routine payload switching still produced a steady trickle of nuisance advisories.
    threshold: 5,
    // ~5 min at 5 Hz: long enough that routine payload-on periods (every ~90 s) are part of the baseline
    // variance, so only genuinely unusual current draws alarm (ISA-18.2: avoid nuisance alarms).
    windowSize: 1500,
    enabled: true,
  },
  {
    id: 'eps.socDropRate',
    name: 'Battery fast discharge',
    subsystem: 'EPS',
    severity: 'CAUTION',
    kind: 'roc',
    metric: 'batSoc',
    op: '<',
    threshold: -0.002,
    windowSize: 20,
    enabled: true,
  },
  // Stale rules ignore the metric; threshold is the allowed silence in milliseconds.
  {
    id: 'obc.stale',
    name: 'Telemetry stale',
    subsystem: 'OBC',
    severity: 'CAUTION',
    kind: 'stale',
    metric: 'mode',
    op: '>',
    threshold: 10_000,
    samples: 1,
    enabled: true,
  },
];

type Predicate = (frame: TelemetryFrame, limit: Limit, out: Detection) => Detection;

interface DomainRule {
  op: '>' | '<';
  predicate: Predicate;
}

/** Marks the sample as clearly healthy (gate not satisfied, so the condition does not apply). */
function inapplicable(out: Detection, value: number | null, limit: Limit): Detection {
  out.value = value;
  out.limit = limit.threshold;
  out.breach = false;
  out.clear = true;
  return out;
}

const DOMAIN_RULES: Record<string, DomainRule> = {
  // Low state of charge matters most while the panels are dark.
  'eps.lowSocEclipse': {
    op: '<',
    predicate: (f, limit, out) =>
      f.shadow > ECLIPSE_SHADOW ? judge(out, f.batSoc, limit) : inapplicable(out, f.batSoc, limit),
  },
  // A station is above the horizon but we hear nothing: no RSSI at all, or below the floor.
  'comm.linkLossInPass': {
    op: '<',
    predicate: (f, limit, out) => {
      if (f.elevDeg === null || f.elevDeg <= IN_PASS_ELEVATION_DEG)
        return inapplicable(out, f.rssiDbm, limit);
      if (f.rssiDbm === null) {
        out.value = null;
        out.limit = limit.threshold;
        out.breach = true;
        out.clear = false;
        return out;
      }
      return judge(out, f.rssiDbm, limit);
    },
  },
};

export function isKnownDomainRule(ruleId: string): boolean {
  return Object.hasOwn(DOMAIN_RULES, ruleId);
}

/** Detector for a kind 'domain' rule, or null if the id has no registered predicate. */
export function createDomainDetector(rule: AlertRule): Detector | null {
  if (!isKnownDomainRule(rule.id)) return null;
  const domain = DOMAIN_RULES[rule.id]!;
  const limit = new Limit(domain.op, rule.threshold, rule.clearRatio);
  const out: Detection = { breach: false, clear: false, value: null, limit: rule.threshold };
  return { observe: (frame) => domain.predicate(frame, limit, out) };
}

// --- Messages ----------------------------------------------------------------

/** Round for display without trailing zeros: 20.0 -> "20", 18.24 -> "18.2". */
function num(x: number, digits = 1): string {
  return String(Number(x.toFixed(digits)));
}

function percent(fraction: number): string {
  return `${num(fraction * 100)}%`;
}

type Describe = (value: number | null, limit: number) => string;

const SPECIFIC_MESSAGES: Record<string, Describe> = {
  'eps.lowSocEclipse': (v, l) => `Battery ${percent(v ?? 0)} during eclipse (limit ${percent(l)})`,
  'eps.socCritical': (v, l) => `Battery critically low at ${percent(v ?? 0)} (limit ${percent(l)})`,
  'tcs.panelOverTemp': (v, l) => `Solar panel at ${num(v ?? 0)} °C (limit ${num(l)} °C)`,
  'tcs.panelOverTempCritical': (v, l) =>
    `Solar panel critically hot at ${num(v ?? 0)} °C (limit ${num(l)} °C)`,
  'tcs.obcOverTemp': (v, l) => `OBC at ${num(v ?? 0)} °C (limit ${num(l)} °C)`,
  'comm.linkLossInPass': (v, l) =>
    `No link with station in view (RSSI ${v === null ? 'none' : `${num(v)} dBm`}, floor ${num(l)} dBm)`,
  'adcs.tumble': (v, l) => `Attitude rate ${num(v ?? 0, 2)} °/s (limit ${num(l, 2)} °/s)`,
  'eps.busCurrentAnomaly': (v, l) =>
    `Bus current anomaly: z-score ${num(v ?? 0)} (limit ${num(l)})`,
  'eps.socDropRate': (v, l) =>
    `Battery discharging at ${num(Math.abs(v ?? 0) * 100, 2)} %/s (limit ${num(Math.abs(l) * 100, 2)} %/s)`,
  'obc.stale': (v, l) => `No telemetry for ${num((v ?? 0) / 1000)} s (limit ${num(l / 1000)} s)`,
};

/** Message for an open / update; custom text for the default rules, generic for admin-made ones. */
export function describeAlert(rule: AlertRule, value: number | null, limit: number): string {
  const specific = Object.hasOwn(SPECIFIC_MESSAGES, rule.id)
    ? SPECIFIC_MESSAGES[rule.id]
    : undefined;
  if (specific) return specific(value, limit);
  const shown = value === null ? 'none' : num(value, 2);
  switch (rule.kind) {
    case 'zscore':
      return `${rule.name}: ${rule.metric} z-score ${shown} (limit ${num(limit, 2)})`;
    case 'roc':
      return `${rule.name}: ${rule.metric} changing at ${shown}/s (limit ${num(limit, 3)}/s)`;
    case 'threshold':
      return `${rule.name}: ${rule.metric} ${shown} ${rule.op} ${num(limit, 2)}`;
    default:
      return `${rule.name}: ${shown} (limit ${num(limit, 2)})`;
  }
}
