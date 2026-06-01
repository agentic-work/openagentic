/**
 * Regression — approval-gate + admin-audit-log routes MUST be mounted by the
 * LIVE registration path (server.ts), not just by the (dead) wrapper plugins.
 *
 * Root cause this pins (commit 7e6637539 → live 9234c145b):
 *   The approval+audit backend wired its two new route modules
 *     - src/routes/admin-audit-log.ts          → GET  /api/admin/audit-log
 *     - src/routes/chat/approval-gate.routes.ts → POST /api/approvals/:auditId/{approve,deny}
 *   into `src/plugins/chat.plugin.ts` and `src/plugins/admin-audit.plugin.ts`.
 *   But in the OSS edition those wrapper plugins are NEVER registered by
 *   server.ts — server.ts performs its own inline route registration in
 *   registerAllRoutes(). So the routes never mounted and every call 404'd,
 *   with no boot log line. The pre-existing unit tests passed because they
 *   register the handler on a fresh isolated Fastify instance, never touching
 *   the real server.
 *
 * Two guards:
 *   A. SOURCE — server.ts (the live path) imports + registers both route
 *      modules at the correct prefixes. Catches re-wiring the routes into a
 *      plugin file that server.ts doesn't register.
 *   B. RUNTIME — register each route module exactly as server.ts does and
 *      assert via fastify.inject + printRoutes() that the final mounted paths
 *      exist (NOT 404). Catches a prefix/path mismatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_TS = resolve(__dirname, '../../server.ts');

// ── Guard A: source-regression on the live registration path ───────────────
describe('approval+audit routes — wired into the LIVE server.ts path', () => {
  const src = readFileSync(SERVER_TS, 'utf8');

  it('server.ts imports the admin-audit-log route module', () => {
    expect(src).toMatch(/routes\/admin-audit-log\.js/);
  });

  it('server.ts registers admin-audit-log under the /api/admin prefix', () => {
    // import then register adminAuditLogRoutes with { prefix: '/api/admin' }
    expect(src).toMatch(/adminAuditLogRoutes[\s\S]{0,200}?prefix:\s*['"]\/api\/admin['"]/);
  });

  it('server.ts imports the approval-gate route module', () => {
    expect(src).toMatch(/routes\/chat\/approval-gate\.routes\.js/);
  });

  it('server.ts registers approval-gate under the /api prefix with auth', () => {
    expect(src).toMatch(/approvalGateRoutes/);
    // The registration block wraps the route in an authMiddleware onRequest hook
    // and mounts at /api so the final path is /api/approvals/:auditId/{approve,deny}.
    const idx = src.search(/approvalGateRoutes/);
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 300);
    expect(block).toMatch(/prefix:\s*['"]\/api['"]/);
  });
});

// ── Guard B: runtime mount assertion (inject + printRoutes) ────────────────
// Mock the leaf dependencies so the route modules import without a live DB.
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    toolCallAuditLog: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
  },
}));
vi.mock('../../services/approval/auditLog.js', () => ({
  decideAuditRow: vi.fn(async () => true),
}));
vi.mock('../../services/approval/ApprovalRegistry.js', () => ({
  getApprovalRegistry: () => ({ submit: vi.fn(() => true) }),
}));

describe('approval+audit routes — actually mount (not 404) when registered like server.ts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();

    // Mirror server.ts registerAllRoutes() registration EXACTLY.
    // 1. admin-audit-log: route applies adminMiddleware per-route internally,
    //    registered at prefix /api/admin → GET /api/admin/audit-log.
    const { default: adminAuditLogRoutes } = await import('../../routes/admin-audit-log.js');
    await app.register(adminAuditLogRoutes, { prefix: '/api/admin' });

    // 2. approval-gate: wrapped in an onRequest auth hook, registered at /api
    //    → POST /api/approvals/:auditId/{approve,deny}. We inject a fake auth
    //    hook so the inject calls don't 401 — we only care that the route is
    //    MOUNTED (a 404 here is the bug we are guarding against).
    const { approvalGateRoutes } = await import('../../routes/chat/approval-gate.routes.js');
    await app.register(async (instance) => {
      instance.addHook('onRequest', async (req: any) => {
        req.user = { id: 'test-admin' };
      });
      await instance.register(approvalGateRoutes);
    }, { prefix: '/api' });

    await app.ready();
  });

  it('printRoutes() lists the mounted route segments', () => {
    // Fastify renders a radix tree, so full URLs are split across lines. Assert
    // on the load-bearing leaf segments that uniquely identify each route.
    const tree = app.printRoutes();
    expect(tree).toContain('audit-log');
    expect(tree).toContain('approve');
    expect(tree).toContain('deny');
  });

  it('GET /api/admin/audit-log is mounted (NOT 404)', async () => {
    // The route applies the REAL adminMiddleware internally (unmocked here), so
    // an unauthenticated probe yields 401 — which still PROVES the route mounts.
    // The bug being guarded against produced 404 (route absent entirely).
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-log' });
    expect(res.statusCode).not.toBe(404);
  });

  it('POST /api/approvals/:auditId/approve is mounted (NOT 404)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/approvals/a1/approve' });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200); // fake auth hook + mocked deps → handler runs
  });

  it('POST /api/approvals/:auditId/deny is mounted (NOT 404)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/approvals/a1/deny' });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200);
  });
});
