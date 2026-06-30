# MCP Gateway 설계 및 배포 가이드

이 문서는 Claude Code에서 사용할 사내 MCP Gateway를 EKS에 배포하고, Claude Apps Gateway와 같은 IdP를 각각 OIDC/OAuth로 신뢰하도록 구성하는 기준을 정의한다.

참고 문서:

- Claude Code MCP reference: https://code.claude.com/docs/en/mcp
- Managed MCP configuration: https://code.claude.com/docs/en/managed-mcp
- Claude Apps Gateway configuration: https://code.claude.com/docs/en/claude-apps-gateway-config

## 목표 구조

```text
Developer Claude Code
  -> internal HTTPS Ingress/ALB for MCP
  -> mcp-gateway Service
  -> internal MCP servers
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

## 세션 공유 제외

Claude Apps Gateway session token은 MCP Gateway 인증에 재사용하지 않는다.

이유:

- Claude Apps Gateway bearer token은 `session.jwt_secret`으로 서명되는 HS256 내부 세션 토큰이다.
- 이 토큰은 공개 JWKS로 외부 resource server가 검증하는 OIDC access token이 아니다.
- MCP Gateway가 `session.jwt_secret`을 공유받아 검증하면 Gateway 서명키의 blast radius가 커진다.
- Gateway token claim schema는 MCP Gateway가 의존할 외부 인증 계약으로 문서화되어 있지 않다.
- Claude Code가 MCP HTTP 요청에 Claude Apps Gateway bearer token을 자동으로 붙여준다는 보장도 없다.

따라서 MCP Gateway는 자체 OIDC/OAuth resource server로 동작한다. 사용자는 Claude Apps Gateway 로그인과 별도로 MCP Gateway OAuth를 수행하지만, 브라우저의 IdP SSO 세션 때문에 일반적으로 추가 credential 입력 없이 승인된다.

## MCP Gateway 책임

- HTTP MCP endpoint를 제공한다. 예: `https://mcp-gateway.internal.example.com/mcp`
- 사내 IdP의 OIDC discovery/JWKS를 통해 MCP access token을 검증한다.
- `email`, `groups`, `sub` claim을 추출해 tool 권한과 audit identity로 사용한다.
- 내부 MCP server catalog를 aggregation하거나 tool별 upstream MCP server로 라우팅한다.
- tool allow/deny, group별 policy, tool call rate limit, audit log를 적용한다.
- 외부 SaaS나 내부 API credential은 사용자 토큰과 별도의 server-side credential broker로 관리한다.

## IdP 설정

| Client | Redirect URI | 용도 |
| --- | --- | --- |
| Claude Apps Gateway OIDC client | `https://claude-gateway.internal.example.com/oauth/callback` | LLM Gateway device/browser login |
| MCP Gateway OAuth client | Claude Code MCP OAuth callback 또는 MCP Gateway가 요구하는 callback | MCP HTTP server 인증 |

MCP Gateway token 검증 기준:

- `issuer`는 Claude Apps Gateway의 `oidc.issuer`와 같은 IdP를 사용한다.
- `audience`는 MCP Gateway 전용 client/API audience로 제한한다.
- `email_verified: false`인 사용자는 거부한다.
- `allowed_email_domains`와 `allowed_groups`는 Claude Apps Gateway 정책과 맞춘다.
- group claim 이름이 IdP마다 다르면 Gateway와 MCP Gateway 양쪽에 같은 mapping을 적용한다.

## Claude Code 배포 설정

MCP Gateway가 Claude Code에 노출하는 서버는 remote HTTP transport를 사용한다.

`managed-mcp.json`:

```json
{
  "mcpServers": {
    "company": {
      "type": "http",
      "url": "https://mcp-gateway.internal.example.com/mcp",
      "oauth": {
        "scopes": "mcp:tools"
      }
    }
  }
}
```

`managed-mcp.json`은 Claude Apps Gateway server-managed settings로 배포할 수 없다. OS별 system path에 MDM, GPO, Intune, Jamf, fleet management 등으로 별도 배포한다.

