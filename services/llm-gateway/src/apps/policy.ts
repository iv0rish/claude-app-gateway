import type { AppConfig } from "../config.js";
import type { AuthenticatedGateway, GatewayModel, ManagedPolicy } from "../types.js";

export type ResolvedPolicy = {
  settings: Record<string, unknown>;
  availableModels: string[];
  tier: string;
  policies: string[];
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function matches(policy: ManagedPolicy, gateway: AuthenticatedGateway): boolean {
  const hasSelectors = policy.groups.length > 0 || policy.emails.length > 0;
  if (!hasSelectors) return true;
  const email = gateway.email?.toLowerCase();
  if (email && policy.emails.map((item) => item.toLowerCase()).includes(email)) return true;
  const groups = new Set((gateway.groups ?? []).map((group) => group.toLowerCase()));
  return policy.groups.some((group) => groups.has(group.toLowerCase()));
}

export class AppsPolicyEngine {
  constructor(private readonly config: AppConfig) {}

  resolve(gateway: AuthenticatedGateway): ResolvedPolicy {
    const matched = this.config.apps.managedPolicies.filter((policy) => matches(policy, gateway));
    const configuredModels = this.config.apps.models.map((model) => model.id);
    const settings = Object.assign({}, ...matched.map((policy) => policy.settings));
    const availableModels = unique(
      matched.flatMap((policy) =>
        policy.availableModels.length > 0 ? policy.availableModels : configuredModels,
      ),
    );
    const tier = [...matched].reverse().find((policy) => policy.rateLimitTier)?.rateLimitTier;
    return {
      settings,
      availableModels: availableModels.length > 0 ? availableModels : configuredModels,
      tier: tier ?? gateway.tier,
      policies: matched.map((policy) => policy.name),
    };
  }

  modelsFor(gateway: AuthenticatedGateway): GatewayModel[] {
    const policy = this.resolve(gateway);
    const allowed = new Set(policy.availableModels);
    return this.config.apps.models.filter((model) => allowed.size === 0 || allowed.has(model.id));
  }

  assertModelAllowed(gateway: AuthenticatedGateway, model: string) {
    if (!this.config.apps.enabled || this.config.apps.models.length === 0) {
      return this.resolve(gateway);
    }
    const policy = this.resolve(gateway);
    if (!policy.availableModels.includes(model)) {
      throw new Error(`model ${model} is not available for this user`);
    }
    return policy;
  }

  modelById(modelId: string): GatewayModel | undefined {
    return this.config.apps.models.find((model) => model.id === modelId);
  }
}
