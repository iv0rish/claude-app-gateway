import type { FastifyBaseLogger } from "fastify";

export type AuditEvent = {
  event: string;
  tier?: string;
  model?: string;
  decision?: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
  promptText?: string;
  promptLength?: number;
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
      promptText: event.promptText,
      promptLength: event.promptLength,
    },
    "llm gateway audit event",
  );
}
