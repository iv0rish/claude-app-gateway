# 011 Rename LLM Policy Proxy to LLM Gateway

Status: complete

## Scope

- Rename the Apps Gateway upstream service target from `llm-policy-proxy` to `llm-gateway`.
- Update Apps Gateway Helm chart defaults and NetworkPolicy values.
- Update Apps Gateway configuration, packaging, and upstream proxy implementation docs.
- Preserve migration notes for older `llm-rate-limit-proxy` and `llm-policy-proxy` service names.

## Validation

- `helm lint charts/apps-gateway`
- `helm template test charts/apps-gateway --namespace llm-gateway`
- `git diff --check`
