import { describe, expect, it } from "vitest";
import {
  extractInputText,
  extractOutputText,
  parseMessagesRequest,
  upstreamRequestBody,
} from "../src/anthropic/messages.js";

describe("Anthropic Messages helpers", () => {
  it("extracts guardrail text from system, text blocks, and tool results", () => {
    const request = parseMessagesRequest({
      model: "my-model",
      max_tokens: 128,
      system: [{ type: "text", text: "system text" }],
      messages: [
        {
          role: "user",
          content: "plain user text",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "block text" },
            { type: "image", source: { type: "base64", data: "ignored" } },
            {
              type: "tool_result",
              content: [{ type: "text", text: "tool result text" }],
            },
          ],
        },
      ],
    });

    expect(extractInputText(request)).toBe(
      "system text\n\nplain user text\n\nblock text\n\ntool result text",
    );
  });

  it("extracts assistant output text and disables upstream streaming in strict mode", () => {
    expect(
      extractOutputText({
        content: [
          { type: "text", text: "first" },
          { type: "tool_use", id: "tool-1" },
          { type: "text", text: "second" },
        ],
      }),
    ).toBe("first\n\nsecond");

    const request = parseMessagesRequest({
      model: "my-model",
      max_tokens: 128,
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(upstreamRequestBody(request)).toMatchObject({
      stream: false,
    });
  });
});

