import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionManager, snapHz } from './subscriptionManager.ts';

function setup() {
  const sink = { subscribe: vi.fn(), unsubscribe: vi.fn() };
  const manager = new SubscriptionManager();
  manager.attach(sink);
  return { sink, manager };
}

describe('SubscriptionManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('subscribes once for multiple holders and unsubscribes after the last release', () => {
    const { sink, manager } = setup();
    const a = manager.acquire(['sat:1'], 10);
    const b = manager.acquire(['sat:1'], 10);
    manager.flush();
    expect(sink.subscribe).toHaveBeenCalledTimes(1);
    expect(sink.subscribe).toHaveBeenCalledWith(['sat:1'], 10);

    a();
    manager.flush();
    expect(sink.unsubscribe).not.toHaveBeenCalled();
    b();
    manager.flush();
    expect(sink.unsubscribe).toHaveBeenCalledWith(['sat:1']);
  });

  it('coalesces release+acquire in the same tick (StrictMode churn)', () => {
    const { sink, manager } = setup();
    const release = manager.acquire(['fleet'], 1);
    manager.flush();
    sink.subscribe.mockClear();
    release();
    manager.acquire(['fleet'], 1);
    manager.flush();
    expect(sink.unsubscribe).not.toHaveBeenCalled();
    expect(sink.subscribe).not.toHaveBeenCalled();
  });

  it('upgrades the rate to the highest holder and lowers it when that holder leaves', () => {
    const { sink, manager } = setup();
    manager.acquire(['sat:2'], 2);
    const fast = manager.acquire(['sat:2'], 10);
    manager.flush();
    expect(sink.subscribe).toHaveBeenLastCalledWith(['sat:2'], 10);
    fast();
    manager.flush();
    expect(sink.subscribe).toHaveBeenLastCalledWith(['sat:2'], 2);
  });

  it('applies queued rooms when the transport attaches later', () => {
    const manager = new SubscriptionManager();
    manager.acquire(['group:weather'], 2);
    const sink = { subscribe: vi.fn(), unsubscribe: vi.fn() };
    manager.attach(sink);
    manager.flush();
    expect(sink.subscribe).toHaveBeenCalledWith(['group:weather'], 2);
  });

  it('snaps rates to allowed values', () => {
    expect(snapHz(3)).toBe(5);
    expect(snapHz(60)).toBe(10);
    expect(snapHz(1)).toBe(1);
  });
});
