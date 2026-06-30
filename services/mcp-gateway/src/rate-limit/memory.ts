import type { AppConfig } from "../config.js";
import type { RateLimitEntry, RateLimiter, RateLimitStore } from "./types.js";
export type { RateLimitEntry, RateLimiter, RateLimitResult, RateLimitStore } from "./types.js";

type Bucket = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  async increment(key: string, windowMs: number, now: number): Promise<RateLimitEntry> {
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + windowMs,
          };

    bucket.count += 1;
    this.buckets.set(key, bucket);

    return bucket;
  }
}

export type RateLimiterOptions = {
  store?: RateLimitStore;
  now?: () => number;
};

export function createRateLimiter(config: AppConfig, options: RateLimiterOptions = {}): RateLimiter {
  const store = options.store ?? new MemoryRateLimitStore();
  const now = options.now ?? Date.now;

  return {
    async check(principal, toolKey) {
      const key = `${principal.sub}:${toolKey}`;
      const bucket = await store.increment(key, config.rateLimitWindowMs, now());

      return {
        allowed: bucket.count <= config.rateLimitMax,
        remaining: Math.max(config.rateLimitMax - bucket.count, 0),
        resetAt: bucket.resetAt,
      };
    },
  };
}
