/**
 * Sev-0 audit (2026-05-12): PermissionService.submitApproval has NO
 * ownership check. User A creates a pending approval; user B can
 * resolve it by POSTing to /api/permissions/approvals/:id/(approve|deny)
 * with their own session (which threads userId='B'). Without an
 * ownership compare, the approval resolves for user A's tool call
 * because submitApproval only checks existence.
 *
 * Fix: submitApproval(requestId, approved, userId) MUST verify
 *   pending.toolCall.userId === userId
 * before resolving. On mismatch, log + return false.
 *
 * TDD-RED before fix.
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

function forceAskRule(ps: PermissionService, toolName: string) {
  (ps as any).rules = [
    { ruleValue: { toolName }, behavior: 'ask', source: 'test' },
  ];
  (ps as any).rulesLoaded = true;
}

describe('PermissionService.submitApproval — ownership check (Sev-0 2026-05-12)', () => {
  it('REJECTS submit when userId does NOT match the pending toolCall.userId', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 5000 });
    forceAskRule(ps, 'sensitive_tool');

    // User A initiates the ask.
    const askPromise = ps.evaluate(
      {
        toolName: 'sensitive_tool',
        serverName: 'svr',
        arguments: { do: 'something' },
        userId: 'user-A',
      } as any,
      () => {},
    );
    await Promise.resolve();
    const [requestId] = [...((ps as any).pendingAsks as Map<string, any>).keys()];

    // User B (attacker) tries to resolve A's pending request.
    const submittedByB = ps.submitApproval(requestId, true, 'user-B-attacker');
    expect(submittedByB).toBe(false);

    // The pending ask is STILL pending — B's attempt did not unblock it.
    const stillPending = (ps as any).pendingAsks.has(requestId);
    expect(stillPending).toBe(true);

    // User A resolves correctly → approval flows.
    const submittedByA = ps.submitApproval(requestId, true, 'user-A');
    expect(submittedByA).toBe(true);

    const decision = await askPromise;
    expect(decision.approved).toBe(true);
  });

  it('REJECTS submit when userId is empty / "unknown" (unauthenticated route)', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 5000 });
    forceAskRule(ps, 'sensitive_tool_2');

    const askPromise = ps.evaluate(
      {
        toolName: 'sensitive_tool_2',
        serverName: 'svr',
        arguments: {},
        userId: 'user-A',
      } as any,
      () => {},
    );
    await Promise.resolve();
    const [requestId] = [...((ps as any).pendingAsks as Map<string, any>).keys()];

    // Defaults from unauthenticated routes — must not resolve.
    expect(ps.submitApproval(requestId, true, 'unknown')).toBe(false);
    expect(ps.submitApproval(requestId, true, '')).toBe(false);

    // Cleanup
    ps.submitApproval(requestId, false, 'user-A');
    await askPromise;
  });

  it('ALLOWS submit when userId matches', async () => {
    const ps = new PermissionService(silentLogger, { timeoutMs: 5000 });
    forceAskRule(ps, 'tool_x');
    const askPromise = ps.evaluate(
      { toolName: 'tool_x', serverName: 'svr', arguments: {}, userId: 'alice' } as any,
      () => {},
    );
    await Promise.resolve();
    const [requestId] = [...((ps as any).pendingAsks as Map<string, any>).keys()];
    expect(ps.submitApproval(requestId, false, 'alice')).toBe(true);
    const decision = await askPromise;
    expect(decision.approved).toBe(false);
  });
});
