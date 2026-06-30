# Rate Limiting

MCP Gateway는 `tools/call` 요청에 대해 사용자와 tool 단위 rate limit을 적용한다. 목적은 비용이 크거나 side effect가 있는 tool 호출의 폭주를 막는 것이다.

## 적용 범위

Rate limit은 인증, JSON-RPC validation, policy check 이후에 적용된다.

```text
Authorization
  -> JSON-RPC validation
  -> policy
  -> rate limit
  -> upstream tool call
```

policy에서 deny된 요청은 rate limit counter를 소비하지 않는다.

## Key 구성

현재 key는 다음 값으로 구성된다.

```text
<principal.sub>:<server>:<tool>
```

즉 같은 사용자가 같은 tool을 반복 호출할 때만 같은 quota를 소비한다. 다른 사용자 또는 다른 tool 호출은 별도 bucket으로 취급된다.

## 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60000` | window 길이 |
| `RATE_LIMIT_MAX` | `60` | window 안에서 허용되는 호출 수 |

예시:

```sh
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

위 설정은 사용자별, tool별로 1분에 30회까지 호출을 허용한다.

## 초과 응답

rate limit을 초과하면 Gateway는 HTTP 429와 JSON-RPC error를 반환한다.

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32029,
    "message": "Rate limit exceeded"
  }
}
```

이때 다음 기록이 남는다.

- audit event: `tool.rate_limited`
- metric: `mcp_gateway_tool_calls_total{decision="rate_limited"}`
- HTTP status: `429`

## Store 구조

현재 구현은 `RateLimitStore` interface와 memory 구현을 제공한다.

```text
RateLimitStore
  -> MemoryRateLimitStore
```

Memory store는 process-local이다. Pod가 여러 개이면 Pod마다 counter가 따로 계산된다. Pod 재시작 시 counter도 초기화된다.

## Redis 확장 지점

`REDIS_URL` 설정은 schema에 준비되어 있지만 Redis-backed store는 아직 구현되어 있지 않다. EKS에서 replica를 2개 이상 운영하려면 다음 확장이 필요하다.

1. Redis client 추가.
2. `RateLimitStore` interface를 구현하는 `RedisRateLimitStore` 추가.
3. `REDIS_URL`이 있을 때 Redis store를 선택하도록 server bootstrap 수정.
4. increment와 TTL 설정을 atomic하게 처리.
5. Redis 장애 시 fail-open 또는 fail-closed 정책 결정.

운영 기본값은 보안 관점에서 fail-closed가 안전하지만, MCP tool 사용성 관점에서는 일시 장애 시 fail-open이 더 나을 수 있다. 고위험 tool에는 별도 policy deny 또는 upstream 권한 제어를 함께 두는 것이 필요하다.

