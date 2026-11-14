// Shared SUB/UNSUB handling for the /telemetry and /alerts namespaces: payload validation, room allow-list,
// per-client room cap and a sliding-window limit on subscription changes.
import type { Socket } from 'socket.io';
import { MAX_ROOMS_PER_CLIENT, parseRoom, SubscribeRequest, SUB, UNSUB } from '@orbitops/shared';
import type { ParsedRoom } from '@orbitops/shared';

export const SUB_CHANGES_PER_WINDOW = 20;
export const SUB_WINDOW_MS = 10_000;

export type SubAck = { ok: true; rooms: string[] } | { ok: false; error: string };

export class SlidingWindowLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(now: number): boolean {
    while (this.hits.length > 0 && now - (this.hits[0] as number) >= this.windowMs)
      this.hits.shift();
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

export interface SubscriptionHooks {
  allows(room: ParsedRoom): boolean;
  /** After rooms are joined. `requested` holds every validated room (including ones already joined). */
  onSubscribed?(requested: { name: string; room: ParsedRoom }[], request: SubscribeRequest): void;
  onUnsubscribed?(left: { name: string; room: ParsedRoom }[]): void;
}

export const joinedRooms = (socket: Socket): string[] =>
  [...socket.rooms].filter((room) => room !== socket.id);

type Ack = ((response: SubAck) => void) | undefined;

function parseRequest(
  payload: unknown,
  hooks: SubscriptionHooks,
): { request: SubscribeRequest; rooms: { name: string; room: ParsedRoom }[] } | string {
  const request = SubscribeRequest.safeParse(payload);
  if (!request.success) return 'invalid_request';
  const rooms: { name: string; room: ParsedRoom }[] = [];
  for (const name of new Set(request.data.rooms)) {
    const room = parseRoom(name);
    if (!room || !hooks.allows(room)) return 'invalid_room';
    rooms.push({ name, room });
  }
  return { request: request.data, rooms };
}

export function attachSubscriptionHandlers(
  socket: Socket,
  hooks: SubscriptionHooks,
  now: () => number = Date.now,
): void {
  const limiter = new SlidingWindowLimiter(SUB_CHANGES_PER_WINDOW, SUB_WINDOW_MS);
  const reply = (ack: unknown, response: SubAck) => {
    if (typeof ack === 'function') (ack as NonNullable<Ack>)(response);
  };

  socket.on(SUB, async (payload: unknown, ack?: Ack) => {
    if (!limiter.allow(now())) return reply(ack, { ok: false, error: 'rate_limited' });
    const parsed = parseRequest(payload, hooks);
    if (typeof parsed === 'string') return reply(ack, { ok: false, error: parsed });

    const current = new Set(joinedRooms(socket));
    const fresh = parsed.rooms.filter((r) => !current.has(r.name));
    if (current.size + fresh.length > MAX_ROOMS_PER_CLIENT) {
      return reply(ack, { ok: false, error: 'too_many_rooms' });
    }
    await socket.join(fresh.map((r) => r.name));
    hooks.onSubscribed?.(parsed.rooms, parsed.request);
    reply(ack, { ok: true, rooms: joinedRooms(socket) });
  });

  socket.on(UNSUB, async (payload: unknown, ack?: Ack) => {
    if (!limiter.allow(now())) return reply(ack, { ok: false, error: 'rate_limited' });
    const parsed = parseRequest(payload, hooks);
    if (typeof parsed === 'string') return reply(ack, { ok: false, error: parsed });
    for (const { name } of parsed.rooms) await socket.leave(name);
    hooks.onUnsubscribed?.(parsed.rooms);
    reply(ack, { ok: true, rooms: joinedRooms(socket) });
  });
}
