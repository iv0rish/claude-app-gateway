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
  rateLimitTierRpm: jsonRecord,
  rateLimitModelRpm: jsonRecord,
  guardrailInputEnabled: envBoolean.default(false),
  guardrailOutputEnabled: envBoolean.default(false),
  guardrailFailPolicy: z.enum(["closed", "open"]).default("closed"),
  bedrockRegion: z.string().optional(),
  bedrockGuardrailId: z.string().optional(),
  bedrockGuardrailVersion: z.string().optional(),
  refusalText: z
    .string()
    .default("This response was blocked by the organization's safety policy."),
});

export type AppConfig = z.infer<typeof configSchema>;
export type GatewayApiKey = AppConfig["apiKeys"][number];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
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
    guardrailInputEnabled: env.GUARDRAIL_INPUT_ENABLED,
    guardrailOutputEnabled: env.GUARDRAIL_OUTPUT_ENABLED,
    guardrailFailPolicy: env.GUARDRAIL_FAIL_POLICY,
    bedrockRegion: env.BEDROCK_REGION,
    bedrockGuardrailId: env.BEDROCK_GUARDRAIL_ID,
    bedrockGuardrailVersion: env.BEDROCK_GUARDRAIL_VERSION,
    refusalText: env.REFUSAL_TEXT,
  });
}
