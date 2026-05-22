/**
 * #508 Phase 3 — RegistryWriter is the single write SoT for model registry mutations.
 *
 * Spec: docs/superpowers/specs/2026-04-29-provider-model-registry-fedramp-overhaul.md
 *   §5.2 lifecycle state machine
 *   §5.3 single writer contract
 *   §5.6 audit semantics
 *
 * Contract:
 *   - Every method writes ONE audit-log row inside the same prisma.$transaction
 *     as the registry mutation. Audit row + registry row are atomic.
 *   - Lifecycle transitions enforce legal state machine. Illegal moves throw.
 *   - propose→approve enforces separation of duty: requested_by != approved_by.
 *   - The audit-log table is APPEND-ONLY at DB level (REVOKE UPDATE/DELETE in
 *     Phase 1 migration). Writer NEVER updates an existing audit row.
 *   - signature is left null — Phase 8 integrity hashing will populate it.
 *
 * Test style: structurally mock the prisma client via vi.fn() to capture
 * BOTH the registry-row mutation AND the audit-log create. The
 * $transaction(callback) form runs the callback with a tx client; we set
 * the tx client to be the same mocked surface so the assertions work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  modelRoleAssignment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  modelRegistryAuditLog: {
    create: vi.fn(),
  },
  lLMProvider: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  // $transaction(callback) form: invoke callback with the same mock surface
  // so the writer's tx-scoped calls land on the same vi.fn() spies.
  $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
};

vi.mock('../../../utils/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  RegistryWriter,
  IllegalStateTransitionError,
  SeparationOfDutyViolationError,
} from '../RegistryWriter.js';
import { RegistryRowNotFoundError } from '../RegistryReader.js';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'row-1',
    role: 'chat',
    model: 'sonnet-4-6',
    provider: 'aws-bedrock',
    provider_id: 'prov-1',
    state: 'active',
    enabled: true,
    priority: 1,
    capabilities: { chat: true, tools: true },
    current_revision: 1,
    proposed_by: 'alice',
    proposed_at: new Date('2026-04-01T00:00:00Z'),
    approved_by: 'bob',
    approved_at: new Date('2026-04-02T00:00:00Z'),
    cost_per_input_token_usd: null,
    cost_per_output_token_usd: null,
    deprecated_at: null,
    retention_until: null,
    ...overrides,
  };
}

describe('RegistryWriter — #508 Phase 3 single write SoT', () => {
  let writer: RegistryWriter;

  beforeEach(() => {
    Object.values(prismaMock.modelRoleAssignment).forEach((fn: any) => fn.mockReset());
    prismaMock.modelRegistryAuditLog.create.mockReset();
    prismaMock.lLMProvider.findUnique.mockReset();
    prismaMock.lLMProvider.findFirst.mockReset();
    prismaMock.$transaction.mockClear();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    writer = new RegistryWriter();
  });

  // ──────────────────────────────────────────────────────────
  // propose
  // ──────────────────────────────────────────────────────────
  describe('propose', () => {
    it('inserts a new registry row in state=proposed and writes a PROPOSE audit row in one transaction', async () => {
      const created = makeRow({ id: 'r-new', state: 'proposed', enabled: false, current_revision: 1 });
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null); // no existing duplicate
      prismaMock.modelRoleAssignment.create.mockResolvedValueOnce(created);
      prismaMock.modelRegistryAuditLog.create.mockResolvedValueOnce({ id: 'a-1' });

      const result = await writer.propose({
        tenant_id: 't-1',
        provider_id: 'prov-1',
        model: 'sonnet-4-6',
        role: 'chat',
        requested_by: 'alice',
        reason: 'New model rolled out by AWS',
      });

      expect(result.id).toBe('r-new');
      expect(result.state).toBe('proposed');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.modelRoleAssignment.create).toHaveBeenCalledTimes(1);
      const createArg = prismaMock.modelRoleAssignment.create.mock.calls[0][0];
      expect(createArg.data.state).toBe('proposed');
      expect(createArg.data.proposed_by).toBe('alice');
      expect(createArg.data.role).toBe('chat');
      expect(createArg.data.model).toBe('sonnet-4-6');
      expect(createArg.data.provider_id).toBe('prov-1');

      expect(prismaMock.modelRegistryAuditLog.create).toHaveBeenCalledTimes(1);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('PROPOSE');
      expect(auditArg.data.user_id).toBe('alice');
      expect(auditArg.data.registry_id).toBe('r-new');
      expect(auditArg.data.before_state).toBeNull();
      expect(auditArg.data.after_state).toBeTruthy();
      expect(auditArg.data.reason).toBe('New model rolled out by AWS');
    });

    it('throws if the provider_id does not exist (or is soft-deleted)', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce(null);
      await expect(
        writer.propose({
          tenant_id: 't-1',
          provider_id: 'missing-prov',
          model: 'sonnet',
          role: 'chat',
          requested_by: 'alice',
          reason: 'r',
        }),
      ).rejects.toThrow(/provider/i);
    });

    it('throws if the provider is soft-deleted', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({
        id: 'prov-1', name: 'aws-bedrock', deleted_at: new Date('2026-04-28T00:00:00Z'),
      });
      await expect(
        writer.propose({
          tenant_id: 't-1',
          provider_id: 'prov-1',
          model: 'sonnet',
          role: 'chat',
          requested_by: 'alice',
          reason: 'r',
        }),
      ).rejects.toThrow(/soft-deleted|deleted/i);
    });

    it('preserves tenant scoping: passes tenant_id into both the row and audit-log creates', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValueOnce(null);
      prismaMock.modelRoleAssignment.create.mockResolvedValueOnce(makeRow({ id: 'r-new', state: 'proposed' }));

      await writer.propose({
        tenant_id: 't-42',
        provider_id: 'prov-1',
        model: 'sonnet',
        role: 'chat',
        requested_by: 'alice',
        reason: 'r',
      });

      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.tenant_id).toBe('t-42');
    });
  });

  // ──────────────────────────────────────────────────────────
  // approve
  // ──────────────────────────────────────────────────────────
  describe('approve', () => {
    it('PROPOSED → APPROVED, sets approved_by/approved_at/approval_reason, writes APPROVE audit row', async () => {
      const before = makeRow({ id: 'r-1', state: 'proposed', proposed_by: 'alice', approved_by: null, approved_at: null });
      const after = makeRow({ id: 'r-1', state: 'approved', proposed_by: 'alice', approved_by: 'bob', approval_reason: 'LGTM' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.approve('r-1', 'bob', 'LGTM');

      expect(result.state).toBe('approved');
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.where.id).toBe('r-1');
      expect(updArg.data.state).toBe('approved');
      expect(updArg.data.approved_by).toBe('bob');
      expect(updArg.data.approval_reason).toBe('LGTM');
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('APPROVE');
      expect(auditArg.data.user_id).toBe('bob');
      expect(auditArg.data.before_state.state).toBe('proposed');
      expect(auditArg.data.after_state.state).toBe('approved');
      expect(auditArg.data.diff).toBeTruthy();
    });

    it('throws SeparationOfDutyViolationError when requested_by === approved_by', async () => {
      const row = makeRow({ id: 'r-1', state: 'proposed', proposed_by: 'alice' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);

      await expect(writer.approve('r-1', 'alice', 'self-approve')).rejects.toBeInstanceOf(
        SeparationOfDutyViolationError,
      );
      expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
      expect(prismaMock.modelRegistryAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws IllegalStateTransitionError when row is already active', async () => {
      const row = makeRow({ id: 'r-1', state: 'active', proposed_by: 'alice' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.approve('r-1', 'bob', 'why')).rejects.toBeInstanceOf(
        IllegalStateTransitionError,
      );
    });

    it('throws RegistryRowNotFoundError when row is missing', async () => {
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(writer.approve('missing', 'bob', 'r')).rejects.toBeInstanceOf(RegistryRowNotFoundError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // reject
  // ──────────────────────────────────────────────────────────
  describe('reject', () => {
    it('PROPOSED → DISPOSED (the deleted-state for audit retention) and writes REJECT audit row', async () => {
      // Choice: spec §5.2 diagram says reject leads to "(deleted)". The Phase 1
      // enum has no `rejected` value but does have `disposed`. We set state to
      // disposed + populate rejected_by/rejected_at/rejection_reason so the audit
      // chain captures the rejection intent without a separate enum value.
      const before = makeRow({ id: 'r-1', state: 'proposed', proposed_by: 'alice' });
      const after = makeRow({ id: 'r-1', state: 'disposed', rejected_by: 'bob', rejection_reason: 'wrong region' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.reject('r-1', 'bob', 'wrong region');

      expect(result.state).toBe('disposed');
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.state).toBe('disposed');
      expect(updArg.data.rejected_by).toBe('bob');
      expect(updArg.data.rejection_reason).toBe('wrong region');
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('REJECT');
      expect(auditArg.data.user_id).toBe('bob');
      expect(auditArg.data.reason).toBe('wrong region');
    });

    it('throws IllegalStateTransitionError when row is not in proposed state', async () => {
      const row = makeRow({ id: 'r-1', state: 'active', proposed_by: 'alice' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.reject('r-1', 'bob', 'r')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });

    it('throws RegistryRowNotFoundError when row is missing', async () => {
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(writer.reject('missing', 'bob', 'r')).rejects.toBeInstanceOf(RegistryRowNotFoundError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // enable
  // ──────────────────────────────────────────────────────────
  describe('enable', () => {
    it('sets enabled=true on a row in state=approved and logs ENABLE', async () => {
      const before = makeRow({ id: 'r-1', state: 'approved', enabled: false });
      const after = makeRow({ id: 'r-1', state: 'approved', enabled: true });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.enable('r-1', 'bob');

      expect(result.enabled).toBe(true);
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.enabled).toBe(true);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('ENABLE');
      expect(auditArg.data.user_id).toBe('bob');
    });

    it('also works on state=active (idempotent intent log)', async () => {
      const before = makeRow({ id: 'r-1', state: 'active', enabled: true });
      const after = makeRow({ id: 'r-1', state: 'active', enabled: true });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      await writer.enable('r-1', 'bob');
      expect(prismaMock.modelRegistryAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('throws IllegalStateTransitionError when row is in proposed state', async () => {
      const row = makeRow({ id: 'r-1', state: 'proposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.enable('r-1', 'bob')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });

    it('throws IllegalStateTransitionError when row is in deprecated state', async () => {
      const row = makeRow({ id: 'r-1', state: 'deprecated' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.enable('r-1', 'bob')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // disable
  // ──────────────────────────────────────────────────────────
  describe('disable', () => {
    it('sets enabled=false on a row in state=active and logs DISABLE', async () => {
      const before = makeRow({ id: 'r-1', state: 'active', enabled: true });
      const after = makeRow({ id: 'r-1', state: 'active', enabled: false });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.disable('r-1', 'bob', 'over budget');

      expect(result.enabled).toBe(false);
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.enabled).toBe(false);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('DISABLE');
      expect(auditArg.data.reason).toBe('over budget');
    });

    it('throws IllegalStateTransitionError when row is in proposed state', async () => {
      const row = makeRow({ id: 'r-1', state: 'proposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.disable('r-1', 'bob', 'r')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // deprecate
  // ──────────────────────────────────────────────────────────
  describe('deprecate', () => {
    it('ACTIVE → DEPRECATED, sets deprecated_at + retention_until=+90d, logs DEPRECATE', async () => {
      const before = makeRow({ id: 'r-1', state: 'active' });
      const after = makeRow({ id: 'r-1', state: 'deprecated' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const t0 = Date.now();
      const result = await writer.deprecate('r-1', 'bob', 'EOL by vendor');
      const t1 = Date.now();

      expect(result.state).toBe('deprecated');
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.state).toBe('deprecated');
      expect(updArg.data.deprecated_at).toBeInstanceOf(Date);
      expect(updArg.data.deprecation_reason).toBe('EOL by vendor');
      expect(updArg.data.retention_until).toBeInstanceOf(Date);
      // retention_until should be ~90 days after deprecated_at
      const dep = (updArg.data.deprecated_at as Date).getTime();
      const ret = (updArg.data.retention_until as Date).getTime();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      expect(ret - dep).toBe(ninetyDaysMs);
      expect(dep).toBeGreaterThanOrEqual(t0);
      expect(dep).toBeLessThanOrEqual(t1);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('DEPRECATE');
      expect(auditArg.data.reason).toBe('EOL by vendor');
    });

    it('throws IllegalStateTransitionError when row is in proposed state', async () => {
      const row = makeRow({ id: 'r-1', state: 'proposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.deprecate('r-1', 'bob', 'r')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });

    it('throws IllegalStateTransitionError when row is already deprecated', async () => {
      const row = makeRow({ id: 'r-1', state: 'deprecated' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.deprecate('r-1', 'bob', 'r')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // dispose
  // ──────────────────────────────────────────────────────────
  describe('dispose', () => {
    it('any → DISPOSED (admin override of retention), sets disposed_at, logs DISPOSE', async () => {
      const before = makeRow({ id: 'r-1', state: 'deprecated' });
      const after = makeRow({ id: 'r-1', state: 'disposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.dispose('r-1', 'bob', 'security incident');

      expect(result.state).toBe('disposed');
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.state).toBe('disposed');
      expect(updArg.data.disposed_at).toBeInstanceOf(Date);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('DISPOSE');
      expect(auditArg.data.reason).toBe('security incident');
    });

    it('also accepts active state (admin override path)', async () => {
      const before = makeRow({ id: 'r-1', state: 'active' });
      const after = makeRow({ id: 'r-1', state: 'disposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);
      const result = await writer.dispose('r-1', 'bob', 'kill it');
      expect(result.state).toBe('disposed');
    });

    it('throws IllegalStateTransitionError when row is already disposed (idempotency boundary)', async () => {
      const row = makeRow({ id: 'r-1', state: 'disposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.dispose('r-1', 'bob', 'r')).rejects.toBeInstanceOf(IllegalStateTransitionError);
    });
  });

  // ──────────────────────────────────────────────────────────
  // updateCapabilities
  // ──────────────────────────────────────────────────────────
  describe('updateCapabilities', () => {
    it('updates capabilities, bumps current_revision, logs UPDATE_CAPABILITIES', async () => {
      const before = makeRow({ id: 'r-1', state: 'active', capabilities: { chat: true }, current_revision: 3 });
      const after = makeRow({ id: 'r-1', state: 'active', capabilities: { chat: true, tools: true, vision: true }, current_revision: 4 });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      const result = await writer.updateCapabilities(
        'r-1',
        { chat: true, tools: true, vision: true },
        'bob',
        'add tools+vision',
      );

      expect(result.current_revision).toBe(4);
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.capabilities).toEqual({ chat: true, tools: true, vision: true });
      expect(updArg.data.current_revision).toEqual({ increment: 1 });
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('UPDATE_CAPABILITIES');
      expect(auditArg.data.diff).toBeTruthy();
    });

    it('throws IllegalStateTransitionError when row is deprecated', async () => {
      const row = makeRow({ id: 'r-1', state: 'deprecated' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.updateCapabilities('r-1', { chat: true }, 'bob', 'r')).rejects.toBeInstanceOf(
        IllegalStateTransitionError,
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // updateCost
  // ──────────────────────────────────────────────────────────
  describe('updateCost', () => {
    it('updates cost fields, bumps revision, logs UPDATE_COST', async () => {
      const before = makeRow({ id: 'r-1', state: 'active', current_revision: 1 });
      const after = makeRow({ id: 'r-1', state: 'active', current_revision: 2 });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      await writer.updateCost(
        'r-1',
        {
          cost_per_input_token_usd: '3.00',
          cost_per_output_token_usd: '15.00',
          pricing_source: 'bedrock-pricing-sdk',
        },
        'bob',
        'daily refresh',
      );

      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.cost_per_input_token_usd).toBe('3.00');
      expect(updArg.data.cost_per_output_token_usd).toBe('15.00');
      expect(updArg.data.pricing_source).toBe('bedrock-pricing-sdk');
      expect(updArg.data.current_revision).toEqual({ increment: 1 });
      expect(updArg.data.pricing_fetched_at).toBeInstanceOf(Date);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('UPDATE_COST');
    });

    it('throws IllegalStateTransitionError when row is disposed', async () => {
      const row = makeRow({ id: 'r-1', state: 'disposed' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.updateCost('r-1', {}, 'bob', 'r')).rejects.toBeInstanceOf(
        IllegalStateTransitionError,
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // updatePriority
  // ──────────────────────────────────────────────────────────
  describe('updatePriority', () => {
    it('updates priority, logs UPDATE_PRIORITY', async () => {
      const before = makeRow({ id: 'r-1', state: 'active', priority: 100 });
      const after = makeRow({ id: 'r-1', state: 'active', priority: 5 });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(before);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(after);

      await writer.updatePriority('r-1', 5, 'bob', 'promote to default');

      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.priority).toBe(5);
      expect(updArg.data.current_revision).toEqual({ increment: 1 });
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('UPDATE_PRIORITY');
      expect(auditArg.data.diff).toEqual(expect.objectContaining({ priority: { from: 100, to: 5 } }));
    });

    it('throws IllegalStateTransitionError when row is deprecated', async () => {
      const row = makeRow({ id: 'r-1', state: 'deprecated' });
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(row);
      await expect(writer.updatePriority('r-1', 5, 'bob', 'r')).rejects.toBeInstanceOf(
        IllegalStateTransitionError,
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // reconcileFromProvider
  // ──────────────────────────────────────────────────────────
  describe('reconcileFromProvider', () => {
    it('inserts rows in catalog that are missing from registry (state=active, RECONCILE audit)', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([]); // registry empty
      prismaMock.modelRoleAssignment.create.mockResolvedValueOnce(makeRow({ id: 'r-new', model: 'sonnet', state: 'active' }));

      const result = await writer.reconcileFromProvider(
        'prov-1',
        [{ model: 'sonnet', role: 'chat', capabilities: { chat: true, tools: true } }],
        'system',
      );

      expect(result.inserted).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.deprecated).toBe(0);
      expect(prismaMock.modelRoleAssignment.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.modelRegistryAuditLog.create).toHaveBeenCalledTimes(1);
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('RECONCILE');
    });

    it('updates rows that exist in both registry and catalog when capabilities/cost differ', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      const existing = makeRow({
        id: 'r-1',
        model: 'sonnet',
        role: 'chat',
        provider_id: 'prov-1',
        state: 'active',
        capabilities: { chat: true },
      });
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([existing]);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(
        makeRow({ id: 'r-1', model: 'sonnet', state: 'active', capabilities: { chat: true, tools: true } }),
      );

      const result = await writer.reconcileFromProvider(
        'prov-1',
        [{ model: 'sonnet', role: 'chat', capabilities: { chat: true, tools: true } }],
        'system',
      );

      expect(result.updated).toBe(1);
      expect(result.inserted).toBe(0);
      expect(result.deprecated).toBe(0);
      expect(prismaMock.modelRoleAssignment.update).toHaveBeenCalled();
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('RECONCILE');
    });

    it('deprecates rows in registry that are missing from the catalog', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      const orphan = makeRow({
        id: 'r-orphan',
        model: 'old-model',
        role: 'chat',
        provider_id: 'prov-1',
        state: 'active',
      });
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([orphan]);
      prismaMock.modelRoleAssignment.update.mockResolvedValueOnce(
        makeRow({ id: 'r-orphan', state: 'deprecated' }),
      );

      const result = await writer.reconcileFromProvider(
        'prov-1',
        [], // empty catalog
        'system',
      );

      expect(result.deprecated).toBe(1);
      expect(result.inserted).toBe(0);
      expect(result.updated).toBe(0);
      const updArg = prismaMock.modelRoleAssignment.update.mock.calls[0][0];
      expect(updArg.data.state).toBe('deprecated');
      const auditArg = prismaMock.modelRegistryAuditLog.create.mock.calls[0][0];
      expect(auditArg.data.action).toBe('RECONCILE');
    });

    it('no-ops when catalog matches registry exactly (no audit rows)', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      const existing = makeRow({
        id: 'r-1',
        model: 'sonnet',
        role: 'chat',
        provider_id: 'prov-1',
        state: 'active',
        capabilities: { chat: true, tools: true },
      });
      prismaMock.modelRoleAssignment.findMany.mockResolvedValueOnce([existing]);

      const result = await writer.reconcileFromProvider(
        'prov-1',
        [{ model: 'sonnet', role: 'chat', capabilities: { chat: true, tools: true } }],
        'system',
      );

      expect(result.updated).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.deprecated).toBe(0);
      expect(prismaMock.modelRegistryAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws if the provider does not exist or is soft-deleted', async () => {
      prismaMock.lLMProvider.findUnique.mockResolvedValueOnce(null);
      await expect(
        writer.reconcileFromProvider('missing', [], 'system'),
      ).rejects.toThrow(/provider/i);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Cross-cutting: every method writes audit log inside $transaction
  // ──────────────────────────────────────────────────────────
  describe('atomicity — every mutating method runs inside $transaction', () => {
    beforeEach(() => {
      // Re-seed shared fixtures for the parametric test below.
      prismaMock.lLMProvider.findUnique.mockResolvedValue({ id: 'prov-1', name: 'aws-bedrock', deleted_at: null });
      prismaMock.modelRoleAssignment.findFirst.mockResolvedValue(null);
      prismaMock.modelRoleAssignment.create.mockResolvedValue(makeRow({ id: 'r-new', state: 'proposed' }));
      prismaMock.modelRoleAssignment.update.mockResolvedValue(makeRow({ id: 'r-1', state: 'approved' }));
    });

    it('propose runs inside one $transaction', async () => {
      await writer.propose({
        tenant_id: 't-1', provider_id: 'prov-1', model: 'sonnet',
        role: 'chat', requested_by: 'alice', reason: 'r',
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('approve runs inside one $transaction', async () => {
      prismaMock.modelRoleAssignment.findUnique.mockResolvedValueOnce(
        makeRow({ id: 'r-1', state: 'proposed', proposed_by: 'alice' }),
      );
      await writer.approve('r-1', 'bob', 'r');
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
