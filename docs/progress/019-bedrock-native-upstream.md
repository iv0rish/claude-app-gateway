# 019 Bedrock native upstream

Status: completed

## Summary

- Added Bedrock Runtime upstream support behind `/v1/messages`.
- Preserved Anthropic-compatible HTTP upstream behavior for vLLM and other compatible servers.

## Implemented

- `apps.upstreams[].type: bedrock`.
- Per-upstream Bedrock region.
- `apps.models[].upstreamModel` and upstream `modelMap` support.
- Anthropic Messages request conversion to Bedrock Anthropic `InvokeModel` body.
- Claude Code and Anthropic protocol header forwarding for HTTP upstreams.

## Notes

- Bedrock streaming passthrough is not implemented yet.
- The public Bedrock-shaped `/model/:model/invoke*` compatibility routes are still pending; current support is through the standard `/v1/messages` gateway path.
