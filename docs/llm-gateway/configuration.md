# Configuration

`llm-gateway` proxy path는 환경 변수로 설정된다. Apps-compatible runtime은 `APP_CONFIG_PATH`가 가리키는 YAML config file을 읽는다. Helm chart는 두 surface를 모두 렌더링해 기존 env 기반 배포와 apps-compatible 배포를 같이 지원한다.

## Server

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | listen host |
| `PORT` | `8080` | listen port |
| `LOG_LEVEL` | `info` | Pino log level |
| `METRICS_ENABLED` | `true` | `/metrics` endpoint 활성화 |
| `APP_CONFIG_PATH` | `/etc/llm-gateway/gateway.yaml` | apps-compatible runtime config path |

## Apps-Compatible Config

Helm chart는 ConfigMap에 `gateway.yaml`을 만들고 Deployment에 `/etc/llm-gateway/gateway.yaml`로 mount한다.

```yaml
listen:
  host: 0.0.0.0
  port: 8080
  public_url: https://llm-gateway.internal.example.com

oidc:
  issuer: https://login.example.com
  clientId: llm-gateway
  clientSecret: ${OIDC_CLIENT_SECRET}
  redirectUri: https://llm-gateway.internal.example.com/oauth/callback

session:
  jwtSecret: ${SESSION_JWT_SECRET}
  accessTokenTtlSeconds: 3600
  refreshTokenTtlSeconds: 2592000

store:
  postgresUrl: ${POSTGRES_URL}
```

Secret keys:

| Key | 설명 |
| --- | --- |
| `OIDC_CLIENT_SECRET` | OIDC client secret |
| `SESSION_JWT_SECRET` | session JWT signing secret |
| `POSTGRES_URL` | Postgres store URL |
| `ADMIN_TOKEN` or `ADMIN_TOKENS` | admin/bootstrap API token |

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

Apps-compatible config는 `config.upstreams`에서 Anthropic-compatible upstream과 Bedrock native upstream을 렌더링한다.

```yaml
config:
  upstreams:
    anthropicCompatible:
      - name: vllm-standard
        type: anthropic
        baseUrl: http://vllm.vllm.svc.cluster.local:8000
        apiKeyEnv: VLLM_STANDARD_KEY
    bedrockNative:
      enabled: false
      name: bedrock-claude
      type: bedrock
      region: us-east-1
      modelId: anthropic.claude-3-5-sonnet-20241022-v2:0
```

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
  oidc:
    issuer: https://login.example.com
    clientId: llm-gateway
    redirectUri: https://llm-gateway.internal.example.com/oauth/callback
  session:
    accessTokenTtlSeconds: 3600
    refreshTokenTtlSeconds: 2592000
  managedPolicies:
    - name: default
      groups: []
      emails: []
      settings:
        cli:
          availableModels:
            - claude-sonnet-4-6
          enforceAvailableModels: true
      availableModels:
        - claude-sonnet-4-6
  spendLimits:
    failPolicy: closed
    limits:
      - id: org-monthly
        scope: organization
        period: month
        amountUsd: 1000

secrets:
  gatewayApiKeys:
    - key: replace-me
      tier: standard
  upstreamApiKey: ""
  oidcClientSecret: replace-me
  sessionJwtSecret: replace-me
  adminToken: replace-me
  postgresUrl: postgres://user:password@postgres.example.com:5432/llm_gateway?sslmode=require
  vllmStandardKey: replace-me
```
