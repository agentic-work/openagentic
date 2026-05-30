/**
 * TDD — TeamDetailDialog
 *
 * Tests:
 *   D1  Renders three tabs: Members, Shared Flows, Settings
 *   D2  Members tab loads and shows user list
 *   D3  Shared Flows tab shows workflow shares
 *   D4  Settings tab shows editable team fields
 *   D5  Close button calls onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../../services/teamsAdminApi', () => ({
  fetchTeamMembers: vi.fn(),
  fetchSharedFlows: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  shareFlowWithTeam: vi.fn(),
  revokeFlowShare: vi.fn(),
  updateTeam: vi.fn(),
}));

import {
  fetchTeamMembers,
  fetchSharedFlows,
} from '../../../services/teamsAdminApi';
import { TeamDetailDialog } from '../TeamDetailDialog';

const mockFetchMembers = fetchTeamMembers as ReturnType<typeof vi.fn>;
const mockFetchShared = fetchSharedFlows as ReturnType<typeof vi.fn>;

const TEAM = {
  id: 'grp-1',
  name: 'engineering',
  display_name: 'Engineering',
  description: 'Eng team',
  parent_group_id: null,
  cost_center: 'CC-100',
  billing_contact_email: null,
  metadata: {},
  is_active: true,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  member_count: 1,
  shared_flows_count: 1,
};

const MEMBERS = [
  {
    id: 'mem-1',
    user_id: 'u-1',
    group_id: 'grp-1',
    role: 'member',
    is_primary: false,
    joined_at: '2026-01-01T00:00:00Z',
    added_by: null,
    user: { id: 'u-1', email: 'alice@example.com', name: 'Alice' },
  },
];

const SHARES = [
  {
    id: 'share-1',
    workflow_id: 'wf-1',
    share_type: 'group',
    target_id: 'grp-1',
    role: 'viewer',
    shared_by: 'admin',
    created_at: '2026-01-01T00:00:00Z',
    workflow: { id: 'wf-1', name: 'Research Flow', is_active: true },
  },
];

describe('TeamDetailDialog', () => {
  const onClose = vi.fn();
  const onUpdated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchMembers.mockResolvedValue({ members: MEMBERS });
    mockFetchShared.mockResolvedValue({ shares: SHARES });
  });

  // D1
  it('D1: renders three tabs: Members, Shared Flows, Settings', async () => {
    render(<TeamDetailDialog team={TEAM} onClose={onClose} onUpdated={onUpdated} />);

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    expect(screen.getByRole('tab', { name: /members/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /shared flows/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  // D2
  it('D2: Members tab shows user list', async () => {
    render(<TeamDetailDialog team={TEAM} onClose={onClose} onUpdated={onUpdated} />);

    await waitFor(() => expect(screen.getByText('alice@example.com')).toBeInTheDocument());
  });

  // D3
  it('D3: Shared Flows tab shows workflow shares', async () => {
    render(<TeamDetailDialog team={TEAM} onClose={onClose} onUpdated={onUpdated} />);

    // click Shared Flows tab
    await waitFor(() => expect(screen.getByRole('tab', { name: /shared flows/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /shared flows/i }));

    await waitFor(() => expect(screen.getByText('Research Flow')).toBeInTheDocument());
  });

  // D4
  it('D4: Settings tab shows editable team fields', async () => {
    render(<TeamDetailDialog team={TEAM} onClose={onClose} onUpdated={onUpdated} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /settings/i }));

    // Should show display_name field prefilled
    await waitFor(() => {
      const input = screen.getByDisplayValue('Engineering');
      expect(input).toBeInTheDocument();
    });
  });

  // D5
  it('D5: close button calls onClose', async () => {
    render(<TeamDetailDialog team={TEAM} onClose={onClose} onUpdated={onUpdated} />);

    await waitFor(() => expect(screen.getByText('Engineering')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
