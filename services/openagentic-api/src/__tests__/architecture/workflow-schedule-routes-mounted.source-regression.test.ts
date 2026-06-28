/**
 * Regression — the #122 workflow SCHEDULE CRUD routes MUST be mounted by the
 * LIVE registration path (server.ts), not just by the (dead) wrapper plugin.
 *
 * Root cause this pins (#4 HIGH):
 *   The schedule CRUD route module
 *     - src/routes/workflows-schedules.ts → /api/workflows/:id/schedules (CRUD)
 *   was registered ONLY in src/plugins/workflows.plugin.ts. But in the OSS
 *   edition server.ts does NOT load that plugin — it registers the workflow
 *   routes DIRECTLY in registerAllRoutes(). So the schedule routes never
 *   mounted and all four endpoints 404'd. The existing
 *   workflows-schedules.test.ts passed because it registers the handler on a
 *   fresh isolated Fastify instance (unprefixed), never touching the real
 *   server wiring.
 *
 * Two guards:
 *   A. SOURCE — server.ts (the live path) imports + registers the schedule
 *      route module at the /api/workflows prefix. Catches re-wiring the routes
 *      into a plugin file that server.ts doesn't register.
 *   B. RUNTIME — register the route module exactly as server.ts does (with the
 *      /api/workflows prefix) and assert via printRoutes() + inject that the
 *      final path /api/workflows/:id/schedules exists (NOT 404).
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
describe('workflow schedule routes — wired into the LIVE server.ts path', () => {
  const src = readFileSync(SERVER_TS, 'utf8');

  it('server.ts imports the workflows-schedules route module', () => {
    expect(src).toMatch(/routes\/workflows-schedules\.js/);
  });

  it('server.ts registers workflowScheduleRoutes under the /api/workflows prefix', () => {
    expect(src).toMatch(/workflowScheduleRoutes/);
    const idx = src.search(/workflowScheduleRoutes/);
    expect(idx).toBeGreaterThan(-1);
    // import then register with { prefix: '/api/workflows' } — assert the
    // registration block (not just the import) carries the prefix.
    expect(src).toMatch(/workflowScheduleRoutes[\s\S]{0,200}?prefix:\s*['"]\/api\/workflows['"]/);
  });
});

// ── Guard B: runtime mount assertion (printRoutes + inject) ────────────────
// Mock the leaf dependencies so the route module imports without a live DB.
const { workflowFindFirst, scheduleCreate } = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  scheduleCreate: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => {
  const mk = () => {
    const c: Record<string, unknown> = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    };
    c.child = () => c;
    c.bindings = () => ({});
    return c;
  };
  const noop = mk();
  const cats = ['server', 'auth', 'chat', 'mcp', 'database', 'admin', 'routes', 'middleware', 'services', 'pipeline', 'storage', 'prompt'];
  const loggers: Record<string, unknown> = {};
  for (const c of cats) loggers[c] = mk();
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflow: { findFirst: workflowFindFirst },
    workflowSchedule: { create: scheduleCreate },
  },
}));

// Auth middleware stub — sets req.user so the handler runs (we only care that
// the route is MOUNTED at the prefixed path, not the auth behaviour).
vi.mock('../../middleware/unifiedAuth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: Record<string, unknown>) => {
    req.user = { userId: 'owner-1', id: 'owner-1' };
  }),
}));

describe('workflow schedule routes — actually mount at /api/workflows (not 404)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    workflowFindFirst.mockResolvedValue({ id: 'wf-1', name: 'Deploy', created_by: 'owner-1' });
    scheduleCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sch-1', ...data }));

    app = Fastify();
    // Mirror server.ts registerAllRoutes() registration EXACTLY:
    //   register(workflowScheduleRoutes, { prefix: '/api/workflows' })
    const { workflowScheduleRoutes } = await import('../../routes/workflows-schedules.js');
    await app.register(workflowScheduleRoutes, { prefix: '/api/workflows' });
    await app.ready();
  });

  it('printRoutes() lists the mounted schedules segment', () => {
    expect(app.printRoutes()).toContain('schedules');
  });

  it('POST /api/workflows/:id/schedules is mounted + reachable (201, NOT 404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/wf-1/schedules',
      payload: { cron_expression: '*/5 * * * *' },
    });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(201);
  });

  it('GET /api/workflows/:id/schedules is mounted (NOT 404)', async () => {
    const { prisma } = await import('../../utils/prisma.js');
    (prisma.workflowSchedule as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn(async () => []);
    const res = await app.inject({
      method: 'GET',
      url: '/api/workflows/wf-1/schedules',
    });
    expect(res.statusCode).not.toBe(404);
  });
});
