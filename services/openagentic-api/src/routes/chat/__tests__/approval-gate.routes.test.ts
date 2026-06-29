/**
 * Test F — POST /api/approvals/:auditId/approve | /deny (integration, inject).
 *
 * Guarded single pending→decided UPDATE + in-process registry resolve. 404 when
 * neither decided nor resolved (already terminal / unknown). Mocks decideAuditRow
 * + registry.submit; fakes req.user via a preHandler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { decideAuditRowMock, submitMock } = vi.hoisted(() => ({
  decideAuditRowMock: vi.fn(),
  submitMock: vi.fn(),
}));

vi.mock('../../../services/approval/auditLog.js', () => ({
  decideAuditRow: decideAuditRowMock,
}));
vi.mock('../../../services/approval/ApprovalRegistry.js', () => ({
  getApprovalRegistry: () => ({ submit: submitMock }),
}));

import { approvalGateRoutes } from '../approval-gate.routes.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('preHandler', async (req: any) => {
    req.user = { id: 'user-x' };
  });
  await app.register(approvalGateRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

describe('POST /api/approvals/:auditId/approve', () => {
  it('200 with {ok,approved:true,decided,resolved}; calls decideAuditRow + submit', async () => {
    decideAuditRowMock.mockResolvedValue(true);
    submitMock.mockReturnValue(true);
    const res = await app.inject({ method: 'POST', url: '/api/approvals/a1/approve' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, auditId: 'a1', approved: true, decided: true, resolved: true });
    expect(decideAuditRowMock).toHaveBeenCalledWith('a1', 'approved', 'user-x');
    expect(submitMock).toHaveBeenCalledWith('a1', true);
  });
});

describe('POST /api/approvals/:auditId/deny', () => {
  it('200 approved:false; calls decideAuditRow with denied', async () => {
    decideAuditRowMock.mockResolvedValue(true);
    submitMock.mockReturnValue(true);
    const res = await app.inject({ method: 'POST', url: '/api/approvals/a1/deny' });
    expect(res.statusCode).toBe(200);
    expect(res.json().approved).toBe(false);
    expect(decideAuditRowMock).toHaveBeenCalledWith('a1', 'denied', 'user-x');
    expect(submitMock).toHaveBeenCalledWith('a1', false);
  });
});

describe('approve/deny race + not-found', () => {
  it('404 when neither decided nor resolved', async () => {
    decideAuditRowMock.mockResolvedValue(false);
    submitMock.mockReturnValue(false);
    const res = await app.inject({ method: 'POST', url: '/api/approvals/gone/approve' });
    expect(res.statusCode).toBe(404);
  });

  it('200 when row already timed_out (decided false) but registry resolved true', async () => {
    decideAuditRowMock.mockResolvedValue(false);
    submitMock.mockReturnValue(true);
    const res = await app.inject({ method: 'POST', url: '/api/approvals/a1/approve' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, decided: false, resolved: true });
  });
});
