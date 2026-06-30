import type { FastifyBaseLogger } from "fastify";
import type { AuthenticatedPrincipal } from "../types.js";

export type AuditEvent = {
  event: string;
  principal?: AuthenticatedPrincipal;
  method?: string;
  path?: string;
  rpcMethod?: string;
  statusCode?: number;
  server?: string;
  tool?: string;
  decision?: string;
  latencyMs?: number;
  error?: string;
};

export function writeAudit(logger: FastifyBaseLogger, event: AuditEvent): void {
  logger.info(
    {
      audit: true,
      event: event.event,
      sub: event.principal?.sub,
      email: event.principal?.email,
      groups: event.principal?.groups,
      method: event.method,
      path: event.path,
      rpcMethod: event.rpcMethod,
      statusCode: event.statusCode,
      server: event.server,
      tool: event.tool,
      decision: event.decision,
      latencyMs: event.latencyMs,
      error: event.error,
    },
    "mcp audit event",
  );
}
