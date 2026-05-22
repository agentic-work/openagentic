/**
 * Wire-shape regression pin against the canonical Q1 NDJSON capture.
 *
 * Source: reports/verify-cadence/Q-loop-post-811-604acc6d/Q1-admin-obo.ndjson
 * Prompt: "show me my Azure subscriptions and what's in each resource group"
 * Real wire from the dev environment 2026-05-14 · claude-sonnet-4-6 via Bedrock
 * with admin OBO. 821 frames, success=true.
 *
 * This pins the contract our /api/chat/stream emits today. The reducer
 * extraction in Step 2 of the chatmode-interleave-rebuild track will
 * replay this exact NDJSON through `applyCanonicalFrame` and assert the
 * resulting contentBlocks match the mock-16 anatomy. Before that fix
 * lands, we pin the WIRE so any regression in the api stream emitter
 * (ordering, pairing, terminal frame) goes RED here.
 *
 * Per [[feedback_no_synthetic_chunks_only_real_provider_captures]] — if
 * the fixture isn't on disk the suite SKIPs with a loud warn and a
 * re-capture command. Never synthesize chunks.
 */
import { describe, it, expect } from 'vitest';
import {
  loadNDJSONFixture,
  Q1_AZURE_SUBS_RGS_FIXTURE,
  type WireFrame,
} from './wireShape.fixtures';

const fixture = loadNDJSONFixture(
  Q1_AZURE_SUBS_RGS_FIXTURE.path,
  Q1_AZURE_SUBS_RGS_FIXTURE.prompt,
);

const describeIfFixture = fixture ? describe : describe.skip;

describeIfFixture('Q1 Azure subs+RGs wire shape (real capture)', () => {
  const frames: WireFrame[] = fixture!.frames;

  it('has frames at all (fixture loaded)', () => {
    expect(frames.length).toBeGreaterThan(0);
  });

  it('starts with stream_start at index 0', () => {
    expect(frames[0]?.type).toBe('stream_start');
  });

  it('ends with stream_complete at last index with success:true', () => {
    const last = frames[frames.length - 1];
    expect(last?.type).toBe('stream_complete');
    expect((last as { success?: boolean })?.success).toBe(true);
  });

  it('contains exactly one ttft frame with positive ttft_ms', () => {
    const ttfts = frames.filter((f) => f.type === 'ttft');
    expect(ttfts).toHaveLength(1);
    const ms =
      (ttfts[0] as { ttftMs?: number; ttft_ms?: number }).ttft_ms ??
      (ttfts[0] as { ttftMs?: number }).ttftMs;
    expect(ms).toBeGreaterThan(0);
  });

  it('contains zero error frames', () => {
    const errors = frames.filter((f) => f.type === 'error');
    expect(errors).toHaveLength(0);
  });

  it('pairs every tool_executing with a matching tool_result by tool_use_id', () => {
    const executing = new Set<string>();
    const result = new Set<string>();
    for (const f of frames) {
      const id = (f as { tool_use_id?: string }).tool_use_id;
      if (!id) continue;
      if (f.type === 'tool_executing') executing.add(id);
      else if (f.type === 'tool_result') result.add(id);
    }
    expect(executing.size).toBeGreaterThan(0);
    expect([...executing].sort()).toEqual([...result].sort());
  });

  it('orders each tool dispatch as tool_call_complete → tool_executing → tool_result', () => {
    // Wire-shape contract: tool_call_complete carries the canonical
    // `id` (Anthropic-shape tool_use id). tool_executing + tool_result
    // carry the same value as `tool_use_id`. The reducer that lands in
    // Step 2 MUST treat these as the same identity.
    const idOf = (f: WireFrame): string | undefined => {
      const x = f as { id?: string; tool_use_id?: string };
      return x.tool_use_id ?? x.id;
    };
    const seen = new Map<string, string[]>();
    for (const f of frames) {
      if (
        f.type !== 'tool_call_complete' &&
        f.type !== 'tool_executing' &&
        f.type !== 'tool_result'
      )
        continue;
      const id = idOf(f);
      if (!id) continue;
      const arr = seen.get(id) ?? [];
      arr.push(f.type);
      seen.set(id, arr);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const [id, sequence] of seen) {
      expect(sequence, `tool_use_id=${id} sequence`).toEqual([
        'tool_call_complete',
        'tool_executing',
        'tool_result',
      ]);
    }
  });

  it('every content_block_delta wraps an inner delta with a known delta.type', () => {
    const KNOWN_DELTA_TYPES = new Set([
      'thinking_delta',
      'text_delta',
      'input_json_delta',
      'signature_delta',
    ]);
    const deltas = frames.filter((f) => f.type === 'content_block_delta');
    expect(deltas.length).toBeGreaterThan(0);
    for (const f of deltas) {
      const inner = (f as { delta?: { type?: string } }).delta?.type;
      expect(inner, 'inner delta.type').toBeDefined();
      expect(KNOWN_DELTA_TYPES.has(inner!)).toBe(true);
    }
  });

  it('emits thinking_complete exactly once before stream_complete', () => {
    const thinkingCompleteIdx = frames.findIndex(
      (f) => f.type === 'thinking_complete',
    );
    const streamCompleteIdx = frames.length - 1;
    expect(thinkingCompleteIdx).toBeGreaterThan(-1);
    expect(thinkingCompleteIdx).toBeLessThan(streamCompleteIdx);
    const allThinkingCompletes = frames.filter(
      (f) => f.type === 'thinking_complete',
    );
    expect(allThinkingCompletes).toHaveLength(1);
  });
});
