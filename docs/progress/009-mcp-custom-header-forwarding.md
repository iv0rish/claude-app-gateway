# 009 MCP Gateway Custom Header Forwarding

Status: complete

## Scope

- Add upstream-level `forwardHeaders` configuration.
- Forward only allowlisted custom request headers to remote HTTP MCP upstreams.
- Reject unsafe forwarding headers such as `authorization`, `cookie`, `host`, and hop-by-hop headers at config load time.
- Use configured upstream `token` as server-side outbound bearer credential.
- Replace scaffold example upstream behavior with HTTP MCP upstream proxy behavior.
- Update Helm values, feature documentation, and tests.

## Notes

- Header forwarding is intended for custom metadata such as tenant, request, or trace identifiers.
- User credentials are intentionally not forwarded to upstreams.

## Validation

- `npm run typecheck --workspace @internal/mcp-gateway`
- `npm test --workspace @internal/mcp-gateway`
- `helm lint charts/mcp-gateway`
- `helm template test charts/mcp-gateway --namespace llm-gateway`
- `git diff --check`
