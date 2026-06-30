# Tool Policy

Tool policy는 MCP tool 호출 전에 적용되는 allow/deny 규칙이다. principal의 group, 대상 server, tool name을 기준으로 판단한다.

## 평가 순서

정책은 배열 순서대로 평가한다. 첫 번째로 match되는 rule의 `effect`가 최종 결정이 된다.

```text
for rule in rules:
  if group/server/tool 조건이 모두 match:
    return rule.effect

return allow
```

어떤 rule도 match되지 않으면 기본값은 allow다. 운영 환경에서는 명시적 deny rule 또는 default deny에 준하는 allowlist 구성을 권장한다.

## Rule 형식

```json
{
  "effect": "deny",
  "groups": ["contractor"],
  "servers": ["internal"],
  "tools": ["admin*"]
}
```

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `effect` | 예 | `allow` 또는 `deny` |
| `groups` | 아니오 | principal group pattern 목록 |
| `servers` | 아니오 | MCP upstream server pattern 목록 |
| `tools` | 아니오 | tool pattern 목록 |

`groups`, `servers`, `tools`가 비어 있거나 생략되면 해당 조건은 항상 match된다.

## Pattern match

현재 pattern은 세 가지 형태를 지원한다.

| Pattern | 의미 |
| --- | --- |
| `*` | 모든 값 match |
| `prefix*` | prefix match |
| `exact.name` | exact match |

tool pattern은 bare tool name과 server-scoped tool name을 모두 비교한다.

예를 들어 server가 `internal`, tool이 `example.echo`이면 다음 pattern이 match될 수 있다.

- `example.echo`
- `example.*`
- `internal:example.echo`
- `internal:example.*`
- `*`

## 정책 예시

계약직 사용자의 admin tool을 막고, platform group은 모든 tool을 허용하는 예시:

```json
[
  {
    "effect": "deny",
    "groups": ["contractor"],
    "tools": ["admin*"]
  },
  {
    "effect": "allow",
    "groups": ["platform"],
    "tools": ["*"]
  }
]
```

특정 server의 위험 tool을 모든 사용자에게 차단하는 예시:

```json
[
  {
    "effect": "deny",
    "servers": ["prod-admin"],
    "tools": ["*delete*", "prod-admin:deploy*"]
  }
]
```

## 운영 권장안

- deny rule을 allow rule보다 앞에 둔다.
- group 이름은 IdP claim에 들어오는 실제 값과 일치시킨다.
- tool 이름 충돌을 피하려면 server-scoped pattern을 사용한다.
- 신규 upstream을 추가할 때 `tools/list` 결과를 먼저 확인한 뒤 policy를 배포한다.
- 고위험 tool은 group 제한과 rate limit을 함께 적용한다.

## 감사와 metrics

policy가 tool 호출을 차단하면 다음이 기록된다.

- audit event: `tool.denied`
- metric: `mcp_gateway_tool_calls_total{decision="denied"}`
- JSON-RPC error code: `-32003`
- HTTP status: `403`

