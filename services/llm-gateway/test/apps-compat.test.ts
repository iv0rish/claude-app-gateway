import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import type { AppConfig } from "../src/config.js";
import type { GuardrailClient } from "../src/guardrail/client.js";
import type { RateLimiter } from "../src/rate-limit/memory.js";
import type { UpstreamClient } from "../src/upstream/client.js";

function config(): AppConfig {
  return {
    nodeEnv: "test",
    host: "127.0.0.1",
    port: 8080,
    logLevel: "silent",
    metricsEnabled: true,
    apiKeys: [{ key: "gateway-key", tier: "legacy" }],
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
    apps: {
      enabled: true,
      externalUrl: "https://gateway.example.com",
      oidc: {
        issuer: "https://idp.example.com",
        clientId: "claude-code",
        scopes: ["openid", "email", "profile"],
        groupClaim: "groups",
        emailClaim: "email",
      },
      session: {
        issuer: "llm-gateway",
        audience: "claude-code",
        jwtSecret: "test-session-secret",
        accessTokenTtlSeconds: 3600,
        refreshTokenTtlSeconds: 3600,
      },
      store: {},
      admin: { tokens: ["admin-token"] },
      upstreams: [{ name: "default", type: "anthropic", baseUrl: "http://upstream.example.test", modelMap: {} }],
      models: [
        { id: "allowed-model", upstream: "default", inputUsdPer1mTokens: 0, outputUsdPer1mTokens: 0 },
        { id: "denied-model", upstream: "default", inputUsdPer1mTokens: 0, outputUsdPer1mTokens: 0 },
      ],
      managedPolicies: [
        {
          name: "engineers",
          groups: ["eng"],
          emails: [],
          settings: { forceLoginMethod: "gateway" },
          availableModels: ["allowed-model"],
          rateLimitTier: "engineering",
        },
      ],
      spendLimits: { failPolicy: "closed", limits: [] },
    },
  };
}

function guardrail() {
  return {
    apply: vi.fn(async () => ({ action: "NONE", outputs: [] })),
  } satisfies GuardrailClient;
}

function limiter() {
  return {
    check: vi.fn(async () => ({
      allowed: true,
      reason: "allowed",
      resetAt: Date.now() + 60_000,
      kind: "request",
    })),
  } satisfies RateLimiter;
}

function upstream() {
  return {
    messages: vi.fn(async () => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "allowed-model",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    })),
  } satisfies UpstreamClient;
}

async function login(app: Awaited<ReturnType<typeof buildServer>>["app"]) {
  const grant = await app.inject({
    method: "POST",
    url: "/oauth/device_authorization",
    payload: { client_id: "claude-code" },
  });
  const device = grant.json() as { device_code: string; user_code: string };
  await app.inject({
    method: "GET",
    url: `/device?approve=true&user_code=${device.user_code}&email=dev@example.com&groups=eng&tier=default`,
  });
  const token = await app.inject({
    method: "POST",
    url: "/oauth/token",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: device.device_code,
    },
  });
  return token.json() as { access_token: string; refresh_token: string };
}

describe("Apps-compatible LLM gateway", () => {
  it("issues device-flow tokens and returns managed settings", async () => {
    const { app } = await buildServer({
      config: config(),
      guardrail: guardrail(),
      limiter: limiter(),
      upstream: upstream(),
    });
    try {
      const tokens = await login(app);
      expect(tokens.access_token).toBeTruthy();

      const settings = await app.inject({
        method: "GET",
        url: "/managed/settings",
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });

      expect(settings.statusCode).toBe(200);
      expect(settings.json()).toMatchObject({
        settings: { forceLoginMethod: "gateway" },
        availableModels: ["allowed-model"],
      });
    } finally {
      await app.close();
    }
  });

  it("filters models and denies unavailable message models", async () => {
    const upstreamClient = upstream();
    const { app } = await buildServer({
      config: config(),
      guardrail: guardrail(),
      limiter: limiter(),
      upstream: upstreamClient,
    });
    try {
      const tokens = await login(app);
      const models = await app.inject({
        method: "GET",
        url: "/v1/models",
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      expect(models.json()).toMatchObject({
        data: [{ id: "allowed-model" }],
      });

      const denied = await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: { authorization: `Bearer ${tokens.access_token}` },
        payload: {
          model: "denied-model",
          max_tokens: 32,
          messages: [{ role: "user", content: "hello" }],
        },
      });

      expect(denied.statusCode).toBe(403);
      expect(upstreamClient.messages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
