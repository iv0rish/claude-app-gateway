# Observability

`llm-gateway`는 Pino structured log와 Prometheus text metrics를 제공한다.

## Metrics Endpoint

```http
GET /metrics
```

`METRICS_ENABLED=false`이면 `404`를 반환한다.

## Metrics

| Metric | Labels | 설명 |
| --- | --- | --- |
| `llm_gateway_http_requests_total` | `method`, `route`, `status_code` | HTTP 요청 수 |
| `llm_gateway_http_request_duration_seconds` | `method`, `route`, `status_code` | HTTP latency |
| `llm_gateway_requests_total` | `tier`, `model`, `status` | `/v1/messages` 처리 결과 |
| `llm_gateway_auth_denied_total` | `status` | 인증 실패 |
| `llm_gateway_rate_limit_total` | `tier`, `model`, `decision`, `kind` | rate limit 결정 |
| `llm_gateway_prompts_logged_total` | `tier`, `model` | raw prompt log 기록 수 |
| `llm_gateway_guardrail_total` | `source`, `action` | guardrail 결과 |
| `llm_gateway_guardrail_duration_seconds` | `source` | Bedrock `ApplyGuardrail` latency |
| `llm_gateway_upstream_requests_total` | `model`, `status` | upstream 호출 수 |
| `llm_gateway_upstream_duration_seconds` | `model` | upstream latency |

## Audit Events

| Event | 설명 |
| --- | --- |
| `auth.denied` | shared secret 인증 실패 |
| `rate_limited` | rate limit 초과 |
| `rate_limit.error` | rate-limit store 오류 |
| `prompt.logged` | raw prompt 기록 |
| `guardrail.input.allowed` | input guardrail 통과 |
| `guardrail.input.blocked` | input guardrail 차단 |
| `guardrail.input.error` | input guardrail 호출 오류 |
| `guardrail.output.allowed` | output guardrail 통과 |
| `guardrail.output.blocked` | output guardrail 차단 |
| `guardrail.output.error` | output guardrail 호출 오류 |
| `upstream.error` | upstream 호출 실패 |

Audit log 필드:

| 필드 | 설명 |
| --- | --- |
| `audit` | 항상 `true` |
| `event` | event name |
| `tier` | shared secret에서 매핑된 tier |
| `model` | request model |
| `decision` | 정책 결정 |
| `statusCode` | HTTP status |
| `latencyMs` | 처리 시간 |
| `error` | 오류 요약 |
| `promptText` | raw prompt text. `prompt.logged`에만 포함 |
| `promptLength` | prompt text length |

## Log Redaction

Log에 남기지 않는다.

- Apps Gateway shared secret.
- upstream API key.
- model output 원문.

예외:

- `prompt.logged` event는 요구사항에 따라 prompt 원문을 `promptText`로 남긴다.
