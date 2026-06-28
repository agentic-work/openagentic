/**
 * Workflow Schedule CRUD Routes — behaviour + ownership regression spec.
 *
 * Covers src/routes/workflows-schedules.ts, the WRITER half of the durable
 * cron scheduler (WorkflowScheduler is the reader). These tests assert:
 *
 *  (1) POST /:workflowId/schedules  -> 201 { schedule }, persists the cron +
 *      a REAL computed next_run_at (uses the live getNextCronTime, not a stub)
 *      and defaults name/timezone/input_template/is_active.
 *  (2) GET  /:workflowId/schedules  -> 200 { schedules } for an owned workflow.
 *  (3) PATCH /:workflowId/schedules/:scheduleId { is_active:false } pauses.
 *  (4) DELETE /:workflowId/schedules/:scheduleId -> 200 { success:true }.
 *  (5) Invalid cron (4-field / garbage) on POST -> 400 invalid_cron, no write.
 *  (6) Invalid cron on PATCH -> 400 invalid_cron, no write.
 *  (7) Ownership: workflow.created_by !== userId -> 403; missing workflow ->
 *      404; schedule not under the workflow -> 404.
 *
 * The cron helpers are imported REAL from WorkflowScheduler.js — this both
 * proves they are exported (the pre-step) and lets us assert the computed
 * next_run_at came from the live cron math.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Prisma stub — hoisted so the mock factory can close over the fns.
// ---------------------------------------------------------------------------
const {
  workflowFindFirst,
  scheduleCreate,
  scheduleFindMany,
  scheduleFindUnique,
  scheduleUpdate,
  scheduleDelete,
} = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  scheduleCreate: vi.fn(),
  scheduleFindMany: vi.fn(),
  scheduleFindUnique: vi.fn(),
  scheduleUpdate: vi.fn(),
  scheduleDelete: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflow: { findFirst: workflowFindFirst },
    workflowSchedule: {
      create: scheduleCreate,
      findMany: scheduleFindMany,
      findUnique: scheduleFindUnique,
      update: scheduleUpdate,
      delete: scheduleDelete,
    },
  },
}));

// ---------------------------------------------------------------------------
// Auth middleware stub — reads x-test-user; absent => 401 short-circuit.
// ---------------------------------------------------------------------------
vi.mock('../../middleware/unifiedAuth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (req: Record<string, unknown>, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const headers = req.headers as Record<string, string | undefined>;
    const uid = headers['x-test-user'];
    if (!uid) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    }
    req.user = { userId: uid, id: uid, email: `${uid}@example.com` };
  }),
}));

import { workflowScheduleRoutes } from '../workflows-schedules.js';
import { getNextCronTime } from '../../services/WorkflowScheduler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const OWNER = 'owner-alice';
const WORKFLOW_ID = 'wf-1';
const SCHEDULE_ID = 'sch-1';

function ownedWorkflow(overrides: Record<string, unknown> = {}) {
  return { id: WORKFLOW_ID, name: 'Deploy', created_by: OWNER, ...overrides };
}

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    workflow_id: WORKFLOW_ID,
    name: 'Deploy schedule',
    cron_expression: '*/5 * * * *',
    timezone: 'UTC',
    input_template: {},
    is_active: true,
    next_run_at: new Date('2026-07-01T00:00:00Z'),
    last_run_at: null,
    last_run_status: null,
    total_runs: 0,
    ...overrides,
  };
}

