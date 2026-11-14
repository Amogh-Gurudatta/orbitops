import { describe, expect, it, vi } from 'vitest';
import { createFrameLoop } from './frameLoop.ts';

function manualRaf() {
  let queued: FrameRequestCallback | null = null;
  return {
    request: (cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    },
    cancel: vi.fn(() => {
      queued = null;
    }),
    step(now: number) {
      const cb = queued;
      queued = null;
      cb?.(now);
    },
    get pending() {
      return queued !== null;
    },
  };
}

describe('frameLoop', () => {
  it('runs callbacks every frame and stops when none remain', () => {
    const raf = manualRaf();
    const loop = createFrameLoop(raf.request, raf.cancel);
    const cb = vi.fn();
    const off = loop.onFrame(cb);
    raf.step(0);
    raf.step(16);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    expect(raf.cancel).toHaveBeenCalled();
    expect(raf.pending).toBe(false);
  });

  it('throttles a callback to its hz cap', () => {
    const raf = manualRaf();
    const loop = createFrameLoop(raf.request, raf.cancel);
    const cb = vi.fn();
    loop.onFrame(cb, { hz: 10 });
    for (let t = 0; t <= 1000; t += 16.7) raf.step(t);
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(11);
  });

  it('does not restart the loop for a second registration', () => {
    const raf = manualRaf();
    const loop = createFrameLoop(raf.request, raf.cancel);
    const a = vi.fn();
    const b = vi.fn();
    loop.onFrame(a);
    loop.onFrame(b, { hz: 1 });
    raf.step(0);
    raf.step(16);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
