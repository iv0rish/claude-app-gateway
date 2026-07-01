# Bedrock Native Upstream

Apps-compatible `llm-gateway` mode can route a model directly to Amazon Bedrock instead of forwarding to an Anthropic-compatible HTTP upstream.

This is different from Bedrock Guardrails. Guardrails use `bedrock:ApplyGuardrail` as a policy check around a request. A Bedrock native upstream uses Bedrock as the model provider.

## Helm Values

```yaml
config:
  upstreams:
    bedrockNative:
      enabled: true
      name: bedrock-claude
      type: bedrock
      region: us-east-1
      modelId: anthropic.claude-3-5-sonnet-20241022-v2:0
  models:
    - id: claude-sonnet-4-6-bedrock
      displayName: Bedrock Claude Sonnet
      upstream: bedrock-claude
      upstreamModel: anthropic.claude-3-5-sonnet-20241022-v2:0
```

Rendered config:

```yaml
upstreams:
  - name: bedrock-claude
    type: bedrock
    region: us-east-1
    modelMap:
      default: anthropic.claude-3-5-sonnet-20241022-v2:0
```

## IAM

The Pod service account needs model invocation permissions for the selected model and region. Keep guardrail permissions separate so they can be audited independently.

Example actions:

```json
[
  "bedrock:InvokeModel",
  "bedrock:InvokeModelWithResponseStream"
]
```

If Bedrock Guardrails remain enabled, also grant `bedrock:ApplyGuardrail` for the configured guardrail resource.

## Model Policy

Expose Bedrock-backed models only through managed policies.

```yaml
managedPolicies:
  - name: bedrock-users
    groups:
      - bedrock-users
    emails: []
    settings:
      cli:
        availableModels:
          - claude-sonnet-4-6-bedrock
        enforceAvailableModels: true
    availableModels:
      - claude-sonnet-4-6-bedrock
```

Do not leave external Anthropic upstreams configured as fallback when internal-only routing is required.
