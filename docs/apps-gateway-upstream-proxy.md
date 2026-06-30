# Apps Gateway Upstream LLM Gateway 구현 가이드

이 문서는 Claude Apps Gateway 뒤쪽에 배치할 `llm-gateway` 구현 기준을 정의한다. 기존 rate-limit proxy 책임에 Bedrock Guardrails 강제 적용을 합친 구조다. 기능별 상세 문서는 [llm-gateway/](./llm-gateway/)를 따른다.

참고 문서:

- Claude Apps Gateway configuration: https://code.claude.com/docs/en/claude-apps-gateway-config
- Amazon Bedrock ApplyGuardrail: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ApplyGuardrail.html
- Bedrock Guardrails independent API: https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-independent-api.html

## 목표 구조

```text
Claude Code
  -> Claude Apps Gateway
  -> llm-gateway
     -> Redis
     -> Bedrock Runtime ApplyGuardrail
     -> vLLM or another Anthropic-compatible upstream
```

Apps Gateway는 OIDC 로그인, session, spend limit, model allowlist를 담당한다. `llm-gateway`는 `/v1/messages` 추론 요청에 대해 다음 정책을 강제한다.

- Gateway shared secret 검증.
- request validation.
- input guardrail.
- inference rate limit.
- upstream forwarding.
- output guardrail.
- audit log와 metrics.

Apps Gateway 자체 설정만으로 non-Bedrock upstream에 Bedrock Guardrails를 강제하는 옵션은 확인되지 않는다. Bedrock `ApplyGuardrail` API는 모델 호출과 독립적으로 사용할 수 있으므로, proxy에서 입력과 출력을 별도로 검사한다.

## Naming

기존 문서에서는 `llm-rate-limit-proxy`와 `llm-policy-proxy`라는 이름을 사용했다. Guardrail 기능까지 포함하면 책임이 rate limit보다 넓어지므로 신규 구현 이름은 `llm-gateway`로 한다.

마이그레이션 중 기존 Apps Gateway chart나 values가 `llm-rate-limit-proxy` 또는 `llm-policy-proxy`를 바라보고 있다면 다음 중 하나를 선택한다.

- Apps Gateway `base_url`을 `http://llm-gateway.llm-gateway.svc.cluster.local:8080`로 변경한다.
- `llm-rate-limit-proxy` 또는 `llm-policy-proxy` Service를 `llm-gateway` Deployment로 연결하는 compatibility Service로 유지한다.

## API Surface

필수 endpoint:

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/healthz` | process liveness |
| `GET` | `/readyz` | Redis, Bedrock config, upstream URL readiness |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/v1/messages` | Anthropic Messages API proxy |

`/v1/messages`는 Anthropic-compatible request와 response를 유지해야 한다. Claude Apps Gateway가 `provider: anthropic` upstream으로 호출하기 때문이다.

## Request Flow

```text
POST /v1/messages
  -> authenticate gateway shared secret
  -> parse Anthropic Messages request
  -> select tier/model policy
  -> reserve rate-limit quota
  -> ApplyGuardrail(source=INPUT)
  -> forward to upstream
  -> collect upstream response
  -> ApplyGuardrail(source=OUTPUT)
  -> settle token usage
  -> return response
```

권장 순서:

1. Gateway 인증을 가장 먼저 수행한다.
2. request body를 size limit 안에서 parse한다.
3. rate limit은 guardrail 호출 전에 coarse reject 용도로 먼저 실행해도 된다.
4. input guardrail은 upstream 호출 전에 반드시 통과해야 한다.
5. output guardrail은 client 반환 전에 반드시 통과해야 한다.
6. guardrail 또는 rate limit 실패 요청은 upstream으로 보내지 않는다.

## Authentication

Apps Gateway upstream 설정의 `auth.api_key`는 proxy에서 검증한다.

Apps Gateway 설정:

```yaml
upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-gateway.llm-gateway.svc.cluster.local:8080
```

Proxy 검증:

- `x-api-key` 또는 Anthropic-compatible auth header에서 shared secret을 읽는다.
- constant-time comparison을 사용한다.
- secret별 tier를 매핑한다. 예: `standard`, `premium`, `batch`.
- 인증 실패는 `401` 또는 `403`으로 반환하고 upstream 호출을 하지 않는다.

