import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import { ToolApprovalGate, type ToolCallInfo } from '../services/ToolApprovalGate.js';

// UserToolTrust is an internal (un-exported) shape; mirror it locally so the
// test can seed the gate's private trust map with a faithful structure.
interface UserToolTrust {
  totalCalls: number;
  approvedCalls: number;
  deniedCalls: number;
  lastUsed: number;
  trustScore: number;
}

// ---------------------------------------------------------------------------
// Prisma is the only external dep loadConfig touches. We give each test the
// ability to drive findFirst's return value (per-key) so we can simulate a
// malformed hitl_policy row, a valid policy row, etc. — without a live DB.
// ---------------------------------------------------------------------------
const findFirstMock = vi.fn();
const createMock = vi.fn().mockResolvedValue({});
const upsertMock = vi.fn().mockResolvedValue({});

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

// Neutralise the fire-and-forget audit sink so submitApproval doesn't reach
// for the real DataAccessAuditService (which would try to persist).
const auditRecordMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/DataAccessAuditService.js', () => ({
  getDataAccessAuditService: () => ({ record: auditRecordMock }),
}));

const logger = pino({ level: 'silent' });

const mkToolCall = (toolName: string, overrides: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  toolName,
  userId: 'test-user',
  arguments: {},
  ...overrides,
});

/**
 * Seed the gate's private in-memory trust map directly. This is exactly the
 * shape loadUserTrust() would have produced from the DB, so it faithfully
 * simulates a user who has "earned trust" for a tool.
 */
function seedTrust(
  gate: ToolApprovalGate,
  userId: string,
  toolName: string,
  trust: Partial<UserToolTrust>,
): void {
  const map: Map<string, UserToolTrust> = (gate as any).userToolTrust;
  map.set(`${userId}:${toolName}`, {
    totalCalls: 0,
    approvedCalls: 0,
    deniedCalls: 0,
    lastUsed: Date.now(),
    trustScore: 0,
    ...trust,
  });
}

