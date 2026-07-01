# 020 Apps-compatible tests

Status: completed

## Summary

- Added focused tests for Apps-compatible login and policy behavior.
- Preserved all existing `llm-gateway` tests.

## Implemented

- Device authorization and token exchange test.
- Managed settings response test.
- Model catalog filtering test.
- `/v1/messages` model deny test.
- Legacy config normalization so old shared-secret tests do not need Apps config fields.

## Validation

- `npm run test --workspace services/llm-gateway`
- `npm run typecheck --workspace services/llm-gateway`
