/**
 * TDD — admin-teams route
 *
 * Tests:
 *   R1  GET /api/admin/teams — returns 200 with teams list
 *   R2  POST /api/admin/teams — 201 on valid input
 *   R3  POST /api/admin/teams — 409 on name conflict
 *   R4  POST /api/admin/teams — 400 on missing required field
 *   R5  PUT /api/admin/teams/:id — 200 on update
 *   R6  DELETE /api/admin/teams/:id — 204 on soft-delete
 *   R7  GET /api/admin/teams/:id/members — 200 with member list
 *   R8  POST /api/admin/teams/:id/members — 201 on add member
 *   R9  POST /api/admin/teams/:id/members — 404 on unknown user
 *   R10 DELETE /api/admin/teams/:id/members/:uid — 204 on remove
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Hoist mock refs
// ---------------------------------------------------------------------------
const mockListTeams = vi.hoisted(() => vi.fn());
const mockCreateTeam = vi.hoisted(() => vi.fn());
const mockUpdateTeam = vi.hoisted(() => vi.fn());
const mockDeleteTeam = vi.hoisted(() => vi.fn());
const mockListMembers = vi.hoisted(() => vi.fn());
const mockAddMember = vi.hoisted(() => vi.fn());
const mockRemoveMember = vi.hoisted(() => vi.fn());
const mockListSharedFlows = vi.hoisted(() => vi.fn());
const mockShareFlow = vi.hoisted(() => vi.fn());
const mockRevokeFlowShare = vi.hoisted(() => vi.fn());

vi.mock('../../services/TeamsService.js', () => ({
  teamsService: {
    listTeams: mockListTeams,
    createTeam: mockCreateTeam,
    updateTeam: mockUpdateTeam,
    deleteTeam: mockDeleteTeam,
    listMembers: mockListMembers,
    addMember: mockAddMember,
    removeMember: mockRemoveMember,
    listSharedFlows: mockListSharedFlows,
    shareFlow: mockShareFlow,
    revokeFlowShare: mockRevokeFlowShare,
  },
}));

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    routes: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEAM_FIXTURE = {
  id: 'grp-1',
  name: 'engineering',
  display_name: 'Engineering',
  description: null,
  parent_group_id: null,
  cost_center: 'CC-100',
  billing_contact_email: null,
  metadata: {},
  is_active: true,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  member_count: 3,
  shared_flows_count: 2,
};

const MEMBER_FIXTURE = {
  id: 'mem-1',
  user_id: 'user-99',
  group_id: 'grp-1',
  role: 'member',
  user: { id: 'user-99', email: 'alice@example.com', name: 'Alice' },
};

function domainError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp() {
  const { adminTeamsRoutes } = await import('../admin-teams.js');
  const app = Fastify({ logger: false });
  await app.register(adminTeamsRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin-teams routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // R1
  it('R1: GET /api/admin/teams returns 200 with teams list', async () => {
    mockListTeams.mockResolvedValue([TEAM_FIXTURE]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/teams' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe('engineering');
    expect(body.teams[0].member_count).toBe(3);
  });

  // R2
  it('R2: POST /api/admin/teams returns 201 on valid input', async () => {
    mockCreateTeam.mockResolvedValue(TEAM_FIXTURE);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/teams',
      payload: { name: 'engineering', display_name: 'Engineering' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.team.id).toBe('grp-1');
  });

  // R3
  it('R3: POST /api/admin/teams returns 409 on name conflict', async () => {
    mockCreateTeam.mockRejectedValue(domainError('TEAM_NAME_CONFLICT', 'Team name already taken'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/teams',
      payload: { name: 'engineering', display_name: 'Engineering' },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('TEAM_NAME_CONFLICT');
  });

  // R4
  it('R4: POST /api/admin/teams returns 400 on missing required field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/teams',
      payload: { display_name: 'Engineering' }, // missing name
    });

    expect(res.statusCode).toBe(400);
  });

  // R5
  it('R5: PUT /api/admin/teams/:id returns 200 on update', async () => {
    const updated = { ...TEAM_FIXTURE, display_name: 'Eng Updated' };
    mockUpdateTeam.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/teams/grp-1',
      payload: { display_name: 'Eng Updated' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.team.display_name).toBe('Eng Updated');
  });

  // R6
  it('R6: DELETE /api/admin/teams/:id returns 204 on soft-delete', async () => {
    mockDeleteTeam.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: '/api/admin/teams/grp-1' });

    expect(res.statusCode).toBe(204);
  });

  // R7
  it('R7: GET /api/admin/teams/:id/members returns 200 with member list', async () => {
    mockListMembers.mockResolvedValue([MEMBER_FIXTURE]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/teams/grp-1/members' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].user.email).toBe('alice@example.com');
  });

  // R8
  it('R8: POST /api/admin/teams/:id/members returns 201 on add member', async () => {
    mockAddMember.mockResolvedValue(MEMBER_FIXTURE);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/teams/grp-1/members',
      payload: { user_email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.membership.user_id).toBe('user-99');
  });

  // R9
  it('R9: POST /api/admin/teams/:id/members returns 404 on unknown user', async () => {
    mockAddMember.mockRejectedValue(domainError('USER_NOT_FOUND', 'No user found'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/teams/grp-1/members',
      payload: { user_email: 'ghost@example.com' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('USER_NOT_FOUND');
  });

  // R10
  it('R10: DELETE /api/admin/teams/:id/members/:uid returns 204 on remove', async () => {
    mockRemoveMember.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/teams/grp-1/members/user-99',
    });

    expect(res.statusCode).toBe(204);
  });
});
