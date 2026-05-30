/**
 * TDD — teamsAdminApi
 *
 * Tests:
 *   A1  fetchTeams resolves with parsed JSON on 200
 *   A2  fetchTeams rejects with descriptive error on non-200
 *   A3  createTeam posts body and returns created team
 *   A4  addTeamMember posts user_email and returns membership
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/utils/api';
import { fetchTeams, createTeam, addTeamMember, removeTeamMember } from '../../../services/teamsAdminApi';

const mockApi = apiRequest as ReturnType<typeof vi.fn>;

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function err(status: number, text = 'error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('no json')),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

const TEAMS_FIXTURE = {
  teams: [
    {
      id: 'grp-1',
      name: 'engineering',
      display_name: 'Engineering',
      member_count: 5,
      shared_flows_count: 2,
    },
  ],
};

describe('teamsAdminApi', () => {
  beforeEach(() => vi.clearAllMocks());

  // A1
  it('A1: fetchTeams resolves with parsed JSON on 200', async () => {
    mockApi.mockResolvedValueOnce(ok(TEAMS_FIXTURE));

    const result = await fetchTeams();

    expect(result.teams).toHaveLength(1);
    expect(result.teams[0].name).toBe('engineering');
    expect(mockApi).toHaveBeenCalledWith('/admin/teams');
  });

  // A2
  it('A2: fetchTeams rejects with descriptive error on non-200', async () => {
    mockApi.mockResolvedValueOnce(err(500, 'Server error'));

    await expect(fetchTeams()).rejects.toThrow('fetchTeams failed: 500');
  });

  // A3
  it('A3: createTeam posts body and returns created team on 201', async () => {
    const created = { team: TEAMS_FIXTURE.teams[0] };
    mockApi.mockResolvedValueOnce(ok(created));

    const result = await createTeam({ name: 'engineering', display_name: 'Engineering' });

    expect(result.team.id).toBe('grp-1');
    expect(mockApi).toHaveBeenCalledWith(
      '/admin/teams',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  // A4
  it('A4: addTeamMember posts user_email and returns membership', async () => {
    const membership = { membership: { id: 'mem-1', user_id: 'u-1', group_id: 'grp-1' } };
    mockApi.mockResolvedValueOnce(ok(membership));

    const result = await addTeamMember('grp-1', 'alice@example.com');

    expect(result.membership.id).toBe('mem-1');
    expect(mockApi).toHaveBeenCalledWith(
      '/admin/teams/grp-1/members',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
