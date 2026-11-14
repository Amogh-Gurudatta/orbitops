// Generic per-(satellite, rule) detectors and the hysteresis state machine they feed.
//
// A detector looks at one frame and returns a `Detection`: is the sample in breach, and is it
// far enough back inside the limit to count as clear? (A value in the hysteresis band is
// neither.) `Hysteresis` then turns runs of such samples into open / close decisions.
import type { AlertRule, TelemetryFrame } from '@orbitops/shared';
import { RateWindow, SlidingWindowStats } from './stats.js';

export const DEFAULT_SAMPLES = 3;
export const DEFAULT_CLEAR_RATIO = 0.9;
const DEFAULT_ZSCORE_WINDOW = 60;
const DEFAULT_ROC_WINDOW = 10;

export interface Detection {
  breach: boolean;
  clear: boolean;
  /** The measured quantity: metric value, |z|, or rate per second depending on the detector. */
  value: number | null;
  /** The configured threshold the value was compared against. */
  limit: number;
}

/** Detectors reuse one `Detection` object, so the result is only valid until the next call. */
export interface Detector {
  /** Returns null when the sample carries no information (missing metric, warm-up). */
  observe(frame: TelemetryFrame, ts: number): Detection | null;
}

/**
 * Breach / clear thresholds for one comparison direction. The clear point sits
 * `|threshold| * (1 - clearRatio)` on the safe side of the threshold, so with the default 0.9:
 * '>' 70 clears at <= 63, '<' 0.2 clears at >= 0.22. A clearRatio >= 1 means no band.
 */
export class Limit {
  readonly clearPoint: number;

  constructor(
    readonly op: '>' | '<',
    readonly threshold: number,
    clearRatio: number = DEFAULT_CLEAR_RATIO,
  ) {
    const band = Math.abs(threshold) * Math.max(0, 1 - clearRatio);
    this.clearPoint = op === '>' ? threshold - band : threshold + band;
  }

  breached(value: number): boolean {
    return this.op === '>' ? value > this.threshold : value < this.threshold;
  }

  cleared(value: number): boolean {
    return this.op === '>' ? value <= this.clearPoint : value >= this.clearPoint;
  }
}

/** Fill `out` from a numeric value and its limit. */
export function judge(out: Detection, value: number, limit: Limit): Detection {
  out.value = value;
  out.limit = limit.threshold;
  out.breach = limit.breached(value);
  out.clear = limit.cleared(value);
  return out;
}

function newDetection(limit: number): Detection {
  return { breach: false, clear: false, value: null, limit };
}

function limitOf(rule: AlertRule): Limit {
  return new Limit(rule.op, rule.threshold, rule.clearRatio);
}

/** Numeric metric of a frame, or null for a null / non-numeric field. */
export function numericMetric(frame: TelemetryFrame, metric: AlertRule['metric']): number | null {
  const value = frame[metric];
  return typeof value === 'number' ? value : null;
}

/**
 * Opens after `samples` consecutive breaching samples; closes after `samples` consecutive
 * clear samples. `canOpen` lets the caller defer opening (cooldown) - while deferred the
 * breach run stays saturated, so it opens on the first sample once allowed.
 */
export class Hysteresis {
  constructor(
    private readonly samples: number,
    public open = false,
  ) {}

  private run = 0;

  step(detection: Detection, canOpen: boolean): 'open' | 'close' | null {
    if (!this.open) {
      this.run = detection.breach ? Math.min(this.run + 1, this.samples) : 0;
      if (this.run >= this.samples && canOpen) {
        this.open = true;
        this.run = 0;
        return 'open';
      }
      return null;
    }
    this.run = detection.clear ? this.run + 1 : 0;
    if (this.run >= this.samples) {
      this.open = false;
      this.run = 0;
      return 'close';
    }
    return null;
  }
}

/** Plain threshold on a metric: `metric op threshold`. */
export function createThresholdDetector(rule: AlertRule): Detector {
  const limit = limitOf(rule);
  const out = newDetection(rule.threshold);
  return {
    observe(frame) {
      const value = numericMetric(frame, rule.metric);
      return value === null ? null : judge(out, value, limit);
    },
  };
}

/**
 * Two-sided z-score against the metric's own trailing window (`op` is ignored: both tails
 * count). Silent until the window is full. The sample is scored before it joins the window.
 */
export function createZScoreDetector(rule: AlertRule): Detector {
  const window = new SlidingWindowStats(rule.windowSize ?? DEFAULT_ZSCORE_WINDOW);
  const limit = new Limit('>', rule.threshold, rule.clearRatio);
  const out = newDetection(rule.threshold);
  return {
    observe(frame) {
      const value = numericMetric(frame, rule.metric);
      if (value === null) return null;
      const ready = window.isFull;
      const z = ready ? Math.abs(window.zScore(value)) : 0;
      window.push(value);
      return ready ? judge(out, z, limit) : null;
    },
  };
}

/**
 * Signed rate of change per second over the last `windowSize` samples:
 * `(value - value_n_samples_ago) / dt`. Use op '<' with a negative threshold for falling
 * values. Silent until the window is full or if time did not advance.
 */
export function createRocDetector(rule: AlertRule): Detector {
  const window = new RateWindow(rule.windowSize ?? DEFAULT_ROC_WINDOW);
  const limit = limitOf(rule);
  const out = newDetection(rule.threshold);
  return {
    observe(frame, ts) {
      const value = numericMetric(frame, rule.metric);
      if (value === null) return null;
      const rate = window.rateThenPush(value, ts);
      return rate === null ? null : judge(out, rate, limit);
    },
  };
}
