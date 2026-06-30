import type { FastifyPluginAsync } from "fastify";
import { writeAudit } from "../audit/logger.js";
import { AuthError, type AuthService } from "../auth/oidc.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RateLimiter } from "../rate-limit/memory.js";
import type { UpstreamRegistry } from "../upstreams/registry.js";
import type { McpInitializeParams, McpToolCallParams } from "../upstreams/registry.js";

type McpRouterOptions = {
  auth: AuthService;
  policy: PolicyEngine;
  limiter: RateLimiter;
  upstreams: UpstreamRegistry;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId | undefined {
  return (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function requestId(body: unknown): JsonRpcId {
  if (!isRecord(body)) return null;
  return isJsonRpcId(body.id) ? (body.id ?? null) : null;
}

function parseJsonRpcRequest(body: unknown): JsonRpcRequest | undefined {
  if (!isRecord(body)) return undefined;
  if (body.jsonrpc !== "2.0") return undefined;
  if (typeof body.method !== "string" || body.method.length === 0) return undefined;
  if (!isJsonRpcId(body.id)) return undefined;

  return {
    jsonrpc: "2.0",
    id: body.id ?? null,
    method: body.method,
    params: body.params,
  };
}

function parseInitializeParams(params: unknown): McpInitializeParams | undefined {
  if (params === undefined) return undefined;
  if (!isRecord(params)) return undefined;
  if (params.protocolVersion !== undefined && typeof params.protocolVersion !== "string") {
    return undefined;
  }

  return {
    protocolVersion: params.protocolVersion,
  };
}

function parseToolCallParams(params: unknown): McpToolCallParams | undefined {
  if (!isRecord(params)) return undefined;
  if (typeof params.name !== "string" || params.name.length === 0) return undefined;
  if (params.arguments !== undefined && !isRecord(params.arguments)) return undefined;

  return {
    name: params.name,
    arguments: params.arguments,
  };
}

export const createMcpRouter: FastifyPluginAsync<McpRouterOptions> = async (app, options) => {
  app.addHook("preHandler", async (request, reply) => {
    try {
      request.principal = await options.auth.authenticate(request);
    } catch (error) {
      reply.header("WWW-Authenticate", options.auth.challenge());
      reply.code(error instanceof AuthError ? error.status : 401);
      throw error;
    }
  });

  app.post("/", async (request, reply) => {
    const startedAt = Date.now();
    const principal = request.principal;
    const body = parseJsonRpcRequest(request.body);

    if (!body) {
      reply.code(400);
      return rpcError(requestId(request.body), -32600, "Invalid Request");
    }

    const upstream = options.upstreams.first();

    if (body.method === "initialize") {
      const params = parseInitializeParams(body.params);
      if (body.params !== undefined && !params) {
        reply.code(400);
        return rpcError(body.id, -32602, "Invalid params");
      }

      return rpcResult(body.id, await upstream.initialize(params));
    }

    if (body.method === "tools/list") {
      return rpcResult(body.id, await upstream.listTools());
    }

    if (body.method === "tools/call") {
      const params = parseToolCallParams(body.params);
      if (!params) {
        reply.code(400);
        return rpcError(body.id, -32602, "Invalid params");
      }

      const tool = params.name;
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

      return rpcResult(body.id, await upstream.callTool(params));
    }

    return rpcError(body.id, -32601, "Method not found");
  });
};
