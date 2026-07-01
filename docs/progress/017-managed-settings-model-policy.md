# 017 Managed settings and model policy

Status: completed

## Summary

- Added managed settings and model catalog endpoints.
- Connected Apps-compatible session identity to `/v1/messages` model authorization.

## Implemented

- `GET /managed/settings`
- `GET /v1/models`
- `POST /v1/messages/count_tokens`
- Managed policy matching by email and group.
- Policy-derived rate-limit tier override.
- Server-side model allowlist enforcement for `/v1/messages`.
- User identity fields in audit events.

## Notes

- Policy configuration is read from `apps.managedPolicies`.
- Model metadata is read from `apps.models`.
