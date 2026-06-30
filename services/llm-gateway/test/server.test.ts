import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import type { AppConfig } from "../src/config.js";
import type { GuardrailClient, GuardrailResult, GuardrailSource } from "../src/guardrail/client.js";
import type { RateLimiter } from "../src/rate-limit/memory.js";
import type { UpstreamClient } from "../src/upstream/client.js";
import type { AnthropicMessagesRequest } from "../src/anthropic/messages.js";

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
    guardrailInputEnabled: true,
    guardrailOutputEnabled: true,
    guardrailFailPolicy: "closed",
    refusalText: "blocked",
    ...overrides,
  };
}

function requestBody(overrides: Partial<AnthropicMessagesRequest> = {}) {
  return {
    model: "my-model",
    max_tokens: 128,
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  };
}

function guardrail(result: GuardrailResult = { action: "NONE", outputs: [] }) {
  return {
    apply: vi.fn(async () => result),
  } satisfies GuardrailClient;
}

function limiter(allowed = true) {
  return {
    check: vi.fn(async () => ({
      allowed,
      reason: allowed ? "allowed" : "rate limit exceeded",
      resetAt: Date.now() + 60_000,
    })),
  } satisfies RateLimiter;
}

function upstream() {
  return {
    messages: vi.fn(async () => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "my-model",
      content: [{ type: "text", text: "upstream answer" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 1,
        output_tokens: 2,
      },
    })),
  } satisfies UpstreamClient;
}

describe("LLM gateway server", () => {
  it("rejects requests without a valid gateway API key", async () => {
    const { app } = await buildServer({
      config: config(),
      guardrail: guardrail(),
      limiter: limiter(),
      upstream: upstream(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        payload: requestBody(),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          type: "authentication_error",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("applies input and output guardrails around the upstream call", async () => {
    const guard = guardrail();
    const upstreamClient = upstream();
    const { app } = await buildServer({
      config: config(),
      guardrail: guard,
      limiter: limiter(),
      upstream: upstreamClient,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          "x-api-key": "gateway-key",
          "anthropic-version": "2023-06-01",
        },
        payload: requestBody({ stream: true }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        content: [{ type: "text", text: "upstream answer" }],
      });
      expect(guard.apply).toHaveBeenNthCalledWith(1, "INPUT", "hello");
      expect(guard.apply).toHaveBeenNthCalledWith(2, "OUTPUT", "upstream answer");
      expect(upstreamClient.messages).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false }),
        expect.objectContaining({ "anthropic-version": "2023-06-01" }),
      );
    } finally {
      await app.close();
    }
  });

  it("blocks input guardrail interventions before calling upstream", async () => {
    const guard = {
      apply: vi.fn(async (source: GuardrailSource) =>
        source === "INPUT"
          ? { action: "GUARDRAIL_INTERVENED" as const, outputs: [] }
          : { action: "NONE" as const, outputs: [] },
      ),
    } satisfies GuardrailClient;
    const upstreamClient = upstream();
    const { app } = await buildServer({
      config: config(),
      guardrail: guard,
      limiter: limiter(),
      upstream: upstreamClient,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          "x-api-key": "gateway-key",
        },
        payload: requestBody(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          type: "invalid_request_error",
          message: "request blocked by policy",
        },
      });
      expect(upstreamClient.messages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("replaces output guardrail interventions with a refusal response", async () => {
    const guard = {
      apply: vi.fn(async (source: GuardrailSource) =>
        source === "OUTPUT"
          ? { action: "GUARDRAIL_INTERVENED" as const, outputs: ["policy refusal"] }
          : { action: "NONE" as const, outputs: [] },
      ),
    } satisfies GuardrailClient;
    const { app } = await buildServer({
      config: config(),
      guardrail: guard,
      limiter: limiter(),
      upstream: upstream(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          "x-api-key": "gateway-key",
        },
        payload: requestBody(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: "msg_guardrail",
        content: [{ type: "text", text: "policy refusal" }],
      });
    } finally {
      await app.close();
    }
  });

  it("returns Anthropic-compatible 429 rate limit errors", async () => {
    const upstreamClient = upstream();
    const { app } = await buildServer({
      config: config(),
      guardrail: guardrail(),
      limiter: limiter(false),
      upstream: upstreamClient,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          "x-api-key": "gateway-key",
        },
        payload: requestBody(),
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      expect(response.json()).toMatchObject({
        error: {
          type: "rate_limit_error",
        },
      });
      expect(upstreamClient.messages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("fails closed when the rate-limit store is unavailable", async () => {
    const upstreamClient = upstream();
    const failingLimiter: RateLimiter = {
      check: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    };
    const { app } = await buildServer({
      config: config(),
      guardrail: guardrail(),
      limiter: failingLimiter,
      upstream: upstreamClient,
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          "x-api-key": "gateway-key",
        },
        payload: requestBody(),
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: {
          type: "api_error",
          message: "rate limit store unavailable",
        },
      });
      expect(upstreamClient.messages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
