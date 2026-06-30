# 014 LLM Gateway Token Policy and Prompt Logging

Status: complete

## Scope

- Add token-based rate-limit policy to `llm-gateway`.
- Use request `max_tokens` as token reservation for TPM buckets.
- Support global, tier, model, and `tier:model` TPM settings.
- Extend Redis and in-memory rate-limit stores to increment by token amount.
- Log every validated prompt through `prompt.logged` audit events before rate limit and guardrail checks.
- Add `PROMPT_LOGGING_ENABLED` config, enabled by default.
- Add prompt logging and token policy documentation.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run build`
- `helm lint charts/llm-gateway`
- `helm template test charts/llm-gateway --namespace llm-gateway`
- `git diff --check`

