# MCP Gateway

이 문서는 Claude Code에서 사용할 사내 MCP Gateway의 구현 기능을 설명한다. 기존 설계 문서의 내용을 기능 단위로 나누었고, 각 문서는 현재 코드에 구현된 동작과 운영 시 알아야 할 한계를 함께 적는다.

## 목표 구조

```text
Claude Code
  -> internal HTTPS Ingress/ALB
  -> mcp-gateway Service
  -> internal MCP upstreams
```

Claude Apps Gateway와 MCP Gateway는 같은 사내 IdP를 사용하지만 로그인 세션을 공유하지 않는다.

```text
Claude Code
  -> claude-apps-gateway
     -> IdP OIDC login for LLM gateway session

Claude Code
  -> mcp-gateway
     -> IdP OIDC login for MCP access token
```

Claude Apps Gateway session token은 MCP Gateway 인증에 재사용하지 않는다. Apps Gateway 토큰은 Gateway 내부 세션 토큰이고, MCP Gateway가 공개 JWKS로 검증할 수 있는 별도 OIDC access token 계약이 아니다. 따라서 MCP Gateway는 자체 OIDC/OAuth resource server로 동작한다.

## 문서 구조

| 문서 | 내용 |
| --- | --- |
| [configuration.md](./configuration.md) | 환경 변수, Helm values, 설정 JSON 형식 |
| [authentication.md](./authentication.md) | OIDC/JWKS 검증, principal 추출, 인증 실패 처리 |
| [mcp-json-rpc.md](./mcp-json-rpc.md) | `/mcp` endpoint, 지원 JSON-RPC method, 오류 응답 |
| [policy.md](./policy.md) | group/server/tool 기반 allow/deny 정책 |
| [rate-limiting.md](./rate-limiting.md) | tool call rate limit, store interface, Redis 확장 지점 |
| [audit-logging.md](./audit-logging.md) | audit event, structured log 필드, 운영 활용 |
| [metrics.md](./metrics.md) | Prometheus endpoint와 metric 목록 |
| [upstreams.md](./upstreams.md) | upstream registry, 현재 example upstream, 실제 proxy 확장 계획 |
| [operations.md](./operations.md) | EKS 배포, Claude Code managed MCP 배포, 점검 절차 |

## 현재 구현된 기능

- Fastify 기반 MCP Gateway service.
- OIDC bearer token 검증.
- email domain, group claim 기반 접근 제한.
- MCP JSON-RPC endpoint: `initialize`, `tools/list`, `tools/call`.
- tool policy engine: group, server, tool pattern 기반 allow/deny.
- in-memory tool call rate limit.
- audit log.
- Prometheus text metrics.
- Dockerfile과 Helm chart.

## 현재 구현 범위의 한계

- `MCP_UPSTREAMS[].url` 설정은 존재하지만, 현재 코드는 실제 remote MCP server로 HTTP proxy하지 않고 in-process example upstream을 등록한다.
- `REDIS_URL` 설정과 rate-limit store interface는 준비되어 있지만 Redis store 구현은 아직 없다.
- JWKS URL은 `OIDC_JWKS_URL`이 있으면 그 값을 사용하고, 없으면 issuer 기준 `/.well-known/jwks.json`으로 계산한다. OIDC discovery document를 가져와 `jwks_uri`를 해석하는 기능은 아직 없다.
- 인증 실패 challenge는 OAuth protected resource metadata URL을 포함하지만, 해당 metadata endpoint 자체는 아직 구현되어 있지 않다.
- metric registry는 process-local이다. Pod 재시작 시 counter와 histogram 상태는 초기화된다.

