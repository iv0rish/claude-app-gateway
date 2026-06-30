# Authentication

MCP Gateway는 `/mcp` route에 대해 OIDC bearer token을 요구한다. token은 JWKS로 검증하고, 검증된 claim에서 Gateway 내부 principal을 만든다.

## 요청 형식

모든 MCP JSON-RPC 요청은 다음 header를 포함해야 한다.

```http
Authorization: Bearer <access-token>
```

`Bearer` scheme은 대소문자를 구분하지 않는다. token 값이 비어 있거나 bearer 형식이 아니면 인증 실패로 처리된다.

## 검증 절차

1. `Authorization` header에서 bearer token을 추출한다.
2. `OIDC_JWKS_URL`이 있으면 해당 URL에서 JWKS를 읽는다.
3. `OIDC_JWKS_URL`이 없으면 `OIDC_ISSUER` 기준 `/.well-known/jwks.json`을 사용한다.
4. `jose.jwtVerify`로 signature, issuer, audience를 검증한다.
5. `email_verified`가 명시적으로 `false`이면 거부한다.
6. `ALLOWED_EMAIL_DOMAINS`가 설정되어 있으면 email domain을 case-insensitive로 검사한다.
7. `ALLOWED_GROUPS`가 설정되어 있으면 group claim과 교집합이 있는지 검사한다.
8. 검증된 claim에서 principal을 만든다.

## Principal 필드

Gateway 내부에서는 다음 identity 필드를 audit, policy, rate-limit key에 사용한다.

| 필드 | 출처 | 용도 |
| --- | --- | --- |
| `sub` | JWT `sub` | 사용자 고유 식별자, rate-limit key |
| `email` | JWT `email` | audit log |
| `groups` | `GROUPS_CLAIM` claim | policy evaluation |

group claim은 문자열 또는 문자열 배열을 지원한다. claim이 문자열이면 단일 group으로 취급한다.

## 인증 실패 응답

인증 실패 시 Gateway는 JSON 응답과 `WWW-Authenticate` header를 반환한다.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="mcp-gateway", resource_metadata="https://mcp-gateway.internal.example.com/.well-known/oauth-protected-resource"
Content-Type: application/json
```

```json
{
  "error": "unauthorized"
}
```

실패 사유는 client 응답에 자세히 노출하지 않는다. 대신 audit log에 `auth.denied` event를 남기고 `mcp_gateway_auth_denied_total` metric을 증가시킨다.

## Apps Gateway 세션과의 관계

MCP Gateway는 Claude Apps Gateway의 내부 session token을 공유하지 않는다.

- Apps Gateway session token은 Gateway 내부 세션 계약이다.
- MCP Gateway가 Apps Gateway signing secret을 공유받으면 blast radius가 커진다.
- Claude Code가 MCP HTTP 요청에 Apps Gateway token을 자동 첨부한다는 보장이 없다.

운영 관점에서는 Apps Gateway와 MCP Gateway가 같은 IdP를 바라보게 한다. 사용자는 두 Gateway에서 각각 OAuth/OIDC flow를 수행하지만, IdP SSO 세션 때문에 보통 credential을 다시 입력하지 않는다.

## 현재 한계

- OAuth protected resource metadata endpoint는 아직 구현되어 있지 않다.
- OIDC discovery document에서 `jwks_uri`를 자동 탐색하지 않는다.
- scope 검증은 아직 구현되어 있지 않다. 현재 접근 제어는 audience, email domain, group, tool policy 중심이다.

