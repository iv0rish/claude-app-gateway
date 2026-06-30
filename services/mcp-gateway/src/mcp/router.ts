import type { FastifyPluginAsync } from "fastify";
import { writeAudit } from "../audit/logger.js";
import type { AuthService } from "../auth/oidc.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RateLimiter } from "../rate-limit/memory.js";
import type { UpstreamRegistry } from "../upstreams/registry.js";

type McpRouterOptions = {
  auth: AuthService;
  policy: PolicyEngine;
  limiter: RateLimiter;
  upstreams: UpstreamRegistry;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export const createMcpRouter: FastifyPluginAsync<McpRouterOptions> = async (app, options) => {
  app.addHook("preHandler", async (request, reply) => {
    try {
      request.principal = await options.auth.authenticate(request);
    } catch (error) {
      reply.header("WWW-Authenticate", options.auth.challenge());
      reply.code(401);
      throw error;
    }
  });

  app.post("/", async (request, reply) => {
    const startedAt = Date.now();
    const principal = request.principal;
    const body = request.body as JsonRpcRequest;

    if (!body || body.jsonrpc !== "2.0" || !body.method) {
      reply.code(400);
      return rpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request");
    }

    if (body.method === "tools/list") {
      return rpcResult(body.id, {
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
      });
    }

    if (body.method === "tools/call") {
      const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const tool = params?.name ?? "unknown";
      const upstream = options.upstreams.first();
      const decision = options.policy.canCallTool(principal, upstream.name, tool);
      if (!decision.allowed) {
        writeAudit(request.log, {
          event: "tool.denied",
          principal,
          server: upstream.name,
          tool,
          decision: decision.reason,
          latencyMs: Date.now() - startedAt,
        });
        reply.code(403);
        return rpcError(body.id, -32003, decision.reason);
      }

      const limit = await options.limiter.check(principal, `${upstream.name}:${tool}`);
      if (!limit.allowed) {
        writeAudit(request.log, {
          event: "tool.rate_limited",
          principal,
          server: upstream.name,
          tool,
          decision: "rate-limit",
          latencyMs: Date.now() - startedAt,
        });
        reply.code(429);
        return rpcError(body.id, -32029, "rate limit exceeded");
      }

      writeAudit(request.log, {
        event: "tool.allowed",
        principal,
        server: upstream.name,
        tool,
        decision: "allowed",
        latencyMs: Date.now() - startedAt,
      });

      return rpcResult(body.id, {
        content: [
          {
            type: "text",
            text: String(params?.arguments?.text ?? ""),
          },
        ],
      });
    }

    return rpcError(body.id, -32601, `Unsupported method: ${body.method}`);
  });
};

