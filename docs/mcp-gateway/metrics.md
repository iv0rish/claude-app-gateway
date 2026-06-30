# Metrics

MCP Gateway는 `/metrics`에서 Prometheus text format metric을 제공한다. metric은 process-local registry에 기록된다.

## Endpoint

```http
GET /metrics
```

`METRICS_ENABLED=false`이면 endpoint는 404를 반환한다.

```json
{
  "error": "metrics disabled"
}
```

## HTTP metrics

### mcp_gateway_http_requests_total

HTTP request 수를 센다.

Labels:

| Label | 설명 |
| --- | --- |
| `method` | HTTP method |
| `route` | Fastify route 또는 path |
| `status_code` | HTTP status code |

활용:

- status code별 오류율 계산.
- `/mcp`, `/metrics`, `/healthz`, `/readyz` endpoint별 traffic 확인.

### mcp_gateway_http_request_duration_seconds

HTTP request latency histogram이다.

Labels:

| Label | 설명 |
| --- | --- |
| `method` | HTTP method |
| `route` | Fastify route 또는 path |
| `status_code` | HTTP status code |

기본 bucket:

```text
0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
```

## Auth metrics

### mcp_gateway_auth_denied_total

인증 실패 수를 센다.

Labels:

| Label | 설명 |
| --- | --- |
| `reason` | 인증 실패 분류 |

현재 client에는 자세한 실패 사유를 노출하지 않지만 metric과 audit log에서는 운영자가 원인을 볼 수 있다.

## RPC metrics

### mcp_gateway_rpc_requests_total

JSON-RPC method 처리 수를 센다.

Labels:

| Label | 설명 |
| --- | --- |
| `method` | JSON-RPC method. invalid request는 `invalid` |
| `status` | `ok`, `invalid_request`, `invalid_params`, `method_not_found`, `error` 등 |

활용:

- Claude Code client traffic 패턴 확인.
- 미지원 method 요청 탐지.
- request validation 실패 증가 감지.

## Tool metrics

### mcp_gateway_tool_calls_total

tool call 결정 결과를 센다.

Labels:

| Label | 설명 |
| --- | --- |
| `server` | MCP upstream server |
| `tool` | MCP tool name |
| `decision` | `allowed`, `denied`, `rate_limited`, `error` |

활용:

- tool별 사용량.
- policy deny 비율.
- rate limit 초과 빈도.
- 특정 upstream 장애 탐지.

### mcp_gateway_tool_call_duration_seconds

허용된 tool call의 처리 시간 histogram이다.

Labels:

| Label | 설명 |
| --- | --- |
| `server` | MCP upstream server |
| `tool` | MCP tool name |

기본 bucket:

```text
0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30
```

## Prometheus scrape 예시

ServiceMonitor를 쓰지 않는 환경에서는 Prometheus scrape config에 다음과 같이 추가할 수 있다.

```yaml
scrape_configs:
  - job_name: mcp-gateway
    metrics_path: /metrics
    static_configs:
      - targets:
          - mcp-gateway.llm-gateway.svc.cluster.local:8080
```

NetworkPolicy를 사용하는 경우 Prometheus namespace에서 MCP Gateway Pod 또는 Service로 들어오는 ingress를 허용해야 한다.

## 현재 한계

- metric registry는 process-local이다.
- Pod 재시작 시 counter와 histogram은 초기화된다.
- OpenTelemetry exporter는 아직 없다.
- label cardinality는 tool name과 server name에 영향을 받는다. 외부 입력이 tool name으로 직접 들어오지 않도록 upstream registry에서 통제해야 한다.

