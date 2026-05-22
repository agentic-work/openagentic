/**
 * Sev-0 #798 — gpt-oss:20b emits compose_visual / synth as a JSON array
 * literal inside text content rather than as tool_calls. With no native
 * tool_calls and no <|channel|> gpt-oss prefix, the existing
 * parseGptOssToolCalls returns null, the chat loop ends with empty
 * assistant content, and the UI surfaces "Model finished without producing
 * an answer".
 *
 * Q6 / Q7 / Q7-followup live captures (2026-05-13) all show this same shape:
 *   [ { "name": "compose_visual", "arguments": {...} }, ... ]
 *
 * Fix: a second-fallback parser that detects a JSON array literal of
 * {name, arguments} objects at the START of accumulated text (after
 * optional whitespace/thinking-prefix), extracts each entry, and returns
 * them as tool calls. If the array doesn't conform, return null and fall
 * through (so plain prose isn't accidentally turned into tool calls).
 *
 * Static method on OllamaProvider so the parser is unit-testable without
 * spinning up a real Ollama session.
 */
import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '../OllamaProvider.js';

describe('OllamaProvider.parseInlineJsonArrayToolCalls — #798 recovery', () => {
  it('parses single tool call wrapped in JSON array', () => {
    const content = '[ { "name": "compose_visual", "arguments": { "template": "bar_chart", "data": { "x": [1, 2, 3] } } } ]';
    const parsed = OllamaProvider.parseInlineJsonArrayToolCalls(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls.length).toBe(1);
    expect(parsed!.toolCalls[0].function.name).toBe('compose_visual');
    expect(parsed!.toolCalls[0].function.arguments).toContain('bar_chart');
  });

  it('parses two parallel tool calls (Q6/Q7 exact shape)', () => {
    const content = `[
      { "name": "compose_visual", "arguments": { "template": "stacked_bar_chart" } },
      { "name": "synth", "arguments": { "capabilities": [], "code": "print(1)" } }
    ]`;
    const parsed = OllamaProvider.parseInlineJsonArrayToolCalls(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls.length).toBe(2);
    expect(parsed!.toolCalls[0].function.name).toBe('compose_visual');
    expect(parsed!.toolCalls[1].function.name).toBe('synth');
  });

  it('parses array after leading prose/thinking text', () => {
    const content = `Let me think about this. Here are the tool calls I need:

[ { "name": "synth", "arguments": { "code": "x=1" } } ]`;
    const parsed = OllamaProvider.parseInlineJsonArrayToolCalls(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls.length).toBe(1);
    expect(parsed!.toolCalls[0].function.name).toBe('synth');
  });

  it('returns null for plain prose with no JSON array', () => {
    const content = 'Here is my answer in plain prose. No tool calls today.';
    expect(OllamaProvider.parseInlineJsonArrayToolCalls(content)).toBeNull();
  });

  it('returns null for JSON array missing required {name, arguments} shape', () => {
    const content = '[ { "foo": "bar" }, { "baz": 42 } ]';
    expect(OllamaProvider.parseInlineJsonArrayToolCalls(content)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const content = '[ { "name": "synth", "arguments": { ';
    expect(OllamaProvider.parseInlineJsonArrayToolCalls(content)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(OllamaProvider.parseInlineJsonArrayToolCalls('')).toBeNull();
    expect(OllamaProvider.parseInlineJsonArrayToolCalls('   ')).toBeNull();
  });
});
