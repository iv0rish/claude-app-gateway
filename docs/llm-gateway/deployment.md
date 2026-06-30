# Deployment

`llm-gateway`는 Docker image와 Helm chart로 배포한다.

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
| `Secret` | `GATEWAY_API_KEYS`, `UPSTREAM_API_KEY` |
| `Deployment` | `llm-gateway` workload |
| `Service` | ClusterIP `llm-gateway:8080` |
| `NetworkPolicy` | Apps Gateway ingress, DNS egress |

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

## 운영 확인

```sh
kubectl -n llm-gateway get pods -l app.kubernetes.io/name=llm-gateway
kubectl -n llm-gateway logs deploy/llm-gateway
kubectl -n llm-gateway port-forward svc/llm-gateway 8080:8080
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/readyz
curl -fsS http://127.0.0.1:8080/metrics
```

