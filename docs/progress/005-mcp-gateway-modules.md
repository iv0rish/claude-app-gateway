# 005 MCP Gateway Auth, Routing, Policy, and Rate Limit

## Status

Completed.

## Summary

- Hardened OIDC bearer authentication with typed `AuthError`.
- Added MCP JSON-RPC handling for:
  - `initialize`
  - `tools/list`
  - `tools/call`
- Added static/example upstream registry.
- Added configurable tool policy support through `MCP_TOOL_POLICIES`.
- Added Redis-ready rate-limit interfaces with an in-memory implementation.
- Added unit tests for auth, routing, policy, and rate limit behavior.

## Integration Notes

- The router now preserves `AuthError.status`, so authorization failures can return `403` instead of being forced to `401`.
- The MCP Gateway Helm chart now exposes `MCP_TOOL_POLICIES` through ConfigMap values.

