# Configuration

`llm-gateway`는 환경 변수로 설정된다. Helm chart는 ConfigMap과 Secret으로 값을 주입한다.

## Server

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | listen host |
| `PORT` | `8080` | listen port |
| `LOG_LEVEL` | `info` | Pino log level |
| `METRICS_ENABLED` | `true` | `/metrics` endpoint 활성화 |

## Apps Gateway 인증

| 환경 변수 | 필수 | 설명 |
| --- | --- | --- |
| `GATEWAY_API_KEYS` | 조건부 | JSON array. key와 tier 목록 |
| `GATEWAY_API_KEY` | 조건부 | 단일 shared secret. legacy/simple mode |

둘 중 하나는 필요하다.

`GATEWAY_API_KEYS` 예시:

```json
[
  { "key": "standard-secret", "tier": "standard" },
  { "key": "premium-secret", "tier": "premium" }
]
```

Apps Gateway upstream별 `auth.api_key` 값을 다르게 두면 tier별 rate limit을 적용할 수 있다.

## Upstream

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `UPSTREAM_BASE_URL` | `http://vllm.vllm.svc.cluster.local:8000` | Anthropic-compatible upstream base URL |
| `UPSTREAM_API_KEY` | 없음 | upstream server-side API key |
| `UPSTREAM_TIMEOUT_MS` | `120000` | upstream request timeout |

`UPSTREAM_API_KEY`가 있으면 upstream 요청에 `x-api-key`로 전달된다. client의 `Authorization`, `Cookie`, `x-api-key`는 upstream으로 전달하지 않는다.

## Rate Limit

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `REDIS_URL` | 없음 | Redis shared counter URL |
| `RATE_LIMIT_WINDOW_MS` | `60000` | rate-limit window |
| `RATE_LIMIT_GLOBAL_RPM` | `600` | global RPM |
| `RATE_LIMIT_TIER_RPM` | `{}` | tier별 RPM JSON object |
| `RATE_LIMIT_MODEL_RPM` | `{}` | model 또는 `tier:model`별 RPM JSON object |
| `RATE_LIMIT_GLOBAL_TPM` | `0` | global TPM. `0`이면 token bucket 비활성 |
| `RATE_LIMIT_TIER_TPM` | `{}` | tier별 TPM JSON object |
| `RATE_LIMIT_MODEL_TPM` | `{}` | model 또는 `tier:model`별 TPM JSON object |

예시:

```json
{
  "standard": 300,
  "premium": 1200
}
```

```json
{
  "my-model": 600,
  "premium:my-model": 2000
}
```

## Guardrails

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `GUARDRAIL_INPUT_ENABLED` | `false` | input guardrail 활성화 |
| `GUARDRAIL_OUTPUT_ENABLED` | `false` | output guardrail 활성화 |
| `GUARDRAIL_FAIL_POLICY` | `closed` | `closed` 또는 `open` |
| `BEDROCK_REGION` | 없음 | Bedrock Runtime region |
| `BEDROCK_GUARDRAIL_ID` | 없음 | guardrail identifier |
| `BEDROCK_GUARDRAIL_VERSION` | 없음 | guardrail version 또는 alias |
| `REFUSAL_TEXT` | 기본 정책 문구 | output 차단 시 fallback refusal |

input/output guardrail 중 하나라도 켜면 Bedrock region, guardrail id, guardrail version이 필요하다.

## Helm Values

주요 values:

```yaml
config:
  upstreamBaseUrl: http://vllm.vllm.svc.cluster.local:8000
  redisUrl: redis://redis.llm-gateway.svc.cluster.local:6379
  rateLimitGlobalRpm: 600
  rateLimitGlobalTpm: 60000
  rateLimitTierRpm:
    standard: 300
    premium: 1200
  rateLimitTierTpm:
    standard: 30000
    premium: 120000
  promptLoggingEnabled: true
  guardrailInputEnabled: true
  guardrailOutputEnabled: true
  guardrailFailPolicy: closed
  bedrockRegion: us-east-1
  bedrockGuardrailId: gr-xxxxxxxx
  bedrockGuardrailVersion: "1"

secrets:
  gatewayApiKeys:
    - key: replace-me
      tier: standard
  upstreamApiKey: ""
```
