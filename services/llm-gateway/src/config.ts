import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const envBoolean = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (value === undefined || value === "") return true;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const jsonRecord = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      const result = z.record(z.coerce.number().int().positive()).safeParse(parsed);
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
        message: `Invalid JSON object: ${(error as Error).message}`,
      });
      return z.NEVER;
    }
  });

const jsonPositiveRecord = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      const result = z.record(z.coerce.number().int().positive()).safeParse(parsed);
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
        message: `Invalid JSON object: ${(error as Error).message}`,
      });
      return z.NEVER;
    }
  });

const apiKeySchema = z.object({
  key: z.string().min(1),
  tier: z.string().min(1).default("default"),
});

const apiKeys = z
  .object({
    json: z.string().optional(),
    legacy: z.string().optional(),
  })
  .transform((value, ctx) => {
    if (value.json) {
      try {
        const parsed = JSON.parse(value.json);
        const result = z.array(apiKeySchema).min(1).safeParse(parsed);
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
          message: `Invalid GATEWAY_API_KEYS JSON: ${(error as Error).message}`,
        });
        return z.NEVER;
      }
    }

    return value.legacy ? [{ key: value.legacy, tier: "default" }] : [];
  })
  .refine((value) => value.length > 0, "At least one gateway API key is required");

const stringArray = z.array(z.string().min(1)).default([]);

const upstreamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["anthropic", "bedrock"]).default("anthropic"),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  region: z.string().optional(),
  modelMap: z.record(z.string()).default({}),
});

const modelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  upstream: z.string().min(1).default("default"),
  upstreamModel: z.string().optional(),
});

const managedPolicySchema = z.object({
  name: z.string().min(1),
  groups: stringArray,
  emails: stringArray,
  settings: z.record(z.unknown()).default({}),
  availableModels: stringArray,
  rateLimitTier: z.string().optional(),
});

const spendLimitSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(["organization", "group", "user"]),
  subject: z.string().optional(),
  period: z.enum(["day", "week", "month"]),
  amountUsd: z.coerce.number().nonnegative(),
});

const appsConfigSchema = z.object({
  enabled: envBoolean.default(false),
  externalUrl: z.string().url().optional(),
  oidc: z
    .object({
      issuer: z.string().url().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      redirectUri: z.string().url().optional(),
      scopes: stringArray.default(["openid", "email", "profile"]),
      groupClaim: z.string().default("groups"),
      emailClaim: z.string().default("email"),
    })
    .default({}),
  session: z
    .object({
      issuer: z.string().default("llm-gateway"),
      audience: z.string().default("claude-code"),
      jwtSecret: z.string().optional(),
      accessTokenTtlSeconds: z.coerce.number().int().positive().default(3600),
      refreshTokenTtlSeconds: z.coerce.number().int().positive().default(2592000),
    })
    .default({}),
  store: z
    .object({
      postgresUrl: z.string().optional(),
    })
    .default({}),
  admin: z
    .object({
      tokens: stringArray,
    })
    .default({ tokens: [] }),
  upstreams: z.array(upstreamSchema).default([]),
  models: z.array(modelSchema).default([]),
  managedPolicies: z.array(managedPolicySchema).default([]),
  spendLimits: z
    .object({
      failPolicy: z.enum(["open", "closed"]).default("closed"),
      limits: z.array(spendLimitSchema).default([]),
    })
    .default({ failPolicy: "closed", limits: [] }),
});

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(8080),
  logLevel: z.string().default("info"),
  metricsEnabled: envBoolean.default(true),
  apiKeys,
  upstreamBaseUrl: z.string().url(),
  upstreamApiKey: z.string().optional(),
  upstreamTimeoutMs: z.coerce.number().int().positive().default(120_000),
  redisUrl: z.string().url().optional(),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),
  rateLimitGlobalRpm: z.coerce.number().int().positive().default(600),
  rateLimitTierRpm: jsonPositiveRecord,
  rateLimitModelRpm: jsonPositiveRecord,
  rateLimitGlobalTpm: z.coerce.number().int().nonnegative().default(0),
  rateLimitTierTpm: jsonPositiveRecord,
  rateLimitModelTpm: jsonPositiveRecord,
  promptLoggingEnabled: envBoolean.default(true),
  guardrailInputEnabled: envBoolean.default(false),
  guardrailOutputEnabled: envBoolean.default(false),
  guardrailFailPolicy: z.enum(["closed", "open"]).default("closed"),
  bedrockRegion: z.string().optional(),
  bedrockGuardrailId: z.string().optional(),
  bedrockGuardrailVersion: z.string().optional(),
  refusalText: z
    .string()
    .default("This response was blocked by the organization's safety policy."),
  apps: appsConfigSchema,
});

