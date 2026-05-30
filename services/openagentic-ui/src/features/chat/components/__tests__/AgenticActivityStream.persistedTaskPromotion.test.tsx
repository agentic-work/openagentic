/**
 * Sev-0 #841 — persisted-reload Task tool_use blocks must promote to
 * agent_group so SubAgentCard renders on page reload.
 *
 * Bug surface (verified live 2026-05-14 in session_1778779339525_gcw7g81os
 * on 0.7.1-07daee05): the persisted assistant message has 3
 * `sub_agent_completed` viz frames + 3 `tool_use` Task blocks. The merge
 * helper lifts the 3 entries into `subAgentsByMessageId` and the
 * MessageBubble memo (after #840) re-renders correctly — but the inline
 * SubAgentCards STILL never mount.
 *
 * Root cause: persisted Task tool_use blocks come back from the
 * steps→adapter conversion with NO `agentId` / `agentRole` (those fields
 * only get stamped by the live streaming reducer when a sub_agent_started
 * envelope arrives). The AAS group-builder then drops them via the
 * T1-hide filter because `Task` is in T1_TOOL_NAMES — zero cards.
 *
 * Fix: promote orphan persisted Task blocks into agent_group by pairing
 * the i-th unpromoted Task block with the i-th SubAgentEntry from
 * `subAgents`. Each promoted block synthesizes `agentRole = sa.role` so
 * the existing agent_group → SubAgentCard render path lights up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'AgenticActivityStream', 'AgenticActivityStream.tsx');

describe('Sev-0 #841 — AAS persisted Task → agent_group promotion', () => {
  const src = readFileSync(SRC, 'utf8');

  it('mentions #841 promotion logic with rationale', () => {
    expect(src).toMatch(/#841/);
    expect(src).toMatch(/promot/i);
  });

  it('checks block.toolName === "Task" inside the group-builder loop', () => {
    // Promotion gate must literally match the Task tool name string —
    // a regex on toolCalls won't catch persisted reload blocks.
    expect(src).toMatch(/block\.toolName\s*===\s*['"]Task['"]/);
  });

  it('walks subAgents array sequentially via an index counter', () => {
    // The pairing is positional (i-th persisted Task ↔ i-th SubAgentEntry).
    // We verify there is an index counter (any of common variable names)
    // and it gates against subAgents.length.
    expect(src).toMatch(/nextSubAgentIndex|nextSAIndex|saIndex|subAgentCursor/);
    expect(src).toMatch(/<\s*subAgents(?:ForPromotion)?\.length/);
  });

  it('synthesizes agentRole on the promoted block (not the original)', () => {
    // Spread + override pattern — never mutate the original block.
    expect(src).toMatch(/agentRole:\s*sa\.role/);
    // Spread of block (any variant) must occur on the same line region.
    expect(src).toMatch(/\.\.\.block[,\s}]/);
  });

  it('skips promotion when block already has agentRole (live streaming path unchanged)', () => {
    // The check `!block.agentRole` is what gates the promotion — without
    // it, live streaming would re-promote already-correct blocks and
    // double-consume entries from subAgents.
    expect(src).toMatch(/!block\.agentRole/);
  });

  it('keeps Task in T1_TOOL_NAMES (T1-hide rule still applies when no SubAgentEntry available)', () => {
    // The fix is additive — Task remains a T1 hidden tool. Promotion
    // only fires when there's a matching SubAgentEntry; otherwise the
    // T1-hide filter still drops the orphan block (graceful default).
    expect(src).toMatch(/T1_TOOL_NAMES[\s\S]{0,500}?['"]Task['"]/);
  });
});
