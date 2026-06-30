import type { AppConfig } from "../config.js";
import type { McpUpstream } from "../types.js";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolCallParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type McpToolCallResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
};

export type McpInitializeParams = {
  protocolVersion?: string;
};

export type McpInitializeResult = {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
};

export type RegisteredUpstream = McpUpstream & {
  initialize(params?: McpInitializeParams): Promise<McpInitializeResult>;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(params: McpToolCallParams): Promise<McpToolCallResult>;
};

export type UpstreamRegistry = {
  list(): RegisteredUpstream[];
  first(): RegisteredUpstream;
  get(name: string): RegisteredUpstream | undefined;
};

function createExampleUpstream(upstream: McpUpstream): RegisteredUpstream {
  return {
    ...upstream,
    async initialize(params) {
      return {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: upstream.name,
          version: "0.1.0",
        },
      };
    },
    async listTools() {
      return {
        tools: [
          {
            name: "example.echo",
            description: "Echo input through the example MCP gateway tool",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
              required: ["text"],
            },
          },
        ],
      };
    },
    async callTool(params) {
      return {
        content: [
          {
            type: "text",
            text: String(params.arguments?.text ?? ""),
          },
        ],
      };
    },
  };
}

export function createUpstreamRegistry(config: AppConfig): UpstreamRegistry {
  const upstreams = config.upstreams.map(createExampleUpstream);

  return {
    list() {
      return upstreams;
    },
    first() {
      return upstreams[0];
    },
    get(name) {
      return upstreams.find((upstream) => upstream.name === name);
    },
  };
}
