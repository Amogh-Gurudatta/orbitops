// Slow-consumer detection. A client whose outgoing buffers stay above threshold is downgraded to the
// 1 Hz fleet feed; if it stays slow for `kickAfterMs` it is disconnected.
import type { Socket } from 'socket.io';

export interface BackpressureOptions {
  maxQueuedPackets: number;
  maxBufferedBytes: number;
  kickAfterMs: number;
}

export const DEFAULT_BACKPRESSURE: BackpressureOptions = {
  maxQueuedPackets: 200,
  maxBufferedBytes: 1024 * 1024,
  kickAfterMs: 10_000,
};

export interface SocketLoad {
  queuedPackets: number;
  bufferedBytes: number;
}

/** Reads engine.io / ws internals defensively; unknown shapes read as zero load. */
export function readSocketLoad(socket: Socket): SocketLoad {
  const conn = socket.conn as unknown as {
    writeBuffer?: { length?: number };
    transport?: { socket?: { bufferedAmount?: number } };
  };
  return {
    queuedPackets: conn.writeBuffer?.length ?? 0,
    bufferedBytes: conn.transport?.socket?.bufferedAmount ?? 0,
  };
}

export type ConsumerAction = 'ok' | 'downgrade' | 'recover' | 'kick';

export interface ConsumerState {
  slow: boolean;
  slowSince: number | null;
}

/** Pure decision function: returns what to do with this consumer given its current load. */
export function evaluateConsumer(
  state: ConsumerState,
  load: SocketLoad,
  now: number,
  options: BackpressureOptions = DEFAULT_BACKPRESSURE,
): ConsumerAction {
  const overloaded =
    load.queuedPackets > options.maxQueuedPackets || load.bufferedBytes > options.maxBufferedBytes;
  if (!overloaded) return state.slow ? 'recover' : 'ok';
  if (!state.slow) return 'downgrade';
  return state.slowSince !== null && now - state.slowSince >= options.kickAfterMs ? 'kick' : 'ok';
}
