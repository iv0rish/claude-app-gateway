# Apps-Compatible Deployment

`llm-gateway` can be packaged as an apps-compatible Gateway: the service becomes the client-facing Claude Code Gateway instead of only sitting behind a separate Apps Gateway.

In this mode, the runtime reads a mounted app config file from `APP_CONFIG_PATH`.

```text
Claude Code
  -> internal HTTPS Ingress
  -> llm-gateway apps-compatible runtime
     -> Postgres for sessions and spend state
     -> OIDC issuer
     -> Anthropic-compatible vLLM upstream or Bedrock native upstream
     -> optional Bedrock Guardrails
```

## Helm

The chart mounts `gateway.yaml` from the ConfigMap at `/etc/llm-gateway/gateway.yaml` and sets:

```yaml
config:
  appConfigPath: /etc/llm-gateway/gateway.yaml
```

Enable ingress when `llm-gateway` is the client-facing service.

```yaml
ingress:
  enabled: true
  className: alb
  hosts:
    - host: llm-gateway.internal.example.com
      paths:
        - path: /
          pathType: Prefix
```

Deploy:

```sh
helm upgrade --install llm-gateway charts/llm-gateway \
  --namespace llm-gateway \
  --create-namespace \
  -f values-prod.yaml
```

## Required Values

Configure these before production use:

| Area | Values |
| --- | --- |
| Public URL | `config.publicUrl`, `ingress.hosts` |
| OIDC | `config.oidc.*`, `secrets.oidcClientSecret` |
| Session | `config.session.*`, `secrets.sessionJwtSecret` |
| Store | `secrets.postgresUrl` |
| Admin | `secrets.adminToken` |
| Model policy | `config.models`, `config.managedPolicies` |
| Spend | `config.spendLimits` |
| Upstreams | `config.upstreams.*`, upstream secret values |

The chart still renders the legacy environment variables used by the existing `/v1/messages` proxy implementation: `GATEWAY_API_KEYS`, `UPSTREAM_BASE_URL`, `REDIS_URL`, rate-limit settings, prompt logging, and Bedrock Guardrail settings.

## Network Policy

When ingress is enabled, allow ingress from the ingress controller namespace to port 8080. Egress should include DNS, OIDC issuer endpoints, Postgres, selected upstreams, and Bedrock endpoints when Bedrock native upstream or Guardrails are used.

Keep direct egress to external Anthropic disabled unless that is an intentional upstream.
