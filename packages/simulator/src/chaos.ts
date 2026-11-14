// Chaos mode: when the server sends a ChaosConfig, outgoing batches are deliberately corrupted so the
// server's defences (dedup, reorder buffer, validation) can be demonstrated. Only the copy put on the
// wire is mangled; the simulator's own buffers stay clean, so nothing is lost on retry.
import { CHAOS_DEFAULTS, type ChaosConfig, type TelemetryEvent } from '@orbitops/shared';

export interface ChaosCounts {
  duplicates: number;
  reordered: number;
  malformed: number;
}

/** Cap on events delayed to a later batch per source, so a high reorderRate cannot grow memory. */
const MAX_HELD_PER_SOURCE = 64;

export class Chaos {
  private config: ChaosConfig = { ...CHAOS_DEFAULTS };
  private readonly held = new Map<string, unknown[]>();
  private readonly total: ChaosCounts = { duplicates: 0, reordered: 0, malformed: 0 };

  constructor(private readonly rng: () => number = Math.random) {}

  configure(config: ChaosConfig): void {
    this.config = config;
    if (!config.enabled) this.held.clear();
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Cumulative injected counts since process start. */
  get counts(): Readonly<ChaosCounts> {
    return this.total;
  }

  /**
   * Returns the events to actually put on the wire for one source's batch (never empty when the input
   * is not). Never mutates its input. Delayed events resurface, out of order, in a later batch.
   */
  apply(sourceId: string, events: readonly TelemetryEvent[]): unknown[] {
    if (!this.config.enabled) return [...events];
    const { duplicateRate, reorderRate, malformedRate } = this.config;

    const staged: unknown[] = [];
    for (const event of events) {
      const wire = this.rng() < malformedRate ? this.malform(event) : event;
      staged.push(wire);
      if (this.rng() < duplicateRate) {
        staged.push(event);
        this.total.duplicates++;
      }
    }

    const previouslyHeld = this.held.get(sourceId) ?? [];
    const nowHeld: unknown[] = [];
    const out: unknown[] = [];
    for (let i = 0; i < staged.length; i++) {
      const current = staged[i];
      if (this.rng() >= reorderRate) {
        out.push(current);
        continue;
      }
      this.total.reordered++;
      const next = staged[i + 1];
      if (next !== undefined && this.rng() < 0.5) {
        out.push(next, current); // swapped within the batch
        i++;
      } else if (nowHeld.length < MAX_HELD_PER_SOURCE) {
        nowHeld.push(current); // delayed to the next batch
      } else {
        out.push(current);
      }
    }
    out.push(...previouslyHeld);
    if (out.length === 0) out.push(...nowHeld.splice(0));
    this.held.set(sourceId, nowHeld);
    return out;
  }

  private malform(event: TelemetryEvent): unknown {
    this.total.malformed++;
    const copy = structuredClone(event) as Record<string, unknown> & {
      data: Record<string, unknown>;
    };
    const keys = Object.keys(copy.data);
    switch (Math.floor(this.rng() * 5)) {
      case 0:
        copy.data['solarW'] = NaN;
        break;
      case 1:
        copy.data['lat'] = 91 + this.rng() * 400;
        break;
      case 2:
        delete copy.data[keys[Math.floor(this.rng() * keys.length)] ?? 'lat'];
        break;
      case 3:
        copy.data['batSoc'] = String(copy.data['batSoc']);
        break;
      default:
        copy['type'] = 'bogus';
    }
    return copy;
  }
}
