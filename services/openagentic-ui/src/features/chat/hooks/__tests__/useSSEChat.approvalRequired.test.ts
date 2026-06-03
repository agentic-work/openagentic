/**
 * useSSEChat — `approval_required` SSE dispatch (backend commit 7e6637539).
 *
 * The event name `approval_required` is SHARED by two features:
 *   1. the NEW mutating-tool gate, shape { auditId, toolName, serverName?, args, preview }
 *   2. the EXISTING agent-tree gate, shape { executionId, agentId, toolName, ... }
 * They are discriminated by the presence of `auditId`. This spec pins that
 * discriminator so the two never collide.
 *
 * Drives the real hook with renderHook + a mocked fetch that streams SSE
 * frames, and spies on useAgentTreeStore.handleApprovalRequired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── mock auth so sendMessage gets a token without an AuthProvider ────────────
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
    user: { id: 'u1' },
  }),
}));

// useSSEChat retired — the streaming engine is now useChatStream, which
// carries the OSS-only `approval_required` (auditId) discriminator surface
// this asserts. Aliased locally so the test body reads unchanged.
import { useChatStream as useSSEChat } from '../useChatStream';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';

// ── helper: build a fetch Response whose body streams the given frames ───────
// The ported streaming engine (useChatStream) consumes the v0.6.6 NDJSON wire
// format: one typed JSON object `{type, ...payload}` per `\n`-terminated line
// (NOT the legacy `event:`/`data:` SSE framing). `frame()` emits that shape.
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function frame(event: string, data: Record<string, unknown>): string {
  return `${JSON.stringify({ type: event, ...data })}\n`;
}

describe('useSSEChat — approval_required discriminator', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let agentTreeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    agentTreeSpy = vi
      .spyOn(useAgentTreeStore.getState(), 'handleApprovalRequired')
      .mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch' as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a frame WITH auditId to onAuditApprovalRequired (NOT the agent tree)', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        frame('approval_required', {
          auditId: 'a1',
          toolName: 'aws_s3_delete_bucket',
          serverName: 'aws',
          args: { bucket: 'x' },
          preview: 'delete it',
        }),
        frame('done', {}),
      ]) as any,
    );

    const onAuditApprovalRequired = vi.fn();
    const { result } = renderHook(() =>
      useSSEChat({ sessionId: 's1', onAuditApprovalRequired }),
    );

    await result.current.sendMessage('go');

    await waitFor(() => {
      expect(onAuditApprovalRequired).toHaveBeenCalledTimes(1);
    });
    expect(onAuditApprovalRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        auditId: 'a1',
        toolName: 'aws_s3_delete_bucket',
        serverName: 'aws',
        preview: 'delete it',
      }),
    );
    // the agent-tree path must NOT run for the auditId shape
    expect(agentTreeSpy).not.toHaveBeenCalled();
  });

  it('routes a frame WITHOUT auditId (executionId+agentId) to the agent tree', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        frame('approval_required', {
          executionId: 'e1',
          agentId: 'ag1',
          toolName: 'some_tool',
          args: { a: 1 },
        }),
        frame('done', {}),
      ]) as any,
    );

    const onAuditApprovalRequired = vi.fn();
    const { result } = renderHook(() =>
      useSSEChat({ sessionId: 's1', onAuditApprovalRequired }),
    );

    await result.current.sendMessage('go');

    await waitFor(() => {
      expect(agentTreeSpy).toHaveBeenCalledTimes(1);
    });
    expect(agentTreeSpy).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ agentId: 'ag1', toolName: 'some_tool' }),
    );
    // the new audit gate must NOT fire for the agent-tree shape
    expect(onAuditApprovalRequired).not.toHaveBeenCalled();
  });
});
