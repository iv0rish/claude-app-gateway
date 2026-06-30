# Rate Limiting

Rate limit은 인증과 request validation 이후, guardrail과 upstream 호출 전에 적용된다.

## Store

| 설정 | 동작 |
| --- | --- |
| `REDIS_URL` 있음 | Redis shared counter |
| `REDIS_URL` 없음 | in-memory counter |

운영에서 replica를 2개 이상 사용할 경우 Redis가 필요하다. in-memory counter는 Pod별로 독립적이며 재시작 시 초기화된다.

## Bucket

현재 구현은 request count 기반 RPM 제한이다.

| Bucket | Key |
| --- | --- |
| Global | `global` |
| Tier | `tier:<tier>` |
| Model | `tier:<tier>:model:<model>` |

Redis key prefix:

```text
llm-gateway:rate-limit:<bucket>
```

## 제한값 우선순위

Tier:

```text
RATE_LIMIT_TIER_RPM[tier] ?? RATE_LIMIT_GLOBAL_RPM
```

Model:

```text
RATE_LIMIT_MODEL_RPM["<tier>:<model>"]
  ?? RATE_LIMIT_MODEL_RPM["<model>"]
  ?? RATE_LIMIT_GLOBAL_RPM
```

## 초과 처리

Rate limit 초과 시:

- HTTP `429`
- Anthropic-compatible `rate_limit_error`
- `Retry-After` header
- audit event `rate_limited`
- metric `llm_gateway_rate_limit_total{decision="denied"}`

## Store 장애

Rate-limit store 오류는 fail closed다.

- HTTP `503`
- error message: `rate limit store unavailable`
- upstream 미호출
- audit event `rate_limit.error`
- metric `llm_gateway_rate_limit_total{decision="error"}`

