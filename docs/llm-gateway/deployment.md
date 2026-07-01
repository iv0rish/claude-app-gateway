# Deployment

`llm-gateway`는 Docker image와 Helm chart로 배포한다. Helm chart는 기존 내부 `/v1/messages` policy proxy 배포와 apps-compatible client-facing Gateway 배포를 모두 표현할 수 있다.

## Docker

Dockerfile:

```text
services/llm-gateway/Dockerfile
```

빌드 예시:

```sh
docker build -f services/llm-gateway/Dockerfile -t llm-gateway:0.1.0 .
```

## Helm

Chart:

```text
charts/llm-gateway
```

렌더링:

```sh
helm template llm-gateway charts/llm-gateway --namespace llm-gateway
```

배포:

```sh
helm upgrade --install llm-gateway charts/llm-gateway \
  --namespace llm-gateway \
  --create-namespace
```

## Kubernetes Resources

Chart가 만드는 리소스:

| Resource | 설명 |
| --- | --- |
| `Namespace` | 기본 `llm-gateway` |
| `ServiceAccount` | Bedrock IRSA 부여 대상 |
| `ConfigMap` | runtime config |
| `Secret` | `GATEWAY_API_KEYS`, `UPSTREAM_API_KEY`, OIDC/session/Postgres/admin/upstream secrets |
| `Deployment` | `llm-gateway` workload |
| `Service` | ClusterIP `llm-gateway:8080` |
| `Ingress` | optional client-facing HTTPS entrypoint |
| `NetworkPolicy` | Apps Gateway ingress, DNS egress |

## Apps-Compatible Deployment

When `llm-gateway` is the client-facing Claude Code Gateway, enable ingress and provide OIDC, Postgres, managed policy, spend limit, and upstream values.

```yaml
ingress:
  enabled: true
  hosts:
    - host: llm-gateway.internal.example.com
      paths:
        - path: /
          pathType: Prefix

config:
  appConfigPath: /etc/llm-gateway/gateway.yaml
  publicUrl: https://llm-gateway.internal.example.com
  oidc:
    issuer: https://login.example.com
    clientId: llm-gateway
    redirectUri: https://llm-gateway.internal.example.com/oauth/callback
  managedPolicies:
    - name: default
      groups: []
      emails: []
      settings:
        cli:
          availableModels:
            - claude-sonnet-4-6
          enforceAvailableModels: true
      availableModels:
        - claude-sonnet-4-6
  spendLimits:
    failPolicy: closed
    limits:
      - id: org-monthly
        scope: organization
        period: month
        amountUsd: 1000

secrets:
  oidcClientSecret: replace-me
  sessionJwtSecret: replace-me
  adminToken: replace-me
  postgresUrl: postgres://user:password@postgres.example.com:5432/llm_gateway?sslmode=require
```

The Deployment mounts ConfigMap key `gateway.yaml` at `/etc/llm-gateway/gateway.yaml` and exposes `APP_CONFIG_PATH` through env.

## NetworkPolicy

기본 ingress:

```text
claude-apps-gateway -> llm-gateway:8080
```

기본 egress:

```text
llm-gateway -> kube-dns
```

운영에서는 `networkPolicy.egress.extra`로 다음 egress를 추가한다.

- Redis.
- Bedrock Runtime endpoint.
- vLLM Service.
- Postgres endpoint.
- OIDC issuer/token/userinfo endpoints.

## Apps Gateway 연결

Apps Gateway upstream:

```yaml
upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-gateway.llm-gateway.svc.cluster.local:8080
```

`VLLM_STANDARD_KEY`는 `llm-gateway`의 `GATEWAY_API_KEYS[].key`와 일치해야 한다.

Apps-compatible mode does not need a separate Apps Gateway in front. Claude Code managed settings should point directly to `config.publicUrl`.

## 운영 확인

```sh
kubectl -n llm-gateway get pods -l app.kubernetes.io/name=llm-gateway
kubectl -n llm-gateway logs deploy/llm-gateway
kubectl -n llm-gateway port-forward svc/llm-gateway 8080:8080
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/metrics
```
