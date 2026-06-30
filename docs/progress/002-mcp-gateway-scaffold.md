# 002 MCP Gateway Scaffold

## Status

In progress.

## Summary

- Added a root npm workspace for `services/mcp-gateway`.
- Created the initial TypeScript/Fastify MCP Gateway service skeleton.
- Added placeholder modules for OIDC auth, policy, in-memory rate limiting, upstream registry, audit logging, and JSON-RPC MCP request handling.
- Added an MCP Gateway Dockerfile.

## Notes

- The initial MCP endpoint supports `tools/list` and an example `tools/call` echo response.
- The deeper auth, routing, Redis-backed rate limiting, Helm packaging, and tests will be refined in subsequent implementation steps.

