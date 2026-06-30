# 002 MCP Gateway Scaffold

## Status

Completed.

## Summary

- Added a root npm workspace for `services/mcp-gateway`.
- Created the initial TypeScript/Fastify MCP Gateway service skeleton.
- Added placeholder modules for OIDC auth, policy, in-memory rate limiting, upstream registry, audit logging, and JSON-RPC MCP request handling.
- Added an MCP Gateway Dockerfile.

## Notes

- The initial MCP endpoint supports `tools/list` and an example `tools/call` echo response.
- Deeper auth, routing, policy, rate limiting, Helm packaging, and tests were completed in later steps:
  - `004-mcp-gateway-chart.md`
  - `005-mcp-gateway-modules.md`
  - `006-validation.md`
