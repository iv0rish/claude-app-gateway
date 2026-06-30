import type { AppConfig } from "../config.js";
import type { AuthenticatedPrincipal, ToolDecision } from "../types.js";

export type PolicyEngine = {
  canCallTool(principal: AuthenticatedPrincipal, server: string, tool: string): ToolDecision;
};

type ToolPolicyRule = AppConfig["toolPolicies"][number];

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }

  return pattern === value;
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => matchesPattern(pattern, value));
}

function matchesGroup(patterns: string[] | undefined, principal: AuthenticatedPrincipal): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  return patterns.some(
    (pattern) => pattern === "*" || principal.groups.some((group) => matchesPattern(pattern, group)),
  );
}

function matchesTool(patterns: string[] | undefined, server: string, tool: string): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }

  const scopedTool = `${server}:${tool}`;
  return patterns.some((pattern) => matchesPattern(pattern, tool) || matchesPattern(pattern, scopedTool));
}

function matchesRule(
  rule: ToolPolicyRule,
  principal: AuthenticatedPrincipal,
  server: string,
  tool: string,
): boolean {
  return matchesGroup(rule.groups, principal) && matchesAny(rule.servers, server) && matchesTool(rule.tools, server, tool);
}

export function createPolicyEngine(config: AppConfig): PolicyEngine {
  return {
    canCallTool(principal, server, tool) {
      for (const rule of config.toolPolicies) {
        if (matchesRule(rule, principal, server, tool)) {
          return {
            allowed: rule.effect === "allow",
            reason: `policy-${rule.effect}`,
          };
        }
      }

      return {
        allowed: true,
        reason: "default-allow",
      };
    },
  };
}
