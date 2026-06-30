# 008 MCP Gateway Feature Documentation

Status: complete

## Scope

- Split the previous single MCP Gateway document into feature-level documentation.
- Document implemented behavior by feature area:
  - configuration
  - authentication
  - MCP JSON-RPC endpoint
  - tool policy
  - rate limiting
  - audit logging
  - metrics
  - upstream registry
  - operations
- Call out current implementation boundaries so code work can continue without confusing scaffold behavior with production-ready behavior.

## Notes

- The new documentation is rooted at `docs/mcp-gateway/`.
- The existing Apps Gateway config document now links to `docs/mcp-gateway/`.
