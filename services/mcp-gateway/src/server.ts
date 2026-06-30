import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { createAuth } from "./auth/oidc.js";
import { createMcpRouter } from "./mcp/router.js";
import { createPolicyEngine } from "./policy/engine.js";
import { createRateLimiter } from "./rate-limit/memory.js";
import { createUpstreamRegistry } from "./upstreams/registry.js";

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: false,
  });

  const auth = createAuth(config);
  const policy = createPolicyEngine(config);
  const limiter = createRateLimiter(config);
  const upstreams = createUpstreamRegistry(config);

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => ({
    ok: true,
    upstreams: upstreams.list().map((upstream) => upstream.name),
  }));

  app.register(createMcpRouter, {
    prefix: "/mcp",
    auth,
    policy,
    limiter,
    upstreams,
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

