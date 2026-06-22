/**
 * F1 — tool-prefix prompt caching across providers.
 *
 * Anthropic + Bedrock-Anthropic + Vertex-Anthropic support marking the
 * tool-array prefix as cacheable. The marker shape differs per provider but
 * the canonical SDK adapter must emit the right one when `tools[].length > 0`:
 *
 *   Anthropic     → attach `cache_control: {type:'ephemeral'}` to the LAST
 *                   element of `body.tools[]`.
 *   Bedrock       → APPEND `{cachePoint: {type:'default'}}` to
 *                   `body.toolConfig.tools[]` AFTER the last toolSpec.
 *                   (AWS prompt-caching wire shape — see Bedrock Converse docs.)
 *
 * Without these markers the tool prefix is uncacheable, costing ~80-90% extra
 * input tokens per turn at scale. F1 is the single highest cost-per-fix item
 * in the industry-best-practices research (2026-05-12).
 *
 * Non-Anthropic providers (AIF Responses, OpenAI Chat Completions, Ollama,
 * Vertex Gemini) handle caching automatically or not at all — no canonical
 * marker needs to land on their wire. Existing `adapters.shape.test.ts`
 * pins that those adapters STRIP cache_control. We don't re-pin here.
 */

import { describe, it, expect } from 'vitest';
import { OpenagenticToAnthropic } from '../OpenagenticToAnthropic.js';
import { OpenagenticToBedrock } from '../OpenagenticToBedrock.js';
import type { CanonicalRequest } from '../../canonical/types.js';

function baseRequest(tools: CanonicalRequest['tools']): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    system: null,
    tools,
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
  };
}

const T1_TOOLS: CanonicalRequest['tools'] = [
  {
    name: 'tool_search',
    description: 'Discover relevant tools.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agent_search',
    description: 'Discover relevant sub-agents.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'Task',
    description: 'Spawn a sub-agent.',
    input_schema: { type: 'object', properties: { prompt: { type: 'string' } } },
  },
];

describe('F1 — Anthropic adapter tool-prefix cache breakpoint', () => {
  it('attaches cache_control:{type:"ephemeral"} to the LAST tool when tools[] non-empty', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest(T1_TOOLS));

    expect(body.tools).toBeDefined();
    expect(body.tools!).toHaveLength(3);
    // Earlier tools must NOT carry the marker — only the last one does
    expect(body.tools![0].cache_control).toBeUndefined();
    expect(body.tools![1].cache_control).toBeUndefined();
    // Last tool — marker present
    expect(body.tools![2].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('no-op when tools[] is empty (no marker on missing tools key)', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest([]));
    // Empty tools array is correct here — assert no leakage of cache_control
    // anywhere in the body, since there's no last tool to mark.
    expect(JSON.stringify(body).includes('cache_control')).toBe(false);
  });

  it('single-tool case marks the only tool', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest([T1_TOOLS[0]]));
    expect(body.tools).toHaveLength(1);
    expect(body.tools![0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('F1 — Bedrock adapter tool-prefix cache breakpoint', () => {
  it('appends {cachePoint:{type:"default"}} after the last toolSpec when tools[] non-empty', () => {
    const adapter = new OpenagenticToBedrock();
    const body = adapter.adaptRequest(baseRequest(T1_TOOLS));

    expect(body.toolConfig).toBeDefined();
    const tools = body.toolConfig!.tools;
    // 3 toolSpecs + 1 cachePoint trailer = 4 entries
    expect(tools).toHaveLength(4);
    // First three are toolSpec entries
    for (let i = 0; i < 3; i++) {
      expect((tools[i] as any).toolSpec).toBeDefined();
      expect((tools[i] as any).cachePoint).toBeUndefined();
    }
    // Last entry is the cachePoint trailer
    expect((tools[3] as any).cachePoint).toEqual({ type: 'default' });
    expect((tools[3] as any).toolSpec).toBeUndefined();
  });

  it('no-op when tools[] is empty (no toolConfig key, no cachePoint anywhere)', () => {
    const adapter = new OpenagenticToBedrock();
    const body = adapter.adaptRequest(baseRequest([]));
    expect(body.toolConfig).toBeUndefined();
    expect(JSON.stringify(body).includes('cachePoint')).toBe(false);
  });

  it('single-tool case still appends cachePoint trailer (caches the one tool)', () => {
    const adapter = new OpenagenticToBedrock();
    const body = adapter.adaptRequest(baseRequest([T1_TOOLS[0]]));
    expect(body.toolConfig).toBeDefined();
    expect(body.toolConfig!.tools).toHaveLength(2);
    expect((body.toolConfig!.tools[0] as any).toolSpec.name).toBe('tool_search');
    expect((body.toolConfig!.tools[1] as any).cachePoint).toEqual({ type: 'default' });
  });
});
