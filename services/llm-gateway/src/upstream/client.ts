import type { AppConfig } from "../config.js";
import type { AnthropicMessageResponse, AnthropicMessagesRequest } from "../anthropic/messages.js";

export type UpstreamClient = {
  messages(request: AnthropicMessagesRequest, headers: Record<string, string>): Promise<AnthropicMessageResponse>;
};

export class HttpUpstreamClient implements UpstreamClient {
  constructor(private readonly config: AppConfig) {}

  async messages(
    request: AnthropicMessagesRequest,
    headers: Record<string, string>,
  ): Promise<AnthropicMessageResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);

    try {
      const response = await fetch(new URL("/v1/messages", this.config.upstreamBaseUrl), {
        method: "POST",
        headers: this.buildHeaders(headers),
        body: JSON.stringify(request),
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

  private buildHeaders(incoming: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };

    for (const name of ["anthropic-version", "anthropic-beta"]) {
      if (incoming[name]) headers[name] = incoming[name];
    }

    if (this.config.upstreamApiKey) {
      headers["x-api-key"] = this.config.upstreamApiKey;
    }

    return headers;
  }
}

