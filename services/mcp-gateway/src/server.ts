import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { createAuth } from "./auth/oidc.js";
import { createMcpRouter } from "./mcp/router.js";
import { createPolicyEngine } from "./policy/engine.js";
import { createRateLimiter } from "./rate-limit/memory.js";
import { createUpstreamRegistry } from "./upstreams/registry.js";
import { createMetricsRegistry, httpDurationBuckets } from "./metrics/registry.js";

export async function buildServer() {
  const config = loadConfig();
  const metrics = createMetricsRegistry();
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: false,
  });

  const auth = createAuth(config);
  const policy = createPolicyEngine(config);
  const limiter = createRateLimiter(config);
  const upstreams = createUpstreamRegistry(config);

  app.addHook("onRequest", async (request) => {
    request.metricsStartedAt = Date.now();
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!config.metricsEnabled) return;
    const route = request.routeOptions.url ?? request.url;
    const durationSeconds = (Date.now() - (request.metricsStartedAt ?? Date.now())) / 1000;
    metrics.increment("mcp_gateway_http_requests_total", "Total HTTP requests", {
      method: request.method,
      route,
      status: reply.statusCode,
    });
    metrics.observe(
      "mcp_gateway_http_request_duration_seconds",
      "HTTP request duration in seconds",
      httpDurationBuckets,
      {
        method: request.method,
        route,
        status: reply.statusCode,
      },
      durationSeconds,
    );
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => ({
    ok: true,
    upstreams: upstreams.list().map((upstream) => upstream.name),
  }));
  app.get("/metrics", async (_request, reply) => {
    if (!config.metricsEnabled) {
      reply.code(404);
      return { error: "metrics disabled" };
    }
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return metrics.render();
  });

  app.register(createMcpRouter, {
    prefix: "/mcp",
    auth,
    policy,
    limiter,
    upstreams,
    metrics,
  });

  return { app, config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, config } = await buildServer();

  const close = async () => {
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", close);
  process.on("SIGINT", close);

  await app.listen({
    host: config.host,
    port: config.port,
  });
}
