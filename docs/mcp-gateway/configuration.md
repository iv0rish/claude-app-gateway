# Configuration

MCP Gateway는 환경 변수로 설정된다. Helm chart는 대부분의 값을 ConfigMap으로 주입하고, 민감한 값은 Secret 또는 별도 secret manager 연동으로 분리하는 전제를 둔다.

## 기본 서버 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Fastify listen host |
| `PORT` | `8080` | Fastify listen port |
| `PUBLIC_URL` | 없음 | 외부에서 접근하는 MCP Gateway base URL |
| `LOG_LEVEL` | `info` | Pino log level |
| `METRICS_ENABLED` | `true` | `/metrics` endpoint 활성화 여부 |

`PUBLIC_URL`은 인증 실패 시 `WWW-Authenticate` header의 `resource_metadata` URL을 만들 때 사용된다.

## OIDC 설정

| 환경 변수 | 필수 | 설명 |
| --- | --- | --- |
| `OIDC_ISSUER` | 예 | token issuer |
| `OIDC_AUDIENCE` | 예 | MCP Gateway 전용 audience |
| `OIDC_JWKS_URL` | 아니오 | explicit JWKS URL |
| `ALLOWED_EMAIL_DOMAINS` | 아니오 | comma-separated email domain allowlist |
| `ALLOWED_GROUPS` | 아니오 | comma-separated group allowlist |
| `GROUPS_CLAIM` | 아니오 | group claim 이름. 기본값 `groups` |

`OIDC_JWKS_URL`이 없으면 Gateway는 `OIDC_ISSUER` 기준 `/.well-known/jwks.json`을 사용한다. 현재 구현은 OIDC discovery document에서 `jwks_uri`를 읽지 않는다.

예시:

```sh
OIDC_ISSUER=https://idp.example.com
OIDC_AUDIENCE=mcp-gateway
OIDC_JWKS_URL=https://idp.example.com/oauth2/v1/keys
ALLOWED_EMAIL_DOMAINS=example.com,corp.example.com
ALLOWED_GROUPS=platform,ai-users
GROUPS_CLAIM=groups
```

## Tool policy 설정

`MCP_TOOL_POLICIES`는 JSON 문자열이다. 세 가지 형태를 지원한다.

배열 형태:

```json
[
  {
    "effect": "deny",
    "groups": ["contractor"],
    "servers": ["internal"],
    "tools": ["admin*"]
  },
  {
    "effect": "allow",
    "groups": ["platform"],
    "tools": ["*"]
  }
]
```

`rules` wrapper 형태:

```json
{
  "rules": [
    {
      "effect": "deny",
      "tools": ["dangerous*"]
    }
  ]
}
```

`allow`/`deny` 분리 형태:

```json
{
  "deny": [
    {
      "groups": ["contractor"],
      "tools": ["admin*"]
    }
  ],
  "allow": [
    {
      "groups": ["platform"],
      "tools": ["*"]
    }
  ]
}
```

`allow`/`deny` 분리 형태는 내부적으로 deny rule을 먼저 배치하고 allow rule을 뒤에 둔다.

## Rate limit 설정

| 환경 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60000` | rate limit window |
| `RATE_LIMIT_MAX` | `60` | window 안에서 허용되는 tool call 수 |
| `REDIS_URL` | 없음 | future Redis-backed store용 설정 |

현재 구현은 in-memory store만 사용한다. `REDIS_URL`은 설정 schema에 있지만 아직 store 선택에 쓰이지 않는다.

## Upstream 설정

`MCP_UPSTREAMS`는 JSON 배열이다.

```json
[
  {
    "name": "internal",
    "url": "http://internal-mcp.default.svc.cluster.local:8080/mcp",
    "token": "optional-upstream-token",
    "forwardHeaders": ["x-tenant-id", "x-trace-id"]
  }
]
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `name` | 예 | Gateway 내부 upstream 이름 |
| `url` | 예 | remote HTTP MCP endpoint |
| `token` | 아니오 | upstream 호출용 bearer token |
| `forwardHeaders` | 아니오 | client 요청에서 upstream으로 전달할 custom header allowlist |

Gateway는 `initialize`, `tools/list`, `tools/call` 요청을 `url`에 JSON-RPC POST로 전달한다. `token`이 있으면 outbound 요청에 `Authorization: Bearer <token>`을 붙인다.

`forwardHeaders`는 명시된 header만 전달한다. Header 이름은 소문자로 정규화되며 중복은 제거된다.

전달할 수 없는 header:

- `authorization`
- `cookie`
- `set-cookie`
- `proxy-authorization`
- `connection`
- `content-length`
- `host`
- `keep-alive`
- `proxy-authenticate`
- `te`
- `trailer`
- `transfer-encoding`
- `upgrade`

위 header를 `forwardHeaders`에 넣으면 Gateway가 설정 로딩 단계에서 실패한다. 사용자 bearer token이나 cookie를 upstream에 그대로 전달하지 않기 위한 제한이다.

## Helm values 매핑

MCP Gateway Helm chart는 다음 값을 ConfigMap으로 노출한다.

```yaml
config:
  publicUrl: https://mcp-gateway.internal.example.com
  oidcIssuer: https://idp.example.com
  oidcAudience: mcp-gateway
  oidcJwksUrl: https://idp.example.com/oauth2/v1/keys
  allowedEmailDomains:
    - example.com
  allowedGroups:
    - platform
  groupsClaim: groups
  logLevel: info
  metricsEnabled: true
  rateLimitWindowMs: 60000
  rateLimitMax: 60
  toolPolicies:
    rules: []
  upstreams:
    - name: internal
      url: http://internal-mcp.default.svc.cluster.local:8080/mcp
      forwardHeaders:
        - x-tenant-id
        - x-trace-id
```
