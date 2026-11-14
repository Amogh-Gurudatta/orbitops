// Stage 2: per-device token bucket. A sustained events/second budget plus a burst allowance, so a
// producer can briefly exceed its steady rate (e.g. after a reconnect flush) but not flood the server.
import { BurstyRateLimiter, RateLimiterMemory } from 'rate-limiter-flexible';

export interface DeviceRateLimitOptions {
  eventsPerSec: number;
  /** Extra events allowed per 10 s window on top of the sustained rate. */
  burstEvents: number;
}

export interface DeviceRateLimiter {
  /** Returns 0 when `events` are admitted, otherwise the suggested retry delay in ms. */
  consume(deviceId: string, events: number): Promise<number>;
}

export function createDeviceRateLimiter(options: DeviceRateLimitOptions): DeviceRateLimiter {
  const limiter = new BurstyRateLimiter(
    new RateLimiterMemory({ points: options.eventsPerSec, duration: 1 }),
    new RateLimiterMemory({ points: options.burstEvents, duration: 10 }),
  );
  return {
    async consume(deviceId, events) {
      // A batch larger than the whole budget could never be admitted; clamp so the caller gets a retry hint.
      const points = Math.min(events, options.eventsPerSec);
      try {
        await limiter.consume(deviceId, points);
        return 0;
      } catch (rejection) {
        if (rejection instanceof Error) throw rejection;
        const wait = (rejection as { msBeforeNext?: number }).msBeforeNext ?? 1000;
        return Math.max(1, Math.ceil(wait));
      }
    },
  };
}