describe('workflowScheduleRoutes — CRUD + ownership', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // create echoes back the merged row so the handler can return it.
    scheduleCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: SCHEDULE_ID, ...data }));
    scheduleUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...scheduleRow(), id: where.id, ...data }));
    scheduleDelete.mockResolvedValue(scheduleRow());
    scheduleFindMany.mockResolvedValue([scheduleRow()]);

    app = Fastify();
    await app.register(workflowScheduleRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // (1) POST creates a schedule
  // =========================================================================
  it('POST creates a schedule -> 201 { schedule } with persisted cron + computed next_run_at', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());

    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: '*/5 * * * *' },
    });

    expect(res.statusCode).toBe(201);
    const { schedule } = res.json();
    expect(schedule.cron_expression).toBe('*/5 * * * *');
    // default name = "<workflow name> schedule"
    expect(schedule.name).toBe('Deploy schedule');
    expect(schedule.timezone).toBe('UTC');
    expect(schedule.is_active).toBe(true);

    // next_run_at is a REAL future time computed by the live cron math.
    const nextRun = new Date(schedule.next_run_at);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    expect(nextRun.getMinutes() % 5).toBe(0);

    // persisted via prisma with the computed Date.
    expect(scheduleCreate).toHaveBeenCalledTimes(1);
    const data = scheduleCreate.mock.calls[0][0].data;
    expect(data.workflow_id).toBe(WORKFLOW_ID);
    expect(data.cron_expression).toBe('*/5 * * * *');
    expect(data.next_run_at).toBeInstanceOf(Date);
    // matches an independent live-helper computation (same minute window).
    const expected = getNextCronTime('*/5 * * * *', new Date());
    expect(Math.abs(data.next_run_at.getTime() - expected.getTime())).toBeLessThanOrEqual(5 * 60_000);
  });

  it('POST honours supplied name/timezone/input_template/is_active', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: {
        cron_expression: '0 9 * * *',
        name: 'Morning run',
        timezone: 'America/New_York',
        input_template: { region: 'us-east-1' },
        is_active: false,
      },
    });
    expect(res.statusCode).toBe(201);
    const data = scheduleCreate.mock.calls[0][0].data;
    expect(data.name).toBe('Morning run');
    expect(data.timezone).toBe('America/New_York');
    expect(data.input_template).toEqual({ region: 'us-east-1' });
    expect(data.is_active).toBe(false);
  });

  // =========================================================================
  // (2) GET lists
  // =========================================================================
  it('GET lists schedules for an owned workflow -> 200 { schedules }', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    const res = await app.inject({
      method: 'GET',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.schedules)).toBe(true);
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0].id).toBe(SCHEDULE_ID);
    expect(scheduleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workflow_id: WORKFLOW_ID } }),
    );
  });

  // =========================================================================
  // (3) PATCH pauses
  // =========================================================================
  it('PATCH { is_active:false } pauses the schedule -> 200 { schedule }', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    scheduleFindUnique.mockResolvedValue(scheduleRow());

    const res = await app.inject({
      method: 'PATCH',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
      payload: { is_active: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().schedule.is_active).toBe(false);
    expect(scheduleUpdate).toHaveBeenCalledTimes(1);
    const call = scheduleUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: SCHEDULE_ID });
    expect(call.data.is_active).toBe(false);
  });

  it('PATCH { cron_expression } re-validates + recomputes next_run_at', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    scheduleFindUnique.mockResolvedValue(scheduleRow());

    const res = await app.inject({
      method: 'PATCH',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: '0 0 * * *' },
    });

    expect(res.statusCode).toBe(200);
    const data = scheduleUpdate.mock.calls[0][0].data;
    expect(data.cron_expression).toBe('0 0 * * *');
    expect(data.next_run_at).toBeInstanceOf(Date);
  });

  // =========================================================================
  // (4) DELETE removes
  // =========================================================================
  it('DELETE removes the schedule -> 200 { success:true }', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    scheduleFindUnique.mockResolvedValue(scheduleRow());

    const res = await app.inject({
      method: 'DELETE',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(scheduleDelete).toHaveBeenCalledWith({ where: { id: SCHEDULE_ID } });
  });

  // =========================================================================
  // (5) invalid cron on POST
  // =========================================================================
  it('POST with a 4-field cron -> 400 invalid_cron, nothing written', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: '* * * *' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_cron');
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('POST with a garbage cron -> 400 invalid_cron, nothing written', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: 'not-a-cron' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_cron');
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('POST with no cron_expression -> 400, nothing written', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  // =========================================================================
  // (6) invalid cron on PATCH
  // =========================================================================
  it('PATCH with a bad cron -> 400 invalid_cron, no update', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    scheduleFindUnique.mockResolvedValue(scheduleRow());
    const res = await app.inject({
      method: 'PATCH',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: 'garbage' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_cron');
    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  // =========================================================================
  // (7) ownership
  // =========================================================================
  it('POST against a workflow owned by someone else -> 403, nothing written', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow({ created_by: 'someone-else' }));
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: '*/5 * * * *' },
    });
    expect(res.statusCode).toBe(403);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('POST against a missing workflow -> 404, nothing written', async () => {
    workflowFindFirst.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: `/${WORKFLOW_ID}/schedules`,
      headers: { 'x-test-user': OWNER },
      payload: { cron_expression: '*/5 * * * *' },
    });
    expect(res.statusCode).toBe(404);
    expect(scheduleCreate).not.toHaveBeenCalled();
  });

  it('PATCH a schedule that is not under the named workflow -> 404, no update', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    // schedule belongs to a DIFFERENT workflow
    scheduleFindUnique.mockResolvedValue(scheduleRow({ workflow_id: 'other-wf' }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(404);
    expect(scheduleUpdate).not.toHaveBeenCalled();
  });

  it('DELETE a schedule that is not under the named workflow -> 404, no delete', async () => {
    workflowFindFirst.mockResolvedValue(ownedWorkflow());
    scheduleFindUnique.mockResolvedValue(scheduleRow({ workflow_id: 'other-wf' }));
    const res = await app.inject({
      method: 'DELETE',
      url: `/${WORKFLOW_ID}/schedules/${SCHEDULE_ID}`,
      headers: { 'x-test-user': OWNER },
    });
    expect(res.statusCode).toBe(404);
    expect(scheduleDelete).not.toHaveBeenCalled();
  });

  // =========================================================================
  // (8) auth preHandler gates every handler
  // =========================================================================
  it('unauthenticated request -> 401; handler logic never runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/${WORKFLOW_ID}/schedules`,
    });
    expect(res.statusCode).toBe(401);
    expect(workflowFindFirst).not.toHaveBeenCalled();
  });
});
