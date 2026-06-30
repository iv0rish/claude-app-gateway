# Upstreams

MCP Gateway는 내부 MCP server를 upstream으로 등록하고, Claude Code에는 하나의 gateway endpoint만 노출하는 구조를 목표로 한다.

## 설정 모델

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

| 필드 | 설명 |
| --- | --- |
| `name` | Gateway 내부 server 이름 |
| `url` | remote MCP endpoint URL |
| `token` | upstream 호출에 사용할 optional credential |
| `forwardHeaders` | client 요청에서 upstream으로 전달할 custom header allowlist |

## 현재 구현

현재 코드는 `RegisteredUpstream` abstraction을 두고, 설정된 upstream마다 HTTP MCP upstream을 만든다. Gateway는 다음 JSON-RPC method를 upstream `url`로 POST한다.

- `initialize`
- `tools/list`
- `tools/call`

Outbound 요청에는 기본적으로 다음 header가 들어간다.

```http
Accept: application/json
Content-Type: application/json
```

`token`이 설정된 upstream은 다음 header를 추가한다.

```http
Authorization: Bearer <token>
```

## Custom header forwarding

`forwardHeaders`에 지정된 incoming request header는 upstream으로 전달된다.

예시:

```json
[
  {
    "name": "internal",
    "url": "http://internal-mcp.default.svc.cluster.local:8080/mcp",
    "forwardHeaders": ["x-tenant-id", "x-request-id", "x-trace-id"]
  }
]
```

Client 요청:

```http
POST /mcp
Authorization: Bearer <user-access-token>
X-Tenant-Id: tenant-a
X-Trace-Id: trace-123
X-Not-Forwarded: ignored
```

Upstream 요청:

```http
POST /mcp
Accept: application/json
Content-Type: application/json
X-Tenant-Id: tenant-a
X-Trace-Id: trace-123
```

`X-Not-Forwarded`는 allowlist에 없으므로 전달되지 않는다.

Header forwarding은 custom metadata 전달 용도다. 사용자 credential 전달 용도로 사용하지 않는다. 다음 header는 설정 로딩 단계에서 거부된다.

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

## 아직 구현되지 않은 부분

다음 기능은 아직 구현되지 않았다.

- 여러 upstream의 tool catalog aggregation.
- tool name collision 처리.
- upstream timeout, retry, circuit breaker.
- upstream health check.
- mTLS credential 주입.

## Remote proxy 흐름

현재 remote proxy는 다음 순서로 동작한다.

```text
MCP request
  -> auth
  -> policy
  -> rate limit
  -> select upstream
  -> forward JSON-RPC to upstream.url
  -> normalize upstream response
  -> record audit/metrics
```

구현 단위:

1. `RegisteredUpstream` interface를 유지한다.
2. 설정된 upstream은 HTTP MCP upstream으로 등록한다.
3. upstream token은 outbound `Authorization` header로만 사용하고 log에 남기지 않는다.
4. allowlist된 custom header만 outbound 요청에 복사한다.
5. upstream 응답의 JSON-RPC `result`를 Gateway client 응답의 `result`로 반환한다.

## Tool routing 기준

현재는 등록된 첫 upstream을 사용한다. 여러 upstream을 본격적으로 운영하려면 다음 중 하나의 routing 정책이 필요하다.

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| server 명시 | 충돌이 적고 audit이 명확함 | client가 server 선택 정보를 알아야 함 |
| tool prefix | 설정이 단순함 | naming convention에 의존 |
| catalog aggregation | Claude Code에서는 하나의 server처럼 보임 | tool 충돌 처리와 cache invalidation 필요 |

초기 운영에서는 server-scoped tool name을 권장한다. 예를 들어 `github.search`, `jira.createIssue`, `prod-admin.deploy`처럼 upstream별 prefix를 둔다.

## 보안 기준

- 사용자 OIDC token을 upstream에 그대로 전달하지 않는다.
- `authorization`, `cookie` 등 credential header는 custom forwarding 대상에서 제외한다.
- upstream credential은 Gateway server-side secret으로 관리한다.
- upstream egress는 Kubernetes NetworkPolicy로 allowlist한다.
- side effect가 큰 tool은 upstream 자체 권한과 Gateway policy를 모두 적용한다.
