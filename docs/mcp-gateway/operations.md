# Operations

이 문서는 MCP Gateway를 EKS에 배포하고 Claude Code client에 배포하는 운영 절차를 설명한다.

## EKS 리소스

Helm chart는 다음 Kubernetes 리소스를 만든다.

| 리소스 | 설명 |
| --- | --- |
| `ServiceAccount` | MCP Gateway Pod identity |
| `ConfigMap` | runtime 환경 변수 |
| `Deployment` | MCP Gateway workload |
| `Service` | ClusterIP service |
| `Ingress` | internal ingress |
| `NetworkPolicy` | ingress/egress 제한 |

Namespace는 `llm-gateway` 또는 별도 `mcp-gateway` namespace를 사용할 수 있다.

## Ingress 기준

- Apps Gateway와 MCP Gateway hostname은 분리한다.
- MCP Gateway hostname은 internal DNS에서만 resolve되게 한다.
- TLS는 ALB 또는 ingress controller에서 종료한다.
- 예시 hostname: `https://mcp-gateway.internal.example.com`.

## NetworkPolicy 기준

Ingress:

- internal ingress controller namespace에서 Gateway port로 들어오는 traffic을 허용한다.
- Prometheus scraping이 필요하면 Prometheus namespace도 허용한다.

Egress:

- Kubernetes DNS.
- IdP JWKS endpoint.
- 내부 MCP upstream service.
- 필요 시 log/metric collector.
- 필요 시 secret manager 또는 credential broker.

## Claude Code managed MCP 배포

Claude Code에는 remote HTTP MCP server로 Gateway를 등록한다.

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

배포 위치:

| Platform | Path |
| --- | --- |
| macOS | `/Library/Application Support/ClaudeCode/managed-mcp.json` |
| Linux / WSL | `/etc/claude-code/managed-mcp.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-mcp.json` |

외부 MCP server 추가를 제한하려면 enterprise managed settings에 allowlist를 배포한다.

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

## 배포 확인

1. Pod 상태 확인.

   ```sh
   kubectl -n llm-gateway get pods -l app.kubernetes.io/name=mcp-gateway
   ```

2. health endpoint 확인.

   ```sh
   kubectl -n llm-gateway port-forward svc/mcp-gateway 8080:8080
   curl -fsS http://localhost:8080/healthz
   curl -fsS http://localhost:8080/readyz
   ```

3. 인증 challenge 확인.

   ```sh
   curl -i https://mcp-gateway.internal.example.com/mcp
   ```

4. metrics 확인.

   ```sh
   curl -fsS https://mcp-gateway.internal.example.com/metrics
   ```

5. Claude Code에서 MCP server 목록 확인.

   ```sh
   claude mcp list
   ```

6. Claude Code에서 MCP login 수행.

   ```sh
   claude mcp login company
   ```

7. 허용된 tool call과 차단된 tool call을 각각 실행하고 audit log와 metrics가 증가하는지 확인한다.

## 장애 대응

| 증상 | 확인 지점 |
| --- | --- |
| MCP server가 보이지 않음 | `managed-mcp.json` 경로, 파일 권한, Claude Code version, enterprise policy |
| MCP OAuth 실패 | IdP client, redirect URI, issuer, audience, JWKS URL |
| 인증은 되지만 403 발생 | `ALLOWED_GROUPS`, `GROUPS_CLAIM`, `MCP_TOOL_POLICIES` |
| tool call이 429로 실패 | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, 사용자별 호출량 |
| metrics가 수집되지 않음 | `METRICS_ENABLED`, ServiceMonitor/scrape config, NetworkPolicy |
| upstream 호출이 기대와 다름 | 현재 구현은 실제 remote proxy가 아니라 example upstream임 |

## 운영 수용 기준

- MCP Gateway는 Apps Gateway session token을 재사용하지 않는다.
- Gateway는 IdP access token을 JWKS로 검증한다.
- Claude Code에는 managed MCP 설정으로 Gateway endpoint가 배포된다.
- tool 호출은 policy와 rate limit을 통과해야 한다.
- 보안상 의미 있는 결정은 audit log로 남는다.
- Prometheus에서 HTTP, auth, RPC, tool-call metric을 수집할 수 있다.

