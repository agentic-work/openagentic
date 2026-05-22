/**
 * Sev-0 follow-up to #798 — gpt-oss:20b also emits compose_visual /
 * compose_app / render_artifact as a BARE JSON OBJECT (not wrapped in an
 * array). Live capture pattern (Q-loop 2026-05-21):
 *
 *   JSON
 *   {
 *     "name": "compose_visual",
 *     "arguments": { "template": "sankey", "data": {...} }
 *   }
 *
 * Existing parsers fail:
 *   - parseGptOssToolCalls          → expects <|channel|> harmony frames
 *   - parseInlineJsonArrayToolCalls → array-only, fails on bare object
 *
 * Without this third-fallback parser, the chat loop receives no
 * tool_use blocks, the JSON envelope leaks to the user as raw text,
 * and the artifact never renders.
 *
 * Fix layer: bare-object recovery parser, ALLOWLISTED to artifact tools
 * only — never accept arbitrary `name` field (defends against
 * conversational JSON like `{"theme":"dark"}` from accidentally
 * becoming a tool call).
 *
 * Pure function in ../util/parseInlineJsonObjectToolCall.ts for
 * unit-testability without spinning up a real Ollama session.
 */
import { describe, it, expect } from 'vitest';
import { parseInlineJsonObjectToolCall } from '../util/parseInlineJsonObjectToolCall.js';

describe('parseInlineJsonObjectToolCall — bare-object recovery (post-#798)', () => {
  it('parses bare compose_visual object (Q-loop 2026-05-21 capture)', () => {
    const content = '{"name":"compose_visual","arguments":{"template":"sankey","data":{"nodes":[],"links":[]}}}';
    const parsed = parseInlineJsonObjectToolCall(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls.length).toBe(1);
    expect(parsed!.toolCalls[0].name).toBe('compose_visual');
    expect(parsed!.toolCalls[0].arguments).toMatchObject({
      template: 'sankey',
    });
  });

  it('parses with leading `JSON\\n` marker line (gpt-oss tendency)', () => {
    const content = 'JSON\n{\n  "name": "compose_visual",\n  "arguments": { "template": "bar_chart" }\n}';
    const parsed = parseInlineJsonObjectToolCall(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls[0].name).toBe('compose_visual');
  });

  it('parses with ```json ... ``` fence wrapping', () => {
    const content = '```json\n{ "name": "compose_app", "arguments": { "template": "dashboard" } }\n```';
    const parsed = parseInlineJsonObjectToolCall(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls[0].name).toBe('compose_app');
  });

  it('parses with surrounding prose (extracts first balanced object)', () => {
    const content = 'Here is the call I want to make: { "name": "render_artifact", "arguments": { "kind": "code", "content": "x=1" } } — done.';
    const parsed = parseInlineJsonObjectToolCall(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls[0].name).toBe('render_artifact');
  });

  it('returns null when object is missing `name` field', () => {
    const content = '{"arguments":{"template":"sankey"}}';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('returns null when name is NOT in the artifact-tool allowlist', () => {
    // Defends against conversational JSON like `{"name":"foo"}` from
    // accidentally becoming a tool call. Arbitrary names rejected.
    const content = '{"name":"WebSearch","arguments":{"query":"x"}}';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('returns null for conversational JSON like `{"theme":"dark"}`', () => {
    const content = '{"theme":"dark","accent":"green"}';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseInlineJsonObjectToolCall('')).toBeNull();
    expect(parseInlineJsonObjectToolCall('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const content = '{"name":"compose_visual","arguments":{';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('returns null for plain prose with no object at all', () => {
    const content = 'Here is my plain prose answer. No JSON here.';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('returns null for object that looks like an array entry (defer to array parser)', () => {
    // If the input IS an array, we return null — let
    // parseInlineJsonArrayToolCalls handle it. We only handle bare objects.
    const content = '[{"name":"compose_visual","arguments":{}}]';
    expect(parseInlineJsonObjectToolCall(content)).toBeNull();
  });

  it('accepts arguments as pre-serialized string (some models do this)', () => {
    const content = '{"name":"compose_visual","arguments":"{\\"template\\":\\"sankey\\"}"}';
    const parsed = parseInlineJsonObjectToolCall(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.toolCalls[0].name).toBe('compose_visual');
    // arguments parsed back into object form
    expect(parsed!.toolCalls[0].arguments).toMatchObject({ template: 'sankey' });
  });
});