| Platform | Path |
| --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/managed-mcp.json` |
| Linux / WSL | `/etc/claude-code/managed-mcp.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-mcp.json` |

외부 MCP server 추가를 차단하려면 admin-controlled managed settings에 allowlist를 같이 배포한다.

```json
{
  "allowManagedMcpServersOnly": true,
  "allowedMcpServers": [
    { "serverUrl": "https://mcp-gateway.internal.example.com/*" }
  ],
  "deniedMcpServers": [
    { "serverUrl": "https://*.untrusted.example.com/*" }
  ]
}
```

`managed-mcp.json`은 서버 목록을 배포하고, `allowManagedMcpServersOnly`와 `allowedMcpServers`는 사용자가 다른 MCP server를 추가하지 못하게 막는 역할을 한다.

## EKS 배포 구성

필수 리소스:

- `Namespace`: `llm-gateway` 또는 별도 `mcp-gateway`
- `ServiceAccount`: MCP Gateway Pod 전용
- `Secret`: MCP Gateway OAuth client secret, upstream API credentials
- `Deployment`: `mcp-gateway`
- `Service`: ClusterIP, port 8080
- `Ingress`: internal ALB 또는 사내 ingress controller
- `NetworkPolicy`: ingress/egress 제한

Ingress 기준:

- LLM Gateway와 MCP Gateway hostname은 분리한다.
- MCP Gateway hostname은 `https://mcp-gateway.internal.example.com`처럼 별도 internal hostname을 사용한다.
- TLS는 ALB/Ingress에서 종료한다.
- 사내 DNS에서 MCP Gateway hostname은 private address로만 resolve되어야 한다.

NetworkPolicy 기준:

- Ingress는 internal ALB/Ingress controller namespace에서 오는 MCP Gateway port만 허용한다.
- MCP Gateway egress는 다음만 허용한다.
  - 사내 IdP discovery/JWKS/token/userinfo endpoints
  - 내부 MCP upstream services
  - MCP Gateway가 사용하는 credential store 또는 secret manager
  - 필요 시 audit/OTLP collector
  - Kubernetes DNS

## 운영 확인 절차

1. MCP Gateway Pod가 시작되는지 확인한다.

   ```sh
   kubectl -n llm-gateway logs deploy/mcp-gateway
   ```

2. MCP Gateway endpoint와 OAuth challenge가 동작하는지 확인한다.

   ```sh
   curl -i https://mcp-gateway.internal.example.com/mcp
   ```

3. 개발자 머신에서 `managed-mcp.json` 배포 후 `claude mcp list`에 `company` server만 보이는지 확인한다.

4. Claude Code의 `/mcp` 또는 `claude mcp login company`로 MCP Gateway OIDC login을 완료하고, IdP 재인증 없이 SSO로 승인되는지 확인한다.

5. 허용된 MCP tool 호출은 성공하고, 차단된 tool 또는 외부 MCP server 추가는 enterprise policy로 거부되는지 확인한다.

## 장애 대응 기준

| 증상 | 우선 확인 |
| --- | --- |
| MCP server가 보이지 않음 | `managed-mcp.json` 경로/권한, Claude Code version, enterprise policy 충돌 |
| MCP OAuth 실패 | MCP Gateway OAuth client, redirect URI, IdP issuer/JWKS, audience/scope 설정 |
| 외부 MCP server 추가 가능 | `allowManagedMcpServersOnly`, `allowedMcpServers`, admin-controlled tier 배포 여부 |
| tool 호출 403 | user/group claim, tool allow/deny policy, upstream credential mapping |
| tool 호출 timeout | MCP Gateway idle timeout, upstream MCP server 상태, NetworkPolicy egress |

## 수용 기준

- MCP Gateway는 Claude Apps Gateway session token을 재사용하지 않고 같은 IdP의 OIDC/OAuth token을 별도로 검증한다.
- Claude Code에는 `managed-mcp.json`으로 사내 MCP Gateway가 배포된다.
- 허용되지 않은 MCP server는 enterprise policy로 차단된다.
- 허용된 MCP tool 호출은 내부 MCP upstream으로 라우팅된다.
- MCP tool 호출은 MCP Gateway audit log에 사용자 identity와 tool name을 남긴다.

