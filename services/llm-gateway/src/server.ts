import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import {
  createAnthropicError,
  createRefusalResponse,
  extractInputText,
  extractOutputText,
  parseMessagesRequest,
  upstreamRequestBody,
  type AnthropicMessagesRequest,
} from "./anthropic/messages.js";
import { writeAudit } from "./audit/logger.js";
import { AuthError, createAuth, type AuthService } from "./auth/shared-secret.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  createGuardrailClient,
  type GuardrailClient,
  type GuardrailSource,
} from "./guardrail/client.js";
import {
  createMetricsRegistry,
  guardrailDurationBuckets,
  httpDurationBuckets,
  upstreamDurationBuckets,
  type MetricsRegistry,
} from "./metrics/registry.js";
import type { RateLimiter } from "./rate-limit/memory.js";
import { createRateLimiter } from "./rate-limit/redis.js";
import { HttpUpstreamClient, type UpstreamClient } from "./upstream/client.js";

export type ServerDependencies = {
  config?: AppConfig;
  auth?: AuthService;
  limiter?: RateLimiter;
  guardrail?: GuardrailClient;
  upstream?: UpstreamClient;
  metrics?: MetricsRegistry;
};

type BuildServerResult = {
  app: FastifyInstance;
  config: AppConfig;
  metrics: MetricsRegistry;
};

function requestHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers[name.toLowerCase()] = value;
  }
  return headers;
}

