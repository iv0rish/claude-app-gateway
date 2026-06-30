import {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
  type GuardrailContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { AppConfig } from "../config.js";

export type GuardrailSource = "INPUT" | "OUTPUT";

export type GuardrailResult = {
  action: "NONE" | "GUARDRAIL_INTERVENED";
  outputs: string[];
};

export type GuardrailClient = {
  apply(source: GuardrailSource, text: string): Promise<GuardrailResult>;
};

export class NoopGuardrailClient implements GuardrailClient {
  async apply(): Promise<GuardrailResult> {
    return {
      action: "NONE",
      outputs: [],
    };
  }
}

export class BedrockGuardrailClient implements GuardrailClient {
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly config: AppConfig) {
    if (!config.bedrockRegion || !config.bedrockGuardrailId || !config.bedrockGuardrailVersion) {
      throw new Error("Bedrock guardrail configuration is incomplete");
    }

    this.client = new BedrockRuntimeClient({
      region: config.bedrockRegion,
    });
  }

  async apply(source: GuardrailSource, text: string): Promise<GuardrailResult> {
    if (text.trim().length === 0) {
      return {
        action: "NONE",
        outputs: [],
      };
    }

    const content: GuardrailContentBlock[] = [
      {
        text: {
          text,
        },
      },
    ];

    const response = await this.client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier: this.config.bedrockGuardrailId,
        guardrailVersion: this.config.bedrockGuardrailVersion,
        source,
        content,
      }),
    );

    return {
      action: response.action === "GUARDRAIL_INTERVENED" ? "GUARDRAIL_INTERVENED" : "NONE",
      outputs: (response.outputs ?? [])
        .map((output) => output.text)
        .filter((value): value is string => typeof value === "string"),
    };
  }
}

export function createGuardrailClient(config: AppConfig): GuardrailClient {
  if (!config.guardrailInputEnabled && !config.guardrailOutputEnabled) {
    return new NoopGuardrailClient();
  }
  return new BedrockGuardrailClient(config);
}

