import type { AppConfig } from "../config.js";

export type RateLimitDecision = {
  allowed: boolean;
  reason: string;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimiter = {
  check(tier: string, model: string): Promise<RateLimitDecision>;
};

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: AppConfig) {}

  async check(tier: string, model: string): Promise<RateLimitDecision> {
    const decisions = [
      this.checkBucket("global", this.config.rateLimitGlobalRpm),
      this.checkBucket(`tier:${tier}`, this.config.rateLimitTierRpm[tier] ?? this.config.rateLimitGlobalRpm),
      this.checkBucket(
        `tier:${tier}:model:${model}`,
        this.config.rateLimitModelRpm[`${tier}:${model}`] ??
          this.config.rateLimitModelRpm[model] ??
          this.config.rateLimitGlobalRpm,
      ),
    ];

    const denied = decisions.find((decision) => !decision.allowed);
    return denied ?? decisions[decisions.length - 1];
  }

  private checkBucket(key: string, limit: number): RateLimitDecision {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + this.config.rateLimitWindowMs,
          };

    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (bucket.count > limit) {
      return {
        allowed: false,
        reason: `rate limit exceeded for ${key}`,
        resetAt: bucket.resetAt,
      };
    }

    return {
      allowed: true,
      reason: "allowed",
      resetAt: bucket.resetAt,
    };
  }
}

export function rateLimitForConfig(
  config: AppConfig,
  tier: string,
  model: string,
): Array<{ key: string; limit: number }> {
  return [
    {
      key: "global",
      limit: config.rateLimitGlobalRpm,
    },
    {
      key: `tier:${tier}`,
      limit: config.rateLimitTierRpm[tier] ?? config.rateLimitGlobalRpm,
    },
    {
      key: `tier:${tier}:model:${model}`,
      limit:
        config.rateLimitModelRpm[`${tier}:${model}`] ??
        config.rateLimitModelRpm[model] ??
        config.rateLimitGlobalRpm,
    },
  ];
}
