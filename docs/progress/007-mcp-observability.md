# 007 MCP Gateway Observability

## Status

Completed.

## Summary

- Added an internal Prometheus text metrics registry.
- Added `/metrics` endpoint with configurable `METRICS_ENABLED`.
- Added HTTP request counters and duration histograms.
- Added MCP auth denial, JSON-RPC request, tool-call decision, and tool-call duration metrics.
- Expanded structured audit events for auth denial, invalid RPC, method-not-found, allowed tools, denied tools, and rate-limited tools.
- Exposed `LOG_LEVEL` and `METRICS_ENABLED` through the MCP Gateway Helm chart.

## Validation

- Added metrics tests for registry rendering and `/metrics`.
- Full validation is expected to include:
  - `npm run typecheck`
  - `npm test`
  - `helm lint charts/mcp-gateway`
  - `helm template test charts/mcp-gateway --namespace llm-gateway`

