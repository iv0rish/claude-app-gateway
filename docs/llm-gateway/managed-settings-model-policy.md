# Managed Settings and Model Policy

Apps-compatible `llm-gateway` mode owns the model catalog that Claude Code sees and the managed CLI policy returned to enrolled clients.

## Client Enrollment

Enterprise managed settings must force Claude Code to use the Gateway URL.

```json
{
  "forceLoginMethod": "gateway",
  "forceLoginGatewayUrl": "https://llm-gateway.internal.example.com"
}
```

Deploy this through MDM, managed preferences, group policy, or the OS-level managed settings path. User-level `~/.claude/settings.json` is not an enforcement boundary.

## Model Catalog

The chart renders `config.models` into `gateway.yaml`.

```yaml
auto_include_builtin_models: false
models:
  - id: claude-sonnet-4-6
    displayName: Internal vLLM Sonnet
    upstream: vllm-standard
    upstreamModel: my-model
    inputUsdPer1mTokens: 3
    outputUsdPer1mTokens: 15
```

`models[].id` is what Claude Code users see. `upstream` selects the named upstream and `upstreamModel` is the model id required by that upstream. The `inputUsdPer1mTokens` and `outputUsdPer1mTokens` fields allow spend-limit accounting.

## Managed Policies

Managed policies are evaluated against the authenticated user and shape the CLI configuration.

```yaml
managedPolicies:
  - name: premium
    groups:
      - llm-premium
    emails: []
    settings:
      cli:
        availableModels:
          - claude-sonnet-4-6
        enforceAvailableModels: true
        permissions:
          deny:
            - WebFetch
        env:
          DISABLE_UPDATES: "1"
    availableModels:
      - claude-sonnet-4-6
    rateLimitTier: premium
  - name: default
    groups: []
    emails: []
    settings:
      cli:
        availableModels:
          - claude-sonnet-4-6
        enforceAvailableModels: true
    availableModels:
      - claude-sonnet-4-6
    rateLimitTier: standard
```

Use `availableModels` plus `settings.cli.enforceAvailableModels: true` so users cannot select models outside the managed catalog.

## Tier Mapping

For Anthropic-compatible upstreams behind the legacy policy proxy, separate tiers by using different upstream secrets and model entries. The receiving proxy maps `GATEWAY_API_KEYS[].tier` to RPM/TPM buckets.
