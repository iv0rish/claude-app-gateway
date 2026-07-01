# Spend Limits

Spend limits are an apps-compatible Gateway control. They cap allowed usage over a period and are separate from request/token rate limits enforced by the legacy `/v1/messages` proxy path.

## Configuration

The Helm chart renders `config.spendLimits` into `gateway.yaml`.

```yaml
spendLimits:
  failPolicy: closed
  limits:
    - id: org-monthly
      scope: organization
      period: month
      amountUsd: 1000
    - id: premium-group-daily
      scope: group
      subject: llm-premium
      period: day
      amountUsd: 100
    - id: user-monthly
      scope: user
      subject: user@example.com
      period: month
      amountUsd: 50
```

Supported scopes:

| Scope | Subject |
| --- | --- |
| `organization` | omit `subject` |
| `group` | group name or group id from OIDC claims |
| `user` | stable user id or email, depending on runtime identity mapping |

Supported periods are `day`, `week`, and `month`.

## Operations

- Store spend state in Postgres so limits survive restarts and work across replicas.
- Set `models[].inputUsdPer1mTokens` and `models[].outputUsdPer1mTokens`; unset prices default to zero.
- Keep rate limits enabled even when spend limits are configured. Spend limits protect budget; RPM/TPM limits protect capacity.
- Use explicit model policies with `enforceAvailableModels: true` so spend is only accrued against approved upstreams.
- If the runtime supports an admin API, protect it with `ADMIN_TOKEN` or `ADMIN_TOKENS` and restrict ingress to operator networks.
