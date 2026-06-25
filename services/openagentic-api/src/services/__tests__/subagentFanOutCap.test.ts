/**
 * Q1 — sub-agent fan-out cap.
 *
 * Pure-function unit tests. The wiring into chatLoop is exercised by the
 * cascade-tool-routing live battery; this file pins the cap logic alone.
 */

import { describe, it, expect } from 'vitest';
import {
  applyFanOutCap,
  DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  type FanOutCandidateBlock,
} from '../subagentFanOutCap.js';

function taskBlock(): FanOutCandidateBlock {
  return { type: 'tool_use', name: 'Task' };
}

function otherBlock(name: string): FanOutCandidateBlock {
  return { type: 'tool_use', name };
}

describe('subagentFanOutCap.applyFanOutCap', () => {
  it('allows when Task count is at or below cap (default 4)', () => {
    const blocks = [taskBlock(), taskBlock(), taskBlock(), taskBlock()];
    const decision = applyFanOutCap(blocks);
    expect(decision.allowed).toBe(true);
    expect(decision.requested).toBe(4);
    expect(decision.cap).toBe(DEFAULT_MAX_CONCURRENT_SUBAGENTS);
    expect(decision.reason).toBeUndefined();
  });

  it('blocks when Task count exceeds default cap and explains why', () => {
    const blocks = Array.from({ length: 5 }, () => taskBlock());
    const decision = applyFanOutCap(blocks);
    expect(decision.allowed).toBe(false);
    expect(decision.requested).toBe(5);
    expect(decision.cap).toBe(4);
    expect(decision.reason).toContain('5');
    expect(decision.reason).toContain('4');
    expect(decision.reason).toMatch(/split|batch|request_clarification/i);
  });

  it('respects custom cap', () => {
    const blocks = Array.from({ length: 3 }, () => taskBlock());
    expect(applyFanOutCap(blocks, 2).allowed).toBe(false);
    expect(applyFanOutCap(blocks, 3).allowed).toBe(true);
    expect(applyFanOutCap(blocks, 10).allowed).toBe(true);
  });

  it('ignores non-Task tool calls entirely', () => {
    // 6 mixed blocks but only 2 Task calls — well under default cap of 4
    const blocks = [
      otherBlock('compose_visual'),
      taskBlock(),
      otherBlock('azure_list_subscriptions'),
      otherBlock('aws_list_accounts'),
      taskBlock(),
      otherBlock('tool_search'),
    ];
    const decision = applyFanOutCap(blocks);
    expect(decision.allowed).toBe(true);
    expect(decision.requested).toBe(2);
  });

  it('handles empty input cleanly', () => {
    expect(applyFanOutCap([])).toEqual({
      allowed: true,
      requested: 0,
      cap: DEFAULT_MAX_CONCURRENT_SUBAGENTS,
    });
  });

  it('blocks at extreme fan-out (32 sub-agents — the live regression)', () => {
    // The capstone failure mode: "list every Azure subscription and run a
    // full analysis on each" — model wants 32+ parallel sub-agents.
    const blocks = Array.from({ length: 32 }, () => taskBlock());
    const decision = applyFanOutCap(blocks);
    expect(decision.allowed).toBe(false);
    expect(decision.requested).toBe(32);
    expect(decision.reason).toContain('32');
  });
});
