/**
 * TeamsManagementView — chrome consistency tests (Bulk Batch B1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../services/teamsAdminApi', () => ({
  fetchTeams: vi.fn(() => Promise.resolve({ teams: [] })),
}));

vi.mock('../CreateTeamDialog', () => ({
  CreateTeamDialog: () => null,
}));

vi.mock('../TeamDetailDialog', () => ({
  TeamDetailDialog: () => null,
}));

import { TeamsManagementView } from '../TeamsManagementView';

describe('TeamsManagementView — chrome consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the universal PageHeader primitive at the top', async () => {
    render(<TeamsManagementView theme="dark" />);
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeDefined();
    });
  });

  it('PageHeader contains an <h1> with text matching /Teams/i', async () => {
    render(<TeamsManagementView theme="dark" />);
    const header = await waitFor(() => screen.getByTestId('page-header'));
    const h1 = within(header).getByRole('heading', { level: 1 });
    expect(h1.textContent || '').toMatch(/Teams/i);
  });

  it('renders no hex literals inside any inline style attribute', async () => {
    const { container } = render(<TeamsManagementView theme="dark" />);
    await waitFor(() => screen.getByTestId('page-header'));

    const html = container.innerHTML;
    const styleHexes = [...html.matchAll(/style="[^"]*"/g)]
      .flatMap(m => [...m[0].matchAll(/#[0-9a-fA-F]{3,8}\b/g)])
      .map(m => m[0]);
    expect(styleHexes).toEqual([]);
  });
});
