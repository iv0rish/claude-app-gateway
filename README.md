# Claude App Gateway Infrastructure

Claude Apps Gateway를 사내 EKS 환경에 배포하고, 뒤쪽에 LLM 정책 gateway와 MCP gateway를 붙이기 위한 구현/문서 저장소다.

## Architecture

```text
Claude Code
  -> Claude Apps Gateway
     -> llm-gateway
        -> Redis optional
        -> AWS Bedrock ApplyGuardrail
        -> vLLM or another Anthropic-compatible upstream

Claude Code
  -> MCP Gateway
     -> internal MCP upstreams
```

역할:

| Component | 역할 |
| --- | --- |
| Claude Apps Gateway | Claude Code 로그인, OIDC session, spend limit, managed settings, model allowlist |
| `llm-gateway` | `/v1/messages` rate/token limit, prompt logging, Bedrock Guardrails, upstream forwarding |
| `mcp-gateway` | OIDC-authenticated MCP endpoint, tool policy, rate limit, audit log, metrics |

## Repository Layout

```text
charts/
  apps-gateway/   # Claude Apps Gateway Helm chart
  llm-gateway/    # LLM policy gateway Helm chart
  mcp-gateway/    # MCP Gateway Helm chart

services/
  llm-gateway/    # Fastify service for LLM policy enforcement
  mcp-gateway/    # Fastify service for MCP proxy/policy enforcement

docs/
  apps-gateway-*.md
  llm-gateway/
  mcp-gateway/
  progress/
```

## Services

### LLM Gateway

`services/llm-gateway`는 Apps Gateway의 Anthropic upstream 뒤쪽에서 동작한다.

주요 기능:

- Apps Gateway shared secret 인증.
- Anthropic-compatible `POST /v1/messages`.
- RPM rate limit.
- `max_tokens` reservation 기반 TPM token policy.
- Redis-backed shared counter, in-memory fallback.
- raw prompt logging.
- Bedrock `ApplyGuardrail` input/output 검사.
- output 차단 시 refusal replacement.
- vLLM/Anthropic-compatible upstream forwarding.
- Prometheus metrics와 audit log.

문서: [docs/llm-gateway/README.md](./docs/llm-gateway/README.md)

### MCP Gateway

`services/mcp-gateway`는 Claude Code용 remote HTTP MCP gateway다.

주요 기능:

- OIDC/JWKS bearer token 검증.
- `POST /mcp` JSON-RPC endpoint.
- `initialize`, `tools/list`, `tools/call`.
- group/server/tool policy.
- user/tool rate limit.
- custom header forwarding to MCP upstream.
- audit log와 Prometheus metrics.

문서: [docs/mcp-gateway/README.md](./docs/mcp-gateway/README.md)

## Apps Gateway

Claude Apps Gateway binary 자체는 이 repo에서 구현하지 않는다. 이 repo는 Apps Gateway 설정, 패키징, Helm chart, 뒤쪽 LLM/MCP gateway를 제공한다.

주요 문서:

- [docs/apps-gateway-config.md](./docs/apps-gateway-config.md)
- [docs/apps-gateway-packaging.md](./docs/apps-gateway-packaging.md)
- [docs/apps-gateway-upstream-proxy.md](./docs/apps-gateway-upstream-proxy.md)

Apps Gateway upstream은 `llm-gateway`를 바라본다.

```yaml
upstreams:
  - name: vllm-standard
    provider: anthropic
    auth:
      api_key: ${VLLM_STANDARD_KEY}
    base_url: http://llm-gateway.llm-gateway.svc.cluster.local:8080
```

## Development

Prerequisites:

- Node.js 22+
- npm
- Helm 3

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm run typecheck
npm test
npm run build
```

Helm validation:

```sh
helm lint charts/apps-gateway
helm lint charts/llm-gateway
helm lint charts/mcp-gateway

helm template test charts/apps-gateway --namespace llm-gateway
helm template test charts/llm-gateway --namespace llm-gateway
helm template test charts/mcp-gateway --namespace llm-gateway
```

## Deployment

Build images:

```sh
docker build -f services/llm-gateway/Dockerfile -t <repo>/llm-gateway:<tag> .
docker build -f services/mcp-gateway/Dockerfile -t <repo>/mcp-gateway:<tag> .
```

Deploy charts:

```sh
helm upgrade --install llm-gateway charts/llm-gateway \
  --namespace llm-gateway \
  --create-namespace

helm upgrade --install mcp-gateway charts/mcp-gateway \
  --namespace llm-gateway

helm upgrade --install claude-apps-gateway charts/apps-gateway \
  --namespace llm-gateway
```

Environment-specific values must provide real IdP, Redis, Bedrock, vLLM, Postgres, image, and secret settings.

## Security Notes

- Apps Gateway should not egress directly to external Anthropic API when internal vLLM is required.
- Apps Gateway should only call `llm-gateway` for model inference.
- `llm-gateway` prompt logging records raw prompt text. Restrict log sink access and retention.
- `llm-gateway` should use Redis for shared rate/token limits in multi-replica deployments.
- Bedrock Guardrails should run fail-closed in production.
- MCP Gateway does not reuse Apps Gateway session tokens. It validates its own OIDC access token.

## Progress Log

Implementation progress is recorded in [docs/progress/](./docs/progress/).