async function applyGuardrail(
  source: GuardrailSource,
  text: string,
  context: {
    config: AppConfig;
    guardrail: GuardrailClient;
    metrics: MetricsRegistry;
    request: FastifyRequest;
    tier: string;
    model: string;
  },
) {
  const enabled =
    (source === "INPUT" && context.config.guardrailInputEnabled) ||
    (source === "OUTPUT" && context.config.guardrailOutputEnabled);

  if (!enabled || text.trim().length === 0) {
    return {
      action: "NONE" as const,
      outputs: [],
    };
  }

  const startedAt = Date.now();
  try {
    const result = await context.guardrail.apply(source, text);
    const latencySeconds = (Date.now() - startedAt) / 1000;
    context.metrics.increment("llm_gateway_guardrail_total", "Total guardrail decisions", {
      source: source.toLowerCase(),
      action: result.action,
    });
    context.metrics.observe(
      "llm_gateway_guardrail_duration_seconds",
      "Guardrail call duration in seconds",
      guardrailDurationBuckets,
      { source: source.toLowerCase() },
      latencySeconds,
    );
    writeAudit(context.request.log, {
      event:
        result.action === "GUARDRAIL_INTERVENED"
          ? `guardrail.${source.toLowerCase()}.blocked`
          : `guardrail.${source.toLowerCase()}.allowed`,
      tier: context.tier,
      model: context.model,
      decision: result.action,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    context.metrics.increment("llm_gateway_guardrail_total", "Total guardrail decisions", {
      source: source.toLowerCase(),
      action: "error",
    });
    writeAudit(context.request.log, {
      event: `guardrail.${source.toLowerCase()}.error`,
      tier: context.tier,
      model: context.model,
      decision: context.config.guardrailFailPolicy,
      error: error instanceof Error ? error.message : "guardrail error",
      latencyMs: Date.now() - startedAt,
    });

    if (context.config.guardrailFailPolicy === "closed") {
      throw error;
    }

    return {
      action: "NONE" as const,
      outputs: [],
    };
  }
}

export async function buildServer(dependencies: ServerDependencies = {}): Promise<BuildServerResult> {
  const config = dependencies.config ?? loadConfig();
  const metrics = dependencies.metrics ?? createMetricsRegistry();
  const auth = dependencies.auth ?? createAuth(config.apiKeys);
  const limiter = dependencies.limiter ?? createRateLimiter(config);
  const guardrail = dependencies.guardrail ?? createGuardrailClient(config);
  const upstream = dependencies.upstream ?? new HttpUpstreamClient(config);

  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: false,
  });

  app.addHook("onResponse", async (request, reply) => {
    const elapsed = reply.elapsedTime / 1000;
    const route = request.routeOptions.url ?? request.url;
    metrics.increment("llm_gateway_http_requests_total", "Total HTTP requests", {
      method: request.method,
      route,
      status_code: reply.statusCode,
    });
    metrics.observe(
      "llm_gateway_http_request_duration_seconds",
      "HTTP request duration in seconds",
      httpDurationBuckets,
      {
        method: request.method,
        route,
        status_code: reply.statusCode,
      },
      elapsed,
    );
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => ({
    ok: true,
    upstream: config.upstreamBaseUrl,
    guardrail: {
      input: config.guardrailInputEnabled,
      output: config.guardrailOutputEnabled,
      failPolicy: config.guardrailFailPolicy,
    },
  }));
  app.get("/metrics", async (_request, reply) => {
    if (!config.metricsEnabled) {
      reply.code(404);
      return { error: "metrics disabled" };
    }
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return metrics.render();
  });

  app.post("/v1/messages", async (request, reply) => {
    const startedAt = Date.now();
    let gateway;
    try {
      gateway = auth.authenticate(request);
    } catch (error) {
      const statusCode = error instanceof AuthError ? error.status : 401;
      metrics.increment("llm_gateway_auth_denied_total", "Total denied authentication attempts", {
        status: statusCode,
      });
      writeAudit(request.log, {
        event: "auth.denied",
        statusCode,
        decision: error instanceof Error ? error.message : "authentication failed",
      });
      reply.code(statusCode);
      return createAnthropicError(
        statusCode === 401 ? "authentication_error" : "invalid_request_error",
        "gateway authentication failed",
      );
    }

    let body: AnthropicMessagesRequest;
    try {
      body = parseMessagesRequest(request.body);
    } catch (error) {
      reply.code(400);
      metrics.increment("llm_gateway_requests_total", "Total LLM gateway requests", {
        status: "invalid_request",
      });
      return createAnthropicError(
        "invalid_request_error",
        error instanceof ZodError ? "invalid Anthropic Messages request" : "invalid request",
      );
    }

    let rateLimit;
    try {
      const promptText = extractInputText(body);
      if (config.promptLoggingEnabled) {
        writeAudit(request.log, {
          event: "prompt.logged",
          tier: gateway.tier,
          model: body.model,
          promptText,
          promptLength: promptText.length,
        });
        metrics.increment("llm_gateway_prompts_logged_total", "Total logged prompts", {
          tier: gateway.tier,
          model: body.model,
        });
      }

      rateLimit = await limiter.check(gateway.tier, body.model, body.max_tokens);
    } catch (error) {
      const message = error instanceof Error ? error.message : "rate limit store error";
      reply.code(503);
      metrics.increment("llm_gateway_rate_limit_total", "Total rate limit decisions", {
        tier: gateway.tier,
        model: body.model,
        decision: "error",
        kind: "unknown",
      });
      writeAudit(request.log, {
        event: "rate_limit.error",
        tier: gateway.tier,
        model: body.model,
        decision: "closed",
        statusCode: 503,
        error: message,
        latencyMs: Date.now() - startedAt,
      });
      return createAnthropicError("api_error", "rate limit store unavailable");
    }

    if (!rateLimit.allowed) {
      reply.code(429);
      const retryAfter = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
      reply.header("Retry-After", String(retryAfter));
      metrics.increment("llm_gateway_rate_limit_total", "Total rate limit decisions", {
        tier: gateway.tier,
        model: body.model,
        decision: "denied",
        kind: rateLimit.kind ?? "unknown",
      });
      writeAudit(request.log, {
        event: "rate_limited",
        tier: gateway.tier,
        model: body.model,
        decision: rateLimit.reason,
        statusCode: 429,
        latencyMs: Date.now() - startedAt,
      });
      return createAnthropicError("rate_limit_error", "rate limit exceeded");
    }

    metrics.increment("llm_gateway_rate_limit_total", "Total rate limit decisions", {
      tier: gateway.tier,
      model: body.model,
      decision: "allowed",
      kind: rateLimit.kind ?? "unknown",
    });

    try {
      const inputGuardrail = await applyGuardrail("INPUT", extractInputText(body), {
        config,
        guardrail,
        metrics,
        request,
        tier: gateway.tier,
        model: body.model,
      });

      if (inputGuardrail.action === "GUARDRAIL_INTERVENED") {
        reply.code(400);
        metrics.increment("llm_gateway_requests_total", "Total LLM gateway requests", {
          tier: gateway.tier,
          model: body.model,
          status: "guardrail_input_blocked",
        });
        return createAnthropicError("invalid_request_error", "request blocked by policy");
      }

      const upstreamStartedAt = Date.now();
      const response = await upstream.messages(upstreamRequestBody(body), requestHeaders(request));
      const upstreamLatencySeconds = (Date.now() - upstreamStartedAt) / 1000;
      metrics.increment("llm_gateway_upstream_requests_total", "Total upstream requests", {
        model: body.model,
        status: "ok",
      });
      metrics.observe(
        "llm_gateway_upstream_duration_seconds",
        "Upstream request duration in seconds",
        upstreamDurationBuckets,
        { model: body.model },
        upstreamLatencySeconds,
      );

      const outputGuardrail = await applyGuardrail("OUTPUT", extractOutputText(response), {
        config,
        guardrail,
        metrics,
        request,
        tier: gateway.tier,
        model: body.model,
      });

      if (outputGuardrail.action === "GUARDRAIL_INTERVENED") {
        metrics.increment("llm_gateway_requests_total", "Total LLM gateway requests", {
          tier: gateway.tier,
          model: body.model,
          status: "guardrail_output_blocked",
        });
        return createRefusalResponse(body.model, outputGuardrail.outputs[0] ?? config.refusalText);
      }

      metrics.increment("llm_gateway_requests_total", "Total LLM gateway requests", {
        tier: gateway.tier,
        model: body.model,
        status: "ok",
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "gateway error";
      const statusCode = message.includes("aborted") ? 504 : 503;
      reply.code(statusCode);
      metrics.increment("llm_gateway_requests_total", "Total LLM gateway requests", {
        tier: gateway.tier,
        model: body.model,
        status: "error",
      });
      writeAudit(request.log, {
        event: "upstream.error",
        tier: gateway.tier,
        model: body.model,
        statusCode,
        error: message,
        latencyMs: Date.now() - startedAt,
      });
      return createAnthropicError("api_error", "llm gateway request failed");
    }
  });

  return { app, config, metrics };
}

export async function start() {
  const { app, config } = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
