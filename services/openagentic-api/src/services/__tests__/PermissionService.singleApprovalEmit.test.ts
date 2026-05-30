/**
 * Q1-blocker-8 (2026-05-12) — PermissionService.evaluate must emit
 * EXACTLY ONE approval frame, not three.
 *
 * Pre-fix:  emitted `mcp_approval_required` + `hitl_approval` + `e`
 *           for every ask. Combined with `persistableInlineFrames.ts`
 *           accepting BOTH `hitl_approval` and `mcp_approval_required`,
 *           every approval persisted twice to
 *           chat_messages.visualizations[] — and the UI persisted-
 *           fallback path in ChatMessages.tsx mapped both into the
 *           `approvals` array, rendering TWO cards for one ask.
 *
 * Post-fix: ONE canonical `hitl_approval` frame. Legacy
 *           `mcp_approval_required` + opcode `e` emits ripped.
 *
 * RED behavior on un-fixed code: count of `mcp_approval_required` is 1.
 * GREEN behavior:                count of `mcp_approval_required` is 0,
 *                                count of `hitl_approval` is 1.
 */
import { describe, test, expect, vi } from 'vitest';
import { PermissionService } from '../PermissionService.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
} as any;

function mkEmit() {
  const events: Array<{ event: string; data: unknown }> = [];
  const emit = (event: string, data: unknown) => {
    events.push({ event, data });
  };
  return { emit, events };
}

function mkToolCall(name: string) {
  return {
    toolName: name,
    arguments: {},
    userId: 'test-user',
  };
}

describe('PermissionService — single approval frame (Q1-fix-8)', () => {
  test('emits hitl_approval exactly once and never emits mcp_approval_required', async () => {
    const svc = new PermissionService(logger, { timeoutMs: 100 });
    const { emit, events } = mkEmit();

    // ask-path: weird unknown tool falls through to ask
    await svc.evaluate(mkToolCall('weird_unknown_tool'), emit);

    const hitl = events.filter((e) => e.event === 'hitl_approval');
    const legacy = events.filter((e) => e.event === 'mcp_approval_required');
    const opcodeE = events.filter((e) => e.event === 'e');

    expect(hitl).toHaveLength(1);
    expect(legacy).toHaveLength(0);
    expect(opcodeE).toHaveLength(0);
  });

  test('hitl_approval frame carries the canonical fields the UI reducer expects', async () => {
    const svc = new PermissionService(logger, { timeoutMs: 100 });
    const { emit, events } = mkEmit();

    await svc.evaluate(mkToolCall('weird_unknown_tool'), emit);

    const hitl = events.find((e) => e.event === 'hitl_approval');
    expect(hitl).toBeDefined();
    const data = hitl!.data as any;
    expect(typeof data.requestId).toBe('string');
    expect(data.toolName).toBe('weird_unknown_tool');
    expect(typeof data.timeoutMs).toBe('number');
  });
});
