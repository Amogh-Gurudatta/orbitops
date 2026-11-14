// The 10 Hz fan-out. Each tick drains the state store's dirty fields once and distributes them:
//   sat:{id}    every tick, via one room emit (clients wanting < 10 Hz get a per-socket merged batch instead)
//   group:{g}   coalesced, ~2 Hz
//   fleet       coalesced, position + key status only, ~1 Hz
// Every telemetry emit is volatile: a client that cannot keep up misses frames instead of queueing them.
import type { Namespace } from 'socket.io';
import {
  FLEET_HZ,
  GROUP_HZ,
  groupRoom,
  FLEET_ROOM,
  satRoom,
  socketParser,
  TM_DELTA,
  type SatGroup,
  type TmDelta,
} from '@orbitops/shared';
import type { CounterSink } from '../metrics/collector.js';
import type { StateStore } from '../state/store.js';
import {
  DEFAULT_BACKPRESSURE,
  evaluateConsumer,
  readSocketLoad,
  type BackpressureOptions,
} from './backpressure.js';
import type { ClientRegistry, TelemetryClient } from './clients.js';
import { mergeDelta, toFleetDelta } from './coalesce.js';

export const TICK_MS = 100;
/** Timers fire slightly early/late; emit when within this slack of the nominal interval. */
const SLACK_MS = 20;

export const SLOW_CONSUMER_REASON = 'slow_consumer';
/** Event sent to a client right before it is disconnected for being too slow. */
export const KICK_EVENT = 'kick';

export interface BroadcasterDeps {
  nsp: Namespace;
  state: StateStore;
  registry: ClientRegistry;
  counters: CounterSink;
  backpressure?: BackpressureOptions;
  onSlowConsumer?(socketId: string): void;
}

export class Broadcaster {
  private readonly encoder = new socketParser.Encoder();
  private readonly groupAcc = new Map<SatGroup, Map<number, TmDelta>>();
  private fleetAcc = new Map<number, TmDelta>();
  private lastGroupEmit = 0;
  private lastFleetEmit = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: BroadcasterDeps) {}

  start(): void {
    this.timer ??= setInterval(() => this.tick(Date.now()), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(now: number): void {
    this.checkBackpressure(now);
    const deltas = this.deps.state.drainDirty();
    this.accumulate(deltas);
    this.emitSatRooms(deltas);
    this.emitLowRateClients(deltas, now);
    if (now - this.lastGroupEmit >= 1000 / GROUP_HZ - SLACK_MS) {
      this.lastGroupEmit = now;
      this.emitGroups();
    }
    if (now - this.lastFleetEmit >= 1000 / FLEET_HZ - SLACK_MS) {
      this.lastFleetEmit = now;
      this.emitFleet();
    }
  }

  private accumulate(deltas: TmDelta[]): void {
    for (const delta of deltas) {
      const fleet = toFleetDelta(delta);
      if (fleet) mergeDelta(this.fleetAcc, fleet);
      const group = this.deps.state.group(delta.s);
      if (!group) continue;
      let acc = this.groupAcc.get(group);
      if (!acc) this.groupAcc.set(group, (acc = new Map()));
      mergeDelta(acc, delta);
    }
  }

  private emitSatRooms(deltas: TmDelta[]): void {
    const { lowRateIds } = this.deps.registry;
    for (const delta of deltas) this.emitRoom(satRoom(delta.s), [delta], lowRateIds);
  }

  /** Clients asking for < 10 Hz get their subscribed sats merged and sent at their own pace. */
  private emitLowRateClients(deltas: TmDelta[], now: number): void {
    for (const client of this.deps.registry.lowRateClients()) {
      if (client.slow) continue;
      for (const delta of deltas) if (client.sats.has(delta.s)) mergeDelta(client.pending, delta);
      if (client.pending.size > 0 && now - client.lastEmitAt >= 1000 / client.hz - SLACK_MS) {
        client.lastEmitAt = now;
        this.emitTo(client, [...client.pending.values()]);
        client.pending.clear();
      }
    }
  }

  private emitGroups(): void {
    const { slowIds } = this.deps.registry;
    for (const [group, acc] of this.groupAcc) {
      if (acc.size > 0) this.emitRoom(groupRoom(group), [...acc.values()], slowIds);
      acc.clear();
    }
  }

  private emitFleet(): void {
    if (this.fleetAcc.size === 0) return;
    const payload = [...this.fleetAcc.values()];
    this.fleetAcc = new Map();
    const { slowIds } = this.deps.registry;
    this.emitRoom(FLEET_ROOM, payload, slowIds);
    // Slow clients are downgraded to the fleet feed regardless of what they subscribed to.
    for (const id of slowIds) {
      const client = this.deps.registry.get(id);
      if (client) this.emitTo(client, payload);
    }
  }

  private emitRoom(room: string, payload: TmDelta[], except: ReadonlySet<string>): void {
    const { nsp, counters } = this.deps;
    const members = nsp.adapter.rooms.get(room);
    if (!members || members.size === 0) return;
    let excluded = 0;
    for (const id of except) if (members.has(id)) excluded++;
    const recipients = members.size - excluded;
    if (recipients <= 0) return;

    let op = nsp.volatile.to(room);
    if (except.size > 0) op = op.except([...except]);
    op.emit(TM_DELTA, payload);
    counters.inc('messages', recipients);
    counters.inc('bytes', this.packetBytes(payload) * recipients);
  }

  private emitTo(client: TelemetryClient, payload: TmDelta[]): void {
    client.socket.volatile.emit(TM_DELTA, payload);
    this.deps.counters.inc('messages');
    this.deps.counters.inc('bytes', this.packetBytes(payload));
  }

  private packetBytes(payload: TmDelta[]): number {
    const [frame] = this.encoder.encode({
      type: socketParser.PacketType.EVENT,
      nsp: this.deps.nsp.name,
      data: [TM_DELTA, payload],
    });
    return frame.byteLength;
  }

  private checkBackpressure(now: number): void {
    const options = this.deps.backpressure ?? DEFAULT_BACKPRESSURE;
    const { registry } = this.deps;
    for (const client of registry.values()) {
      const action = evaluateConsumer(client, readSocketLoad(client.socket), now, options);
      if (action === 'downgrade') {
        registry.setSlow(client, true, now);
        this.deps.onSlowConsumer?.(client.socket.id);
      } else if (action === 'recover') {
        registry.setSlow(client, false, now);
      } else if (action === 'kick') {
        client.socket.emit(KICK_EVENT, { reason: SLOW_CONSUMER_REASON });
        client.socket.disconnect(true);
      }
    }
  }
}
