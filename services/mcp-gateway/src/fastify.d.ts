import type { AuthenticatedPrincipal } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthenticatedPrincipal;
    metricsStartedAt?: number;
  }
}
