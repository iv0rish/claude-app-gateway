import { z } from "zod";

const contentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.string(),
    content: z.union([z.string(), z.array(contentBlockSchema)]),
  })
  .passthrough();

const messagesRequestSchema = z
  .object({
    model: z.string().min(1),
    max_tokens: z.number().int().positive(),
    messages: z.array(messageSchema),
    system: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
    stream: z.boolean().optional(),
  })
  .passthrough();

export type AnthropicMessagesRequest = z.infer<typeof messagesRequestSchema>;

export type AnthropicMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: unknown;
  stop_reason?: string | null;
  usage?: unknown;
  [key: string]: unknown;
};

export function parseMessagesRequest(value: unknown): AnthropicMessagesRequest {
  return messagesRequestSchema.parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractTextFromBlock(block: Record<string, unknown>): string[] {
  if (block.type === "text" && typeof block.text === "string") {
    return [block.text];
  }

  if (block.type === "tool_result") {
    if (typeof block.content === "string") return [block.content];
    if (Array.isArray(block.content)) {
      return block.content.flatMap((item) => (isRecord(item) ? extractTextFromBlock(item) : []));
    }
  }

  return [];
}

function extractTextFromContent(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => (isRecord(item) ? extractTextFromBlock(item) : []));
}

export function extractInputText(request: AnthropicMessagesRequest): string {
  const parts: string[] = [];
  if (request.system !== undefined) {
    parts.push(...extractTextFromContent(request.system));
  }
  for (const message of request.messages) {
    parts.push(...extractTextFromContent(message.content));
  }
  return parts.filter(Boolean).join("\n\n");
}

export function extractOutputText(response: AnthropicMessageResponse): string {
  return extractTextFromContent(response.content).filter(Boolean).join("\n\n");
}

export function createAnthropicError(type: string, message: string) {
  return {
    type: "error",
    error: {
      type,
      message,
    },
  };
}

export function createRefusalResponse(model: string, text: string): AnthropicMessageResponse {
  return {
    id: "msg_guardrail",
    type: "message",
    role: "assistant",
    model,
    content: [
      {
        type: "text",
        text,
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

export function upstreamRequestBody(request: AnthropicMessagesRequest): AnthropicMessagesRequest {
  if (!request.stream) return request;
  return {
    ...request,
    stream: false,
  };
}

