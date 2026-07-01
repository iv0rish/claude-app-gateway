# 016 Apps session control plane

Status: completed

## Summary

- Added Apps-compatible control-plane endpoints to `llm-gateway`.
- Added gateway-signed bearer sessions for Apps-compatible mode.
- Preserved legacy shared-secret authentication when Apps-compatible mode is disabled.

## Implemented

- `GET /protocol`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/device_authorization`
- `GET /device`
- `POST /oauth/token`
- Bearer access tokens signed by `apps.session.jwtSecret`.
- Refresh token rotation backed by the in-process session store.

## Notes

- The `/device` handler is currently a gateway endpoint that can be wired to the organization OIDC callback.
- Production deployments must set `apps.session.jwtSecret`; development mode uses a local fallback.
