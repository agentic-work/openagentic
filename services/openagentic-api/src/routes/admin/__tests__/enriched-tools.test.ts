/**
 * Admin EnrichedTool routes — TDD spec for Phase 5 / Task 5.7.
 *
 * the design notes
 * the design notes (Phase 5)
 *
 * Covers:
 *   1. GET /enriched-tools returns list
 *   2. GET /enriched-tools/:slug returns single
 *   3. GET /enriched-tools/:slug returns 404 for missing
 *   4. POST /enriched-tools upserts
 *   5. POST without admin → 403
 *   6. POST with bad body → 400
 *   7. PATCH /:slug/toggle flips enabled
 *   8. PATCH without admin → 403
 *   9. DELETE /:slug deletes
 *  10. DELETE returns 404 for missing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Mock prisma + Service
type Row = any;
const STORE: Row[] = [];

const mockPrisma = {
  enrichedTool: {
    findUnique: vi.fn(({ where: { slug } }: any) =>
      Promise.resolve(STORE.find(r => r.slug === slug) ?? null),
    ),
    findMany: vi.fn(({ where }: any = {}) =>
      Promise.resolve(
        STORE.filter(r => {
          if (where?.enabled !== undefined && r.enabled !== where.enabled) return false;
          if (where?.category && r.category !== where.category) return false;
          if (where?.mcp_server && r.mcp_server !== where.mcp_server) return false;
          return true;
        }),
      ),
    ),
    upsert: vi.fn(({ where: { slug }, create, update }: any) => {
      const existing = STORE.find(r => r.slug === slug);
      if (existing) {
        Object.assign(existing, update, { updated_at: new Date() });
        return Promise.resolve(existing);
      }
      const row = {
        slug,
        ...create,
        created_at: new Date(),
        updated_at: new Date(),
      };
      STORE.push(row);
      return Promise.resolve(row);
    }),
    update: vi.fn(({ where: { slug }, data }: any) => {
      const existing = STORE.find(r => r.slug === slug);
      if (!existing) throw new Error('not found');
      Object.assign(existing, data, { updated_at: new Date() });
      return Promise.resolve(existing);
    }),
    delete: vi.fn(({ where: { slug } }: any) => {
      const idx = STORE.findIndex(r => r.slug === slug);
      if (idx >= 0) STORE.splice(idx, 1);
      return Promise.resolve();
    }),
  },
};

vi.mock('../../../utils/prisma.js', () => ({
  prisma: mockPrisma,
}));

async function buildApp(opts: { isAdmin?: boolean; nonAdmin?: boolean } = {}): Promise<FastifyInstance> {
  const { isAdmin = true, nonAdmin = false } = opts;
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request: any, _reply) => {
    request.user = {
      id: 'user-x',
      email: 'admin@x.com',
      isAdmin: !nonAdmin && isAdmin,
      role: !nonAdmin && isAdmin ? 'admin' : 'user',
    };
  });

  const { default: enrichedToolsRoutes } = await import('../enriched-tools.js');
  await app.register(enrichedToolsRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

function seedStore() {
  STORE.length = 0;
  STORE.push(
    {
      slug: 'azure_list_vms',
      display_name: 'List Azure VMs',
      description: 'desc',
      output_template: 'azure_vm_list',
      truncate_summary: '{{count}} VMs',
      input_schema: { type: 'object' },
      output_schema: null,
      mcp_server: 'oap-azure-mcp',
      category: 'cloud-ops',
      tier: 1,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: null,
      updated_by: null,
    },
    {
      slug: 'k8s_list_pods',
      display_name: 'List K8s Pods',
      description: 'desc',
      output_template: 'k8s_pod_list',
      truncate_summary: '{{count}} pods',
      input_schema: { type: 'object' },
      output_schema: null,
      mcp_server: 'oap-kubernetes-mcp',
      category: 'k8s',
      tier: 1,
      enabled: false,
      created_at: new Date(),
      updated_at: new Date(),
      created_by: null,
      updated_by: null,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seedStore();
});

describe('Admin EnrichedTool routes', () => {
  it('GET /enriched-tools returns all rows (including disabled by default)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/enriched-tools' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.tools.map((t: any) => t.slug).sort()).toEqual(['azure_list_vms', 'k8s_list_pods']);
    await app.close();
  });

  it('GET /enriched-tools?enabled=true filters to enabled', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/enriched-tools?enabled=true' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.tools[0].slug).toBe('azure_list_vms');
    await app.close();
  });

  it('GET /enriched-tools?category=cloud-ops filters by category', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/enriched-tools?category=cloud-ops' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.tools[0].slug).toBe('azure_list_vms');
    await app.close();
  });

  it('GET /enriched-tools/:slug returns single row', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/enriched-tools/azure_list_vms' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tool.slug).toBe('azure_list_vms');
    await app.close();
  });

  it('GET /enriched-tools/:slug returns 404 for missing', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/enriched-tools/nonexistent' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /enriched-tools upserts a new row', async () => {
    const app = await buildApp();
    const body = {
      slug: 'new_tool',
      display_name: 'New Tool',
      description: 'A fresh tool',
      input_schema: { type: 'object', properties: {} },
      mcp_server: null,
      category: 'meta',
      tier: 1,
      enabled: true,
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/enriched-tools',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.success).toBe(true);
    expect(out.tool.slug).toBe('new_tool');
    expect(STORE.find(r => r.slug === 'new_tool')).toBeDefined();
    await app.close();
  });

  it('POST /enriched-tools without admin returns 403', async () => {
    const app = await buildApp({ nonAdmin: true });
    const body = {
      slug: 'x',
      display_name: 'X',
      description: 'd',
      input_schema: {},
      category: 'meta',
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/enriched-tools',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST /enriched-tools with bad body returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/enriched-tools',
      headers: { 'content-type': 'application/json' },
      payload: { slug: 'x' }, // missing required fields
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('PATCH /:slug/toggle flips enabled', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/enriched-tools/azure_list_vms/toggle',
      headers: { 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tool.enabled).toBe(false);
    expect(STORE.find(r => r.slug === 'azure_list_vms')!.enabled).toBe(false);
    await app.close();
  });

  it('PATCH /:slug/toggle without admin returns 403', async () => {
    const app = await buildApp({ nonAdmin: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/enriched-tools/azure_list_vms/toggle',
      headers: { 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /:slug removes the row', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/enriched-tools/azure_list_vms' });
    expect(res.statusCode).toBe(200);
    expect(STORE.find(r => r.slug === 'azure_list_vms')).toBeUndefined();
    await app.close();
  });

  it('DELETE /:slug returns 404 for missing', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/enriched-tools/nonexistent' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DELETE without admin returns 403', async () => {
    const app = await buildApp({ nonAdmin: true });
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/enriched-tools/azure_list_vms' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
