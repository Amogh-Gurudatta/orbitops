// Live state: the latest frame per satellite plus the set of fields changed since the last broadcast tick.
// The broadcaster drains the dirty sets once per tick, so every client room is fed from the same deltas.
import {
  diffFrames,
  encodeFrame,
  type SatGroup,
  type TelemetryFrame,
  type TmDelta,
  type TmSnapshot,
} from '@orbitops/shared';

interface SatState {
  seq: number;
  ts: number;
  frame: TelemetryFrame;
  dirty: Set<keyof TelemetryFrame>;
  group: SatGroup | undefined;
  /** Server wall-clock time of the last applied sample, for staleness tracking. */
  lastSeenAt: number;
}

export class StateStore {
  private readonly sats = new Map<number, SatState>();

  constructor(private readonly groupOf: (satId: number) => SatGroup | undefined) {}

  /** Applies an in-order sample and marks the fields whose rounded value changed. */
  apply(
    satId: number,
    seq: number,
    ts: number,
    frame: TelemetryFrame,
    now: number = Date.now(),
  ): void {
    const current = this.sats.get(satId);
    const changed = diffFrames(current?.frame, frame);
    const dirty = current?.dirty ?? new Set<keyof TelemetryFrame>();
    for (const key of Object.keys(changed) as (keyof TelemetryFrame)[]) dirty.add(key);
    this.sats.set(satId, {
      seq,
      ts,
      frame,
      dirty,
      group: current?.group ?? this.groupOf(satId),
      lastSeenAt: now,
    });
  }

  /** One delta per satellite with pending changes; clears the dirty sets. */
  drainDirty(): TmDelta[] {
    const deltas: TmDelta[] = [];
    for (const [satId, state] of this.sats) {
      if (state.dirty.size === 0) continue;
      const changed: Record<string, unknown> = {};
      for (const key of state.dirty) changed[key] = state.frame[key];
      state.dirty.clear();
      deltas.push({
        s: satId,
        q: state.seq,
        t: state.ts,
        d: encodeFrame(changed as Partial<TelemetryFrame>),
      });
    }
    return deltas;
  }

  snapshot(satId: number): TmSnapshot | undefined {
    const state = this.sats.get(satId);
    return state && { s: satId, q: state.seq, t: state.ts, d: encodeFrame(state.frame) };
  }

  snapshots(satIds?: Iterable<number>): TmSnapshot[] {
    const out: TmSnapshot[] = [];
    for (const satId of satIds ?? this.sats.keys()) {
      const snap = this.snapshot(satId);
      if (snap) out.push(snap);
    }
    return out;
  }

  group(satId: number): SatGroup | undefined {
    return this.sats.get(satId)?.group ?? this.groupOf(satId);
  }

  lastSeenAt(satId: number): number | undefined {
    return this.sats.get(satId)?.lastSeenAt;
  }

  /** Satellites with no sample within `maxAgeMs` of `now`. */
  staleSatIds(now: number, maxAgeMs: number): number[] {
    const stale: number[] = [];
    for (const [satId, state] of this.sats)
      if (now - state.lastSeenAt > maxAgeMs) stale.push(satId);
    return stale;
  }

  satIdsInGroup(group: SatGroup): number[] {
    const ids: number[] = [];
    for (const [satId, state] of this.sats) if (state.group === group) ids.push(satId);
    return ids;
  }

  get size(): number {
    return this.sats.size;
  }
}
