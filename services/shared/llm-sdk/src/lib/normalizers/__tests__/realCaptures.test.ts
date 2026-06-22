/**
 * Real-capture replay tests — feed verbatim live provider streams (captured
 * 2026-05-10 from AIF gpt-5.4, Ollama gpt-oss:20b, Vertex gemini-2.5-flash)
 * through the SDK normalizers and assert canonical event invariants.
 *
 * These tests catch bugs that fixture-from-imagination tests never could:
 * - AIF emits trailing usage chunk AFTER finish_reason — normalizer must
 *   surface those tokens on canonical message_delta.usage.
 * - Ollama gpt-oss:20b sets `done_reason:"stop"` even when emitting
 *   tool_calls in the same chunk — normalizer must override stop_reason
 *   to 'tool_use' when a tool block was emitted (G7).
 * - Vertex gemini-2.5-flash sets `finishReason:"STOP"` even on tool turns —
 *   same G7 issue.
 *
 * Re-capture command: see reports/sdk-capture/2026-05-10/body-aif-vertex.json
 */

import { describe, it, expect } from 'vitest';
import { loadSseFixture, loadNdjsonFixture } from './fixtures/loader.js';
import {
  createOpenAIToOpenagenticNormalizer,
  type OpenAIChunk,
  type CanonicalEvent,
} from '../OpenAIToOpenagentic.js';
import {
  createOllamaToOpenagenticNormalizer,
  type OllamaChunk,
} from '../OllamaToOpenagentic.js';
import {
  createVertexGeminiToOpenagenticNormalizer,
  type GeminiChunk,
} from '../VertexGeminiToOpenagentic.js';

describe('Real captures — AIF gpt-5.4 parallel tools', () => {
  const chunks = loadSseFixture('aif-gpt5.4-parallel-tools.sse') as OpenAIChunk[];

  function run(): CanonicalEvent[] {
    const norm = createOpenAIToOpenagenticNormalizer({ messageId: 'msg_aif', model: 'gpt-5.4' });
    const out: CanonicalEvent[] = [];
    for (const chunk of chunks) {
      for (const ev of norm.consume(chunk)) out.push(ev);
    }
    for (const ev of norm.finalize()) out.push(ev);
    return out;
  }

  it('captures BOTH parallel tool calls (Boston + Tokyo)', () => {
    const events = run();
    const toolStarts = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStarts.length).toBe(2);
    expect((toolStarts[0]!.content_block as any).name).toBe('get_weather');
    expect((toolStarts[1]!.content_block as any).name).toBe('get_weather');
    expect((toolStarts[0]!.content_block as any).id).toMatch(/^call_/);
    expect((toolStarts[1]!.content_block as any).id).toMatch(/^call_/);
  });

  it('reassembles each tool_call argument JSON to {"location":"<city>"}', () => {
    const events = run();
    const argDeltas = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    // Group by index, concatenate, parse.
    const byIndex = new Map<number, string>();
    for (const d of argDeltas) {
      const idx = d.index;
      byIndex.set(idx, (byIndex.get(idx) ?? '') + (d.delta as any).partial_json);
    }
    const parsed = [...byIndex.values()].map(s => JSON.parse(s));
    const cities = parsed.map(p => p.location).sort();
    expect(cities).toEqual(['Boston', 'Tokyo']);
  });

  it('reports stop_reason="tool_use"', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    expect(md.delta.stop_reason).toBe('tool_use');
  });

  it('G1 — surfaces real prompt_tokens/completion_tokens on message_delta.usage', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    // Real AIF returned: prompt_tokens=167, completion_tokens=48, total=215
    expect(md.usage.input_tokens).toBe(167);
    expect(md.usage.output_tokens).toBe(48);
  });

  // ── G2 / G3 — OpenAI / AIF reasoning_content + reasoning.summary ─────
  // The current fixture is a parallel-tools capture; it has no reasoning
  // content. Track the missing fixture explicitly so future-Claude (or
  // a future capture pass) un-`.todo`s these and adds the AIF-reasoning
  // capture at fixtures/aif-gpt5.4-reasoning.sse.
  //
  // Procedure: docs/smoke-gates/canonical-events.md §"Missing fixtures".
  // Root cause for gpt-5.4 no-thinking UX surface flagged 2026-05-10.

  it.todo('G2 — AIF gpt-5.4 reasoning prompt: ≥1 thinking_delta event from delta.reasoning_content');
  it.todo('G3 — AIF gpt-5.4 Responses API reasoning.summary chunks → ≥1 thinking_delta event');
});