사용자 단위 rate limit은 기본 구조에서 어렵다. Apps Gateway가 upstream에 사용자 email/sub/groups를 전달하는 안정적인 공개 계약이 없기 때문이다. 사용자 단위 정책이 필요하면 Apps Gateway 앞이 아니라 별도 인증 proxy 또는 Gateway 확장 계약이 필요하다.

## Request Parsing

Proxy는 `/v1/messages` body에서 최소한 다음 필드를 읽는다.

| Field | 용도 |
| --- | --- |
| `model` | rate-limit bucket, upstream model 검증 |
| `max_tokens` | token reservation |
| `stream` | output guardrail mode 결정 |
| `system` | input guardrail 대상 |
| `messages` | input guardrail 대상 |
| `tools` | 필요 시 policy/audit 대상 |

Guardrail input text 추출 대상:

- `system` string 또는 content block text.
- `messages[].content`가 string이면 해당 string.
- `messages[].content[]` 중 `type: "text"` block.
- `messages[].content[]` 중 `type: "tool_result"` block의 text content.

기본적으로 image, file, tool schema JSON 전체는 guardrail text 대상에서 제외한다. 필요하면 별도 정책으로 tool input/output text만 allowlist 추출한다.

## Rate Limit

Rate limit은 `REDIS_URL`이 설정되면 Redis 기반 shared counter를 사용한다. `REDIS_URL`이 없으면 in-memory counter로 동작하므로 replica가 여러 개인 EKS 운영 환경에서는 Redis를 반드시 설정한다.

설정:

| 환경 변수 | 설명 |
| --- | --- |
| `REDIS_URL` | Redis rate-limit store URL. 없으면 in-memory counter 사용 |
| `RATE_LIMIT_WINDOW_MS` | rate-limit window |
| `RATE_LIMIT_GLOBAL_RPM` | global request-per-minute 제한 |
| `RATE_LIMIT_TIER_RPM` | tier별 RPM JSON object |
| `RATE_LIMIT_MODEL_RPM` | model 또는 `tier:model`별 RPM JSON object |
| `RATE_LIMIT_GLOBAL_TPM` | global token-per-minute 제한. `max_tokens` reservation 기준 |
| `RATE_LIMIT_TIER_TPM` | tier별 TPM JSON object |
| `RATE_LIMIT_MODEL_TPM` | model 또는 `tier:model`별 TPM JSON object |
| `PROMPT_LOGGING_ENABLED` | raw prompt logging 활성화 |

권장 bucket:

| Bucket | Key 예시 | 목적 |
| --- | --- | --- |
| Global RPM | `global:rpm` | 전체 보호 |
| Tier RPM | `tier:standard:rpm` | shared secret별 제한 |
| Model RPM | `tier:standard:model:my-model:rpm` | 모델별 제한 |
| Token reservation | `tpm:tier:standard:model:my-model` | `max_tokens` 기반 보수적 제한 |

초과 응답은 Anthropic-compatible error 형식을 사용한다.

```json
{
  "type": "error",
  "error": {
    "type": "rate_limit_error",
    "message": "rate limit exceeded"
  }
}
```

HTTP status는 `429`를 사용한다. `Retry-After` header를 붙일 수 있으면 붙인다.

## Bedrock Guardrails

Proxy는 Bedrock Runtime `ApplyGuardrail` API를 직접 호출한다.

필수 설정:

| 환경 변수 | 설명 |
| --- | --- |
| `BEDROCK_REGION` | Bedrock Runtime region |
| `BEDROCK_GUARDRAIL_ID` | guardrail identifier |
| `BEDROCK_GUARDRAIL_VERSION` | guardrail version 또는 alias |
| `GUARDRAIL_INPUT_ENABLED` | input guardrail 활성화 |
| `GUARDRAIL_OUTPUT_ENABLED` | output guardrail 활성화 |
| `GUARDRAIL_FAIL_POLICY` | `closed` 또는 `open`. 기본 `closed` |

IAM:

