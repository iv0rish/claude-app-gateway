import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpRouter } from "../src/mcp/router.js";
import { loadConfig } from "../src/config.js";
import { createUpstreamRegistry } from "../src/upstreams/registry.js";
import type { AppConfig } from "../src/config.js";
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

type FetchObserver = (url: string, init: RequestInit, body: Record<string, unknown>) => void;

function stubMcpFetch(observer?: FetchObserver) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      observer?.(url, init, body);

      let result: unknown;
      if (body.method === "initialize") {
        const params = body.params as { protocolVersion?: string } | undefined;
        result = {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "example",
            version: "0.1.0",
          },
        };
      } else if (body.method === "tools/list") {
        result = {
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
        };
      } else if (body.method === "tools/call") {
        const params = body.params as { arguments?: { text?: string } };
        result = {
          content: [
            {
              type: "text",
              text: String(params.arguments?.text ?? ""),
            },
          ],
        };
      } else {
        result = {};
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }),
  );
}

function buildTestApp(
  overrides: Partial<AppConfig> = {},
  observer?: FetchObserver,
) {
  stubMcpFetch(observer);
  const app = Fastify({ logger: false });
  const config = {
    ...loadConfig({}),
    ...overrides,
  };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP JSON-RPC router", () => {
  it("handles initialize through the configured HTTP upstream", async () => {
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

  it("lists tools from the configured HTTP upstream", async () => {
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

  it("calls tools through policy, rate limit, and the configured HTTP upstream", async () => {
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

  it("forwards only allowlisted custom headers to the HTTP upstream", async () => {
    const observedHeaders: Record<string, string> = {};
    const observedBodies: Record<string, unknown>[] = [];
    const { app } = buildTestApp(
      {
        upstreams: [
          {
            name: "example",
            url: "http://upstream.example.test/mcp",
            token: "upstream-token",
            forwardHeaders: ["x-tenant-id", "x-trace-id"],
          },
        ],
      },
      (_url, init, body) => {
        Object.assign(observedHeaders, init.headers);
        observedBodies.push(body);
      },
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          authorization: "Bearer client-token",
          "x-tenant-id": "tenant-a",
          "x-trace-id": "trace-1",
          "x-not-forwarded": "ignored",
        },
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
      expect(observedBodies).toHaveLength(1);
      expect(observedHeaders).toMatchObject({
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer upstream-token",
        "x-tenant-id": "tenant-a",
        "x-trace-id": "trace-1",
      });
      expect(observedHeaders).not.toHaveProperty("x-not-forwarded");
    } finally {
      await app.close();
    }
  });

  it("rejects unsafe forwarding headers at config load time", () => {
    expect(() =>
      loadConfig({
        MCP_UPSTREAMS: JSON.stringify([
          {
            name: "example",
            url: "http://upstream.example.test/mcp",
            forwardHeaders: ["authorization"],
          },
        ]),
      }),
    ).toThrow(/cannot be forwarded/);
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