export type AppConfig = z.infer<typeof configSchema>;
export type GatewayApiKey = AppConfig["apiKeys"][number];

function expandEnv(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map((item) => expandEnv(item, env));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandEnv(item, env)]),
    );
  }
  return value;
}

function loadAppsConfig(env: NodeJS.ProcessEnv): unknown {
  const configPath = env.APP_CONFIG_PATH;
  if (!configPath) {
    return {
      enabled: env.APPS_COMPAT_ENABLED,
      externalUrl: env.APPS_EXTERNAL_URL,
      oidc: {
        issuer: env.OIDC_ISSUER,
        clientId: env.OIDC_CLIENT_ID,
        clientSecret: env.OIDC_CLIENT_SECRET,
        redirectUri: env.OIDC_REDIRECT_URI,
      },
      session: {
        jwtSecret: env.SESSION_JWT_SECRET,
      },
      store: {
        postgresUrl: env.POSTGRES_URL,
      },
      admin: {
        tokens: env.ADMIN_TOKENS ? env.ADMIN_TOKENS.split(",").map((token) => token.trim()) : [],
      },
    };
  }

  const parsed = parseYaml(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const expanded = expandEnv(parsed, env) as Record<string, unknown>;
  return expanded.apps ?? expanded;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apps = loadAppsConfig(env);
  return configSchema.parse({
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    metricsEnabled: env.METRICS_ENABLED,
    apiKeys: {
      json: env.GATEWAY_API_KEYS,
      legacy: env.GATEWAY_API_KEY,
    },
    upstreamBaseUrl: env.UPSTREAM_BASE_URL ?? "http://vllm.vllm.svc.cluster.local:8000",
    upstreamApiKey: env.UPSTREAM_API_KEY,
    upstreamTimeoutMs: env.UPSTREAM_TIMEOUT_MS,
    redisUrl: env.REDIS_URL,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitGlobalRpm: env.RATE_LIMIT_GLOBAL_RPM,
    rateLimitTierRpm: env.RATE_LIMIT_TIER_RPM,
    rateLimitModelRpm: env.RATE_LIMIT_MODEL_RPM,
    rateLimitGlobalTpm: env.RATE_LIMIT_GLOBAL_TPM,
    rateLimitTierTpm: env.RATE_LIMIT_TIER_TPM,
    rateLimitModelTpm: env.RATE_LIMIT_MODEL_TPM,
    promptLoggingEnabled: env.PROMPT_LOGGING_ENABLED,
    guardrailInputEnabled: env.GUARDRAIL_INPUT_ENABLED,
    guardrailOutputEnabled: env.GUARDRAIL_OUTPUT_ENABLED,
    guardrailFailPolicy: env.GUARDRAIL_FAIL_POLICY,
    bedrockRegion: env.BEDROCK_REGION,
    bedrockGuardrailId: env.BEDROCK_GUARDRAIL_ID,
    bedrockGuardrailVersion: env.BEDROCK_GUARDRAIL_VERSION,
    refusalText: env.REFUSAL_TEXT,
    apps,
  });
}
