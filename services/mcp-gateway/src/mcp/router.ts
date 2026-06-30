import type { FastifyPluginAsync } from "fastify";
import { writeAudit } from "../audit/logger.js";
import { AuthError, type AuthService } from "../auth/oidc.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RateLimiter } from "../rate-limit/memory.js";
import type { UpstreamRegistry } from "../upstreams/registry.js";
import type { McpInitializeParams, McpToolCallParams } from "../upstreams/registry.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import { mcpToolDurationBuckets } from "../metrics/registry.js";

type McpRouterOptions = {
  auth: AuthService;
  policy: PolicyEngine;
  limiter: RateLimiter;
  upstreams: UpstreamRegistry;
  metrics: MetricsRegistry;
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
      const statusCode = error instanceof AuthError ? error.status : 401;
      options.metrics.increment("mcp_gateway_auth_denied_total", "Total denied authentication attempts", {
        status: statusCode,
      });
      writeAudit(request.log, {
        event: "auth.denied",
        method: request.method,
        path: request.url,
        statusCode,
        decision: error instanceof Error ? error.message : "authentication failed",
      });
      reply.header("WWW-Authenticate", options.auth.challenge());
      reply.code(statusCode);
      throw error;
    }
  });

  app.post("/", async (request, reply) => {
    const startedAt = Date.now();
    const principal = request.principal;
    const body = parseJsonRpcRequest(request.body);

    if (!body) {
      reply.code(400);
      options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
        method: "invalid",
        status: "invalid_request",
      });
      writeAudit(request.log, {
        event: "rpc.invalid",
        principal,
        method: request.method,
        path: request.url,
        statusCode: 400,
        decision: "invalid-request",
        latencyMs: Date.now() - startedAt,
      });
      return rpcError(requestId(request.body), -32600, "Invalid Request");
    }

    const upstream = options.upstreams.first();

    if (body.method === "initialize") {
      const params = parseInitializeParams(body.params);
      if (body.params !== undefined && !params) {
        reply.code(400);
        options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
          method: body.method,
          status: "invalid_params",
        });
        return rpcError(body.id, -32602, "Invalid params");
      }

      options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
        method: body.method,
        status: "ok",
      });
      return rpcResult(body.id, await upstream.initialize(params));
    }

    if (body.method === "tools/list") {
      options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
        method: body.method,
        status: "ok",
      });
      return rpcResult(body.id, await upstream.listTools());
    }

    if (body.method === "tools/call") {
      const params = parseToolCallParams(body.params);
      if (!params) {
        reply.code(400);
        options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
          method: body.method,
          status: "invalid_params",
        });
        return rpcError(body.id, -32602, "Invalid params");
      }

      const tool = params.name;
      const decision = options.policy.canCallTool(principal, upstream.name, tool);
      if (!decision.allowed) {
        options.metrics.increment("mcp_gateway_tool_calls_total", "Total MCP tool calls", {
          server: upstream.name,
          tool,
          decision: "denied",
        });
        writeAudit(request.log, {
          event: "tool.denied",
          principal,
          rpcMethod: body.method,
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
        options.metrics.increment("mcp_gateway_tool_calls_total", "Total MCP tool calls", {
          server: upstream.name,
          tool,
          decision: "rate_limited",
        });
        writeAudit(request.log, {
          event: "tool.rate_limited",
          principal,
          rpcMethod: body.method,
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
        rpcMethod: body.method,
        server: upstream.name,
        tool,
        decision: "allowed",
        latencyMs: Date.now() - startedAt,
      });

      const result = await upstream.callTool(params);
      const latencySeconds = (Date.now() - startedAt) / 1000;
      options.metrics.increment("mcp_gateway_tool_calls_total", "Total MCP tool calls", {
        server: upstream.name,
        tool,
        decision: "allowed",
      });
      options.metrics.observe(
        "mcp_gateway_tool_call_duration_seconds",
        "MCP tool call duration in seconds",
        mcpToolDurationBuckets,
        {
          server: upstream.name,
          tool,
          decision: "allowed",
        },
        latencySeconds,
      );
      options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
        method: body.method,
        status: "ok",
      });

      return rpcResult(body.id, result);
    }

    options.metrics.increment("mcp_gateway_rpc_requests_total", "Total MCP JSON-RPC requests", {
      method: body.method,
      status: "method_not_found",
    });
    writeAudit(request.log, {
      event: "rpc.method_not_found",
      principal,
      rpcMethod: body.method,
      statusCode: 200,
      decision: "method-not-found",
      latencyMs: Date.now() - startedAt,
    });
    return rpcError(body.id, -32601, "Method not found");
  });
};