```json
{
  "Effect": "Allow",
  "Action": "bedrock:ApplyGuardrail",
  "Resource": "*"
}
```

운영에서는 가능하면 guardrail ARN 또는 account/region 조건으로 좁힌다.

Input guardrail:

- `source`는 `INPUT`.
- user prompt, system prompt, tool result text를 검사한다.
- `action` 또는 응답 상태가 intervention이면 upstream 호출을 막는다.

Output guardrail:

- `source`는 `OUTPUT`.
- upstream assistant text를 검사한다.
- intervention이면 client에 원문을 반환하지 않는다.

## Streaming Mode

`stream: true` 요청에서 output guardrail을 강제하려면 strict mode를 기본으로 한다.

Strict mode:

```text
client stream request
  -> proxy forwards non-stream or buffered upstream request
  -> proxy receives full upstream response
  -> ApplyGuardrail(source=OUTPUT)
  -> emit response to client
```

장점:

- 출력이 client에 노출되기 전에 guardrail을 통과한다.
- “무조건 guardrail 적용” 요구를 만족하기 쉽다.

단점:

- streaming UX가 약해진다.
- first token latency가 증가한다.

Chunk mode는 기본값으로 쓰지 않는다. chunk 경계를 넘어가는 위험 문맥을 놓칠 수 있기 때문에 “무조건 적용”이라는 요구와 맞지 않는다.

권장 설정:

```sh
STREAMING_OUTPUT_GUARDRAIL_MODE=strict
```

## Upstream Forwarding

Proxy는 upstream을 Anthropic-compatible endpoint로 본다.

필수 설정:

| 환경 변수 | 설명 |
| --- | --- |
| `UPSTREAM_BASE_URL` | 예: `http://vllm.vllm.svc.cluster.local:8000` |
| `UPSTREAM_API_KEY` | vLLM 인증을 켠 경우 사용하는 server-side key |
| `UPSTREAM_TIMEOUT_MS` | upstream 전체 timeout |
| `UPSTREAM_TTFB_TIMEOUT_MS` | first byte timeout |

Forwarding 기준:

- client의 `Authorization`, `Cookie`, `X-Api-Key`를 upstream에 그대로 전달하지 않는다.
- vLLM 인증이 필요하면 `UPSTREAM_API_KEY`를 server-side credential로 붙인다.
- `anthropic-version`, `anthropic-beta` 같은 protocol header가 필요하면 allowlist로 전달한다.
- request body의 `model`은 Apps Gateway가 이미 upstream model로 변환한 값을 사용한다.

## Guardrail Intervention Response

