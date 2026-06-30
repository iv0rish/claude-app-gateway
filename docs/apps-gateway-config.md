# Claude Apps Gateway 설정 가이드

이 문서는 Claude Apps Gateway가 사내 vLLM endpoint를 사용하도록 구성하는 기준을 정의한다. 배포 패키징과 Kubernetes 운영 절차는 [apps-gateway-packaging.md](./apps-gateway-packaging.md), MCP Gateway는 [mcp-gateway.md](./mcp-gateway.md)를 따른다.

참고 문서:

- Claude Apps Gateway overview: https://code.claude.com/docs/en/claude-apps-gateway
- Claude Apps Gateway configuration: https://code.claude.com/docs/en/claude-apps-gateway-config
- vLLM Claude Code integration: https://docs.vllm.ai/en/latest/serving/integrations/claude_code/

## 목표 구조

```text
Developer Claude Code
  -> internal HTTPS Ingress/ALB
  -> claude-apps-gateway Service
  -> llm-rate-limit-proxy Service
  -> vLLM ClusterIP Service
  -> vLLM Pods
```

구성 원칙:

- 개발자 클라이언트는 Claude Apps Gateway URL만 안다.
- Gateway는 OIDC로 사용자를 인증하고, Postgres에 device grant/session/spend-limit 상태를 저장한다.
- Gateway의 Anthropic upstream `base_url`은 EKS 내부 rate-limit proxy를 가리킨다.
- rate-limit proxy는 Anthropic Messages API 요청을 제한한 뒤 vLLM으로 전달한다.
- Gateway Pod에서 외부 `api.anthropic.com` egress는 차단한다.
- vLLM은 Anthropic Messages API 호환 endpoint인 `/v1/messages`를 제공해야 한다.

## CoreDNS Rewrite 제외

`api.anthropic.com` DNS를 CoreDNS에서 vLLM Service로 바꾸는 방식은 기본안으로 쓰지 않는다. 실제 Anthropic API 요청은 HTTPS이고, 클라이언트는 TLS SNI와 Host를 여전히 `api.anthropic.com`으로 보낸다. 내부 vLLM이 `api.anthropic.com`에 대한 신뢰 가능한 인증서를 제시하지 못하면 TLS handshake가 실패한다.

따라서 Gateway 설정에서 Anthropic upstream의 `base_url`을 명시적으로 override한다.

```yaml
upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-rate-limit-proxy.llm-gateway.svc.cluster.local:8080
```

CoreDNS rewrite는 base URL을 바꿀 수 없는 별도 클라이언트가 생겼을 때만 검토한다. 그 경우에도 vLLM으로 직접 rewrite하지 말고, `api.anthropic.com` 인증서/SNI를 처리할 수 있는 내부 TLS 프록시를 별도 설계한다.

## gateway.yaml

기준 설정:

```yaml
listen:
  host: 0.0.0.0
  port: 8080
  public_url: https://claude-gateway.internal.example.com
  trusted_proxies:
    - 10.0.0.0/8

oidc:
  issuer: https://login.example.com
  client_id: 0oa1example2
  client_secret: ${OIDC_CLIENT_SECRET}
  allowed_email_domains:
    - example.com
  userinfo_fallback: true

session:
  jwt_secret: ${GATEWAY_JWT_SECRET}
  ttl_hours: 1

store:
  postgres_url: ${GATEWAY_POSTGRES_URL}
  max_connections: 5

upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-rate-limit-proxy.llm-gateway.svc.cluster.local:8080

auto_include_builtin_models: false
models:
  - id: claude-sonnet-4-6
    label: Internal vLLM Sonnet
    upstream_model:
      vllm-standard: my-model

managed:
  policies:
    - match: {}
      cli:
        availableModels:
          - claude-sonnet-4-6
        enforceAvailableModels: true
        permissions:
          deny:
            - "WebFetch"
        env:
          DISABLE_UPDATES: "1"
```

설정 기준:

- `listen.public_url`은 ALB/Ingress의 외부 HTTPS origin과 정확히 일치해야 한다.
- `oidc.issuer`는 `/.well-known/openid-configuration`을 제공해야 한다.
- `GATEWAY_JWT_SECRET`은 `openssl rand -base64 32`로 생성한다.
- `GATEWAY_POSTGRES_URL`은 운영에서는 RDS PostgreSQL 14+를 권장하며, managed Postgres라면 `sslmode=require`를 붙인다.
- `VLLM_STANDARD_KEY`는 Gateway가 rate-limit proxy에 보낼 shared secret이다.
- `models[].id`는 Claude Code 사용자에게 노출할 모델명이다.
- `models[].upstream_model.<upstream-name>` 값은 vLLM의 served model name과 일치해야 한다.
- upstream에 `name:`을 지정하면 `models[].upstream_model`은 provider 이름이 아니라 upstream name을 key로 사용한다.

