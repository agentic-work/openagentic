import { describe, expect, it } from "vitest";
import { eventText } from "./chat-text.ts";

describe("eventText", () => {
  it("returns the text from a canonical text_delta frame", () => {
    expect(eventText({ delta: { type: "text_delta", text: "Hello" } })).toBe("Hello");
  });

  it("omits thinking_delta (internal reasoning is not the reply)", () => {
    expect(eventText({ delta: { type: "thinking_delta", thinking: "hmm" } })).toBe("");
  });

  it("tolerates a string delta", () => {
    expect(eventText({ delta: "raw" })).toBe("raw");
  });

  it("tolerates a top-level text field", () => {
    expect(eventText({ type: "content", text: "hi" })).toBe("hi");
  });

  it("tolerates a top-level content string", () => {
    expect(eventText({ content: "body" })).toBe("body");
  });

  it("reads an OpenAI-style choices delta", () => {
    expect(eventText({ choices: [{ delta: { content: "tok" } }] })).toBe("tok");
  });

  it("returns empty for null / non-object / unknown shapes", () => {
    expect(eventText(null)).toBe("");
    expect(eventText("nope")).toBe("");
    expect(eventText({ foo: 1 })).toBe("");
  });
});