Input이 차단되면 HTTP `400` 또는 `403` 중 하나를 선택한다. 운영 기본값은 `400`을 권장한다. client 입장에서는 prompt가 정책상 처리 불가능한 요청이기 때문이다.

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "request blocked by policy"
  }
}
```

Output이 차단되면 두 가지 방식 중 하나를 선택한다.

| 방식 | 설명 | 권장 |
| --- | --- | --- |
| Error response | `policy_error` 또는 `api_error` 형태로 실패 반환 | API 명확성 높음 |
| Refusal replacement | assistant text를 정책 문구로 대체 | Claude Code UX가 더 부드러움 |

기본값은 refusal replacement를 권장한다.

```json
{
  "id": "msg_guardrail",
  "type": "message",
  "role": "assistant",
  "model": "policy-filtered",
  "content": [
    {
      "type": "text",
      "text": "This response was blocked by the organization's safety policy."
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  }
}
```

## Failure Policy

Guardrail 강제 적용 요구가 있으면 기본값은 fail closed다.

| 장애 | Fail closed 동작 |
| --- | --- |
| Bedrock timeout | `503` |
| Bedrock throttling | `503` 또는 proxy-level retry 후 실패 |
| Guardrail config 누락 | readiness 실패 |
| Redis 장애 | `503` |
| Upstream timeout | `504` |

`GUARDRAIL_FAIL_POLICY=open`은 개발 또는 임시 장애 우회에만 사용한다. 운영에서는 audit log에 fail-open event를 반드시 남긴다.

## Metrics

Prometheus metric:

| Metric | Labels | 설명 |
| --- | --- | --- |
| `llm_gateway_http_requests_total` | `method`, `route`, `status_code` | HTTP 요청 수 |
| `llm_gateway_http_request_duration_seconds` | `method`, `route`, `status_code` | 전체 latency |
| `llm_gateway_requests_total` | `tier`, `model`, `status` | `/v1/messages` 처리 결과 |
| `llm_gateway_rate_limit_total` | `tier`, `model`, `decision`, `kind` | rate limit 결정 |
| `llm_gateway_prompts_logged_total` | `tier`, `model` | prompt log 기록 수 |
| `llm_gateway_guardrail_total` | `source`, `action` | guardrail 결과 |
| `llm_gateway_guardrail_duration_seconds` | `source` | ApplyGuardrail latency |
| `llm_gateway_upstream_requests_total` | `model`, `status` | upstream 호출 수 |
| `llm_gateway_upstream_duration_seconds` | `model` | upstream latency |
| `llm_gateway_auth_denied_total` | `status` | Apps Gateway shared secret 인증 실패 |

Alert 후보:

- guardrail error rate 증가.
- fail-open event 발생.
- rate-limit Redis error.
- upstream 5xx 증가.
- output guardrail intervention 급증.

## Audit Log

Audit event:

| Event | 설명 |
| --- | --- |
| `auth.denied` | Gateway shared secret 검증 실패 |
| `rate_limited` | rate limit 초과 |
| `guardrail.input.allowed` | input guardrail 통과 |
| `guardrail.input.blocked` | input guardrail 차단 |
| `guardrail.output.allowed` | output guardrail 통과 |
| `guardrail.output.blocked` | output guardrail 차단 |
| `upstream.error` | upstream 실패 |

Log에 남기지 않을 값:

- Gateway shared secret.
- upstream API key.
- prompt 원문.
- model output 원문.

필요하면 prompt/output hash, content length, guardrail action, policy category만 남긴다.

## Kubernetes 배포

필수 리소스:

- `Deployment`: `llm-gateway`
- `Service`: `llm-gateway`, port 8080
- `ServiceAccount`: IRSA로 Bedrock 권한 부여
- `Secret`: Gateway shared secrets, upstream API key
- `ConfigMap`: policy, rate-limit, guardrail 설정
- `Redis`: rate-limit store
- `NetworkPolicy`: Gateway ingress, Redis/Bedrock/vLLM egress

NetworkPolicy:

```text
claude-apps-gateway -> llm-gateway
llm-gateway -> Redis
llm-gateway -> Bedrock Runtime
llm-gateway -> vLLM
```

Gateway가 vLLM 또는 외부 Anthropic API로 직접 나가는 egress는 차단한다.

## 구현 모듈

권장 모듈:

| Module | 책임 |
| --- | --- |
| `server` | HTTP routes, lifecycle |
| `auth` | Gateway shared secret 검증 |
| `anthropic` | request/response schema, text extraction |
| `rate-limit` | Redis bucket, token reservation |
| `guardrail` | Bedrock ApplyGuardrail client |
| `upstream` | vLLM/Anthropic-compatible forwarding |
| `streaming` | strict buffering, SSE response formatting |
| `audit` | security event logging |
| `metrics` | Prometheus registry |

## 테스트 기준

Unit test:

- `x-api-key` 누락/오류.
- request body parse 실패.
- model별/tier별 rate limit.
- input guardrail block 시 upstream 미호출.
- output guardrail block 시 원문 미반환.
- Bedrock 장애 fail closed.
- Redis 장애 fail closed.
- streaming strict mode에서 output guardrail 전 client write 없음.

Integration test:

- mock Bedrock Runtime.
- mock vLLM `/v1/messages`.
- Redis test container 또는 fake Redis.
- Anthropic-compatible non-stream response.
- Anthropic-compatible stream response.

EKS smoke test:

- Gateway login 후 모델 요청 성공.
- burst 요청이 `429`로 차단.
- guardrail block 샘플이 vLLM access log에 남지 않음.
- output block 샘플이 client에 원문으로 노출되지 않음.
- Gateway Pod에서 vLLM 직접 egress 불가.
