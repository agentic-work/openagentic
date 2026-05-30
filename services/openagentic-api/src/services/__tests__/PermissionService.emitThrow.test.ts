/**
 * Sev-0 audit fix #86 (2026-05-12): `PermissionService.askForApproval`
 * emits the approval frame BEFORE arming the approval-wait emitter. If
 * the emit call throws synchronously, the function never reaches
 * `waitForApproval(requestId)` — the askEmitter listener is never
 * registered, the UI's POST has no resolver, and the dispatch hangs for
 * the full 120s timeout (or longer if the upstream read timeout is
 * shorter).
 *
 * Q1-fix-8 (2026-05-12) — service used to emit THREE frames
 * (mcp_approval_required, hitl_approval, `e:` opcode); collapsed to
 * ONE canonical `hitl_approval` to stop the dual-card-render bug.
 *
 * Live 36-cell matrix evidence (2026-05-12) showed pattern_save +
 * pattern_recall hitting 150s read-timeout on AIF and "Approval timed
 * out — automatically denied" on Ollama — both consistent with this
 * failure mode.
 *
 * Fix: wrap each emit() call in try/catch + log warning + continue.
 * The waitForApproval listener arms regardless, and the in-memory
 * approval store can still resolve via /api/permissions/approvals/:id
 * + UI button click.
 *
 * TDD-RED before fix: throwing emit bails askForApproval early
 * (throws to caller). After fix: askForApproval returns the
 * waitForApproval promise, which can resolve normally via submitApproval.
 */

import { describe, it, expect } from 'vitest';
import { PermissionService } from '../PermissionService.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: function () { return this; },
} as any;

/**
 * Force a `'ask'` path by injecting a single rule that matches the
 * synthetic tool name. PermissionService.rules is private; we mutate
 * via the public `loadConfig` test seam if it exists, or fall back to
 * a direct assignment that the freeze test cage tolerates.
 */
function forceAskRule(ps: PermissionService, toolName: string) {
  (ps as any).rules = [
    {
      ruleValue: { toolName },
      behavior: 'ask',
      source: 'test',
    },
  ];
  (ps as any).rulesLoaded = true;
}

describe('PermissionService.evaluate — emit fault tolerance (Sev-0 #86)', () => {
  it('survives a throwing emit on `hitl_approval` — evaluate still returns a pending promise', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 500 });
    forceAskRule(ps, 'tool_a');

    let firstEmitFired = false;
    const throwingEmit = (frame: string, _payload: unknown) => {
      // Q1-fix-8 — canonical frame; legacy `mcp_approval_required` ripped.
      if (frame === 'hitl_approval') {
        firstEmitFired = true;
        throw new Error('synthetic stream-write failure');
      }
    };

    const askPromise = ps.evaluate(
      { toolName: 'tool_a', serverName: 'test', arguments: { x: 1 }, userId: 'u' } as any,
      throwingEmit,
    );

    // Wait one tick for the in-flight ask to settle into pendingAsks.
    await Promise.resolve();
    expect(firstEmitFired).toBe(true);

    const pending = (ps as any).pendingAsks as Map<string, any>;
    expect(pending.size).toBe(1);
    const [requestId] = [...pending.keys()];
    const submitted = ps.submitApproval(requestId, true, 'u');
    expect(submitted).toBe(true);

    const decision = await askPromise;
    expect(decision.behavior).toBe('allow');
    expect(decision.approved).toBe(true);
  });

  it('survives a throwing emit on `hitl_approval` (second emit) — same recovery path', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 500 });
    forceAskRule(ps, 'tool_b');
    const throwingEmit = (frame: string, _payload: unknown) => {
      if (frame === 'hitl_approval') throw new Error('synthetic failure 2');
    };
    const askPromise = ps.evaluate(
      { toolName: 'tool_b', serverName: 'test', arguments: {}, userId: 'u' } as any,
      throwingEmit,
    );
    await Promise.resolve();
    const [requestId] = [...((ps as any).pendingAsks as Map<string, any>).keys()];
    ps.submitApproval(requestId, false, 'u');
    const decision = await askPromise;
    expect(decision.behavior).toBe('deny');
  });

  it('all three emits throwing: evaluate still completes via submitApproval', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 500 });
    forceAskRule(ps, 'tool_c');
    const throwingEmit = () => {
      throw new Error('every emit throws');
    };
    const askPromise = ps.evaluate(
      { toolName: 'tool_c', serverName: 'test', arguments: {}, userId: 'u' } as any,
      throwingEmit,
    );
    await Promise.resolve();
    const [requestId] = [...((ps as any).pendingAsks as Map<string, any>).keys()];
    ps.submitApproval(requestId, true, 'u');
    const decision = await askPromise;
    expect(decision.approved).toBe(true);
  });

  it('all three emits throwing AND no submitApproval: 500ms timeout fires (deny)', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 500 });
    forceAskRule(ps, 'tool_d');
    const askPromise = ps.evaluate(
      { toolName: 'tool_d', serverName: 'test', arguments: {}, userId: 'u' } as any,
      () => { throw new Error('all emits fail'); },
    );
    const start = Date.now();
    const decision = await askPromise;
    const elapsed = Date.now() - start;
    expect(decision.behavior).toBe('deny');
    expect(decision.approvedBy).toMatch(/timeout/i);
    // ≥ 500ms (the configured timeout) and ≪ 2000ms (we set short
    // timeoutMs precisely so this test stays fast).
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(2000);
  });
});
