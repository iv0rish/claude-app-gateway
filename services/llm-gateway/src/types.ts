export type AuthenticatedGateway = {
  tier: string;
  subject?: string;
  email?: string;
  groups?: string[];
};

export type AnthropicErrorType =
  | "authentication_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "api_error";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
};

export type UpstreamKind = "anthropic" | "bedrock";

export type GatewayModel = {
  id: string;
  displayName?: string;
  upstream: string;
  upstreamModel?: string;
  inputUsdPer1mTokens?: number;
  outputUsdPer1mTokens?: number;
};

export type ManagedPolicy = {
  name: string;
  groups: string[];
  emails: string[];
  settings: Record<string, unknown>;
  availableModels: string[];
  rateLimitTier?: string;
};

export type SpendLimit = {
  id: string;
  scope: "organization" | "group" | "user";
  subject?: string;
  period: "day" | "week" | "month";
  amountUsd: number;
};
