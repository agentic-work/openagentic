/**
 * toolRound — TDD spec for task #82.
 *
 * Shared helper for generating a roundId + stamping tool_round_start /
 * tool_round_end envelopes around a parallel batch of tool calls. The
 * pipeline calls this from tool-execution.helper before and after
 * executeParallelSettled so the UI can group N concurrent tools under
 * one visual card.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  newRoundId,
  emitRoundStart,
  emitRoundEnd,
  type RoundStartFrame,
  type RoundEndFrame,
} from '../toolRound.js';

describe('newRoundId', () => {
  it('returns a crypto-random 16-hex-char id', () => {
    const a = newRoundId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('two successive calls never collide', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRoundId()));
    expect(ids.size).toBe(100);
  });
});

describe('emitRoundStart', () => {
  it('emits "tool_round_start" with roundId, toolCount, toolIds', () => {
    const emit = vi.fn();
    const roundId = emitRoundStart(emit, [
      { toolCallId: 'c1', toolName: 'azure_list_vms' },
      { toolCallId: 'c2', toolName: 'aws_list_s3_buckets' },
    ]);
    expect(roundId).toMatch(/^[0-9a-f]{16}$/);
    expect(emit).toHaveBeenCalledWith(
      'tool_round_start',
      expect.objectContaining({
        roundId,
        toolCount: 2,
        toolIds: ['c1', 'c2'],
        toolNames: ['azure_list_vms', 'aws_list_s3_buckets'],
      }),
    );
  });

  it('accepts a pre-generated roundId', () => {
    const emit = vi.fn();
    const rid = 'abcdef0123456789';
    const out = emitRoundStart(emit, [{ toolCallId: 'c1', toolName: 'f' }], rid);
    expect(out).toBe(rid);
    expect(emit.mock.calls[0][1].roundId).toBe(rid);
  });

  it('is a no-op when tools list is empty (no round to open)', () => {
    const emit = vi.fn();
    emitRoundStart(emit, []);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('emitRoundEnd', () => {
  it('emits "tool_round_end" with succeeded/failed/durationMs', () => {
    const emit = vi.fn();
    emitRoundEnd(emit, {
      roundId: '1234567890abcdef',
      succeeded: 2,
      failed: 1,
      durationMs: 820,
    });
    expect(emit).toHaveBeenCalledWith(
      'tool_round_end',
      expect.objectContaining({
        roundId: '1234567890abcdef',
        succeeded: 2,
        failed: 1,
        durationMs: 820,
      }),
    );
  });
});

describe('round envelope types', () => {
  it('RoundStartFrame carries the fields the UI needs to render', () => {
    const f: RoundStartFrame = {
      roundId: 'abc',
      toolCount: 3,
      toolIds: ['a', 'b', 'c'],
      toolNames: ['t1', 't2', 't3'],
      timestamp: new Date().toISOString(),
    };
    expect(f.toolCount).toBe(3);
  });

  it('RoundEndFrame carries the fields the UI needs to close the round', () => {
    const f: RoundEndFrame = {
      roundId: 'abc',
      succeeded: 3,
      failed: 0,
      durationMs: 100,
      timestamp: new Date().toISOString(),
    };
    expect(f.succeeded).toBe(3);
  });
});
