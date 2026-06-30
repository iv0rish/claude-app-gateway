# 010 Apps Gateway Upstream Policy Proxy Documentation

Status: complete

## Scope

- Combine the previous Apps Gateway rate-limit proxy design with Bedrock Guardrails enforcement.
- Rename the implementation target from `llm-rate-limit-proxy` to `llm-policy-proxy`. This was renamed again to `llm-gateway` in a later step.
- Document request flow, rate limiting, Bedrock `ApplyGuardrail` input/output checks, strict streaming behavior, failure policy, metrics, audit logs, and Kubernetes deployment expectations.
- Update Apps Gateway config and packaging docs to point to the combined proxy document.

## Validation

- Documentation and Apps Gateway chart default update.
- `git diff --check`
- `helm lint charts/apps-gateway`
- `helm template test charts/apps-gateway --namespace llm-gateway`
