import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  );

const envBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (value === undefined || value === "") return true;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const headerNameSchema = z
  .string()
  .min(1)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "header name must be an RFC 9110 token")
  .transform((value) => value.toLowerCase());

const blockedForwardHeaderNames = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const forwardHeadersSchema = z
  .array(headerNameSchema)
  .default([])
  .superRefine((headers, ctx) => {
    for (const header of headers) {
      if (blockedForwardHeaderNames.has(header)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `header "${header}" cannot be forwarded`,
        });
      }
    }
  })
  .transform((headers) => Array.from(new Set(headers)));

const upstreamSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  token: z.string().optional(),
  forwardHeaders: forwardHeadersSchema,
});

const toolPolicyMatchSchema = z
  .object({
    groups: z.array(z.string().min(1)).optional(),
    servers: z.array(z.string().min(1)).optional(),
    tools: z.array(z.string().min(1)).optional(),
  })
  .strict();

const toolPolicyRuleSchema = toolPolicyMatchSchema.extend({
  effect: z.enum(["allow", "deny"]),
});

const toolPoliciesJsonSchema = z.union([
  z.array(toolPolicyRuleSchema),
  z
    .object({
      rules: z.array(toolPolicyRuleSchema),
    })
    .strict()
    .transform(({ rules }) => rules),
  z
    .object({
      allow: z.array(toolPolicyMatchSchema).optional(),
      deny: z.array(toolPolicyMatchSchema).optional(),
    })
    .strict()
    .transform(({ allow = [], deny = [] }) => [
      ...deny.map((rule) => ({ ...rule, effect: "deny" as const })),
      ...allow.map((rule) => ({ ...rule, effect: "allow" as const })),
    ]),
]);

const toolPolicies = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      const result = toolPoliciesJsonSchema.safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.error.message,
        });
        return z.NEVER;
      }
      return result.data;
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid MCP_TOOL_POLICIES JSON: ${(error as Error).message}`,
      });
      return z.NEVER;
    }
  });

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(8080),
  publicUrl: z.string().url(),
  oidcIssuer: z.string().url(),
  oidcAudience: z.string().min(1),
  oidcJwksUrl: z.string().url().optional(),
  allowedEmailDomains: csv,
  allowedGroups: csv,
  groupsClaim: z.string().default("groups"),
  redisUrl: z.string().url().optional(),
  logLevel: z.string().default("info"),
  metricsEnabled: envBoolean.default(true),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),
  rateLimitMax: z.coerce.number().int().positive().default(60),
  toolPolicies,
  upstreams: z
    .string()
    .default('[{"name":"example","url":"http://127.0.0.1:9090/mcp"}]')
    .transform((value, ctx) => {
      try {
        const parsed = JSON.parse(value);
        const result = z.array(upstreamSchema).min(1).safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: result.error.message,
          });
          return z.NEVER;
        }
        return result.data;
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid MCP_UPSTREAMS JSON: ${(error as Error).message}`,
        });
        return z.NEVER;
      }
    }),
});

export type AppConfig = z.infer<typeof configSchema>;
export type UpstreamConfig = AppConfig["upstreams"][number];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    publicUrl: env.PUBLIC_URL ?? "https://mcp-gateway.internal.example.com",
    oidcIssuer: env.OIDC_ISSUER ?? "https://login.example.com",
    oidcAudience: env.OIDC_AUDIENCE ?? "mcp-gateway",
    oidcJwksUrl: env.OIDC_JWKS_URL,
    allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS ?? "example.com",
    allowedGroups: env.ALLOWED_GROUPS,
    groupsClaim: env.GROUPS_CLAIM,
    redisUrl: env.REDIS_URL,
    logLevel: env.LOG_LEVEL,
    metricsEnabled: env.METRICS_ENABLED,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMax: env.RATE_LIMIT_MAX,
    toolPolicies: env.MCP_TOOL_POLICIES,
    upstreams: env.MCP_UPSTREAMS,
  });
}
