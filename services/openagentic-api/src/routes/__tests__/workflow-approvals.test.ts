/**
 * Workflow Approval Routes — security/correctness regression spec.
 *
 * Covers the fail-closed authz + quorum logic in
 * src/routes/workflow-approvals.ts. These tests are written to FAIL if a
 * fail-closed branch is flipped to fail-open or an auth check is dropped:
 *
 *  (1) GET /:id by a user who is NEITHER in required_approvers NOR the
 *      execution owner  -> 403, and NO approval data is leaked.
 *  (2) POST /:id/approve by a userId NOT in required_approvers -> 403, and
 *      the approval is NOT recorded (prisma.update never runs).
 *  (3) Double-approval: a user already in approved_by cannot approve again
 *      to inflate the count -> 400, no update.
 *  (4) Quorum: a single approval on a 2-of-N gate must NOT resume the
 *      workflow (resumeViaWorkflowsService NOT called; status stays pending).
 *      The Nth approval that meets required_count DOES resume.
 *  (5) Reject: records rejected_by + terminates (status 'rejected', exec
 *      marked failed) — it does NOT resume.
 *  (6) Escalate: adds non-approvers to required_approvers/escalated_to and
 *      notifies them; a non-approver caller cannot escalate (403).
 *  (7) All handlers run the authMiddleware preHandler: an unauthenticated
 *      request never reaches handler logic (401, prisma never queried).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const mk = () => {
    const c: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    c.child = () => c;
    c.bindings = () => ({});
    return c;
  };
  const noop = mk();
  const cats = ['server', 'auth', 'chat', 'mcp', 'database', 'admin', 'routes', 'middleware', 'services', 'pipeline', 'storage', 'prompt'];
  const loggers: Record<string, any> = {};
  for (const c of cats) loggers[c] = mk();
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub — hoisted so the mock factory can close over the fns.
// ---------------------------------------------------------------------------
const {
  approvalFindUnique,
  approvalFindMany,
  approvalCount,
  approvalUpdate,
  executionUpdate,
  workflowUpdate,
} = vi.hoisted(() => ({
  approvalFindUnique: vi.fn(),
  approvalFindMany: vi.fn(),
  approvalCount: vi.fn(),
  approvalUpdate: vi.fn(),
  executionUpdate: vi.fn(),
  workflowUpdate: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflowApproval: {
      findUnique: approvalFindUnique,
      findMany: approvalFindMany,
      count: approvalCount,
      update: approvalUpdate,
    },
    workflowExecution: { update: executionUpdate },
    workflow: { update: workflowUpdate },
  },
}));

// ---------------------------------------------------------------------------
// Resume proxy + notification service stubs. The resume proxy is the seam
// that re-enters the workflow engine — asserting it is/ isn't called is how
// we prove the quorum + reject branches behave.
// ---------------------------------------------------------------------------
const { resumeMock } = vi.hoisted(() => ({ resumeMock: vi.fn() }));
vi.mock('../../services/resumeViaWorkflowsService.js', () => ({
  resumeViaWorkflowsService: resumeMock,
}));

const { sendApprovalRequestMock } = vi.hoisted(() => ({ sendApprovalRequestMock: vi.fn() }));
vi.mock('../../services/NotificationService.js', () => ({
  getNotificationService: () => ({ sendApprovalRequest: sendApprovalRequestMock }),
}));

// ---------------------------------------------------------------------------
// Auth middleware stub. This is the real preHandler the routes register.
// It reads an `x-test-user` header:
//   - header present  -> set request.user (authenticated) and continue.
//   - header absent    -> reply 401 and STOP (mirrors the real fail path).
// Because the handler only runs when the preHandler does NOT reply, the
// "no header -> 401, handler never runs" test exercises the real
// preHandler-gates-handler contract.
// ---------------------------------------------------------------------------
vi.mock('../../middleware/unifiedAuth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: any, reply: any) => {
    const uid = req.headers['x-test-user'];
    if (!uid) {
      await reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return reply; // returning the reply short-circuits the handler
    }
    req.user = { userId: uid, id: uid, email: `${uid}@example.com` };
  }),
}));

import { workflowApprovalRoutes } from '../workflow-approvals.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const APPROVAL_ID = 'apr-1';

/** A 2-of-N gate: approvers alice + bob + carol, requires 2. */
function twoOfNApproval(overrides: Record<string, any> = {}) {
  return {
    id: APPROVAL_ID,
    execution_id: 'exec-1',
    node_id: 'node-approval',
    status: 'pending',
    message: 'Approve the deploy',
    required_approvers: ['alice', 'bob', 'carol'],
    required_count: 2,
    approved_by: [],
    rejected_by: null,
    escalated_to: [],
    timeout_seconds: 3600,
    timeout_action: 'reject',
    timeout_at: new Date('2026-07-01T00:00:00Z'),
    created_at: new Date('2026-06-01T00:00:00Z'),
    decided_at: null,
    context_data: {},
    execution: {
      id: 'exec-1',
      started_by: 'owner-dave',
      workflow_id: 'wf-1',
      workflow: { id: 'wf-1', name: 'Deploy', description: 'deploys', workflow_id: 'wf-1' },
      version: { definition: { nodes: [], edges: [] } },
      state: { input: {}, variables: {}, nodeResults: {} },
      started_at: new Date('2026-06-01T00:00:00Z'),
      tenant_id: 'local',
      logs: [],
    },
    ...overrides,
  };
}

