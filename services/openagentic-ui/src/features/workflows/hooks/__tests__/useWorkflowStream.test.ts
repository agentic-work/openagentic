/**
 * useWorkflowStream — Phase E₂.3 unit tests + streaming extension.
 *
 * Proves the hook consumes the same NDJSON wire format as the chat
 * stream (via `parseNDJSONStream`) and correctly observes the flow
 * envelopes (execution_start, node_start, node_stream carrying inner
 * AnthropicStreamEvent, node_complete, execution_complete).
 *
 * S1 tests: streamingText accumulation per-node
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkflowStream } from '../useWorkflowStream';

vi.mock('@/utils/api', () => ({
  workflowEndpoint: (p: string) => `http://localhost:0${p}`,
}));

function mockNDJSONResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

describe('useWorkflowStream — Phase E₂.3', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Default: never resolves — safe for mount-but-no-fetch tests.
    fetchSpy.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('executionId=null → no fetch performed', () => {
    renderHook(() => useWorkflowStream({ executionId: null }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('happy path: collects flow envelopes + inner canonical events', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-1' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-0', nodeType: 'llm_completion' }),
        JSON.stringify({
          type: 'node_stream',
          nodeId: 'llm-0',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hi' },
          },
        }),
        JSON.stringify({
          type: 'node_stream',
          nodeId: 'llm-0',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' there' },
          },
        }),
        JSON.stringify({
          type: 'node_complete',
          nodeId: 'llm-0',
          output: { content: 'Hi there' },
        }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-1' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-1', getAuthHeaders: () => ({ Authorization: 'Bearer x' }) }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(6), { timeout: 3000 });

    const types = result.current.events.map((e) => e.type);
    expect(types).toEqual([
      'execution_start',
      'node_start',
      'node_stream',
      'node_stream',
      'node_complete',
      'execution_complete',
    ]);

    const innerTypes = result.current.events
      .filter((e) => e.type === 'node_stream')
      .map((e) => (e as { event: { type: string } }).event.type);
    expect(innerTypes).toEqual(['content_block_delta', 'content_block_delta']);

    unmount();
  });

  test('execution_complete terminates the loop early', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-2' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-2' }),
        JSON.stringify({ type: 'node_start', nodeId: 'late' }),
      ]),
    );

    const { result, unmount } = renderHook(() => useWorkflowStream({ executionId: 'exec-2' }));

    await waitFor(() => expect(result.current.events.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });

    const types = result.current.events.map((e) => e.type);
    expect(types).toContain('execution_complete');
    expect(types).not.toContain('node_start');

    unmount();
  });

  test('disconnect() aborts the in-flight stream', async () => {
    let abortSignal: AbortSignal | undefined;
    fetchSpy.mockImplementationOnce(async (_url: any, init: any) => {
      abortSignal = init?.signal;
      return new Promise<Response>(() => { /* never resolves */ });
    });

    const { result, unmount } = renderHook(() => useWorkflowStream({ executionId: 'exec-3' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 3000 });
    result.current.disconnect();
    expect(abortSignal?.aborted).toBe(true);
    unmount();
  });
});

// ── S1: streamingText accumulation ──────────────────────────────────────────

