# Upstream Forwarding

`llm-gateway`는 Anthropic-compatible upstream의 `/v1/messages`로 요청을 전달한다. 기본 대상은 vLLM Anthropic Messages 호환 endpoint다.

## URL

`UPSTREAM_BASE_URL` 기준으로 `/v1/messages`를 호출한다.

예시:

```sh
UPSTREAM_BASE_URL=http://vllm.vllm.svc.cluster.local:8000
```

실제 호출:

```text
POST http://vllm.vllm.svc.cluster.local:8000/v1/messages
```

## Header

기본 outbound header:

```http
Accept: application/json
Content-Type: application/json
```

Allowlist로 전달되는 incoming protocol header:

- `anthropic-version`
- `anthropic-beta`

`UPSTREAM_API_KEY`가 있으면 다음 header를 붙인다.

```http
X-Api-Key: <UPSTREAM_API_KEY>
```

전달하지 않는 값:

- client `Authorization`.
- client `Cookie`.
- Apps Gateway가 보낸 `x-api-key`.

## Body

request body는 Anthropic Messages API shape를 유지한다. 단, strict output guardrail을 위해 `stream:true`는 upstream 호출 시 `stream:false`로 바뀐다.

```json
{
  "model": "my-model",
  "max_tokens": 1024,
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "hello"
    }
  ]
}
```

## Timeout

`UPSTREAM_TIMEOUT_MS` 안에 upstream 응답이 오지 않으면 request를 abort한다. Gateway 응답은 `503` 또는 abort message에 따라 `504`로 처리될 수 있다.

## 현재 한계

- upstream retry/backoff는 없다.
- circuit breaker는 없다.
- 여러 upstream routing은 없다.
- SSE streaming passthrough는 없다.

