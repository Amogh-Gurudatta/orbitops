import { describe, expect, it } from 'vitest';
import { evaluateConsumer, type BackpressureOptions } from './backpressure.js';

const opts: BackpressureOptions = {
  maxQueuedPackets: 10,
  maxBufferedBytes: 1000,
  kickAfterMs: 10_000,
};
const calm = { queuedPackets: 0, bufferedBytes: 0 };
const busy = { queuedPackets: 50, bufferedBytes: 0 };

describe('evaluateConsumer', () => {
  it('leaves healthy consumers alone', () => {
    expect(evaluateConsumer({ slow: false, slowSince: null }, calm, 0, opts)).toBe('ok');
  });

  it('downgrades on queue or byte overload', () => {
    expect(evaluateConsumer({ slow: false, slowSince: null }, busy, 0, opts)).toBe('downgrade');
    expect(
      evaluateConsumer(
        { slow: false, slowSince: null },
        { queuedPackets: 0, bufferedBytes: 5000 },
        0,
        opts,
      ),
    ).toBe('downgrade');
  });

  it('kicks only after staying slow for the full duration', () => {
    const state = { slow: true, slowSince: 1000 };
    expect(evaluateConsumer(state, busy, 5000, opts)).toBe('ok');
    expect(evaluateConsumer(state, busy, 11_000, opts)).toBe('kick');
  });

  it('recovers once the buffers drain', () => {
    expect(evaluateConsumer({ slow: true, slowSince: 1000 }, calm, 2000, opts)).toBe('recover');
  });
});
