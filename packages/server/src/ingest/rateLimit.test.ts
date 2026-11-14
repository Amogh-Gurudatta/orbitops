import { describe, expect, it } from 'vitest';
import { createDeviceRateLimiter } from './rateLimit.js';

describe('createDeviceRateLimiter', () => {
  it('admits traffic within the sustained rate', async () => {
    const limiter = createDeviceRateLimiter({ eventsPerSec: 100, burstEvents: 100 });
    expect(await limiter.consume('d1', 50)).toBe(0);
    expect(await limiter.consume('d1', 50)).toBe(0);
  });

  it('allows a burst beyond the sustained rate, then asks the caller to retry later', async () => {
    const limiter = createDeviceRateLimiter({ eventsPerSec: 10, burstEvents: 20 });
    expect(await limiter.consume('d1', 10)).toBe(0);
    expect(await limiter.consume('d1', 10)).toBe(0); // served by the burst bucket
    expect(await limiter.consume('d1', 10)).toBe(0); // burst bucket
    expect(await limiter.consume('d1', 10)).toBeGreaterThan(0);
  });

  it('limits devices independently', async () => {
    const limiter = createDeviceRateLimiter({ eventsPerSec: 5, burstEvents: 5 });
    await limiter.consume('a', 5);
    await limiter.consume('a', 5);
    expect(await limiter.consume('a', 5)).toBeGreaterThan(0);
    expect(await limiter.consume('b', 5)).toBe(0);
  });
});
