/**
 * v3-extras permission endpoints — TDD spec for the 4 dead admin endpoints
 * added alongside the existing v3-extras read-only routes:
 *
 *   GET  /api/admin/permissions/available-mcps  → { servers: [{id,name,description}] }
 *   GET  /api/admin/permissions/available-llms  → { providers: [{id,name,display_name,provider_type}] }
 *   PUT  /api/admin/permissions                 → alias of tool-permissions replaceAllRules
 *   POST /api/admin/permissions/reset           → alias of tool-permissions clearAllUserRules
 *
 * The GETs back onto Prisma (MCPServerConfig / LLMProvider). The PUT + reset
 * delegate to the shared PermissionService singleton.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    modelRoutingDecision: { findMany: vi.fn() },
    adminAuditLog:        { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    userPermissions:      { findMany: vi.fn() },
    user:                 { findMany: vi.fn() },
    groupPermissions:     { findMany: vi.fn() },
    mCPUsage:             { findMany: vi.fn() },
    workflowExecution:    { findMany: vi.fn() },
    lLMRequestLog:        { findMany: vi.fn() },
    apiKey:               { findMany: vi.fn() },
    mCPServerConfig:      { findMany: vi.fn() },
    lLMProvider:          { findMany: vi.fn() },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes: {
      child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    },
    services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

const replaceAllRules = vi.fn();
const clearAllUserRules = vi.fn();
vi.mock('../../../services/PermissionService.js', () => ({
  getPermissionService: () => ({ replaceAllRules, clearAllUserRules }),
}));

import { prisma } from '../../../utils/prisma.js';
const p = prisma as any;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', async (request: any) => {
    request.user = { id: 'test-admin', email: 'admin@openagentic.io', isAdmin: true, role: 'admin' };
  });
  const { default: routes } = await import('../v3-extras.js');
  await app.register(routes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/permissions/available-mcps', () => {
  it('200: returns the REAL fleet — built-in catalog UNIONed with DB rows', async () => {
    // The built-ins are NOT DB rows anymore (the memory phantom was removed);
    // available-mcps now reflects the real fleet: the known built-in catalog
    // plus any DB-registered admin-added servers (proxy fetch fails fast in tests).
    p.mCPServerConfig.findMany.mockResolvedValue([
      { id: 'web', name: 'web', description: 'Web search MCP' },        // reconciles with the built-in `web`
      { id: 'custom-mcp', name: 'custom-mcp', description: null },      // extra admin-added server
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions/available-mcps' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    const ids = json.servers.map((s: any) => s.id);
    // every known built-in surfaces (so disabled ones are still grantable)
    for (const builtin of ['admin', 'web', 'kubernetes', 'prometheus', 'aws', 'azure', 'gcp', 'loki', 'alertmanager', 'github']) {
      expect(ids).toContain(builtin);
    }
    // the extra admin-added server is included too
    expect(ids).toContain('custom-mcp');
    // built-in `web` reconciles to ONE entry (no duplicate from the DB row)
    expect(ids.filter((i: string) => i === 'web')).toHaveLength(1);
    // every server has the {id,name,description} shape
    expect(json.servers[0]).toEqual(expect.objectContaining({
      id: expect.any(String), name: expect.any(String),
    }));
    // only enabled DB servers are queried
    expect(p.mCPServerConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    );
  });

  it('500: surfaces Prisma failure', async () => {
    p.mCPServerConfig.findMany.mockRejectedValue(new Error('db down'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions/available-mcps' });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /api/admin/permissions/available-llms', () => {
  it('200: returns { providers: [{id,name,display_name,provider_type}] }', async () => {
    p.lLMProvider.findMany.mockResolvedValue([
      { id: 'p1', name: 'ollama-local', display_name: 'Ollama (local)', provider_type: 'ollama' },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions/available-llms' });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.providers).toHaveLength(1);
    expect(json.providers[0]).toEqual({
      id: 'p1', name: 'ollama-local', display_name: 'Ollama (local)', provider_type: 'ollama',
    });
    // soft-deleted + disabled providers excluded
    expect(p.lLMProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deleted_at: null, enabled: true } }),
    );
  });
});

describe('PUT /api/admin/permissions', () => {
  it('200: delegates valid rules to PermissionService.replaceAllRules', async () => {
    p.adminAuditLog.create.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions',
      payload: { rules: [{ ruleBehavior: 'allow', ruleValue: { toolName: 'web_search' } }] },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json).toEqual({ success: true, count: 1 });
    expect(replaceAllRules).toHaveBeenCalledTimes(1);
  });

  it('400: rejects a non-array rules body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/admin/permissions', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(replaceAllRules).not.toHaveBeenCalled();
  });

  it('400: rejects an invalid rule (missing toolName)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/permissions',
      payload: { rules: [{ ruleBehavior: 'allow', ruleValue: {} }] },
    });
    expect(res.statusCode).toBe(400);
    expect(replaceAllRules).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/permissions/reset', () => {
  it('200: delegates to PermissionService.clearAllUserRules', async () => {
    p.adminAuditLog.create.mockResolvedValue({});
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/permissions/reset' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(clearAllUserRules).toHaveBeenCalledTimes(1);
  });
});
