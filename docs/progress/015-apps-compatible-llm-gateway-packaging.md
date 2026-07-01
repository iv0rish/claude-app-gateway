# 015 - Apps-Compatible LLM Gateway Packaging

## Scope

- Documented apps-compatible `llm-gateway` deployment alongside the existing internal `/v1/messages` policy proxy mode.
- Added focused docs for OIDC/session, managed settings and model policy, spend limits, Bedrock native upstream, and app-compatible Helm deployment.
- Expanded the `charts/llm-gateway` values and templates to render `APP_CONFIG_PATH`, mounted `gateway.yaml`, Postgres, OIDC, session JWT, admin token, managed policies, spend limits, upstream settings, and optional ingress.

## Compatibility Notes

- Existing env-based proxy settings remain rendered: `GATEWAY_API_KEYS`, `UPSTREAM_BASE_URL`, `UPSTREAM_API_KEY`, Redis/rate-limit settings, prompt logging, and Bedrock Guardrail envs.
- The chart keeps env-based proxy compatibility while also rendering the current `APP_CONFIG_PATH` apps-compatible config schema.
