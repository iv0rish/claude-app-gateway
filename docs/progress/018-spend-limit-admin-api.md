# 018 Spend limit Admin API

Status: completed

## Summary

- Added spend limit enforcement and read-side Admin API endpoints.
- Added model pricing fields for usage-to-cost conversion.

## Implemented

- `GET /v1/organizations/spend_limits`
- `GET /v1/organizations/spend_limits/:id`
- `GET /v1/organizations/spend_limits/effective`
- `GET /v1/organizations/spend_limits/audit`
- User/group/organization spend limit matching.
- Daily, weekly, and monthly usage buckets.
- Successful response usage recording from Anthropic-compatible `usage`.

## Notes

- Spend limits are seeded from YAML.
- Usage is currently held in the gateway process store. The service boundary is isolated so a Postgres-backed implementation can replace it.
