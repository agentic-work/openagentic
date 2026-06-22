/**
 * Sev-1 audit (2026-05-12) — concurrent sub-agent dispatch race.
 *
 * makeRunSubagentViaRecursorPerCall (430c261c) currently MUTATES the
 * shared parentCtx via `(parentCtx as any)[RECURSOR_CTX_SLOTS.subagentDepth] = childDepth`
 * BEFORE recursion. When the parent chatLoop dispatches N sub-agents in
 * parallel from the SAME turn (Task tool fan-out), they all read the
 * same currentDepth and write the same childDepth — siblings all carry
 * the same depth, and their grandchildren mis-classify too.
 *
 * Worse: if call 1 writes depth=1, then call 2 reads depth=1 (call 1's
 * write!), then call 2 writes depth=2 — call 2's grandchild thinks
 * it's at depth=3 even though it's only one level deep.
 *
 * Fix: do NOT mutate parentCtx. Build a per-call shallow childCtx clone
 * with the new subagentDepth value, and pass that to
 * makeRunSubagentViaRecursor.
 *
 * TDD-RED before fix.
 */

import { describe, it, expect } from 'vitest';
import {
  RECURSOR_CTX_SLOTS,
  makeRunSubagentViaRecursorPerCall,
} from '../makeRunSubagentViaRecursor.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

function makeStubCtx(depth?: number): any {
  const ctx: any = {
    emit: () => {},
    logger: silentLogger,
    sessionId: 's',
    userId: 'u',
    user: {
      id: 'u',
      email: 'e',
      name: 'n',
      isAdmin: false,
      groups: [],
      authMethod: 'aad',
      accessToken: '',
      idToken: '',
    },
  };
  ctx[RECURSOR_CTX_SLOTS.parentDeps] = {};
  ctx[RECURSOR_CTX_SLOTS.parentSequencer] = {};
  ctx[RECURSOR_CTX_SLOTS.parentTurnId] = 'turn-1';
  if (depth !== undefined) {
    ctx[RECURSOR_CTX_SLOTS.subagentDepth] = depth;
  }
  return ctx;
}

describe('subagent depth cap — parallel dispatch race (Sev-1 2026-05-12)', () => {
  it('parallel sub-agent dispatch does NOT corrupt parentCtx.subagentDepth', async () => {
    const runSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: () => [{ agent_type: 'unknown', body: 'sys', tools: [] }] as any,
    });
    const parentCtx = makeStubCtx(0);

    // Three parallel "Task" dispatches from the same parent turn.
    // Each should see currentDepth=0 and pass childDepth=1 to the recursor.
    // The recursor will fail (unknown agent type), but we don't care —
    // the assertion is that parentCtx remains UNMUTATED.
    const beforeDepth = parentCtx[RECURSOR_CTX_SLOTS.subagentDepth];
    await Promise.all([
      runSubagent({ role: 'a', prompt: 'p1' }, parentCtx),
      runSubagent({ role: 'b', prompt: 'p2' }, parentCtx),
      runSubagent({ role: 'c', prompt: 'p3' }, parentCtx),
    ]);
    const afterDepth = parentCtx[RECURSOR_CTX_SLOTS.subagentDepth];

    // parentCtx should be IMMUTABLE w.r.t. depth — each call clones into
    // a childCtx instead. If parentCtx was mutated, afterDepth would have
    // some non-zero value (depending on serialization order).
    expect(afterDepth).toBe(beforeDepth);
  });

  it('serial dispatch from same parentCtx still increments the CHILD depth correctly', async () => {
    // The depth-cap test still passes — each call computes childDepth
    // based on currentDepth in parentCtx (or zero), not a sibling's
    // residual mutation.
    const runSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: () => [{ agent_type: 'r', body: 'sys', tools: [] }] as any,
    });
    const parentCtx = makeStubCtx(0); // top-level

    // First call: childDepth would be 1 → allowed
    // (recursor fails on its own "unknown agent" path; we expect that error,
    //  NOT a depth-cap error)
    const r1 = await runSubagent({ role: 'unknown', prompt: 'x' }, parentCtx);
    expect(r1.error).toMatch(/unknown agent type/i);

    // parentCtx still depth=0 after first call (no mutation)
    expect(parentCtx[RECURSOR_CTX_SLOTS.subagentDepth]).toBe(0);

    // Second call from the SAME parent — also allowed, also fails on
    // unknown agent (not depth cap).
    const r2 = await runSubagent({ role: 'unknown2', prompt: 'y' }, parentCtx);
    expect(r2.error).toMatch(/unknown agent type/i);
    expect(parentCtx[RECURSOR_CTX_SLOTS.subagentDepth]).toBe(0);
  });

  it('STILL caps when parentCtx.subagentDepth is already at the limit', async () => {
    // Regression — the race fix doesn't break the depth cap itself.
    const runSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: () => [{ agent_type: 'r', body: 'sys', tools: [] }] as any,
    });
    const parentCtx = makeStubCtx(2); // already at default cap
    const result = await runSubagent({ role: 'r', prompt: 'p' }, parentCtx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/depth|nesting|recurs/i);
  });
});
