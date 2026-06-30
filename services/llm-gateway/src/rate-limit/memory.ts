import type { AppConfig } from "../config.js";

export type RateLimitDecision = {
  allowed: boolean;
  reason: string;
  resetAt: number;
  kind?: "request" | "token";
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimiter = {
  check(tier: string, model: string, tokenReservation: number): Promise<RateLimitDecision>;
};

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: AppConfig) {}

  async check(tier: string, model: string, tokenReservation: number): Promise<RateLimitDecision> {
    const decisions = rateLimitForConfig(this.config, tier, model, tokenReservation).map((bucket) =>
      this.checkBucket(bucket.key, bucket.limit, bucket.amount, bucket.kind),
    );

    const denied = decisions.find((decision) => !decision.allowed);
    return denied ?? decisions[decisions.length - 1];
  }

  private checkBucket(
    key: string,
    limit: number,
    amount: number,
    kind: "request" | "token",
  ): RateLimitDecision {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + this.config.rateLimitWindowMs,
          };

    bucket.count += amount;
    this.buckets.set(key, bucket);

    if (bucket.count > limit) {
      return {
        allowed: false,
        reason: `rate limit exceeded for ${key}`,
        resetAt: bucket.resetAt,
        kind,
      };
    }

    return {
      allowed: true,
      reason: "allowed",
      resetAt: bucket.resetAt,
      kind,
    };
  }
}

export function rateLimitForConfig(
  config: AppConfig,
  tier: string,
  model: string,
  tokenReservation: number,
): Array<{ key: string; limit: number; amount: number; kind: "request" | "token" }> {
  const requestBuckets: Array<{
    key: string;
    limit: number;
    amount: number;
    kind: "request";
  }> = [
    {
      key: "rpm:global",
      limit: config.rateLimitGlobalRpm,
      amount: 1,
      kind: "request",
    },
    {
      key: `rpm:tier:${tier}`,
      limit: config.rateLimitTierRpm[tier] ?? config.rateLimitGlobalRpm,
      amount: 1,
      kind: "request",
    },
    {
      key: `rpm:tier:${tier}:model:${model}`,
      limit:
        config.rateLimitModelRpm[`${tier}:${model}`] ??
        config.rateLimitModelRpm[model] ??
        config.rateLimitGlobalRpm,
      amount: 1,
      kind: "request",
    },
  ];

  const tokenBuckets: Array<{
    key: string;
    limit: number;
    amount: number;
    kind: "token";
  }> = [];
  const tierTpm = config.rateLimitTierTpm[tier] ?? config.rateLimitGlobalTpm;
  const modelTpm =
    config.rateLimitModelTpm[`${tier}:${model}`] ??
    config.rateLimitModelTpm[model] ??
    config.rateLimitGlobalTpm;

  if (config.rateLimitGlobalTpm > 0) {
    tokenBuckets.push({
      key: "tpm:global",
      limit: config.rateLimitGlobalTpm,
      amount: tokenReservation,
      kind: "token",
    });
  }
  if (tierTpm > 0) {
    tokenBuckets.push({
      key: `tpm:tier:${tier}`,
      limit: tierTpm,
      amount: tokenReservation,
      kind: "token",
    });
  }
  if (modelTpm > 0) {
    tokenBuckets.push({
      key: `tpm:tier:${tier}:model:${model}`,
      limit: modelTpm,
      amount: tokenReservation,
      kind: "token",
    });
  }

  return [...requestBuckets, ...tokenBuckets];
}
