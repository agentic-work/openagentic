/**
 * useSubagentStream — Phase E₂.3 unit tests.
 *
 * We don't spin up the real React runtime — we exercise the hook's
 * backing fetch + parseNDJSONStream loop by calling the hook through
 * react's testing utilities, stubbing `globalThis.fetch`, and asserting
 * the parser sees the canonical events end-to-end. The hook is
 * intentionally thin — most behaviour lives in `parseNDJSONStream`,
 * which has its own coverage.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSubagentStream } from '../useSubagentStream';

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

describe('useSubagentStream — Phase E₂.3', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  test('start() kicks off a POST to the endpoint and collects canonical events', async () => {
    fetchSpy.mockResolvedValue(
      mockNDJSONResponse([
        JSON.stringify({ type: 'agent_start', id: 'task-1', name: 'Azure Analysis', role: 'azure', _agentId: 'task-1', _seq: 1, _runId: 'r1', _ts: 1 }),
        JSON.stringify({ type: 'tool_start', id: 'task-1:azure_list:0', toolName: 'azure_list', serverName: 'azure', _agentId: 'task-1', _seq: 2, _runId: 'r1', _ts: 2 }),
        JSON.stringify({ type: 'tool_stop', id: 'task-1:azure_list:0', result: 'ok', durationMs: 10, _agentId: 'task-1', _seq: 3, _runId: 'r1', _ts: 3 }),
        JSON.stringify({ type: 'agent_stop', id: 'task-1', durationMs: 100, tokensIn: 5, tokensOut: 10, cost: 0, _agentId: 'task-1', _seq: 4, _runId: 'r1', _ts: 4 }),
      ]),
    );

    const { result } = renderHook(() =>
      useSubagentStream({
        endpointUrl: '/api/orchestrate/stream/canonical',
        body: { request: 'list my azure resources' },
      }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.events.length).toBe(4));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/orchestrate/stream/canonical',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson',
        }),
      }),
    );

    const types = result.current.events.map((e) => e.type);
    expect(types).toEqual(['agent_start', 'tool_start', 'tool_stop', 'agent_stop']);
  });

  test('groups events by _agentId for multi-agent demultiplexing', async () => {
    fetchSpy.mockResolvedValue(
      mockNDJSONResponse([
        JSON.stringify({ type: 'agent_start', id: 'task-1', name: 'a', role: 'x', _agentId: 'task-1', _seq: 1, _runId: 'r1', _ts: 1 }),
        JSON.stringify({ type: 'agent_start', id: 'task-2', name: 'b', role: 'y', _agentId: 'task-2', _seq: 1, _runId: 'r1', _ts: 2 }),
        JSON.stringify({ type: 'agent_stop', id: 'task-1', durationMs: 1, tokensIn: 0, tokensOut: 0, cost: 0, _agentId: 'task-1', _seq: 2, _runId: 'r1', _ts: 3 }),
        JSON.stringify({ type: 'agent_stop', id: 'task-2', durationMs: 1, tokensIn: 0, tokensOut: 0, cost: 0, _agentId: 'task-2', _seq: 2, _runId: 'r1', _ts: 4 }),
      ]),
    );

    const { result } = renderHook(() =>
      useSubagentStream({
        endpointUrl: '/api/orchestrate/stream/canonical',
        body: { request: 'hybrid cloud' },
      }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.events.length).toBe(4));

    const task1 = result.current.eventsByAgent.get('task-1') || [];
    const task2 = result.current.eventsByAgent.get('task-2') || [];
    expect(task1).toHaveLength(2);
    expect(task2).toHaveLength(2);
    expect(task1.map((e) => e.type)).toEqual(['agent_start', 'agent_stop']);
    expect(task2.map((e) => e.type)).toEqual(['agent_start', 'agent_stop']);
  });

  test('stop() aborts the in-flight fetch', async () => {
    let abortSignal: AbortSignal | undefined;
    fetchSpy.mockImplementation(async (_url: any, init: any) => {
      abortSignal = init?.signal;
      return new Promise<Response>(() => { /* never resolves */ });
    });

    const { result } = renderHook(() =>
      useSubagentStream({
        endpointUrl: '/api/orchestrate/stream/canonical',
        body: { request: 'x' },
      }),
    );

    act(() => {
      result.current.start();
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    act(() => {
      result.current.stop();
    });

    expect(abortSignal?.aborted).toBe(true);
  });

  test('no body → start() is a no-op', async () => {
    const { result } = renderHook(() =>
      useSubagentStream({
        endpointUrl: '/api/orchestrate/stream/canonical',
        body: null,
      }),
    );

    act(() => {
      result.current.start();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.events).toEqual([]);
  });
});
