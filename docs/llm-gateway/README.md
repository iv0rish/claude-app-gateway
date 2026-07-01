# LLM Gateway

`llm-gateway`는 Claude Apps Gateway 뒤에서 Anthropic-compatible `/v1/messages` 요청을 받아 rate limit, Bedrock Guardrails, upstream forwarding을 적용하는 내부 service다. Apps-compatible mode에서는 OIDC login, session, managed model policy, spend limit까지 담당하는 client-facing Gateway로 패키징할 수 있다.

```text
Claude Code
  -> Claude Apps Gateway or llm-gateway apps-compatible runtime
  -> llm-gateway policy path
     -> Redis optional
     -> Bedrock Runtime ApplyGuardrail
     -> vLLM, another Anthropic-compatible upstream, or Bedrock native upstream
```

기존 proxy mode에서는 Apps Gateway가 OIDC 로그인, session, spend limit, model allowlist를 담당한다. Apps-compatible mode에서는 `llm-gateway`가 그 역할을 직접 수행하고 `APP_CONFIG_PATH`의 `gateway.yaml`을 읽는다.

## 문서 구조

| 문서 | 내용 |
| --- | --- |
| [configuration.md](./configuration.md) | 환경 변수, secret, Helm values |
| [apps-compatible-deployment.md](./apps-compatible-deployment.md) | `APP_CONFIG_PATH`, ingress, app config 배포 |
| [oidc-session.md](./oidc-session.md) | OIDC login, session JWT, Postgres store, admin token |
| [managed-settings-model-policy.md](./managed-settings-model-policy.md) | Claude Code managed settings, model catalog, managed policies |
| [spend-limits.md](./spend-limits.md) | organization/group/user spend limits |
| [bedrock-native-upstream.md](./bedrock-native-upstream.md) | Bedrock native model upstream |
| [request-flow.md](./request-flow.md) | `/v1/messages` 처리 순서와 오류 응답 |
| [authentication.md](./authentication.md) | Apps Gateway shared secret 검증 |
| [rate-limiting.md](./rate-limiting.md) | in-memory/Redis rate limit |
| [prompt-logging.md](./prompt-logging.md) | raw prompt audit logging |
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
  - RPM request bucket.
  - `max_tokens` reservation 기반 TPM token bucket.
- raw prompt logging.
- Bedrock Runtime `ApplyGuardrail` client.
- input guardrail.
- output guardrail.
- output intervention refusal replacement.
- upstream forwarding to `/v1/messages`.
- strict streaming 처리: client request가 `stream:true`여도 upstream에는 `stream:false`로 전달한다.
- audit log와 Prometheus metrics.
- Dockerfile과 Helm chart.

## Apps-Compatible Packaging

Helm chart는 기존 proxy env를 유지하면서 다음 app Gateway 설정도 렌더링한다.

- `APP_CONFIG_PATH=/etc/llm-gateway/gateway.yaml`
- OIDC issuer/client/domain/group settings.
- Postgres store settings.
- session JWT secret reference.
- admin token reference.
- managed model policies.
- spend limits.
- Anthropic-compatible upstreams and optional Bedrock native upstream.
- optional Kubernetes Ingress.

## 현재 한계

- Apps-compatible API surface는 `APP_CONFIG_PATH` config를 읽는 runtime path에 의존한다. 기존 `/v1/messages` proxy env는 backward compatibility를 위해 계속 렌더링된다.
- token policy는 `max_tokens` reservation 기반으로 구현되어 있다. upstream 응답의 실제 usage로 사후 보정하는 settlement는 아직 없다.
- SSE streaming passthrough는 제공하지 않는다. output guardrail을 강제하기 위해 strict buffering 방식을 사용한다.
- Bedrock Guardrail retry/backoff와 circuit breaker는 아직 없다.
- Redis는 optional이다. 운영에서 replica를 2개 이상 쓰면 `REDIS_URL`을 반드시 설정한다.
- 사용자 단위 rate limit은 구현하지 않았다. Apps Gateway가 upstream에 사용자 identity를 안정적으로 전달하는 공개 계약이 없기 때문이다.
- prompt logging은 raw prompt를 남긴다. 운영에서는 로그 저장소 접근 제어와 보존 기간을 별도로 관리해야 한다.
