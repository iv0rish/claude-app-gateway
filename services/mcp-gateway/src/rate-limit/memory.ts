import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal } from "../types.js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimiter = {
  check(principal: AuthenticatedPrincipal, toolKey: string): Promise<RateLimitResult>;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(config: AppConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    async check(principal, toolKey) {
      const now = Date.now();
      const key = `${principal.sub}:${toolKey}`;
      const current = buckets.get(key);
      const bucket =
        current && current.resetAt > now
          ? current
          : {
              count: 0,
              resetAt: now + config.rateLimitWindowMs,
            };

      bucket.count += 1;
      buckets.set(key, bucket);

      return {
        allowed: bucket.count <= config.rateLimitMax,
        remaining: Math.max(config.rateLimitMax - bucket.count, 0),
        resetAt: bucket.resetAt,
      };
    },
  };
}

