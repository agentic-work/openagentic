/**
 * Admin RBAC System Prompts CRUD route — P-Live-6.
 *
 * Tests via fastify.inject() against a fresh Fastify instance with a
 * minimal AppContext that only exposes ctx.app.rbacSystemPromptService.
 * The service itself is stubbed; tests verify route shape, validation,
 * status codes, and that endpoints invoke the service with the right
 * arguments (writes pass through actor/reason; rollback parses version).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { adminRbacSystemPromptsRoutes } from '../admin-rbac-system-prompts.js';

function buildServer(svcOverrides: Record<string, any> = {}) {
  const baseSvc = {
    getActiveTemplate: vi.fn(async (role: string) => {
      if (role === 'admin') return '[DB-ADMIN] body';
      if (role === 'member') return '[DB-MEMBER] body';
      throw new Error(`No active rbac_system_prompt for role '${role}'.`);
    }),
    listVersions: vi.fn(async (role: string) => {
      if (role === 'admin') {
        return [
          {
            id: 'a-2',
            role_key: 'admin',
            body: '[DB-ADMIN] body',
            version: 2,
            is_active: true,
            created_at: new Date('2026-05-10T01:00:00Z'),
            updated_at: new Date('2026-05-10T01:00:00Z'),
          },
          {
            id: 'a-1',
            role_key: 'admin',
            body: '[DB-ADMIN] old body',
            version: 1,
            is_active: false,
            created_at: new Date('2026-05-10T00:00:00Z'),
            updated_at: new Date('2026-05-10T00:00:00Z'),
          },
        ];
      }
      return [];
    }),
    setActiveTemplate: vi.fn(async (role: string, body: string, opts: any) => ({
      id: 'new-id',
      role_key: role,
      body,
      version: 99,
      is_active: true,
      created_at: new Date('2026-05-10T02:00:00Z'),
      updated_at: new Date('2026-05-10T02:00:00Z'),
    })),
    rollback: vi.fn(async (role: string, target: number) => ({
      id: `rolled-${target}`,
      role_key: role,
      body: 'rolled body',
      version: target,
      is_active: true,
      created_at: new Date('2026-05-10T03:00:00Z'),
      updated_at: new Date('2026-05-10T03:00:00Z'),
    })),
    invalidate: vi.fn(),
  };
  const svc = { ...baseSvc, ...svcOverrides };

  const fastify = Fastify();
  fastify.decorate('app', { rbacSystemPromptService: svc });
  fastify.register(adminRbacSystemPromptsRoutes);
  return { fastify, svc };
}

describe('GET /', () => {
  it('returns roles array with active version + preview for each role', async () => {
    const { fastify, svc } = buildServer();
    const res = await fastify.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roles).toHaveLength(2);
    const admin = body.roles.find((r: any) => r.role_key === 'admin');
    expect(admin.active_version).toBe(2);
    expect(admin.total_versions).toBe(2);
    expect(admin.preview).toContain('[DB-ADMIN]');
    expect(svc.listVersions).toHaveBeenCalledWith('admin');
    expect(svc.listVersions).toHaveBeenCalledWith('member');
  });

  it('marks unseeded role with `unseeded:true` when listVersions throws', async () => {
    const { fastify, svc } = buildServer();
    svc.listVersions = vi.fn(async () => {
      throw new Error('table empty');
    });
    const res = await fastify.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roles.every((r: any) => r.unseeded === true)).toBe(true);
  });

  it('503 when rbacSystemPromptService is not on AppContext', async () => {
    const fastify = Fastify();
    fastify.decorate('app', {});
    fastify.register(adminRbacSystemPromptsRoutes);
    const res = await fastify.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
  });
});

describe('GET /:role', () => {
  it('returns body for valid role', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role_key: 'admin', body: '[DB-ADMIN] body' });
  });

  it('400 for invalid role string', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({ method: 'GET', url: '/superuser' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/Invalid role/);
  });

  it('404 when no active row for role', async () => {
    const { fastify, svc } = buildServer();
    svc.getActiveTemplate = vi.fn(async () => {
      throw new Error("No active rbac_system_prompt for role 'admin'.");
    });
    const res = await fastify.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /:role/versions', () => {
  it('returns version history with body_preview only (no full body for list view)', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({ method: 'GET', url: '/admin/versions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role_key).toBe('admin');
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version).toBe(2);
    expect(body.versions[0].is_active).toBe(true);
    expect(body.versions[0].body_preview).toContain('[DB-ADMIN]');
    expect(body.versions[0]).not.toHaveProperty('body');
  });

  it('400 for invalid role', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({ method: 'GET', url: '/superuser/versions' });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /:role', () => {
  it('passes body+reason to setActiveTemplate, returns 201 with new version metadata', async () => {
    const { fastify, svc } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin',
      payload: {
        body: 'tightened tool-use directive',
        reason: 'sev0 fix on 2026-05-10',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(svc.setActiveTemplate).toHaveBeenCalledWith(
      'admin',
      'tightened tool-use directive',
      expect.objectContaining({ reason: 'sev0 fix on 2026-05-10' }),
    );
    const body = res.json();
    expect(body).toMatchObject({ role_key: 'admin', version: 99, is_active: true });
  });

  it('400 when body is missing', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin',
      payload: { reason: 'no body' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when body is empty string', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin',
      payload: { body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('413 when body exceeds 64 KB', async () => {
    const { fastify } = buildServer();
    const huge = 'x'.repeat(64 * 1024 + 1);
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin',
      payload: { body: huge },
    });
    expect(res.statusCode).toBe(413);
  });

  it('400 for invalid role on POST', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/superuser',
      payload: { body: 'whatever' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /:role/rollback/:version', () => {
  it('parses version + calls rollback + returns the restored row', async () => {
    const { fastify, svc } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/rollback/1',
      payload: { reason: 'regression' },
    });
    expect(res.statusCode).toBe(200);
    expect(svc.rollback).toHaveBeenCalledWith(
      'admin',
      1,
      expect.objectContaining({ reason: 'regression' }),
    );
    expect(res.json()).toMatchObject({ role_key: 'admin', version: 1, is_active: true });
  });

  it('400 for invalid version (non-numeric)', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/rollback/abc',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 for invalid version (zero or negative)', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/rollback/0',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 when target version does not exist', async () => {
    const { fastify, svc } = buildServer();
    svc.rollback = vi.fn(async () => {
      throw new Error("No rbac_system_prompt for role='admin' version=999.");
    });
    const res = await fastify.inject({
      method: 'POST',
      url: '/admin/rollback/999',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 for invalid role on rollback', async () => {
    const { fastify } = buildServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/superuser/rollback/1',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
