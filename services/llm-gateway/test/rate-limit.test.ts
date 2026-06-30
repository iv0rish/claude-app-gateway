import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { MemoryRateLimiter } from "../src/rate-limit/memory.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 8080,
    logLevel: "silent",
    metricsEnabled: true,
    apiKeys: [{ key: "gateway-key", tier: "standard" }],
    upstreamBaseUrl: "http://upstream.example.test",
    upstreamTimeoutMs: 120_000,
    rateLimitWindowMs: 60_000,
    rateLimitGlobalRpm: 100,
    rateLimitTierRpm: {},
    rateLimitModelRpm: {},
    rateLimitGlobalTpm: 0,
    rateLimitTierTpm: {},
    rateLimitModelTpm: {},
    promptLoggingEnabled: true,
    guardrailInputEnabled: false,
    guardrailOutputEnabled: false,
    guardrailFailPolicy: "closed",
    refusalText: "blocked",
    ...overrides,
  };
}

describe("LLM gateway rate limiter", () => {
  it("enforces request rate limits", async () => {
    const limiter = new MemoryRateLimiter(
      config({
        rateLimitGlobalRpm: 1,
      }),
    );

    await expect(limiter.check("standard", "my-model", 128)).resolves.toMatchObject({
      allowed: true,
      kind: "request",
    });
    await expect(limiter.check("standard", "my-model", 128)).resolves.toMatchObject({
      allowed: false,
      kind: "request",
    });
  });

  it("enforces token reservation limits from max_tokens", async () => {
    const limiter = new MemoryRateLimiter(
      config({
        rateLimitGlobalRpm: 100,
        rateLimitGlobalTpm: 200,
      }),
    );

    await expect(limiter.check("standard", "my-model", 150)).resolves.toMatchObject({
      allowed: true,
      kind: "token",
    });
    await expect(limiter.check("standard", "my-model", 60)).resolves.toMatchObject({
      allowed: false,
      kind: "token",
    });
  });

  it("prefers tier and model token limits when configured", async () => {
    const limiter = new MemoryRateLimiter(
      config({
        rateLimitGlobalRpm: 100,
        rateLimitGlobalTpm: 1000,
        rateLimitTierTpm: {
          standard: 500,
        },
        rateLimitModelTpm: {
          "standard:my-model": 100,
        },
      }),
    );

    await expect(limiter.check("standard", "my-model", 101)).resolves.toMatchObject({
      allowed: false,
      kind: "token",
      reason: "rate limit exceeded for tpm:tier:standard:model:my-model",
    });
  });
});