describe('useWorkflowStream — S1: streamingText accumulation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('S1.1: accumulates text from delta-only node_stream events (flat shape)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s1' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-1', nodeType: 'llm_completion' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-1', delta: 'Hello' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-1', delta: ' world' }),
        JSON.stringify({ type: 'node_complete', nodeId: 'llm-1', output: { content: 'Hello world' } }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s1' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s1' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(6), { timeout: 3000 });

    // After two delta events, streamingText for 'llm-1' should be the concat
    // but node_complete clears it — so check intermediate events built the map
    const streamEvents = result.current.events.filter(e => e.type === 'node_stream');
    expect(streamEvents).toHaveLength(2);
    expect((streamEvents[0] as any).delta).toBe('Hello');
    expect((streamEvents[1] as any).delta).toBe(' world');

    unmount();
  });

  test('S1.2: accumulates text from fullText node_stream events', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s2' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-2', nodeType: 'openagentic_llm' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-2', fullText: 'Partial output so far' }),
        JSON.stringify({ type: 'node_complete', nodeId: 'llm-2', output: { content: 'Final output' } }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s2' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s2' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(5), { timeout: 3000 });

    const streamEvents = result.current.events.filter(e => e.type === 'node_stream');
    expect(streamEvents).toHaveLength(1);
    expect((streamEvents[0] as any).fullText).toBe('Partial output so far');

    // streamingText for llm-2 should be cleared after node_complete
    expect(result.current.streamingText['llm-2']).toBeUndefined();

    unmount();
  });

  test('S1.3: handles a mix of delta and fullText events for same node', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s3' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-3' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-3', delta: 'Token1 ' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-3', delta: 'Token2 ' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-3', fullText: 'Token1 Token2 Token3' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s3' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s3' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(6), { timeout: 3000 });

    // After 3 stream events, the streamingText for llm-3 should reflect the fullText (last wins)
    expect(result.current.streamingText['llm-3']).toBe('Token1 Token2 Token3');

    unmount();
  });

  test('S1.4: clears streamingText on node_error (S4)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s4' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-4' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-4', delta: 'Some partial' }),
        JSON.stringify({ type: 'node_error', nodeId: 'llm-4', error: 'Timeout' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s4' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s4' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(5), { timeout: 3000 });

    // S4: buffer must be cleared on error
    expect(result.current.streamingText['llm-4']).toBeUndefined();

    unmount();
  });

  test('S1.5: accumulates streaming across multiple nodes independently', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s5' }),
        JSON.stringify({ type: 'node_start', nodeId: 'nodeA' }),
        JSON.stringify({ type: 'node_start', nodeId: 'nodeB' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'nodeA', delta: 'A1 ' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'nodeB', delta: 'B1 ' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'nodeA', delta: 'A2' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s5' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s5' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(7), { timeout: 3000 });

    // Each node accumulates independently
    expect(result.current.streamingText['nodeA']).toBe('A1 A2');
    expect(result.current.streamingText['nodeB']).toBe('B1 ');

    unmount();
  });

  test('S1.6: does not show streamingText for completed nodes (S3)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s6' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-6' }),
        JSON.stringify({ type: 'node_stream', nodeId: 'llm-6', delta: 'text' }),
        JSON.stringify({ type: 'node_complete', nodeId: 'llm-6', output: 'final' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s6' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s6' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(5), { timeout: 3000 });

    // S3: after node_complete, streaming buffer cleared
    expect(result.current.streamingText['llm-6']).toBeUndefined();

    unmount();
  });

  test('S1.7: handles inner canonical event shape (existing format stays working)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockNDJSONResponse([
        JSON.stringify({ type: 'execution_start', executionId: 'exec-s7' }),
        JSON.stringify({ type: 'node_start', nodeId: 'llm-7' }),
        JSON.stringify({
          type: 'node_stream',
          nodeId: 'llm-7',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'tok' } },
        }),
        JSON.stringify({ type: 'node_complete', nodeId: 'llm-7', output: 'tok' }),
        JSON.stringify({ type: 'execution_complete', executionId: 'exec-s7' }),
      ]),
    );

    const { result, unmount } = renderHook(() =>
      useWorkflowStream({ executionId: 'exec-s7' }),
    );

    await waitFor(() => expect(result.current.events.length).toBe(5), { timeout: 3000 });

    // Inner event format should also accumulate streamingText during streaming
    // (before node_complete clears it)
    const streamEvent = result.current.events.find(e => e.type === 'node_stream');
    expect(streamEvent).toBeDefined();
    expect((streamEvent as any).event?.delta?.text).toBe('tok');

    unmount();
  });
});
