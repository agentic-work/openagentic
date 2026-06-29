/**
 * teamsAdminApi — fetch helpers for Teams management endpoints.
 *
 * Endpoints (backed by admin-teams.ts):
 *   GET    /api/admin/teams
 *   POST   /api/admin/teams
 *   PUT    /api/admin/teams/:id
 *   DELETE /api/admin/teams/:id
 *   GET    /api/admin/teams/:id/members
 *   POST   /api/admin/teams/:id/members
 *   DELETE /api/admin/teams/:id/members/:user_id
 *   GET    /api/admin/teams/:id/shared-flows
 *   POST   /api/admin/teams/:id/shared-flows
 *   DELETE /api/admin/teams/:id/shared-flows/:share_id
 */

import { apiRequest } from '@/utils/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  parent_group_id: string | null;
  cost_center: string | null;
  billing_contact_email: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
  shared_flows_count: number;
}

export interface TeamMember {
  id: string;
  user_id: string;
  group_id: string;
  role: string;
  is_primary: boolean;
  joined_at: string;
  added_by: string | null;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export interface SharedFlow {
  id: string;
  workflow_id: string;
  share_type: string;
  target_id: string;
  role: string;
  shared_by: string;
  created_at: string;
  workflow: {
    id: string;
    name: string;
    is_active: boolean;
  } | null;
}

export interface CreateTeamInput {
  name: string;
  display_name: string;
  description?: string;
  parent_group_id?: string;
  cost_center?: string;
  billing_contact_email?: string;
}

export interface UpdateTeamInput {
  display_name?: string;
  description?: string;
  parent_group_id?: string;
  cost_center?: string;
  billing_contact_email?: string;
  metadata?: Record<string, unknown>;
}

export type FlowRole = 'viewer' | 'editor' | 'executor' | 'admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkOk(res: Response, label: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} failed: ${res.status}${text ? ` — ${text}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Teams CRUD
// ---------------------------------------------------------------------------

export async function fetchTeams(): Promise<{ teams: Team[] }> {
  const res = await apiRequest('/admin/teams');
  await checkOk(res, 'fetchTeams');
  return res.json();
}

export async function createTeam(input: CreateTeamInput): Promise<{ team: Team }> {
  const res = await apiRequest('/admin/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await checkOk(res, 'createTeam');
  return res.json();
}

export async function updateTeam(id: string, input: UpdateTeamInput): Promise<{ team: Team }> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await checkOk(res, 'updateTeam');
  return res.json();
}

export async function deleteTeam(id: string): Promise<void> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await checkOk(res, 'deleteTeam');
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function fetchTeamMembers(teamId: string): Promise<{ members: TeamMember[] }> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(teamId)}/members`);
  await checkOk(res, 'fetchTeamMembers');
  return res.json();
}

export async function addTeamMember(
  teamId: string,
  userEmail: string,
): Promise<{ membership: TeamMember }> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_email: userEmail }),
  });
  await checkOk(res, 'addTeamMember');
  return res.json();
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const res = await apiRequest(
    `/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  await checkOk(res, 'removeTeamMember');
}

// ---------------------------------------------------------------------------
// Shared flows
// ---------------------------------------------------------------------------

export async function fetchSharedFlows(teamId: string): Promise<{ shares: SharedFlow[] }> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(teamId)}/shared-flows`);
  await checkOk(res, 'fetchSharedFlows');
  return res.json();
}

export async function shareFlowWithTeam(
  teamId: string,
  workflowId: string,
  role: FlowRole,
): Promise<{ share: SharedFlow }> {
  const res = await apiRequest(`/admin/teams/${encodeURIComponent(teamId)}/shared-flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: workflowId, role }),
  });
  await checkOk(res, 'shareFlowWithTeam');
  return res.json();
}

export async function revokeFlowShare(teamId: string, shareId: string): Promise<void> {
  const res = await apiRequest(
    `/admin/teams/${encodeURIComponent(teamId)}/shared-flows/${encodeURIComponent(shareId)}`,
    { method: 'DELETE' },
  );
  await checkOk(res, 'revokeFlowShare');
}
