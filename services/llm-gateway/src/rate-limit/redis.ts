import { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import {
  MemoryRateLimiter,
  rateLimitForConfig,
  type RateLimitDecision,
  type RateLimiter,
} from "./memory.js";

const incrementScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

export class RedisRateLimiter implements RateLimiter {
  private readonly redis: Redis;

  constructor(private readonly config: AppConfig) {
    if (!config.redisUrl) {
      throw new Error("REDIS_URL is required for RedisRateLimiter");
    }
    this.redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async check(tier: string, model: string): Promise<RateLimitDecision> {
    if (this.redis.status === "wait") {
      await this.redis.connect();
    }

    const buckets = rateLimitForConfig(this.config, tier, model);
    let lastAllowed: RateLimitDecision = {
      allowed: true,
      reason: "allowed",
      resetAt: Date.now() + this.config.rateLimitWindowMs,
    };

    for (const bucket of buckets) {
      const key = `llm-gateway:rate-limit:${bucket.key}`;
      const [count, ttl] = (await this.redis.eval(
        incrementScript,
        1,
        key,
        String(this.config.rateLimitWindowMs),
      )) as [number, number];

      const resetAt = Date.now() + Math.max(ttl, 0);
      if (count > bucket.limit) {
        return {
          allowed: false,
          reason: `rate limit exceeded for ${bucket.key}`,
          resetAt,
        };
      }
      lastAllowed = {
        allowed: true,
        reason: "allowed",
        resetAt,
      };
    }

    return lastAllowed;
  }
}

export function createRateLimiter(config: AppConfig): RateLimiter {
  return config.redisUrl ? new RedisRateLimiter(config) : new MemoryRateLimiter(config);
}