describe('workflowApprovalRoutes — security & quorum regression', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // update echoes back the merged record so handlers can read it.
    approvalUpdate.mockImplementation(async ({ data }: any) => ({ id: APPROVAL_ID, ...data }));
    executionUpdate.mockResolvedValue({});
    workflowUpdate.mockResolvedValue({});
    resumeMock.mockResolvedValue({ success: true });
    sendApprovalRequestMock.mockResolvedValue(undefined);

    app = Fastify();
    await app.register(workflowApprovalRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // (1) GET /:id authorization fail-closed
  // =========================================================================
  describe('(1) GET /:id authorization', () => {
    it('403 + no data leak for a user who is neither approver nor execution owner', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());

      const res = await app.inject({
        method: 'GET',
        url: `/${APPROVAL_ID}`,
        headers: { 'x-test-user': 'mallory' }, // not in approvers, not the owner (owner-dave)
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe('Forbidden');
      // Fail-closed: the approval payload must NOT be returned.
      expect(body.approval).toBeUndefined();
      expect(res.body).not.toContain('Approve the deploy');
    });

    it('200 for a required approver', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'GET', url: `/${APPROVAL_ID}`, headers: { 'x-test-user': 'alice' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().approval.id).toBe(APPROVAL_ID);
    });

    it('200 for the execution owner even though not in required_approvers', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'GET', url: `/${APPROVAL_ID}`, headers: { 'x-test-user': 'owner-dave' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().approval.id).toBe(APPROVAL_ID);
    });
  });

  // =========================================================================
  // (2) approve by a non-approver is rejected, NOT recorded
  // =========================================================================
  describe('(2) approve by a non-approver', () => {
    it('403 and prisma.update is never called (approval not recorded)', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/approve`,
        headers: { 'x-test-user': 'mallory' }, // not in required_approvers
        payload: { comment: 'lgtm' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Forbidden');
      // The decisive fail-closed assertion: nothing was written.
      expect(approvalUpdate).not.toHaveBeenCalled();
      expect(resumeMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // (3) double-approval cannot inflate the count
  // =========================================================================
  describe('(3) double-approval guard', () => {
    it('400 when a user already in approved_by approves again; no update, no resume', async () => {
      // alice already approved once on a 2-of-N gate.
      approvalFindUnique.mockResolvedValue(twoOfNApproval({ approved_by: ['alice'] }));

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/approve`,
        headers: { 'x-test-user': 'alice' },
        payload: { comment: 'again' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Already approved');
      // Must NOT re-record (which would push alice twice -> [alice,alice] -> meets count of 2).
      expect(approvalUpdate).not.toHaveBeenCalled();
      expect(resumeMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // (4) quorum — single approval on 2-of-N must NOT resume
  // =========================================================================
  describe('(4) quorum enforcement', () => {
    it('first approval on a 2-of-N gate records but does NOT resume the workflow', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval({ approved_by: [] }));

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/approve`,
        headers: { 'x-test-user': 'alice' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.isFullyApproved).toBe(false);
      expect(body.approval.status).toBe('pending');
      expect(body.approval.approvalProgress).toBe('1/2');

      // It WAS recorded...
      expect(approvalUpdate).toHaveBeenCalledTimes(1);
      const updateArg = approvalUpdate.mock.calls[0][0];
      expect(updateArg.data.approved_by).toEqual(['alice']);
      expect(updateArg.data.status).toBe('pending');
      expect(updateArg.data.decided_at).toBeNull();

      // ...but the workflow must NOT have resumed (the security-critical bit).
      expect(resumeMock).not.toHaveBeenCalled();
    });

    it('the approval that meets required_count DOES resume the workflow', async () => {
      // alice already in; bob is the 2nd of 2.
      approvalFindUnique.mockResolvedValue(twoOfNApproval({ approved_by: ['alice'] }));

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/approve`,
        headers: { 'x-test-user': 'bob' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.isFullyApproved).toBe(true);
      expect(body.approval.status).toBe('approved');
      expect(body.approval.approvalProgress).toBe('2/2');

      const updateArg = approvalUpdate.mock.calls[0][0];
      expect(updateArg.data.approved_by).toEqual(['alice', 'bob']);
      expect(updateArg.data.status).toBe('approved');
      expect(updateArg.data.decided_at).toBeInstanceOf(Date);

      // Now — and only now — the workflow resumes.
      expect(resumeMock).toHaveBeenCalledTimes(1);
      const resumeArg = resumeMock.mock.calls[0][0];
      expect(resumeArg.executionId).toBe('exec-1');
      expect(resumeArg.fromNodeId).toBe('node-approval');
    });

    it('a 1-of-N gate resumes on the very first approval', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval({ required_count: 1, approved_by: [] }));
      const res = await app.inject({
        method: 'POST', url: `/${APPROVAL_ID}/approve`,
        headers: { 'x-test-user': 'alice' }, payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().approval.isFullyApproved).toBe(true);
      expect(resumeMock).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // (5) reject records rejected_by and terminates (no resume)
  // =========================================================================
  describe('(5) reject terminates the gate', () => {
    it('records rejected_by, sets status rejected, marks execution failed, and does NOT resume', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/reject`,
        headers: { 'x-test-user': 'bob' },
        payload: { reason: 'unsafe change' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approval.status).toBe('rejected');
      expect(body.approval.rejectedBy).toBe('bob');

      // Approval row terminated as rejected.
      const updateArg = approvalUpdate.mock.calls[0][0];
      expect(updateArg.data.status).toBe('rejected');
      expect(updateArg.data.rejected_by).toBe('bob');

      // Execution marked failed — i.e. terminated, not resumed.
      expect(executionUpdate).toHaveBeenCalled();
      const execArg = executionUpdate.mock.calls[0][0];
      expect(execArg.data.status).toBe('failed');

      // The workflow must NOT resume after a rejection.
      expect(resumeMock).not.toHaveBeenCalled();
    });

    it('a non-approver cannot reject (403, nothing written)', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'POST', url: `/${APPROVAL_ID}/reject`,
        headers: { 'x-test-user': 'mallory' }, payload: { reason: 'no' },
      });
      expect(res.statusCode).toBe(403);
      expect(approvalUpdate).not.toHaveBeenCalled();
      expect(executionUpdate).not.toHaveBeenCalled();
    });

    it('rejection requires a reason (400 when blank)', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'POST', url: `/${APPROVAL_ID}/reject`,
        headers: { 'x-test-user': 'bob' }, payload: { reason: '   ' },
      });
      expect(res.statusCode).toBe(400);
      expect(approvalUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // (6) escalate to a non-approver
  // =========================================================================
  describe('(6) escalate', () => {
    it('adds new approvers to required_approvers + escalated_to and notifies them', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());

      const res = await app.inject({
        method: 'POST',
        url: `/${APPROVAL_ID}/escalate`,
        headers: { 'x-test-user': 'alice' },
        payload: { escalateTo: ['erin', 'frank'], reason: 'need more eyes' },
      });

      expect(res.statusCode).toBe(200);
      const updateArg = approvalUpdate.mock.calls[0][0];
      // New approvers are now authorized to act, and recorded as escalation targets.
      expect(updateArg.data.required_approvers).toEqual(expect.arrayContaining(['erin', 'frank']));
      expect(updateArg.data.escalated_to).toEqual(expect.arrayContaining(['erin', 'frank']));
      expect(updateArg.data.status).toBe('escalated');

      // The escalated-to non-approvers are notified.
      expect(sendApprovalRequestMock).toHaveBeenCalledTimes(1);
      expect(sendApprovalRequestMock.mock.calls[0][0].recipients).toEqual(['erin', 'frank']);
    });

    it('a non-approver cannot escalate (403, nothing written, nobody notified)', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'POST', url: `/${APPROVAL_ID}/escalate`,
        headers: { 'x-test-user': 'mallory' }, payload: { escalateTo: ['erin'] },
      });
      expect(res.statusCode).toBe(403);
      expect(approvalUpdate).not.toHaveBeenCalled();
      expect(sendApprovalRequestMock).not.toHaveBeenCalled();
    });

    it('escalate requires at least one target (400)', async () => {
      approvalFindUnique.mockResolvedValue(twoOfNApproval());
      const res = await app.inject({
        method: 'POST', url: `/${APPROVAL_ID}/escalate`,
        headers: { 'x-test-user': 'alice' }, payload: { escalateTo: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(approvalUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // (7) authMiddleware preHandler gates every handler
  // =========================================================================
  describe('(7) auth preHandler gates all handlers', () => {
    const cases: Array<[string, string, any]> = [
      ['GET', `/${APPROVAL_ID}`, undefined],
      ['POST', `/${APPROVAL_ID}/approve`, {}],
      ['POST', `/${APPROVAL_ID}/reject`, { reason: 'x' }],
      ['POST', `/${APPROVAL_ID}/escalate`, { escalateTo: ['erin'] }],
    ];

    it.each(cases)('%s %s -> 401 when unauthenticated; handler logic never runs', async (method, url, payload) => {
      // If the gate were dropped, the handler would query prisma. We prove it
      // does not: prisma.findUnique is never called and the resume seam stays
      // untouched.
      approvalFindUnique.mockResolvedValue(twoOfNApproval());

      const res = await app.inject({ method: method as any, url, payload }); // no x-test-user header

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Unauthorized');
      expect(approvalFindUnique).not.toHaveBeenCalled();
      expect(approvalUpdate).not.toHaveBeenCalled();
      expect(resumeMock).not.toHaveBeenCalled();
    });

    it('authMiddleware is actually registered as the preHandler', async () => {
      const { authMiddleware } = await import('../../middleware/unifiedAuth.js');
      await app.inject({ method: 'GET', url: `/${APPROVAL_ID}`, headers: { 'x-test-user': 'alice' } });
      expect(vi.mocked(authMiddleware)).toHaveBeenCalled();
    });
  });
});
