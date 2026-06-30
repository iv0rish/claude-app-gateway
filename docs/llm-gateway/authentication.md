# Authentication

`llm-gateway`는 Apps Gateway에서 오는 요청만 받아야 한다. 이를 위해 shared secret을 검증한다.

## 지원 Header

우선순위:

1. `x-api-key`
2. `Authorization: Bearer <token>`

Apps Gateway의 `upstreams[].auth.api_key` 값이 proxy의 `GATEWAY_API_KEYS` 또는 `GATEWAY_API_KEY`와 일치해야 한다.

## Tier Mapping

`GATEWAY_API_KEYS`는 key별 tier를 가진다.

```json
[
  { "key": "standard-secret", "tier": "standard" },
  { "key": "premium-secret", "tier": "premium" }
]
```

인증에 성공하면 tier가 rate-limit bucket label로 사용된다.

## 보안 기준

- shared secret 비교는 constant-time comparison을 사용한다.
- 인증 실패 요청은 upstream으로 전달하지 않는다.
- shared secret은 log에 남기지 않는다.
- Apps Gateway 외부에서 `llm-gateway`로 직접 접근하지 못하도록 NetworkPolicy로 제한한다.

## 실패 응답

| 상황 | HTTP status | error type |
| --- | --- | --- |
| key 누락 | `401` | `authentication_error` |
| key 불일치 | `403` | `invalid_request_error` |