describe('ToolApprovalGate — fail-closed + trust-boundary coverage (untested branches)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    findFirstMock.mockReset();
    createMock.mockClear();
    upsertMock.mockClear();
    auditRecordMock.mockClear();
    // Default: no DB rows for any config key.
    findFirstMock.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // (1) Core fail-closed: MEDIUM timeout → AUTO-DENY (not auto-approve), and
  //     the result the LLM receives is a DENIED result. The existing suite
  //     only pins timeout for high/critical; pin it for the gated-medium path
  //     too, since medium is the most likely place a fail-open regression
  //     would slip in (it's the one risk level that's policy-configurable).
  // -------------------------------------------------------------------------
  test('MEDIUM-risk timeout AUTO-DENIES (fail-closed) and the LLM receives a denied result', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    const emits: Array<{ event: string; data: any }> = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data: data as any });

    // create_* matches DEFAULT_MEDIUM_RISK_PATTERNS → medium (gated by default).
    const result = await gate.evaluate(mkToolCall('create_widget'), emit);

    expect(result.riskLevel).toBe('medium');
    // The hard security invariant: timeout must DENY, never silently allow.
    expect(result.approved).toBe(false);
    expect(result.approvedBy).toBe('timeout');
    expect(result.requiresHuman).toBe(true);
    expect(result.reason).toMatch(/timed out/i);
    // And it actually surfaced an approval request — it did not bypass.
    expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined();
  });

  test('a pending approval that times out is purged from pendingApprovals (no leaked allow)', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    const result = await gate.evaluate(mkToolCall('create_widget'), () => {});
    expect(result.approved).toBe(false);
    // After auto-deny, nothing should remain pending (a leaked entry could be
    // resolved-as-approved later by a stale submitApproval).
    expect(gate.getPendingApprovals()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // (2) Explicit DENY blocks the tool — for a MEDIUM call (existing only
  //     denies a HIGH call). Asserts the denied decision is recorded against
  //     the calling user's trust as a denial, and the audit sink is hit.
  // -------------------------------------------------------------------------
  test('explicit DENY of a MEDIUM call blocks it AND records the denial in trust + audit', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 5_000 });
    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });

    const pending = gate.evaluate(mkToolCall('update_record', { userId: 'alice' }), emit);
    await vi.waitFor(
      () => expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined(),
      { timeout: 2_000 },
    );
    const req = emits.find(e => e.event === 'mcp_approval_required')!.data as any;

    const accepted = gate.submitApproval(req.requestId, false, 'reviewer-bob');
    expect(accepted).toBe(true);

    const result = await pending;
    expect(result.approved).toBe(false);
    expect(result.approvedBy).toBe('reviewer-bob');
    expect(result.riskLevel).toBe('medium');

    // The denial was recorded for learning — a denial must NOT inflate trust.
    const trust = gate.getUserTrustData()['alice:update_record'];
    expect(trust).toBeDefined();
    expect(trust.deniedCalls).toBe(1);
    expect(trust.approvedCalls).toBe(0);
    expect(trust.trustScore).toBe(0);

    // The deny decision was sent to the immutable audit trail.
    expect(auditRecordMock).toHaveBeenCalledTimes(1);
    const auditArg = auditRecordMock.mock.calls[0][0];
    expect(auditArg.action).toBe('approval_decision');
    expect(auditArg.details.approved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (3) Explicit APPROVE resolves a MEDIUM call as allowed and records an
  //     approval (positive learning path).
  // -------------------------------------------------------------------------
  test('explicit APPROVE of a MEDIUM call allows it AND records the approval', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 5_000 });
    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });

    const pending = gate.evaluate(mkToolCall('deploy_service', { userId: 'carol' }), emit);
    await vi.waitFor(
      () => expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined(),
      { timeout: 2_000 },
    );
    const req = emits.find(e => e.event === 'mcp_approval_required')!.data as any;
    gate.submitApproval(req.requestId, true, 'reviewer-dan');

    const result = await pending;
    expect(result.approved).toBe(true);
    expect(result.approvedBy).toBe('reviewer-dan');
    expect(result.riskLevel).toBe('medium');

    const trust = gate.getUserTrustData()['carol:deploy_service'];
    expect(trust.approvedCalls).toBe(1);
    expect(trust.trustScore).toBe(1);
  });

  // -------------------------------------------------------------------------
  // (4) THE security pin: user-trust auto-approve must apply ONLY to MEDIUM.
  //     A "fully trusted" user (trust=1.0, 50 calls) must STILL be gated for
  //     HIGH and CRITICAL — trust never short-circuits structural risk.
  // -------------------------------------------------------------------------
  test('a fully-trusted user is STILL gated for HIGH risk (trust never bypasses HIGH)', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    // Earn maximum trust for this exact (user, tool) pair.
    seedTrust(gate, 'trusted-user', 'azure_delete_resource_group', {
      totalCalls: 50,
      approvedCalls: 50,
      trustScore: 1.0,
    });

    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });
    const result = await gate.evaluate(
      mkToolCall('azure_delete_resource_group', { userId: 'trusted-user' }),
      emit,
    );

    expect(result.riskLevel).toBe('high');
    // Must NOT be trust-approved — it had to gate and (with no human) timed out.
    expect(result.approvedBy).not.toBe('trust');
    expect(result.approved).toBe(false);
    expect(result.approvedBy).toBe('timeout');
    expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined();
  });

  test('a fully-trusted user is STILL gated for CRITICAL risk', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    seedTrust(gate, 'trusted-user', 'bulk_delete_users', {
      totalCalls: 50,
      approvedCalls: 50,
      trustScore: 1.0,
    });
    const result = await gate.evaluate(
      mkToolCall('bulk_delete_users', { userId: 'trusted-user' }),
      () => {},
    );
    expect(result.riskLevel).toBe('critical');
    expect(result.approvedBy).not.toBe('trust');
    expect(result.approved).toBe(false);
    expect(result.approvedBy).toBe('timeout');
  });

  // -------------------------------------------------------------------------
  // (4b) Positive path: trust DOES auto-approve a MEDIUM call once both
  //      thresholds are met (>= minCallsForTrust AND >= trustThreshold).
  // -------------------------------------------------------------------------
  test('trusted user auto-approves a MEDIUM call (trust > 0.85 AND calls >= 5)', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 5_000 });
    seedTrust(gate, 'power-user', 'create_widget', {
      totalCalls: 20,
      approvedCalls: 20,
      trustScore: 0.95, // > 0.85 threshold
    });

    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });
    const result = await gate.evaluate(
      mkToolCall('create_widget', { userId: 'power-user' }),
      emit,
    );

    expect(result.riskLevel).toBe('medium');
    expect(result.approved).toBe(true);
    expect(result.approvedBy).toBe('trust');
    expect(result.requiresHuman).toBe(false);
    // Trust auto-approve must NOT emit a human-approval prompt.
    expect(emits.find(e => e.event === 'mcp_approval_required')).toBeUndefined();
  });

  test('trust BELOW threshold (0.84) does NOT auto-approve MEDIUM — it still gates', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    seedTrust(gate, 'borderline-user', 'create_widget', {
      totalCalls: 20,
      approvedCalls: 17,
      trustScore: 0.84, // just under the 0.85 threshold
    });
    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });
    const result = await gate.evaluate(
      mkToolCall('create_widget', { userId: 'borderline-user' }),
      emit,
    );
    expect(result.approvedBy).not.toBe('trust');
    expect(result.approved).toBe(false); // timed out (gated, no human)
    expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined();
  });

  test('high trust but FEWER than minCallsForTrust (4 < 5) does NOT auto-approve MEDIUM', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 30 });
    seedTrust(gate, 'new-user', 'create_widget', {
      totalCalls: 4, // below minCallsForTrust=5
      approvedCalls: 4,
      trustScore: 1.0,
    });
    const result = await gate.evaluate(
      mkToolCall('create_widget', { userId: 'new-user' }),
      () => {},
    );
    expect(result.approvedBy).not.toBe('trust');
    expect(result.approved).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (5) mediumRiskRequiresApproval default (true) gates MEDIUM. And the
  //     internal requiresApproval() switch fails closed for HIGH/CRITICAL
  //     regardless of the policy flag.
  // -------------------------------------------------------------------------
  test('default mediumRiskRequiresApproval=true gates MEDIUM; HIGH/CRITICAL always gate', () => {
    const gate = new ToolApprovalGate(logger);
    const requires = (level: string) => (gate as any).requiresApproval(level);
    expect(requires('low')).toBe(false);
    expect(requires('medium')).toBe(true); // default true
    expect(requires('high')).toBe(true);
    expect(requires('critical')).toBe(true);
  });

  test('even with mediumRiskRequiresApproval flipped OFF, HIGH/CRITICAL still require approval', () => {
    const gate = new ToolApprovalGate(logger);
    // Simulate an admin disabling medium gating via policy.
    (gate as any).mediumRiskRequiresApproval = false;
    const requires = (level: string) => (gate as any).requiresApproval(level);
    expect(requires('medium')).toBe(false); // admin allowed it
    // Structural risk is NOT configurable — must stay gated.
    expect(requires('high')).toBe(true);
    expect(requires('critical')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // (6) Malformed override pattern surfaces an error rather than silently
  //     persisting an un-compilable rule (which would otherwise be skipped at
  //     classify time → fail-open hole). This is the line-670 throw branch.
  // -------------------------------------------------------------------------
  test('setToolRiskOverride throws on a malformed regex (does NOT silently persist)', async () => {
    const gate = new ToolApprovalGate(logger);
    // "[" is an unterminated character class — invalid regex.
    await expect(gate.setToolRiskOverride('[invalid(regex', 'critical')).rejects.toThrow(
      /Invalid tool risk override pattern/i,
    );
    // The bad rule was rejected BEFORE persistence — no upsert occurred.
    expect(upsertMock).not.toHaveBeenCalled();
    // And nothing was added to the in-memory override list.
    expect(gate.getToolRiskOverrides()).toHaveLength(0);
  });

  test('a valid override IS persisted and applied at classify time', async () => {
    const gate = new ToolApprovalGate(logger);
    // Force a normally-LOW read tool to CRITICAL via admin override.
    await gate.setToolRiskOverride('^list_secrets$', 'critical');
    expect(upsertMock).toHaveBeenCalledTimes(1);
    // dbOverridesLoaded must be set for classifyFromDB to consult overrides.
    (gate as any).dbOverridesLoaded = true;
    const risk = (gate as any).classifyRisk(mkToolCall('list_secrets'));
    expect(risk).toBe('critical');
  });

  test('submitApproval for an unknown/duplicate request id returns false (no phantom allow)', () => {
    const gate = new ToolApprovalGate(logger);
    // No such pending request — must NOT resolve anything as approved.
    expect(gate.submitApproval('approval-does-not-exist', true, 'attacker')).toBe(false);
    // The audit sink is not invoked for a non-existent request.
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (7) loadConfig DB-override parse safety: a malformed hitl_policy JSON must
  //     fall back to the safe in-memory defaults — it must NOT crash the gate
  //     OR silently disable gating. The whole point: a corrupt policy row
  //     can't open a fail-open hole.
  // -------------------------------------------------------------------------
  test('loadConfig with a malformed hitl_policy JSON falls back to safe defaults (gating stays ON)', async () => {
    // hitl_policy row exists but its value is un-parseable JSON.
    findFirstMock.mockImplementation(async (arg: any) => {
      if (arg?.where?.key === 'hitl_policy') {
        return { key: 'hitl_policy', value: '{ this is not valid json ]' };
      }
      return null;
    });

    const gate = new ToolApprovalGate(logger);
    // Must not throw — loadConfig swallows + warns, keeping defaults.
    await expect(gate.loadConfig()).resolves.toBeUndefined();

    // The defaults survived: MEDIUM still requires approval, timeout unchanged.
    expect((gate as any).mediumRiskRequiresApproval).toBe(true);
    expect((gate as any).requiresApproval('medium')).toBe(true);
    expect((gate as any).requiresApproval('high')).toBe(true);
    expect((gate as any).defaultTimeoutMs).toBe(120_000);
    // Trust thresholds were NOT loosened by the bad row.
    expect((gate as any).trustThreshold).toBe(0.85);
    expect((gate as any).minCallsForTrust).toBe(5);
  });

  test('loadConfig with a VALID hitl_policy applies its values', async () => {
    findFirstMock.mockImplementation(async (arg: any) => {
      if (arg?.where?.key === 'hitl_policy') {
        return {
          key: 'hitl_policy',
          value: JSON.stringify({
            mediumRiskRequiresApproval: false,
            timeoutMs: 4242,
            trustThreshold: 0.5,
            minCallsForTrust: 2,
          }),
        };
      }
      return null;
    });
    const gate = new ToolApprovalGate(logger);
    await gate.loadConfig();
    expect((gate as any).mediumRiskRequiresApproval).toBe(false);
    expect((gate as any).defaultTimeoutMs).toBe(4242);
    expect((gate as any).trustThreshold).toBe(0.5);
    expect((gate as any).minCallsForTrust).toBe(2);
    // Even with a permissive policy, HIGH/CRITICAL stay structurally gated.
    expect((gate as any).requiresApproval('high')).toBe(true);
    expect((gate as any).requiresApproval('critical')).toBe(true);
  });

  test('loadConfig with a malformed tool_risk_overrides JSON keeps overrides empty (no fail-open)', async () => {
    findFirstMock.mockImplementation(async (arg: any) => {
      if (arg?.where?.key === 'tool_risk_overrides') {
        return { key: 'tool_risk_overrides', value: 'NOT-JSON' };
      }
      return null;
    });
    const gate = new ToolApprovalGate(logger);
    await expect(gate.loadConfig()).resolves.toBeUndefined();
    // A corrupt overrides row must not inject bogus rules.
    expect(gate.getToolRiskOverrides()).toHaveLength(0);
    // Default classification still works (delete → high) — gate not disabled.
    expect((gate as any).classifyRisk(mkToolCall('azure_delete_resource_group'))).toBe('high');
  });
});
