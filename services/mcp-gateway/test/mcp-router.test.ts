import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createMcpRouter } from "../src/mcp/router.js";
import { loadConfig } from "../src/config.js";
import { createUpstreamRegistry } from "../src/upstreams/registry.js";
import type { AuthService } from "../src/auth/oidc.js";
import type { PolicyEngine } from "../src/policy/engine.js";
import type { RateLimiter } from "../src/rate-limit/memory.js";
import type { AuthenticatedPrincipal } from "../src/types.js";
import { createMetricsRegistry } from "../src/metrics/registry.js";

const principal: AuthenticatedPrincipal = {
  sub: "user-1",
  email: "user@example.com",
  groups: [],
  claims: {},
};

function buildTestApp() {
  const app = Fastify({ logger: false });
  const config = loadConfig({});
  const auth: AuthService = {
    authenticate: vi.fn(async () => principal),
    challenge: () => "Bearer realm=\"test\"",
  };
  const policy: PolicyEngine = {
    canCallTool: vi.fn(() => ({ allowed: true, reason: "allowed" })),
  };
  const limiter: RateLimiter = {
    check: vi.fn(async () => ({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    })),
  };

  app.register(createMcpRouter, {
    prefix: "/mcp",
    auth,
    policy,
    limiter,
    upstreams: createUpstreamRegistry(config),
    metrics: createMetricsRegistry(),
  });

  return { app, policy, limiter };
}

describe("MCP JSON-RPC router", () => {
  it("handles initialize through the example upstream", async () => {
    const { app } = buildTestApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "example",
            version: "0.1.0",
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it("lists tools from the example upstream", async () => {
    const { app } = buildTestApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: {
          jsonrpc: "2.0",
          id: "list-1",
          method: "tools/list",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jsonrpc: "2.0",
        id: "list-1",
        result: {
          tools: [
            {
              name: "example.echo",
              description: "Echo input through the example MCP gateway tool",
              inputSchema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                },
                required: ["text"],
              },
            },
          ],
        },
      });
    } finally {
      await app.close();
    }
  });

  it("calls tools through policy, rate limit, and the example upstream", async () => {
    const { app, policy, limiter } = buildTestApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "example.echo",
            arguments: {
              text: "hello",
            },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [
            {
              type: "text",
              text: "hello",
            },
          ],
        },
      });
      expect(policy.canCallTool).toHaveBeenCalledWith(principal, "example", "example.echo");
      expect(limiter.check).toHaveBeenCalledWith(principal, "example:example.echo");
    } finally {
      await app.close();
    }
  });

  it("returns a deterministic invalid request error", async () => {
    const { app } = buildTestApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: {
          jsonrpc: "2.0",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("returns a deterministic method not found error", async () => {
    const { app } = buildTestApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        payload: {
          jsonrpc: "2.0",
          id: 4,
          method: "resources/list",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jsonrpc: "2.0",
        id: 4,
        error: {
          code: -32601,
          message: "Method not found",
        },
      });
    } finally {
      await app.close();
    }
  });
});
