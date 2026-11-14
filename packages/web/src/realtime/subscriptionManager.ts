// Ref-counted room subscriptions. Components call acquire(); the manager coalesces churn (React
// StrictMode mount/unmount/mount, route changes) and tells the sink only about net changes.
import { ALLOWED_SUB_HZ } from '@orbitops/shared';

export interface SubscriptionSink {
  subscribe(rooms: string[], hz: number): void;
  unsubscribe(rooms: string[]): void;
}

type Hz = (typeof ALLOWED_SUB_HZ)[number];

/** Snaps an arbitrary rate up to the next one the server allows. */
export function snapHz(hz: number): Hz {
  return (
    ALLOWED_SUB_HZ.find((allowed) => allowed >= hz) ?? ALLOWED_SUB_HZ[ALLOWED_SUB_HZ.length - 1]!
  );
}

export class SubscriptionManager {
  /** room -> (hz -> holders) */
  private readonly desired = new Map<string, Map<number, number>>();
  private readonly applied = new Map<string, number>();
  private sink: SubscriptionSink | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Attaches the transport and applies everything requested so far. */
  attach(sink: SubscriptionSink | null): void {
    this.sink = sink;
    this.applied.clear();
    this.schedule();
  }

  acquire(rooms: readonly string[], hz: number): () => void {
    const rate = snapHz(hz);
    for (const room of rooms) {
      const byHz = this.desired.get(room) ?? new Map<number, number>();
      byHz.set(rate, (byHz.get(rate) ?? 0) + 1);
      this.desired.set(room, byHz);
    }
    this.schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const room of rooms) this.drop(room, rate);
      this.schedule();
    };
  }

  /** Rooms currently applied to the transport, with their rates. */
  snapshot(): ReadonlyMap<string, number> {
    return this.applied;
  }

  /** Applies pending changes immediately (tests, shutdown). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sync();
  }

  private drop(room: string, hz: number): void {
    const byHz = this.desired.get(room);
    if (!byHz) return;
    const left = (byHz.get(hz) ?? 1) - 1;
    if (left <= 0) byHz.delete(hz);
    else byHz.set(hz, left);
    if (byHz.size === 0) this.desired.delete(room);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sync();
    }, 0);
  }

  private sync(): void {
    if (!this.sink) return;
    const toSubscribe = new Map<number, string[]>();
    for (const [room, byHz] of this.desired) {
      const hz = Math.max(...byHz.keys());
      if (this.applied.get(room) === hz) continue;
      this.applied.set(room, hz);
      toSubscribe.set(hz, [...(toSubscribe.get(hz) ?? []), room]);
    }
    const toUnsubscribe = [...this.applied.keys()].filter((room) => !this.desired.has(room));
    for (const room of toUnsubscribe) this.applied.delete(room);

    if (toUnsubscribe.length > 0) this.sink.unsubscribe(toUnsubscribe);
    for (const [hz, rooms] of toSubscribe) this.sink.subscribe(rooms, hz);
  }
}
