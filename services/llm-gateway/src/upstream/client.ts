import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { AppConfig } from "../config.js";
import type { AnthropicMessageResponse, AnthropicMessagesRequest } from "../anthropic/messages.js";

export type UpstreamClient = {
  messages(request: AnthropicMessagesRequest, headers: Record<string, string>): Promise<AnthropicMessageResponse>;
};

export class HttpUpstreamClient implements UpstreamClient {
  private readonly bedrockClients = new Map<string, BedrockRuntimeClient>();

  constructor(private readonly config: AppConfig) {}

  async messages(
    request: AnthropicMessagesRequest,
    headers: Record<string, string>,
  ): Promise<AnthropicMessageResponse> {
    const model = this.config.apps.models.find((item) => item.id === request.model);
    const upstream = model
      ? this.config.apps.upstreams.find((item) => item.name === model.upstream)
      : undefined;

    if (upstream?.type === "bedrock") {
      return this.bedrockMessages(request, model?.upstreamModel ?? upstream.modelMap[request.model] ?? request.model, upstream.region);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
    const baseUrl = upstream?.baseUrl ?? this.config.upstreamBaseUrl;
    const upstreamModel = model?.upstreamModel ?? upstream?.modelMap[request.model];
    const upstreamBody =
      upstreamModel
        ? {
            ...request,
            model: upstreamModel,
          }
        : request;

    try {
      const response = await fetch(new URL("/v1/messages", baseUrl), {
        method: "POST",
        headers: this.buildHeaders(headers, upstream?.apiKey),
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`upstream returned HTTP ${response.status}`);
      }

      return (await response.json()) as AnthropicMessageResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async bedrockMessages(
    request: AnthropicMessagesRequest,
    modelId: string,
    region?: string,
  ): Promise<AnthropicMessageResponse> {
    const client = this.bedrockClient(region ?? this.config.bedrockRegion);
    const body = {
      ...request,
      model: undefined,
      stream: undefined,
      anthropic_version: "bedrock-2023-05-31",
    };
    const response = await client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(JSON.stringify(body)),
      }),
    );
    const text = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(text) as AnthropicMessageResponse;
    return {
      ...parsed,
      model: request.model,
    };
  }

  private bedrockClient(region?: string): BedrockRuntimeClient {
    if (!region) throw new Error("Bedrock upstream region is required");
    const existing = this.bedrockClients.get(region);
    if (existing) return existing;
    const client = new BedrockRuntimeClient({ region });
    this.bedrockClients.set(region, client);
    return client;
  }

  private buildHeaders(incoming: Record<string, string>, upstreamApiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };

    for (const name of ["anthropic-version", "anthropic-beta"]) {
      if (incoming[name]) headers[name] = incoming[name];
    }
    for (const [name, value] of Object.entries(incoming)) {
      if (name.startsWith("x-claude-code-") || name.startsWith("anthropic-")) {
        headers[name] = value;
      }
    }

    const apiKey = upstreamApiKey ?? this.config.upstreamApiKey;
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    return headers;
  }
}
