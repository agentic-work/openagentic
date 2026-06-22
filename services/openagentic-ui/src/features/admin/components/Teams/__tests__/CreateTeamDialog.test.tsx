/**
 * TDD — CreateTeamDialog
 *
 * Tests:
 *   C1  Renders nothing when open=false
 *   C2  Renders form fields (name, display_name, description, cost_center) when open=true
 *   C3  Submit calls createTeam API with form values
 *   C4  Shows error message on API failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../../../services/teamsAdminApi', () => ({
  createTeam: vi.fn(),
}));

import { createTeam } from '../../../services/teamsAdminApi';
import { CreateTeamDialog } from '../CreateTeamDialog';

const mockCreateTeam = createTeam as ReturnType<typeof vi.fn>;

describe('CreateTeamDialog', () => {
  const onClose = vi.fn();
  const onCreated = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  // C1
  it('C1: renders nothing when open=false', () => {
    render(
      <CreateTeamDialog open={false} onClose={onClose} onCreated={onCreated} existingTeams={[]} />,
    );
    expect(screen.queryByText(/create team/i)).not.toBeInTheDocument();
  });

  // C2
  it('C2: renders form fields when open=true', () => {
    render(
      <CreateTeamDialog open={true} onClose={onClose} onCreated={onCreated} existingTeams={[]} />,
    );
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cost center/i)).toBeInTheDocument();
  });

  // C3
  it('C3: submit calls createTeam with form values', async () => {
    const created = {
      id: 'grp-new',
      name: 'design',
      display_name: 'Design',
      member_count: 0,
      shared_flows_count: 0,
    };
    mockCreateTeam.mockResolvedValue({ team: created });

    render(
      <CreateTeamDialog open={true} onClose={onClose} onCreated={onCreated} existingTeams={[]} />,
    );

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'design' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Design' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(mockCreateTeam).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'design', display_name: 'Design' }),
    ));
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  // C4
  it('C4: shows error message on API failure', async () => {
    mockCreateTeam.mockRejectedValue(new Error('Team name already taken'));

    render(
      <CreateTeamDialog open={true} onClose={onClose} onCreated={onCreated} existingTeams={[]} />,
    );

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'engineering' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Eng' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() =>
      expect(screen.getByText(/team name already taken/i)).toBeInTheDocument(),
    );
  });
});
