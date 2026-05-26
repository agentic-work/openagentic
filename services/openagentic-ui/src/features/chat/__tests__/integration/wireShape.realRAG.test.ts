/**
 * Step 4 — RAG harness regression pin.
 *
 * Source: reports/verify-cadence/step-4-rag/rag-mcp-tools-kubernetes.ndjson
 * Prompt: "What tools do we have available for managing Kubernetes?
 *          Search our internal tool catalog."
 * Captured 2026-05-14 against chat-dev with admin OBO. 473 frames,
 * success=true. tool_search fired against Milvus mcp_tools and returned
 * 10 real grounded results (k8s_cluster_health, k8s_create_namespace, ...).
 *
 * This is the "RAG actually works" gate. Pins three things:
 *   1. tool_search frame fires with a real query
 *   2. tool_result for tool_search has non-empty content.data
 *   3. The reducer turns the capture into a clean contentBlocks shape
 *      (tool_search block + thinking blocks + valid tool_use ids)
 *
 * Per [[feedback_no_synthetic_chunks_only_real_provider_captures]] —
 * if the fixture isn't present, SKIP with loud warn + re-capture cmd.
 */
import { describe, it, expect } from 'vitest';
import {
  loadNDJSONFixture,
  type WireFrame,
} from './wireShape.fixtures';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
} from '../../hooks/streamReducer/applyCanonicalFrame';

const fixture = loadNDJSONFixture(
  'reports/verify-cadence/step-4-rag/rag-mcp-tools-kubernetes.ndjson',
  "What tools do we have available for managing Kubernetes? Search our internal tool catalog.",
);

const describeIfFixture = fixture ? describe : describe.skip;

describeIfFixture('RAG via Milvus tool_search (real capture)', () => {
  const frames: WireFrame[] = fixture!.frames;

  it('successfully completed (stream_complete.success === true)', () => {
    const last = frames[frames.length - 1];
    expect(last?.type).toBe('stream_complete');
    expect((last as { success?: boolean })?.success).toBe(true);
  });

  it('fired tool_search at least once (Milvus dispatch)', () => {
    const calls = frames.filter(
      (f) => f.type === 'tool_call_complete' && (f as { name?: string }).name === 'tool_search',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('tool_search input contains a real query string (not empty)', () => {
    const call = frames.find(
      (f) => f.type === 'tool_call_complete' && (f as { name?: string }).name === 'tool_search',
    ) as { input?: { query?: string } } | undefined;
    expect(call?.input?.query).toBeDefined();
    expect((call?.input?.query ?? '').length).toBeGreaterThan(0);
  });

  it('tool_search tool_result has non-empty content.data (real Milvus hit, not empty)', () => {
    const call = frames.find(
      (f) => f.type === 'tool_call_complete' && (f as { name?: string }).name === 'tool_search',
    ) as { id?: string } | undefined;
    const result = frames.find(
      (f) => f.type === 'tool_result' && (f as { tool_use_id?: string }).tool_use_id === call?.id,
    ) as { content?: { data?: unknown } } | undefined;
    expect(result?.content?.data).toBeDefined();
    expect(String(result?.content?.data).length).toBeGreaterThan(100);
  });

  it('replays cleanly through applyCanonicalFrame → contentBlocks with the tool_search block', () => {
    const finalState: FrameState = frames.reduce<FrameState>(
      applyCanonicalFrame,
      initialFrameState(),
    );
    const toolBlocks = finalState.contentBlocks.filter((b) => b.type === 'tool_use');
    expect(toolBlocks.length).toBeGreaterThanOrEqual(1);
    const toolSearchBlock = toolBlocks.find((b) => b.toolName === 'tool_search');
    expect(toolSearchBlock).toBeDefined();
    expect(toolSearchBlock?.isComplete).toBe(true);
    // resultRaw should carry the real Milvus payload (string with k8s tool names).
    expect(String(toolSearchBlock?.resultRaw ?? '')).toContain('k8s_');
  });

  it('produces stable id + index + isComplete for every block', () => {
    const finalState: FrameState = frames.reduce<FrameState>(
      applyCanonicalFrame,
      initialFrameState(),
    );
    for (const b of finalState.contentBlocks) {
      expect(typeof b.id).toBe('string');
      expect(b.id.length).toBeGreaterThan(0);
      expect(Number.isFinite(b.index)).toBe(true);
      expect(typeof b.isComplete).toBe('boolean');
    }
  });
});
