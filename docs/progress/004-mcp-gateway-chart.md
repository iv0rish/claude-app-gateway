# 004 MCP Gateway Helm Chart

## Status

Completed.

## Summary

- Added `charts/mcp-gateway` Helm chart.
- Chart includes Deployment, Service, Ingress, ConfigMap, Secret placeholder, ServiceAccount, optional Namespace, and NetworkPolicy.
- ConfigMap exposes MCP Gateway runtime configuration through environment variables.

## Notes

- NetworkPolicy defaults only allow DNS egress plus user-supplied explicit egress rules.
- Real IdP, upstream MCP services, and secret store egress rules must be supplied by environment-specific values.

