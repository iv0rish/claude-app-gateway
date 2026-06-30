# LLM Gateway

`llm-gateway`는 Claude Apps Gateway 뒤에서 Anthropic-compatible `/v1/messages` 요청을 받아 rate limit, Bedrock Guardrails, upstream forwarding을 적용하는 내부 service다.

```text
Claude Code
  -> Claude Apps Gateway
  -> llm-gateway
     -> Redis optional
     -> Bedrock Runtime ApplyGuardrail
     -> vLLM or another Anthropic-compatible upstream
```

Apps Gateway는 OIDC 로그인, session, spend limit, model allowlist를 담당한다. `llm-gateway`는 추론 요청의 정책 집행 지점이다.

## 문서 구조

| 문서 | 내용 |
| --- | --- |
| [configuration.md](./configuration.md) | 환경 변수, secret, Helm values |
| [request-flow.md](./request-flow.md) | `/v1/messages` 처리 순서와 오류 응답 |
| [authentication.md](./authentication.md) | Apps Gateway shared secret 검증 |
| [rate-limiting.md](./rate-limiting.md) | in-memory/Redis rate limit |
| [guardrails.md](./guardrails.md) | Bedrock `ApplyGuardrail` input/output 적용 |
| [upstream-forwarding.md](./upstream-forwarding.md) | vLLM/Anthropic-compatible upstream 호출 |
| [observability.md](./observability.md) | audit log, Prometheus metrics |
| [deployment.md](./deployment.md) | Dockerfile, Helm chart, NetworkPolicy |

## 구현된 기능

- Fastify 기반 HTTP service.
- `GET /healthz`, `GET /readyz`, `GET /metrics`.
- `POST /v1/messages` Anthropic-compatible proxy.
- Apps Gateway shared secret 인증.
- Anthropic Messages request validation.
- input text extraction.
- rate limit:
  - `REDIS_URL`이 있으면 Redis-backed shared counter.
  - 없으면 local/dev용 in-memory counter.
- Bedrock Runtime `ApplyGuardrail` client.
- input guardrail.
- output guardrail.
- output intervention refusal replacement.
- upstream forwarding to `/v1/messages`.
- strict streaming 처리: client request가 `stream:true`여도 upstream에는 `stream:false`로 전달한다.
- audit log와 Prometheus metrics.
- Dockerfile과 Helm chart.

## 현재 한계

- token reservation/settlement는 아직 request count 기반 RPM 제한으로만 구현되어 있다.
- SSE streaming passthrough는 제공하지 않는다. output guardrail을 강제하기 위해 strict buffering 방식을 사용한다.
- Bedrock Guardrail retry/backoff와 circuit breaker는 아직 없다.
- Redis는 optional이다. 운영에서 replica를 2개 이상 쓰면 `REDIS_URL`을 반드시 설정한다.
- 사용자 단위 rate limit은 구현하지 않았다. Apps Gateway가 upstream에 사용자 identity를 안정적으로 전달하는 공개 계약이 없기 때문이다.

