# OIDC and Session

Apps-compatible `llm-gateway` mode terminates Claude Code login directly. It uses OIDC for user authentication, signs its own session JWT, and stores device grants, sessions, and spend state in Postgres.

## Runtime Settings

The Helm chart renders these settings into `gateway.yaml` and exposes non-secret values as ConfigMap env vars.

```yaml
enabled: true
externalUrl: https://llm-gateway.internal.example.com
oidc:
  issuer: https://login.example.com
  clientId: llm-gateway
  clientSecret: ${OIDC_CLIENT_SECRET}
  redirectUri: https://llm-gateway.internal.example.com/oauth/callback
  scopes:
    - openid
    - email
    - profile
  groupClaim: groups
  emailClaim: email

session:
  issuer: llm-gateway
  audience: claude-code
  jwtSecret: ${SESSION_JWT_SECRET}
  accessTokenTtlSeconds: 3600
  refreshTokenTtlSeconds: 2592000

store:
  postgresUrl: ${POSTGRES_URL}

admin:
  tokens:
    - ${ADMIN_TOKEN}
```

## Required Secrets

| Secret key | Purpose |
| --- | --- |
| `OIDC_CLIENT_SECRET` | OIDC confidential client secret |
| `SESSION_JWT_SECRET` | Session JWT signing secret |
| `POSTGRES_URL` | Postgres connection string |
| `ADMIN_TOKEN` or `ADMIN_TOKENS` | Administrative API/bootstrap token |

Use `sslmode=require` for managed Postgres endpoints. Generate `SESSION_JWT_SECRET` with at least 32 bytes of entropy and rotate it during a planned session invalidation window.

## IdP Requirements

- Register `listen.public_url` as the Gateway origin.
- Register the Gateway callback path expected by the runtime at that same origin.
- Ensure the issuer publishes OIDC discovery and JWKS metadata.
- Use `emailClaim` and `groupClaim` to match the claims emitted by the IdP.

When a config file is not mounted, the runtime can also read `APPS_COMPAT_ENABLED`, `APPS_EXTERNAL_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `SESSION_JWT_SECRET`, `POSTGRES_URL`, and `ADMIN_TOKENS` directly from env.