describe('Real captures — Ollama gpt-oss:20b tool call', () => {
  const chunks = loadNdjsonFixture('ollama-gpt-oss-20b-tool-call.ndjson') as OllamaChunk[];

  function run(): CanonicalEvent[] {
    const norm = createOllamaToOpenagenticNormalizer({ messageId: 'msg_ollama', model: 'gpt-oss:20b' });
    const out: CanonicalEvent[] = [];
    for (const chunk of chunks) {
      for (const ev of norm.consume(chunk)) out.push(ev);
    }
    for (const ev of norm.finalize()) out.push(ev);
    return out;
  }

  it('streams thinking deltas (gpt-oss reasoning)', () => {
    const events = run();
    const thinkingDeltas = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'thinking_delta',
    );
    expect(thinkingDeltas.length).toBeGreaterThan(5);
    const joined = thinkingDeltas.map(d => (d.delta as any).thinking).join('');
    expect(joined.toLowerCase()).toMatch(/weather|boston|tokyo|call|function/);
  });

  it('emits the tool_use block for get_weather', () => {
    const events = run();
    const toolStart = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    expect((toolStart!.content_block as any).name).toBe('get_weather');
  });

  it('G7 — when chunk has tool_calls AND done_reason="stop", canonical stop_reason MUST be "tool_use"', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    // Live capture: the final chunk has both tool_calls[] AND done_reason:"stop".
    // Stop precedence rule: if a tool_use block was emitted, stop_reason='tool_use'
    // wins regardless of upstream done_reason — otherwise the chat-loop never
    // dispatches the tool. Mirrors Anthropic's own contract.
    expect(md.delta.stop_reason).toBe('tool_use');
  });

  it('G1 — surfaces prompt_eval_count/eval_count on message_delta.usage', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    // Real Ollama returned: prompt_eval_count=166, eval_count=101
    expect(md.usage.input_tokens).toBe(166);
    expect(md.usage.output_tokens).toBe(101);
  });
});

describe('Real captures — Vertex gemini-2.5-flash parallel tools', () => {
  const chunks = loadSseFixture('vertex-gemini-2.5-flash-parallel-tools.sse') as GeminiChunk[];

  function run(): CanonicalEvent[] {
    const norm = createVertexGeminiToOpenagenticNormalizer({ messageId: 'msg_vertex', model: 'gemini-2.5-flash' });
    const out: CanonicalEvent[] = [];
    for (const chunk of chunks) {
      for (const ev of norm.consume(chunk)) out.push(ev);
    }
    for (const ev of norm.finalize()) out.push(ev);
    return out;
  }

  it('captures BOTH parallel functionCall parts (Boston + Tokyo) from one chunk', () => {
    const events = run();
    const toolStarts = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStarts.length).toBe(2);
    expect((toolStarts[0]!.content_block as any).name).toBe('get_weather');
    expect((toolStarts[1]!.content_block as any).name).toBe('get_weather');
  });

  it('preserves both arg payloads', () => {
    const events = run();
    const argDeltas = events.filter(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    // Vertex emits parsed args, normalizer JSON.stringify's once per call.
    const parsed = argDeltas.map(d => JSON.parse((d.delta as any).partial_json));
    const cities = parsed.map(p => p.location).sort();
    expect(cities).toEqual(['Boston', 'Tokyo']);
  });

  it('G7 — finishReason="STOP" with functionCall parts must map to stop_reason="tool_use"', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    // Vertex 2.5-flash returns finishReason:"STOP" even on tool turns.
    // Same G7 fix as Ollama: tool_use wins when a tool block was emitted.
    expect(md.delta.stop_reason).toBe('tool_use');
  });

  it('G1 — surfaces promptTokenCount/candidatesTokenCount on message_delta.usage', () => {
    const events = run();
    const md = events.find(e => e.type === 'message_delta') as any;
    // Real Vertex returned: promptTokenCount=53, candidatesTokenCount=10
    expect(md.usage.input_tokens).toBe(53);
    expect(md.usage.output_tokens).toBe(10);
  });

  // ── G2 — Vertex Gemini "thought" parts (gemini-2.5-pro only) ──────────
  // 2.5-flash does not surface reasoning by default. The missing fixture
  // for the reasoning path is captured from gemini-2.5-pro.
  // Procedure: docs/smoke-gates/canonical-events.md §"Missing fixtures".
  it.todo('G2 — Vertex gemini-2.5-pro thought parts: ≥1 thinking_delta event');
});

// ── Bedrock — fixture pending ──────────────────────────────────────────
// AnthropicShape passthrough normalizer; eventstream framing matters.
// Procedure: docs/smoke-gates/canonical-events.md §"Missing fixtures".
describe.skip('Real captures — Bedrock Anthropic Claude Sonnet (PENDING FIXTURE)', () => {
  it.todo('G1 — Bedrock usage.input_tokens/output_tokens passthrough');
  it.todo('G7 — Bedrock tool_use stop_reason emitted as canonical');
});
