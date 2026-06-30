# 003 Apps Gateway Packaging

## Status

Completed.

## Summary

- Added `docker/apps-gateway/Dockerfile` for a pinned pre-downloaded Claude binary.
- Added `charts/apps-gateway` Helm chart with:
  - ConfigMap-driven `gateway.yaml`
  - Secret placeholders
  - Deployment, Service, Ingress, ServiceAccount, optional Namespace
  - NetworkPolicy for ingress and constrained egress
- Chart defaults point the Apps Gateway upstream at the internal policy proxy. This was later renamed from `llm-rate-limit-proxy` to `llm-policy-proxy`.

## Validation

- Worker validation reported:
  - `helm lint charts/apps-gateway`
  - `helm template test charts/apps-gateway --namespace llm-gateway`
