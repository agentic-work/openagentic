/**
 * TDD — TeamsManagementView
 *
 * Tests:
 *   V1  Renders loading state while fetching teams
 *   V2  Renders teams table with Name, Display Name, Members, Shared Flows columns
 *   V3  Renders empty state when no teams exist
 *   V4  "Create Team" button opens CreateTeamDialog
 *   V5  Clicking a row opens TeamDetailDialog
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------
vi.mock('../../../services/teamsAdminApi', () => ({
  fetchTeams: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock child dialogs
// ---------------------------------------------------------------------------
vi.mock('../CreateTeamDialog', () => ({
  CreateTeamDialog: ({ open, onClose }: any) =>
    open ? <div data-testid="create-team-dialog"><button onClick={onClose}>close</button></div> : null,
}));

vi.mock('../TeamDetailDialog', () => ({
  TeamDetailDialog: ({ team, onClose }: any) =>
    team ? <div data-testid="team-detail-dialog" data-team-id={team.id}><button onClick={onClose}>close</button></div> : null,
}));

import { fetchTeams } from '../../../services/teamsAdminApi';
import { TeamsManagementView } from '../TeamsManagementView';

const mockFetchTeams = fetchTeams as ReturnType<typeof vi.fn>;

const TEAMS_FIXTURE = [
  {
    id: 'grp-1',
    name: 'engineering',
    display_name: 'Engineering',
    description: null,
    cost_center: 'CC-100',
    billing_contact_email: null,
    parent_group_id: null,
    metadata: {},
    is_active: true,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    member_count: 5,
    shared_flows_count: 3,
  },
];

describe('TeamsManagementView', () => {
  beforeEach(() => vi.clearAllMocks());

  // V1
  it('V1: renders loading state while fetching teams', () => {
    mockFetchTeams.mockReturnValue(new Promise(() => {})); // never resolves
    render(<TeamsManagementView theme="dark" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // V2
  it('V2: renders teams table with expected columns', async () => {
    mockFetchTeams.mockResolvedValue({ teams: TEAMS_FIXTURE });
    render(<TeamsManagementView theme="dark" />);

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    expect(screen.getByText('engineering')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();   // member_count
    expect(screen.getByText('3')).toBeInTheDocument();   // shared_flows_count
  });

  // V3
  it('V3: renders empty state when no teams exist', async () => {
    mockFetchTeams.mockResolvedValue({ teams: [] });
    render(<TeamsManagementView theme="dark" />);

    await waitFor(() => expect(screen.getByText(/no teams/i)).toBeInTheDocument());
  });

  // V4
  it('V4: "Create Team" button opens CreateTeamDialog', async () => {
    mockFetchTeams.mockResolvedValue({ teams: TEAMS_FIXTURE });
    render(<TeamsManagementView theme="dark" />);

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    expect(screen.getByTestId('create-team-dialog')).toBeInTheDocument();
  });

  // V5
  it('V5: clicking a team row opens TeamDetailDialog', async () => {
    mockFetchTeams.mockResolvedValue({ teams: TEAMS_FIXTURE });
    render(<TeamsManagementView theme="dark" />);

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Engineering'));
    expect(screen.getByTestId('team-detail-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('team-detail-dialog').getAttribute('data-team-id')).toBe('grp-1');
  });
});
