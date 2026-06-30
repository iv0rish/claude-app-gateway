export type AuthenticatedGateway = {
  tier: string;
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

