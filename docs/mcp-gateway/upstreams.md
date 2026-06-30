# Upstreams

MCP Gateway는 내부 MCP server를 upstream으로 등록하고, Claude Code에는 하나의 gateway endpoint만 노출하는 구조를 목표로 한다.

## 설정 모델

`MCP_UPSTREAMS`는 JSON 배열이다.

```json
[
  {
    "name": "internal",
    "url": "http://internal-mcp.default.svc.cluster.local:8080/mcp",
    "token": "optional-upstream-token"
  }
]
```

| 필드 | 설명 |
| --- | --- |
| `name` | Gateway 내부 server 이름 |
| `url` | remote MCP endpoint URL |
| `token` | upstream 호출에 사용할 optional credential |

## 현재 구현

현재 코드는 `RegisteredUpstream` abstraction을 두고, 설정된 upstream마다 example upstream을 만든다.

Example upstream 동작:

- `initialize`: client가 보낸 `protocolVersion` 또는 기본값 `2024-11-05`를 반환한다.
- `tools/list`: `example.echo` tool 하나를 반환한다.
- `tools/call`: `arguments.text` 값을 text content로 echo한다.

이 구현은 gateway의 인증, policy, rate-limit, logging, metrics 흐름을 검증하기 위한 scaffold다.

## 아직 구현되지 않은 부분

다음 기능은 아직 구현되지 않았다.

- `MCP_UPSTREAMS[].url`로 실제 HTTP request를 보내는 remote MCP proxy.
- upstream별 bearer token 또는 mTLS credential 주입.
- 여러 upstream의 tool catalog aggregation.
- tool name collision 처리.
- upstream timeout, retry, circuit breaker.
- upstream health check.

## Remote proxy 구현 방향

실제 upstream proxy를 추가할 때는 다음 구조를 권장한다.

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
2. `HttpMcpUpstream` 구현체를 추가한다.
3. `url`이 있는 upstream은 `HttpMcpUpstream`으로 등록한다.
4. upstream token은 outbound `Authorization` header로만 사용하고 log에 남기지 않는다.
5. upstream 응답의 JSON-RPC error는 client에 전달하되, Gateway metric에는 `decision="error"` 또는 RPC status를 기록한다.

## Tool routing 기준

현재는 등록된 첫 upstream을 사용한다. remote proxy를 구현하면 다음 중 하나의 정책이 필요하다.

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| server 명시 | 충돌이 적고 audit이 명확함 | client가 server 선택 정보를 알아야 함 |
| tool prefix | 설정이 단순함 | naming convention에 의존 |
| catalog aggregation | Claude Code에서는 하나의 server처럼 보임 | tool 충돌 처리와 cache invalidation 필요 |

초기 운영에서는 server-scoped tool name을 권장한다. 예를 들어 `github.search`, `jira.createIssue`, `prod-admin.deploy`처럼 upstream별 prefix를 둔다.

## 보안 기준

- 사용자 OIDC token을 upstream에 그대로 전달하지 않는다.
- upstream credential은 Gateway server-side secret으로 관리한다.
- upstream egress는 Kubernetes NetworkPolicy로 allowlist한다.
- side effect가 큰 tool은 upstream 자체 권한과 Gateway policy를 모두 적용한다.

