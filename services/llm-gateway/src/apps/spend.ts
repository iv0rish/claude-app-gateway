import type { AppConfig } from "../config.js";
import type { AnthropicMessageResponse } from "../anthropic/messages.js";
import type { AuthenticatedGateway, GatewayModel, SpendLimit } from "../types.js";

export type SpendDecision = {
  allowed: boolean;
  reason: string;
  limit?: SpendLimit;
  spentUsd: number;
};

export type SpendUsageEvent = {
  timestamp: string;
  subject?: string;
  email?: string;
  groups: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

type UsageBucket = {
  spentUsd: number;
  resetAt: number;
};

function periodStart(period: SpendLimit["period"], now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (period === "week") {
    const day = start.getUTCDay();
    const diff = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - diff);
  }
  if (period === "month") {
    start.setUTCDate(1);
  }
  return start;
}

function periodEnd(period: SpendLimit["period"], now: Date): number {
  const start = periodStart(period, now);
  if (period === "day") start.setUTCDate(start.getUTCDate() + 1);
  if (period === "week") start.setUTCDate(start.getUTCDate() + 7);
  if (period === "month") start.setUTCMonth(start.getUTCMonth() + 1);
  return start.getTime();
}

function usageTokens(response: AnthropicMessageResponse): { inputTokens: number; outputTokens: number } {
  const usage = response.usage;
  if (typeof usage !== "object" || usage === null) return { inputTokens: 0, outputTokens: 0 };
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: typeof record.input_tokens === "number" ? record.input_tokens : 0,
    outputTokens: typeof record.output_tokens === "number" ? record.output_tokens : 0,
  };
}

function matches(limit: SpendLimit, gateway: AuthenticatedGateway): boolean {
  if (limit.scope === "organization") return true;
  if (limit.scope === "user") return limit.subject === gateway.email || limit.subject === gateway.subject;
  return (gateway.groups ?? []).includes(limit.subject ?? "");
}

export class SpendLimitService {
  private readonly buckets = new Map<string, UsageBucket>();
  private readonly events: SpendUsageEvent[] = [];

  constructor(private readonly config: AppConfig) {}

  listLimits(): SpendLimit[] {
    return this.config.apps.spendLimits.limits;
  }

  effectiveLimits(gateway: AuthenticatedGateway): SpendLimit[] {
    return this.config.apps.spendLimits.limits.filter((limit) => matches(limit, gateway));
  }

  auditEvents(): SpendUsageEvent[] {
    return [...this.events].reverse().slice(0, 500);
  }

  check(gateway: AuthenticatedGateway): SpendDecision {
    const now = new Date();
    for (const limit of this.effectiveLimits(gateway)) {
      const bucket = this.bucket(limit, gateway, now);
      if (bucket.spentUsd >= limit.amountUsd) {
        return {
          allowed: false,
          reason: `spend limit ${limit.id} exceeded`,
          limit,
          spentUsd: bucket.spentUsd,
        };
      }
    }
    return { allowed: true, reason: "allowed", spentUsd: 0 };
  }

  record(gateway: AuthenticatedGateway, model: GatewayModel | undefined, response: AnthropicMessageResponse) {
    const tokens = usageTokens(response);
    const costUsd =
      (tokens.inputTokens * (model?.inputUsdPer1mTokens ?? 0)) / 1_000_000 +
      (tokens.outputTokens * (model?.outputUsdPer1mTokens ?? 0)) / 1_000_000;
    const event: SpendUsageEvent = {
      timestamp: new Date().toISOString(),
      subject: gateway.subject,
      email: gateway.email,
      groups: gateway.groups ?? [],
      model: model?.id ?? String(response.model ?? "unknown"),
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      costUsd,
    };
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    for (const limit of this.effectiveLimits(gateway)) {
      const bucket = this.bucket(limit, gateway, new Date());
      bucket.spentUsd += costUsd;
    }
    return event;
  }

  private bucket(limit: SpendLimit, gateway: AuthenticatedGateway, now: Date): UsageBucket {
    const subject =
      limit.scope === "organization"
        ? "organization"
        : limit.scope === "user"
          ? (gateway.email ?? gateway.subject ?? "unknown")
          : limit.subject ?? "unknown";
    const key = `${limit.id}:${subject}:${periodStart(limit.period, now).toISOString()}`;
    const current = this.buckets.get(key);
    if (current && current.resetAt > now.getTime()) return current;
    const next = { spentUsd: 0, resetAt: periodEnd(limit.period, now) };
    this.buckets.set(key, next);
    return next;
  }
}
