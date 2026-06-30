# 012 LLM Gateway Implementation

Status: complete

## Scope

- Add `services/llm-gateway` TypeScript/Fastify service.
- Implement Anthropic-compatible `POST /v1/messages` proxy flow:
  - Apps Gateway shared secret authentication
  - request parsing and text extraction
  - rate limiting
  - input Bedrock Guardrail check
  - upstream forwarding
  - output Bedrock Guardrail check
  - refusal replacement for blocked output
  - audit logs and Prometheus metrics
- Add Redis-backed rate limiter when `REDIS_URL` is configured, with in-memory fallback for local/dev.
- Add Dockerfile and Helm chart under `charts/llm-gateway`.
- Update workspace scripts to include both gateway services.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run build`
- `helm lint charts/llm-gateway`
- `helm template test charts/llm-gateway --namespace llm-gateway`
- `helm lint charts/apps-gateway`
- `helm template test charts/apps-gateway --namespace llm-gateway`
- `git diff --check`
