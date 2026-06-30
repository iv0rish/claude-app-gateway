import type { FastifyBaseLogger } from "fastify";

export type AuditEvent = {
  event: string;
  tier?: string;
  model?: string;
  decision?: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
};

export function writeAudit(logger: FastifyBaseLogger, event: AuditEvent): void {
  logger.info(
    {
      audit: true,
      event: event.event,
      tier: event.tier,
      model: event.model,
      decision: event.decision,
      statusCode: event.statusCode,
      latencyMs: event.latencyMs,
      error: event.error,
    },
    "llm gateway audit event",
  );
}

