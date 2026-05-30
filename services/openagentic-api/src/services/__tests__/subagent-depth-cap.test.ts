/**
 * Sev-1 audit finding (2026-05-12): the `runSubagent` factory built by
 * `makeRunSubagentViaRecursorPerCall` had NO depth cap — a sub-agent
 * spawning sub-sub-agent → sub-sub-sub-agent etc. was only bounded by
 * the per-level iteration cap. A pathological model could fan out
 * unbounded.
 *
 * Fix: thread a `subagentDepth` slot on parentCtx. chatLoopRecursor
 * sets it to `(parent || 0) + 1` on the child ctx; the per-call factory
 * reads it and rejects dispatch when it exceeds the configured cap
 * (default 2 → parent + 1 nested level; override via
 * OPENAGENTIC_MAX_SUBAGENT_DEPTH env).
 *
 * TDD-RED: this file fails before the slot + cap land.
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
    user: { id: 'u', email: 'e', name: 'n', isAdmin: false, groups: [], authMethod: 'aad', accessToken: '', idToken: '' },
  };
  // Per-turn handles the recursor needs (any non-null values; the cap
  // test runs BEFORE the recursor unwraps these).
  ctx[RECURSOR_CTX_SLOTS.parentDeps] = {};
  ctx[RECURSOR_CTX_SLOTS.parentSequencer] = {};
  ctx[RECURSOR_CTX_SLOTS.parentTurnId] = 'turn-1';
  if (depth !== undefined) {
    ctx[RECURSOR_CTX_SLOTS.subagentDepth] = depth;
  }
  return ctx;
}

describe('subagent depth cap — Sev-1 audit 2026-05-12', () => {
  it('exposes a `subagentDepth` slot in RECURSOR_CTX_SLOTS', () => {
    expect(RECURSOR_CTX_SLOTS.subagentDepth).toBeDefined();
    expect(typeof RECURSOR_CTX_SLOTS.subagentDepth).toBe('string');
  });

  it('rejects dispatch when current depth would exceed cap (default cap=2 → reject at depth=2)', async () => {
    const runSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: () => [{ agent_type: 'r', body: 'sys', tools: [] }] as any,
    });
    // parentCtx already at depth 2 — calling again would land child at 3 > cap 2.
    const ctx = makeStubCtx(2);
    const result = await runSubagent({ role: 'r', prompt: 'p' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/depth|nesting|recurs/i);
  });

  it('allows dispatch when depth=0 (top-level → child depth=1)', async () => {
    const runSubagent = makeRunSubagentViaRecursorPerCall({
      getAgents: () => [{ agent_type: 'unknown', body: 'sys', tools: [] }] as any,
    });
    // depth=0; we don't need the recursor to actually run — we just need
    // dispatch to NOT be short-circuited by the cap. Use an unknown role
    // so the recursor returns its own "unknown agent" error AFTER passing
    // the cap check.
    const ctx = makeStubCtx(0);
    const result = await runSubagent({ role: 'definitely-not-an-agent', prompt: 'p' }, ctx);
    // The cap didn't fire; the recursor's own unknown-agent path did.
    expect(result.error).toMatch(/unknown agent type/i);
  });

  it('respects OPENAGENTIC_MAX_SUBAGENT_DEPTH env override', async () => {
    const prev = process.env.OPENAGENTIC_MAX_SUBAGENT_DEPTH;
    process.env.OPENAGENTIC_MAX_SUBAGENT_DEPTH = '5';
    try {
      const runSubagent = makeRunSubagentViaRecursorPerCall({
        getAgents: () => [{ agent_type: 'unknown-role', body: 'sys', tools: [] }] as any,
      });
      // depth=4 → child would be 5 → equal to cap → ALLOWED (cap is max,
      // child depth strictly less-than-or-equal cap).
      const ctx = makeStubCtx(4);
      const result = await runSubagent({ role: 'unknown-role-2', prompt: 'p' }, ctx);
      // Should hit the recursor's unknown-agent path, NOT the depth cap.
      expect(result.error).toMatch(/unknown agent type/i);
    } finally {
      if (prev === undefined) delete process.env.OPENAGENTIC_MAX_SUBAGENT_DEPTH;
      else process.env.OPENAGENTIC_MAX_SUBAGENT_DEPTH = prev;
    }
  });
});
