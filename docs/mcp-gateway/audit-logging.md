# Audit Logging

MCP Gateway는 보안상 의미 있는 결정을 structured audit log로 남긴다. 일반 request log와 구분할 수 있도록 audit event에는 `audit: true` 필드가 포함된다.

## Log 형식

Fastify/Pino JSON log를 사용한다.

공통 필드:

| 필드 | 설명 |
| --- | --- |
| `audit` | audit event 여부. 항상 `true` |
| `event` | audit event 이름 |
| `sub` | JWT subject |
| `email` | 사용자 email |
| `groups` | 사용자 group 목록 |
| `method` | HTTP method |
| `path` | HTTP path |
| `rpcMethod` | MCP JSON-RPC method |
| `statusCode` | HTTP status |
| `server` | MCP upstream server name |
| `tool` | MCP tool name |
| `decision` | `allowed`, `denied`, `rate_limited` 등 |
| `latencyMs` | 처리 시간 |
| `error` | 오류 요약 |

필드는 event 성격에 따라 일부만 포함될 수 있다.

## Event 목록

| Event | 발생 조건 | 주요 필드 |
| --- | --- | --- |
| `auth.denied` | bearer token 누락, JWT 검증 실패, email/group 제한 실패 | `method`, `path`, `statusCode`, `error` |
| `rpc.invalid` | JSON-RPC request shape 오류 | `rpcMethod`, `statusCode`, `error` |
| `rpc.method_not_found` | 지원하지 않는 JSON-RPC method | `rpcMethod`, `statusCode` |
| `tool.allowed` | policy와 rate limit을 통과한 tool call | `sub`, `email`, `groups`, `server`, `tool`, `decision` |
| `tool.denied` | policy가 tool call 차단 | `sub`, `email`, `groups`, `server`, `tool`, `decision` |
| `tool.rate_limited` | rate limit 초과 | `sub`, `email`, `groups`, `server`, `tool`, `decision` |

## 예시

허용된 tool call:

```json
{
  "level": 30,
  "audit": true,
  "event": "tool.allowed",
  "sub": "user-123",
  "email": "dev@example.com",
  "groups": ["platform"],
  "rpcMethod": "tools/call",
  "server": "internal",
  "tool": "example.echo",
  "decision": "allowed",
  "latencyMs": 12
}
```

policy deny:

```json
{
  "level": 30,
  "audit": true,
  "event": "tool.denied",
  "sub": "user-456",
  "email": "contractor@example.com",
  "groups": ["contractor"],
  "rpcMethod": "tools/call",
  "server": "internal",
  "tool": "admin.delete",
  "decision": "denied",
  "statusCode": 403
}
```

## 운영 활용

- SIEM 또는 log pipeline에서 `audit=true`로 별도 index를 만든다.
- `event=tool.denied`와 `event=tool.rate_limited`는 alert 후보로 본다.
- `server`, `tool`, `email`, `groups` 필드를 dashboard dimension으로 사용한다.
- 인증 실패는 source IP, ingress log, IdP log와 함께 상관 분석한다.

## 주의사항

- Gateway는 access token 원문을 log에 남기지 않는다.
- tool arguments는 현재 audit log에 포함하지 않는다. 민감정보가 섞일 수 있기 때문이다.
- 감사 목적상 tool arguments가 필요하면 masking 정책과 field allowlist를 먼저 정의해야 한다.

