import type { AppConfig } from "../config.js";
import type { McpUpstream, RequestContext } from "../types.js";

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
  initialize(params: McpInitializeParams | undefined, context: RequestContext): Promise<McpInitializeResult>;
  listTools(context: RequestContext): Promise<{ tools: McpTool[] }>;
  callTool(params: McpToolCallParams, context: RequestContext): Promise<McpToolCallResult>;
};

export type UpstreamRegistry = {
  list(): RegisteredUpstream[];
  first(): RegisteredUpstream;
  get(name: string): RegisteredUpstream | undefined;
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectForwardedHeaders(upstream: McpUpstream, context: RequestContext) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (upstream.token) {
    headers.authorization = `Bearer ${upstream.token}`;
  }

  for (const headerName of upstream.forwardHeaders) {
    const value = context.request.headers[headerName];
    if (typeof value === "string") {
      headers[headerName] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      headers[headerName] = value.join(", ");
    }
  }

  return headers;
}

function assertJsonRpcResult<T>(payload: unknown): T {
  if (!isRecord(payload) || payload.jsonrpc !== "2.0") {
    throw new Error("upstream returned an invalid JSON-RPC response");
  }

  if (isRecord(payload.error)) {
    const message = typeof payload.error.message === "string" ? payload.error.message : "upstream error";
    throw new Error(message);
  }

  if (!("result" in payload)) {
    throw new Error("upstream JSON-RPC response is missing result");
  }

  return payload.result as T;
}

function createHttpUpstream(upstream: McpUpstream): RegisteredUpstream {
  async function postRpc<T>(method: string, params: unknown, context: RequestContext): Promise<T> {
    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: `${upstream.name}:${method}`,
      method,
    };
    if (params !== undefined) {
      body.params = params;
    }

    const response = await fetch(upstream.url, {
      method: "POST",
      headers: collectForwardedHeaders(upstream, context),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`upstream ${upstream.name} returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    return assertJsonRpcResult<T>(payload);
  }

  return {
    ...upstream,
    initialize(params, context) {
      return postRpc<McpInitializeResult>("initialize", params, context);
    },
    listTools(context) {
      return postRpc<{ tools: McpTool[] }>("tools/list", undefined, context);
    },
    callTool(params, context) {
      return postRpc<McpToolCallResult>("tools/call", params, context);
    },
  };
}

export function createUpstreamRegistry(config: AppConfig): UpstreamRegistry {
  const upstreams = config.upstreams.map(createHttpUpstream);

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
