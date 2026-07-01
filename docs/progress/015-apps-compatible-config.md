# 015 Apps-compatible config scaffold

Status: completed

## Summary

- Created `feature/apps-compatible-llm-gateway` from `feature/llm-mcp-gateway`.
- Added YAML-backed Apps-compatible configuration loading to `llm-gateway`.
- Kept the existing environment-variable configuration path for the current policy-proxy deployment.

## Implemented

- `APP_CONFIG_PATH` support with `${ENV_VAR}` expansion.
- Apps-compatible config sections for OIDC, session, Postgres, admin tokens, upstreams, models, managed policies, and spend limits.
- Shared domain types for authenticated users, models, managed policies, spend limits, and upstream kinds.

## Notes

- YAML config is the preferred source of truth for the Apps-compatible mode.
- Legacy shared-secret mode remains available for migration.
