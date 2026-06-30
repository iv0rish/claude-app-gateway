# MCP JSON-RPC Endpoint

MCP Gateway는 `/mcp`에서 HTTP JSON-RPC 2.0 요청을 받는다. 모든 요청은 먼저 OIDC 인증을 통과해야 한다.

## Endpoint

```http
POST /mcp
Content-Type: application/json
Authorization: Bearer <access-token>
```

health check와 운영 endpoint는 별도이다.

| Endpoint | 설명 |
| --- | --- |
| `GET /healthz` | process health |
| `GET /readyz` | ready 상태와 등록된 upstream 목록 |
| `GET /metrics` | Prometheus metrics. `METRICS_ENABLED=false`이면 404 |
| `POST /mcp` | MCP JSON-RPC endpoint |

## 지원 method

### initialize

MCP client 초기화 요청을 처리한다. 현재 구현은 등록된 첫 upstream의 `initialize` 결과를 반환한다.

요청 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05"
  }
}
```

응답 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "serverInfo": {
      "name": "internal",
      "version": "0.1.0"
    }
  }
}
```

### tools/list

등록된 upstream의 tool 목록을 반환한다. 현재 example upstream은 `example.echo` tool 하나를 제공한다.

응답 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "example.echo",
        "description": "Echo text through the MCP gateway",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string"
            }
          },
          "required": ["text"]
        }
      }
    ]
  }
}
```

### tools/call

tool 호출을 처리한다. 호출 전 policy와 rate limit을 적용한다.

요청 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "example.echo",
    "arguments": {
      "text": "hello"
    }
  }
}
```

응답 예시:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "hello"
      }
    ]
  }
}
```

## 오류 응답

| 상황 | HTTP status | JSON-RPC code | message |
| --- | --- | --- | --- |
| 인증 실패 | `401` 또는 `403` | 해당 없음 | `{"error":"unauthorized"}` |
| JSON-RPC shape 오류 | `400` | `-32600` | `Invalid Request` |
| method params 오류 | `400` | `-32602` | `Invalid params` |
| 지원하지 않는 method | `200` | `-32601` | `Method not found` |
| policy deny | `403` | `-32003` | `Tool call denied by policy` |
| rate limit 초과 | `429` | `-32029` | `Rate limit exceeded` |

policy deny와 rate limit은 JSON-RPC error로도 표현하고 HTTP status도 명확히 설정한다. Claude Code와 gateway 앞단 observability 양쪽에서 실패 원인을 볼 수 있게 하기 위한 동작이다.

## 감사와 metrics

`/mcp` 요청은 다음 event와 metric에 반영된다.

- 인증 실패: `auth.denied`, `mcp_gateway_auth_denied_total`.
- 잘못된 request: `rpc.invalid`, `mcp_gateway_rpc_requests_total{status="invalid_request"}`.
- 미지원 method: `rpc.method_not_found`, `mcp_gateway_rpc_requests_total{status="method_not_found"}`.
- tool 허용: `tool.allowed`, `mcp_gateway_tool_calls_total{decision="allowed"}`.
- tool 차단: `tool.denied`, `mcp_gateway_tool_calls_total{decision="denied"}`.
- rate-limit 차단: `tool.rate_limited`, `mcp_gateway_tool_calls_total{decision="rate_limited"}`.

