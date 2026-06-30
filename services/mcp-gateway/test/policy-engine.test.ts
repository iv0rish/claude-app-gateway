import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPolicyEngine } from "../src/policy/engine.js";
import type { AuthenticatedPrincipal } from "../src/types.js";

const principal = (groups: string[]): AuthenticatedPrincipal => ({
  sub: "user-1",
  email: "user@example.com",
  groups,
  claims: {},
});

describe("policy engine", () => {
  it("allows tool calls by default", () => {
    const policy = createPolicyEngine(loadConfig({}));

    expect(policy.canCallTool(principal([]), "example", "example.echo")).toEqual({
      allowed: true,
      reason: "default-allow",
    });
  });

  it("denies matching group and tool policies from MCP_TOOL_POLICIES", () => {
    const policy = createPolicyEngine(
      loadConfig({
        MCP_TOOL_POLICIES: JSON.stringify({
          deny: [
            {
              groups: ["contractors"],
              tools: ["admin.*"],
            },
          ],
        }),
      }),
    );

    expect(policy.canCallTool(principal(["contractors"]), "example", "admin.delete")).toEqual({
      allowed: false,
      reason: "policy-deny",
    });
    expect(policy.canCallTool(principal(["employees"]), "example", "admin.delete")).toEqual({
      allowed: true,
      reason: "default-allow",
    });
    expect(policy.canCallTool(principal(["contractors"]), "example", "example.echo")).toEqual({
      allowed: true,
      reason: "default-allow",
    });
  });

  it("uses ordered rules so allow exceptions can precede broad denies", () => {
    const policy = createPolicyEngine(
      loadConfig({
        MCP_TOOL_POLICIES: JSON.stringify({
          rules: [
            {
              effect: "allow",
              groups: ["admins"],
              tools: ["payments.refund"],
            },
            {
              effect: "deny",
              groups: ["*"],
              tools: ["payments.*"],
            },
          ],
        }),
      }),
    );

    expect(policy.canCallTool(principal(["admins"]), "billing", "payments.refund")).toEqual({
      allowed: true,
      reason: "policy-allow",
    });
    expect(policy.canCallTool(principal(["support"]), "billing", "payments.refund")).toEqual({
      allowed: false,
      reason: "policy-deny",
    });
  });

  it("matches server-scoped tool keys when provided", () => {
    const policy = createPolicyEngine(
      loadConfig({
        MCP_TOOL_POLICIES: JSON.stringify([
          {
            effect: "deny",
            tools: ["private:files.read"],
          },
        ]),
      }),
    );

    expect(policy.canCallTool(principal(["employees"]), "private", "files.read")).toEqual({
      allowed: false,
      reason: "policy-deny",
    });
    expect(policy.canCallTool(principal(["employees"]), "public", "files.read")).toEqual({
      allowed: true,
      reason: "default-allow",
    });
  });
});
