/**
 * B4 — graceful handling of malformed JSON in Ollama tool_calls.arguments.
 *
 * Ollama's chat API spec says `tool_calls[].function.arguments` is a parsed
 * JSON OBJECT, but small models (gpt-oss:20b in particular) occasionally
 * emit a STRING that's only PARTIALLY valid JSON — e.g. `"{\"location\":\"Boston"`
 * (missing closing quote + brace). Pre-B4 the normalizer would happily pass
 * that string through as `partial_json`, then downstream parsers in
 * streamProvider.ts/chatLoop.ts would catch the JSON.parse failure and fall
 * back to `{ _raw: <bad string> }` — the dispatch then runs with garbage
 * input, the MCP tool errors opaquely, the model has no recovery signal.
 *
 * B4 contract: the SDK normalizer detects malformed args at the seam
 * (typeof arguments === 'string' that fails JSON.parse), tags the emitted
 * tool_use block with an `error_args` flag in input so the api can detect
 * the parse failure and emit a synthetic tool_result with is_error:true.
 *
 * Real-data fixture: ollama-malformed-args-real.ndjson — doctored real
 * capture from hal:11434/gpt-oss:20b (the last NDJSON chunk's arguments
 * field was corrupted from {"location":"Boston"} to "{\"location\":\"Boston"
 * to simulate the small-model malformed-emit case).
 *
 * NOT a synthetic chunk — every preceding chunk is verbatim from the live
 * capture; only the malformed `arguments` string is doctored.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createOllamaToOpenagenticNormalizer } from '../OllamaToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadNdjsonChunks(filename: string): any[] {
  const path = resolve(__dirname, 'fixtures', filename);
  const text = readFileSync(path, 'utf8');
  const out: any[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

function normalize(chunks: any[]): CanonicalEvent[] {
  const n = createOllamaToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gpt-oss:20b',
  });
  const events: CanonicalEvent[] = [];
  for (const c of chunks) {
    for (const ev of n.consume(c)) events.push(ev);
  }
  for (const ev of n.finalize()) events.push(ev);
  return events;
}

describe('OllamaToOpenagenticNormalizer — malformed tool_calls.arguments (B4)', () => {
  it('does NOT throw when arguments is a malformed JSON string', () => {
    const chunks = loadNdjsonChunks('ollama-malformed-args-real.ndjson');
    expect(() => normalize(chunks)).not.toThrow();
  });

  it('emits a tool_use content_block_start even when arguments is malformed', () => {
    const chunks = loadNdjsonChunks('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const toolUseStart = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolUseStart).toBeDefined();
    if (toolUseStart && toolUseStart.content_block.type === 'tool_use') {
      expect(toolUseStart.content_block.name).toBe('get_weather');
      expect(toolUseStart.content_block.id).toBe('call_hmr0wlzh');
    }
  });

  it('flags the tool_use block as having malformed args via input.__malformed_args=true', () => {
    const chunks = loadNdjsonChunks('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const toolUseStart = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolUseStart).toBeDefined();
    if (toolUseStart && toolUseStart.content_block.type === 'tool_use') {
      // B4: the normalizer marks the block.input with a sentinel so the
      // api can short-circuit to a synthetic tool_result is_error:true
      // before dispatch ever runs.
      expect((toolUseStart.content_block.input as any).__malformed_args).toBe(true);
      expect(typeof (toolUseStart.content_block.input as any).__raw_args).toBe('string');
      expect((toolUseStart.content_block.input as any).__raw_args).toContain('Boston');
    }
  });

  it('emits the raw malformed string as input_json_delta (resilient pass-through)', () => {
    const chunks = loadNdjsonChunks('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const inputDelta = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(inputDelta).toBeDefined();
    if (inputDelta && inputDelta.delta.type === 'input_json_delta') {
      // The raw string is preserved so debug logs can show what the model
      // actually emitted. Downstream parsers catch + fall back gracefully.
      expect(inputDelta.delta.partial_json).toContain('Boston');
    }
  });

  it('preserves stop_reason=tool_use so the api can pair the tool_use with a synthetic tool_result', () => {
    const chunks = loadNdjsonChunks('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const messageDelta = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'message_delta' }> =>
        e.type === 'message_delta',
    );
    expect(messageDelta).toBeDefined();
    expect(messageDelta!.delta.stop_reason).toBe('tool_use');
  });
});
