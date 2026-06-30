# Request Flow

`llm-gateway`는 `POST /v1/messages`만 추론 proxy endpoint로 제공한다.

## Endpoints

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/healthz` | process liveness |
| `GET` | `/readyz` | upstream과 guardrail 설정 상태 |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/v1/messages` | Anthropic Messages API proxy |

## 처리 순서

```text
POST /v1/messages
  -> shared secret authentication
  -> Anthropic Messages request validation
  -> rate limit
  -> ApplyGuardrail(source=INPUT)
  -> upstream /v1/messages
  -> ApplyGuardrail(source=OUTPUT)
  -> response or refusal replacement
```

## Request Validation

필수 필드:

| Field | 조건 |
| --- | --- |
| `model` | non-empty string |
| `max_tokens` | positive integer |
| `messages` | array |

`system`, `stream`, 기타 Anthropic Messages API 필드는 passthrough된다.

## 오류 응답

인증 실패:

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "gateway authentication failed"
  }
}
```

잘못된 request:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "invalid Anthropic Messages request"
  }
}
```

Rate limit:

```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "rate limit exceeded"
  }
}
```

Gateway 내부 실패:

```json
{
  "type": "error",
  "error": {
    "type": "api_error",
    "message": "llm gateway request failed"
  }
}
```

## Streaming

현재 구현은 strict output guardrail 모드다.

- client request가 `stream:true`여도 upstream에는 `stream:false`로 전달한다.
- upstream 전체 응답을 받은 뒤 output guardrail을 실행한다.
- output이 허용되면 non-stream message response를 반환한다.

이 방식은 streaming UX보다 output guardrail 강제를 우선한다.

