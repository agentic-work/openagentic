/**
 * Phase G — Provider DELETE cascade
 *
 * Spec: docs/superpowers/specs/2026-04-30-ollama-split-topology.md §Phase G
 *
 * Bug: DELETE /api/admin/llm-providers/:id soft-deletes the provider row,
 * but does NOT cascade-disable the ModelRoleAssignment rows that reference
 * it by name. Consequence: deleted-provider models stay in the candidate
 * pool for SmartModelRouter, which picks them, then dispatch fails with
 * "no enabled provider serves it" UNKNOWN_ERROR popup.
 *
 * Fix: inside one prisma.$transaction, soft-delete the provider AND
 * updateMany ModelRoleAssignment rows where provider == name to set
 * enabled=false. Don't hard-delete — soft-disable mirrors the provider
 * soft-delete pattern. Tx rollback if either step throws.
 *
 * Style: prismaMock unit-test (matches sibling llm-providers.registry-delete.test.ts).
 * Avoids requiring a live DB / port-forward.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const prismaMock: any = {
  lLMProvider: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  modelRoleAssignment: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  chatSession: {
    count: vi.fn(),
  },
  // $transaction(callback) form: invoke callback with the same mock surface
  // so the cascade's tx-scoped calls land on the same vi.fn() spies.
  $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
};

vi.mock('../../../utils/prisma.js', () => ({ prisma: prismaMock }));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock('../../../services/llm-providers/CredentialEncryptionService.js', () => ({
  encryptAuthConfig: (c: any) => c,
  decryptAuthConfig: (c: any) => c,
}));

vi.mock('../../../services/llm-providers/ProviderManager.js', () => ({
  ProviderManager: class {},
  invalidateAllModelCaches: async () => {},
}));

vi.mock('../../../utils/auditTrail.js', () => ({
  AuditTrail: class { log() { return Promise.resolve(); } },
  auditTrail: { log: async () => {} },
  AuditEventType: {
    CREDENTIAL_CREATE: 'CREDENTIAL_CREATE',
    CREDENTIAL_DELETE: 'CREDENTIAL_DELETE',
  },
  AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
}));

vi.mock('../../../services/CredentialAuditService.js', () => ({
  credentialAuditService: { log: async () => {} },
}));

import Fastify, { type FastifyInstance } from 'fastify';

describe('DELETE /api/admin/llm-providers/:id — Phase G cascade', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const llmProviderRoutes = (await import('../llm-providers.js')).default;
    app = Fastify({ logger: false });
    app.addHook('preHandler', async (request: any) => {
      request.user = { id: 'test-admin-uuid', email: 'admin@test', isAdmin: true };
    });
    await app.register(llmProviderRoutes as any, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.lLMProvider.findUnique.mockReset();
    prismaMock.lLMProvider.update.mockReset();
    prismaMock.modelRoleAssignment.count.mockReset();
    prismaMock.modelRoleAssignment.updateMany.mockReset();
    prismaMock.chatSession.count.mockReset();
    prismaMock.$transaction.mockClear();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  });

  it('cascades enabled=false to all ModelRoleAssignment rows when provider is soft-deleted', async () => {
    const providerName = 'test-provider-A';
    prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({
      id: 'prov-A-id',
      name: providerName,
      display_name: 'Test Provider A',
      provider_type: 'ollama',
      enabled: true,
      deleted_at: null,
      model_config: {},
      provider_config: {},
    });
    // No active usages → guard passes
    prismaMock.modelRoleAssignment.count.mockResolvedValueOnce(0);
    prismaMock.chatSession.count.mockResolvedValueOnce(0);
    prismaMock.lLMProvider.update.mockResolvedValueOnce({
      id: 'prov-A-id',
      name: providerName,
      deleted_at: new Date(),
      enabled: false,
    });
    prismaMock.modelRoleAssignment.updateMany.mockResolvedValueOnce({ count: 3 });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/prov-A-id?force=true',
    });

    expect(res.statusCode).toBe(200);
    // Cascade runs inside the transaction
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.modelRoleAssignment.updateMany).toHaveBeenCalledWith({
      where: { provider: providerName, enabled: true },
      data: { enabled: false },
    });
    expect(prismaMock.lLMProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prov-A-id' },
        data: expect.objectContaining({ deleted_at: expect.any(Date), enabled: false }),
      }),
    );
  });

  it('updateMany is invoked even when zero ModelRoleAssignment rows reference the provider', async () => {
    prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({
      id: 'prov-empty',
      name: 'orphan-provider',
      display_name: 'Empty Provider',
      provider_type: 'ollama',
      enabled: true,
      deleted_at: null,
      model_config: {},
      provider_config: {},
    });
    prismaMock.modelRoleAssignment.count.mockResolvedValueOnce(0);
    prismaMock.chatSession.count.mockResolvedValueOnce(0);
    prismaMock.lLMProvider.update.mockResolvedValueOnce({
      id: 'prov-empty',
      name: 'orphan-provider',
      deleted_at: new Date(),
    });
    prismaMock.modelRoleAssignment.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/prov-empty?force=true',
    });

    expect(res.statusCode).toBe(200);
    // Even with zero matches, the cascade is invoked — Prisma updateMany with
    // zero matches is a no-op, but always issuing the call keeps the contract
    // simple and the behaviour observable.
    expect(prismaMock.modelRoleAssignment.updateMany).toHaveBeenCalledWith({
      where: { provider: 'orphan-provider', enabled: true },
      data: { enabled: false },
    });
  });

  it('rolls back the provider soft-delete when the cascade throws', async () => {
    prismaMock.lLMProvider.findUnique.mockResolvedValueOnce({
      id: 'prov-rollback',
      name: 'tx-rollback',
      display_name: 'Tx Rollback',
      provider_type: 'ollama',
      enabled: true,
      deleted_at: null,
      model_config: {},
      provider_config: {},
    });
    prismaMock.modelRoleAssignment.count.mockResolvedValueOnce(0);
    prismaMock.chatSession.count.mockResolvedValueOnce(0);

    // Simulate cascade failure: $transaction's callback throws → tx rolls back.
    // The handler must propagate the failure (not swallow + commit a partial state).
    prismaMock.lLMProvider.update.mockResolvedValueOnce({
      id: 'prov-rollback',
      name: 'tx-rollback',
      deleted_at: new Date(),
    });
    prismaMock.modelRoleAssignment.updateMany.mockRejectedValueOnce(
      new Error('simulated cascade failure'),
    );

    // The tx should propagate the throw (real Prisma rolls back on any throw
    // inside $transaction(callback)). With the mocked $transaction as
    // (cb)=>cb(prismaMock), the throw bubbles to the route handler.
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/llm-providers/prov-rollback?force=true',
    });

    // Handler MUST 500 — it cannot return success when the cascade failed.
    expect(res.statusCode).toBe(500);
    // The transaction was attempted (so we exercised the cascade path)…
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // …but the success path's reply was never sent.
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Failed to delete provider/i);
  });
});
