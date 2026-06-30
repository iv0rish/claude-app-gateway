import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal, ToolDecision } from "../types.js";

export type PolicyEngine = {
  canCallTool(principal: AuthenticatedPrincipal, server: string, tool: string): ToolDecision;
};

export function createPolicyEngine(_config: AppConfig): PolicyEngine {
  return {
    canCallTool(_principal, _server, _tool) {
      return {
        allowed: true,
        reason: "default-allow",
      };
    },
  };
}

