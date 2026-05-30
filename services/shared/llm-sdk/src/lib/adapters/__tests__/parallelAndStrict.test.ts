/**
 * Q2 — per-turn `disable_parallel_tool_use` + per-tool `strict` flag.
 *
 * Two related controls:
 *
 *   1. CanonicalRequest.disable_parallel_tool_use?: boolean
 *      - Anthropic adapter: emits `tool_choice.disable_parallel_tool_use:true`
 *      - OpenAI adapter:    emits `parallel_tool_calls: false`
 *      - Vertex Gemini:     emits `toolConfig.parallelFunctionCalling: false`
 *      - Bedrock / AIF / Ollama: ignored (no equivalent on those wires)
 *
 *   2. CanonicalTool.strict?: boolean (OpenAI-specific)
 *      - OpenAI adapter: emits `function.strict: true` on the tool def
 *      - OpenAI contract: strict mode REQUIRES parallel-off. When ANY
 *        tool has `strict: true`, the OpenAI adapter auto-flips
 *        `parallel_tool_calls: false` regardless of the request flag.
 *      - Anthropic / Bedrock / Vertex / Ollama: ignored.
 *
 * Use cases:
 *   - Synthesis-retry turn: set `disable_parallel_tool_use: true` so the
 *     model can't fire more tools before synthesizing.
 *   - Strict JSON output: tag specific tools `strict: true`; parallel
 *     gets disabled for that turn automatically.
 *
 * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
 *         https://developers.openai.com/api/docs/guides/function-calling
 */

import { describe, it, expect } from 'vitest';
import { OpenagenticToAnthropic } from '../OpenagenticToAnthropic.js';
import { OpenagenticToOpenAI } from '../OpenagenticToOpenAI.js';
import { OpenagenticToVertexGemini } from '../OpenagenticToVertexGemini.js';
import type { CanonicalRequest } from '../../canonical/types.js';

function baseRequest(extra: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    system: null,
    tools: [
      { name: 'tool_a', description: 'A', input_schema: { type: 'object', properties: {} } },
      { name: 'tool_b', description: 'B', input_schema: { type: 'object', properties: {} } },
    ],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    ...extra,
  };
}

describe('Q2 — Anthropic adapter: disable_parallel_tool_use', () => {
  it('emits tool_choice.disable_parallel_tool_use:true when request flag set', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest({ disable_parallel_tool_use: true }));
    expect((body.tool_choice as any).disable_parallel_tool_use).toBe(true);
  });

  it('does NOT set the flag when request flag is unset', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest());
    expect((body.tool_choice as any).disable_parallel_tool_use).toBeUndefined();
  });

  it('preserves existing tool_choice type when adding disable_parallel_tool_use', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(
      baseRequest({ disable_parallel_tool_use: true, tool_choice: { type: 'any' } }),
    );
    expect((body.tool_choice as any).type).toBe('any');
    expect((body.tool_choice as any).disable_parallel_tool_use).toBe(true);
  });
});

describe('Q2 — OpenAI adapter: parallel_tool_calls + strict', () => {
  it('emits parallel_tool_calls:false when disable_parallel_tool_use:true', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(baseRequest({ disable_parallel_tool_use: true })) as any;
    expect(body.parallel_tool_calls).toBe(false);
  });

  it('emits function.strict:true on tools tagged strict', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(
      baseRequest({
        tools: [
          { name: 'plain', description: 'P', input_schema: { type: 'object' } },
          {
            name: 'strict_one',
            description: 'S',
            input_schema: { type: 'object', additionalProperties: false },
            strict: true,
          },
        ],
      }),
    );
    expect(body.tools).toBeDefined();
    const plain = body.tools!.find((t) => t.function.name === 'plain');
    const strictOne = body.tools!.find((t) => t.function.name === 'strict_one');
    expect((plain as any).function.strict).toBeUndefined();
    expect((strictOne as any).function.strict).toBe(true);
  });

  it('auto-flips parallel_tool_calls:false when ANY tool has strict:true', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(
      baseRequest({
        tools: [
          { name: 'plain', description: 'P', input_schema: { type: 'object' } },
          { name: 'strict_one', description: 'S', input_schema: { type: 'object' }, strict: true },
        ],
      }),
    ) as any;
    expect(body.parallel_tool_calls).toBe(false);
  });

  it('does NOT set parallel_tool_calls when neither strict nor disable is requested', () => {
    const adapter = new OpenagenticToOpenAI();
    const body = adapter.adaptRequest(baseRequest()) as any;
    // Default OpenAI behavior is parallel-on, so we OMIT the field (don't
    // emit `parallel_tool_calls: true` because it's the default and uses
    // smaller request bodies).
    expect(body.parallel_tool_calls).toBeUndefined();
  });
});

describe('Q2 — Vertex Gemini adapter: parallelFunctionCalling', () => {
  it('emits toolConfig.parallelFunctionCalling:false when request flag set', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(baseRequest({ disable_parallel_tool_use: true })) as any;
    expect(body.toolConfig?.functionCallingConfig?.parallelFunctionCalling).toBe(false);
  });

  it('does NOT set parallelFunctionCalling when request flag is unset', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(baseRequest()) as any;
    expect(body.toolConfig?.functionCallingConfig?.parallelFunctionCalling).toBeUndefined();
  });
});
