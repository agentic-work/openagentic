/**
 * TeamsManagementView — Admin Console > OpenAgentic Flows > Teams
 *
 * Displays a table of UserGroup (Team) records with columns:
 *   Name, Display Name, Cost Center, Members, Shared Flows
 *
 * Features:
 *   - Search/filter by name
 *   - Create Team dialog
 *   - Row click opens TeamDetailDialog (Members / Shared Flows / Settings tabs)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AdminTable } from '../Shared/AdminTable';
import type { AdminTableColumn } from '../Shared/AdminTable';
import { CreateTeamDialog } from './CreateTeamDialog';
import { TeamDetailDialog } from './TeamDetailDialog';
import { fetchTeams } from '../../services/teamsAdminApi';
import type { Team } from '../../services/teamsAdminApi';
import { PageHeader } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TeamsManagementViewProps {
  theme?: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Table columns
// ---------------------------------------------------------------------------

const COLUMNS: AdminTableColumn<Team>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'display_name', header: 'Display Name', sortable: true },
  { key: 'cost_center', header: 'Cost Center', sortable: true,
    render: (val) => (val ? String(val) : '—') },
  { key: 'member_count', header: 'Members', align: 'center', sortable: true,
    render: (val) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{String(val ?? 0)}</span> },
  { key: 'shared_flows_count', header: 'Shared Flows', align: 'center', sortable: true,
    render: (val) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{String(val ?? 0)}</span> },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamsManagementView({ theme = 'dark' }: TeamsManagementViewProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTeams();
      setTeams(data.teams);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? teams.filter(
        t =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.display_name.toLowerCase().includes(search.toLowerCase()),
      )
    : teams;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        crumbs={['Admin', 'Flows', 'Teams']}
        title="Teams"
        explainer="Manage user groups and flow associations."
        actions={[
          { label: 'Create Team', primary: true, onClick: () => setCreateOpen(true) },
        ]}
      />

      {/* Search */}
      <input
        type="search"
        placeholder="Search by name…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-sm rounded px-3 py-1.5 text-sm"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--text-primary)',
        }}
      />

      {/* Loading / Error / Table */}
      {loading ? (
        <div style={{ color: 'var(--text-secondary)' }} className="py-10 text-center text-sm">
          Loading…
        </div>
      ) : error ? (
        <div className="py-10 text-center">
          <p style={{ color: 'var(--color-error)' }} className="text-sm mb-3">
            {error}
          </p>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded text-xs"
            style={{ border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <AdminTable
          columns={COLUMNS}
          data={filtered}
          keyExtractor={row => row.id}
          onRowClick={row => setSelectedTeam(row)}
          emptyMessage="No teams found."
        />
      )}

      {/* Dialogs */}
      <CreateTeamDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load(); }}
        existingTeams={teams}
      />

      {selectedTeam && (
        <TeamDetailDialog
          team={selectedTeam}
          onClose={() => setSelectedTeam(null)}
          onUpdated={load}
        />
      )}
    </div>
  );
}

export default TeamsManagementView;