## Inference Rate Limit

Claude Apps Gateway의 내장 `rate_limits` 설정은 `/v1/messages` 추론 요청이 아니라 unauthenticated device authorization 흐름 보호용이다. `/v1/messages`에 직접 적용되는 내장 제어는 spend limit과 `availableModels` allowlist다. QPS/RPM/TPM 제한은 Gateway 뒤쪽에 별도 proxy를 두고 구현한다.

```text
claude-apps-gateway
  -> llm-rate-limit-proxy
  -> vLLM
```

rate-limit proxy 책임:

- Anthropic Messages API의 `/v1/messages` 요청과 streaming 응답을 그대로 proxy한다.
- Gateway가 보낸 `x-api-key`를 검증한다.
- `model`과 `x-api-key`를 기준으로 bucket을 선택한다.
- 초과 시 Anthropic-compatible `429` 응답을 반환하고 vLLM에는 전달하지 않는다.
- Redis 같은 외부 store를 사용해 replica 간 counter를 공유한다.

지원 단위:

| 단위 | 구현 방식 | 권장 여부 |
| --- | --- | --- |
| Global | proxy 전체 bucket 하나를 사용 | 최소 보호 장치로 권장 |
| Model | request body의 `model` 값 기준으로 bucket 분리 | 권장 |
| Tier/Group | Gateway named upstream마다 다른 `x-api-key`를 발급하고 key별 bucket 분리 | 권장 |
| User | Gateway가 upstream에 사용자 email/sub/groups를 전달하는 공개 설정이 없으므로 기본 구조에서는 비권장 | 별도 인증 proxy 필요 |

Tier별 제한이 필요하면 Gateway upstream을 여러 개 만든다.

```yaml
upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-rate-limit-proxy.llm-gateway.svc.cluster.local:8080
  - name: vllm-premium
    provider: anthropic
    auth:
      api_key: ${VLLM_PREMIUM_KEY}
    base_url: http://llm-rate-limit-proxy.llm-gateway.svc.cluster.local:8080

models:
  - id: claude-sonnet-4-6-standard
    label: Internal vLLM Sonnet Standard
    upstream_model:
      vllm-standard: my-model
  - id: claude-sonnet-4-6-premium
    label: Internal vLLM Sonnet Premium
    upstream_model:
      vllm-premium: my-model

managed:
  policies:
    - match: { groups: [llm-premium] }
      cli:
        availableModels:
          - claude-sonnet-4-6-premium
        enforceAvailableModels: true
    - match: {}
      cli:
        availableModels:
          - claude-sonnet-4-6-standard
        enforceAvailableModels: true
```

token 기반 제한이 필요하면 request body의 `max_tokens`를 예약량으로 차감하고, 응답 usage를 확인할 수 있는 경우 실제 사용량으로 보정한다. streaming 응답은 완료 전까지 usage를 알 수 없을 수 있으므로, 운영 기본값은 request count 제한과 conservative token reservation을 같이 둔다.

## vLLM 요구사항

- served model name은 slash 없는 이름을 사용한다. 예: `my-model`
- Gateway의 `models[].upstream_model.<upstream-name>` 값과 vLLM served model name을 일치시킨다.
- tool calling을 사용하는 Claude Code 워크로드를 고려해 tool call 지원 모델을 선택한다.
- vLLM access log에서 rate-limit proxy 요청의 path가 `/v1/messages`로 기록되는지 확인한다.
- vLLM 인증을 켠 경우 rate-limit proxy가 vLLM server token을 붙여서 upstream 요청을 보내도록 한다.

## 클라이언트 Managed Settings

Gateway 배포만으로는 개발자 머신이 Gateway를 사용하지 않는다. Claude Code managed settings를 MDM 또는 OS별 관리 경로로 배포해야 한다.

```json
{
  "forceLoginMethod": "gateway",
  "forceLoginGatewayUrl": "https://claude-gateway.internal.example.com"
}
```

OS별 파일 경로:

| Platform | Path |
| --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` 또는 `com.anthropic.claudecode` managed preferences domain |
| Linux / WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` 또는 HKLM Group Policy |

`forceLoginMethod: gateway`와 `forceLoginGatewayUrl`은 admin-controlled managed tier에서만 동작한다. 사용자가 `~/.claude/settings.json`에 직접 넣는 방식은 사용할 수 없다.

