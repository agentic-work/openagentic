/**
 * UserLockoutView - Manage Locked User Accounts
 *
 * Displays and manages users who have been locked due to scope violations:
 * - View all locked users with lock reason and time
 * - View users with active warnings
 * - Unlock individual users
 * - Reset warning counts
 * - Bulk unlock selected users
 *
 * Uses AdminTable component with CSS variables for theming.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Lock,
  Unlock,
  AlertTriangle,
  RefreshCw,
  Users,
  Search,
  CheckCircle,
  X,
  Calendar,
  Shield,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { apiRequest } from '@/utils/api';
import SlideInPanel, { SlideInPanelSection, SlideInPanelFooter } from '@/shared/components/SlideInPanel';
import { AdminTable, TableActionButton, TableBadge } from '../Shared';
import type { AdminTableColumn } from '../Shared';
import { PageHeader } from '../../primitives-v2';

interface LockedUser {
  id: string;
  email: string;
  name: string | null;
  is_locked: boolean;
  scope_warning_count: number;
  locked_at: string | null;
  locked_reason: string | null;
  last_login_at: string | null;
  created_at: string;
  selected?: boolean;
}

interface UserLockoutViewProps {
  theme?: string;
}

const UserLockoutView: React.FC<UserLockoutViewProps> = () => {
  const { getAuthHeaders } = useAuth();
  const [lockedUsers, setLockedUsers] = useState<LockedUser[]>([]);
  const [warningUsers, setWarningUsers] = useState<LockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showDetailsPanel, setShowDetailsPanel] = useState(false);
  const [selectedUser, setSelectedUser] = useState<LockedUser | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchLockedUsers();
  }, []);

  const fetchLockedUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();

      // Fetch locked users
      const lockedResponse = await apiRequest('/admin/user-management/locked', { headers });
      const lockedData = await lockedResponse.json();

      // Separate truly locked users from warning users
      const allUsers: LockedUser[] = Array.isArray(lockedData) ? lockedData : lockedData.users || [];
      setLockedUsers(allUsers.filter(u => u.is_locked));
      setWarningUsers(allUsers.filter(u => !u.is_locked && u.scope_warning_count > 0));
    } catch (err) {
      console.error('Failed to fetch locked users:', err);
      setError(err instanceof Error ? err.message : 'Failed to load locked users');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockUser = async (userId: string, userName: string) => {
    setActionLoading(userId);
    setError(null);
    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/unlock`, {
        method: 'POST',
        headers
      });
      setSuccess(`Successfully unlocked ${userName}'s account`);
      await fetchLockedUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock user');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetWarnings = async (userId: string, userName: string) => {
    setActionLoading(userId);
    setError(null);
    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/reset-warnings`, {
        method: 'POST',
        headers
      });
      setSuccess(`Successfully reset warnings for ${userName}`);
      await fetchLockedUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset warnings');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkUnlock = async () => {
    if (selectedUsers.size === 0) return;

    setActionLoading('bulk');
    setError(null);
    try {
      const headers = getAuthHeaders();
      const promises = Array.from(selectedUsers).map(userId =>
        apiRequest(`/admin/user-management/${userId}/unlock`, {
          method: 'POST',
          headers
        })
      );
      await Promise.all(promises);
      setSuccess(`Successfully unlocked ${selectedUsers.size} users`);
      setSelectedUsers(new Set());
      await fetchLockedUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock some users');
    } finally {
      setActionLoading(null);
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelection = new Set(selectedUsers);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUsers(newSelection);
  };

  const selectAllLocked = () => {
    if (selectedUsers.size === filteredLockedUsers.length && filteredLockedUsers.length > 0) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredLockedUsers.map(u => u.id)));
    }
  };

  const viewUserDetails = (user: LockedUser) => {
    setSelectedUser(user);
    setShowDetailsPanel(true);
  };

  const filteredLockedUsers = useMemo(() =>
    lockedUsers.filter(user =>
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [lockedUsers, searchTerm]
  );

  const filteredWarningUsers = useMemo(() =>
    warningUsers.filter(user =>
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [warningUsers, searchTerm]
  );

  // Table columns for locked users
  const lockedUserColumns: AdminTableColumn<LockedUser>[] = [
    {
      key: 'select',
      header: '',
      width: '50px',
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedUsers.has(row.id)}
          onChange={() => toggleUserSelection(row.id)}
          className="rounded"
          style={{ accentColor: 'var(--color-primary)' }}
        />
      ),
    },
    {
      key: 'user',
      header: 'User',
      render: (_, row) => (
        <div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {row.name || 'Unknown'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {row.email}
          </p>
        </div>
      ),
    },
    {
      key: 'locked_at',
      header: 'Locked At',
      render: (_, row) => (
        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Calendar size={14} />
          <span className="text-sm">
            {row.locked_at ? new Date(row.locked_at).toLocaleString() : 'N/A'}
          </span>
        </div>
      ),
    },
    {
      key: 'locked_reason',
      header: 'Reason',
      render: (_, row) => (
        <p
          className="text-sm max-w-[200px] truncate"
          style={{ color: 'var(--text-secondary)' }}
          title={row.locked_reason || 'No reason provided'}
        >
          {row.locked_reason || 'No reason provided'}
        </p>
      ),
    },
    {
      key: 'scope_warning_count',
      header: 'Warnings',
      align: 'center',
      render: (_, row) => (
        <TableBadge variant="error">
          {row.scope_warning_count}/3
        </TableBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (_, row) => (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => handleUnlockUser(row.id, row.name || row.email)}
            disabled={actionLoading === row.id}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
              color: 'var(--color-success)',
            }}
            title="Unlock user"
          >
            <Unlock size={14} />
            {actionLoading === row.id ? '...' : 'Unlock'}
          </button>
          <TableActionButton
            onClick={() => viewUserDetails(row)}
            title="View details"
          >
            <Users size={14} />
          </TableActionButton>
        </div>
      ),
    },
  ];

  // Table columns for warning users
  const warningUserColumns: AdminTableColumn<LockedUser>[] = [
    {
      key: 'user',
      header: 'User',
      render: (_, row) => (
        <div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {row.name || 'Unknown'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {row.email}
          </p>
        </div>
      ),
    },
    {
      key: 'scope_warning_count',
      header: 'Warnings',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: n <= row.scope_warning_count
                    ? 'var(--color-warning)'
                    : 'var(--color-surfaceTertiary)'
                }}
              />
            ))}
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-warning)' }}>
            {row.scope_warning_count}/3
          </span>
        </div>
      ),
    },
    {
      key: 'last_login_at',
      header: 'Last Login',
      render: (_, row) => (
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {row.last_login_at
            ? new Date(row.last_login_at).toLocaleDateString()
            : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (_, row) => (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => handleResetWarnings(row.id, row.name || row.email)}
            disabled={actionLoading === row.id}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
              color: 'var(--color-warning)',
            }}
            title="Reset warnings"
          >
            <RefreshCw size={14} />
            {actionLoading === row.id ? '...' : 'Reset'}
          </button>
          <TableActionButton
            onClick={() => viewUserDetails(row)}
            title="View details"
          >
            <Users size={14} />
          </TableActionButton>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: '2px solid var(--color-border)',
            borderTopColor: 'var(--color-primary)',
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Security', 'Lockouts']}
        title="User Lockouts"
        explainer="Manage locked user accounts and warning counts from scope violations."
      />

      {/* Messages */}
      {error && (
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 50%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} />
            <span style={{ color: 'var(--color-error)' }}>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 rounded transition-colors"
              style={{ color: 'var(--color-error)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-success) 50%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle size={20} style={{ color: 'var(--color-success)' }} />
            <span style={{ color: 'var(--color-success)' }}>{success}</span>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            borderLeft: '4px solid var(--color-error)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Locked Users</p>
              <p className="text-3xl font-bold" style={{ color: 'var(--color-error)' }}>
                {lockedUsers.length}
              </p>
            </div>
            <Lock size={40} style={{ color: 'var(--color-error)', opacity: 0.5 }} />
          </div>
        </div>

        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            borderLeft: '4px solid var(--color-warning)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>With Warnings</p>
              <p className="text-3xl font-bold" style={{ color: 'var(--color-warning)' }}>
                {warningUsers.length}
              </p>
            </div>
            <AlertTriangle size={40} style={{ color: 'var(--color-warning)', opacity: 0.5 }} />
          </div>
        </div>

        <div
          className="p-4 rounded-lg"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            borderLeft: '4px solid var(--color-success)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Total Flagged</p>
              <p className="text-3xl font-bold" style={{ color: 'var(--color-success)' }}>
                {lockedUsers.length + warningUsers.length}
              </p>
            </div>
            <Shield size={40} style={{ color: 'var(--color-success)', opacity: 0.5 }} />
          </div>
        </div>
      </div>

      {/* Search and Actions Bar */}
      <div
        className="p-4 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-[300px]">
            <Search size={20} style={{ color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search users by email or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <button
            onClick={fetchLockedUsers}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent',
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>

          {selectedUsers.size > 0 && (
            <button
              onClick={handleBulkUnlock}
              disabled={actionLoading === 'bulk'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-success)', color: 'var(--ap-fg-0)' }}
            >
              <Unlock size={16} />
              {actionLoading === 'bulk' ? 'Unlocking...' : `Unlock ${selectedUsers.size} Selected`}
            </button>
          )}
        </div>
      </div>

      {/* Locked Users Table */}
      <div
        className="p-6 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Lock size={20} style={{ color: 'var(--color-error)' }} />
            Locked Users ({filteredLockedUsers.length})
          </h3>
          {filteredLockedUsers.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={selectedUsers.size === filteredLockedUsers.length}
                onChange={selectAllLocked}
                className="rounded"
                style={{ accentColor: 'var(--color-primary)' }}
              />
              Select All
            </label>
          )}
        </div>

        {filteredLockedUsers.length > 0 ? (
          <AdminTable
            columns={lockedUserColumns}
            data={filteredLockedUsers}
            keyExtractor={(row) => row.id}
            compact
          />
        ) : (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <Lock size={48} className="mx-auto mb-3 opacity-50" />
            <p>No locked users found.</p>
          </div>
        )}
      </div>

      {/* Users with Warnings Table */}
      <div
        className="p-6 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3 className="text-xl font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <AlertTriangle size={20} style={{ color: 'var(--color-warning)' }} />
          Users with Warnings ({filteredWarningUsers.length})
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          These users have received scope violation warnings but are not yet locked (3 warnings = lockout).
        </p>

        {filteredWarningUsers.length > 0 ? (
          <AdminTable
            columns={warningUserColumns}
            data={filteredWarningUsers}
            keyExtractor={(row) => row.id}
            compact
          />
        ) : (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            <CheckCircle size={48} className="mx-auto mb-3 opacity-50" style={{ color: 'var(--color-success)' }} />
            <p>No users with active warnings.</p>
          </div>
        )}
      </div>

      {/* User Details Panel */}
      <SlideInPanel
        isOpen={showDetailsPanel}
        onClose={() => {
          setShowDetailsPanel(false);
          setSelectedUser(null);
        }}
        title={selectedUser?.name || selectedUser?.email || 'User Details'}
        subtitle={selectedUser?.email}
        width="md"
        icon={<Users size={20} />}
        footer={
          <SlideInPanelFooter
            onCancel={() => {
              setShowDetailsPanel(false);
              setSelectedUser(null);
            }}
            onSubmit={() => {
              if (selectedUser) {
                if (selectedUser.is_locked) {
                  handleUnlockUser(selectedUser.id, selectedUser.name || selectedUser.email);
                } else {
                  handleResetWarnings(selectedUser.id, selectedUser.name || selectedUser.email);
                }
              }
              setShowDetailsPanel(false);
            }}
            cancelText="Close"
            submitText={selectedUser?.is_locked ? 'Unlock User' : 'Reset Warnings'}
            submitVariant={selectedUser?.is_locked ? 'success' : 'primary'}
          />
        }
      >
        {selectedUser && (
          <>
            <SlideInPanelSection title="Account Status">
              <div
                className="p-4 rounded-lg"
                style={{
                  backgroundColor: selectedUser.is_locked
                    ? 'color-mix(in srgb, var(--color-error) 10%, transparent)'
                    : 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                  border: `1px solid ${selectedUser.is_locked
                    ? 'color-mix(in srgb, var(--color-error) 30%, transparent)'
                    : 'color-mix(in srgb, var(--color-warning) 30%, transparent)'
                  }`,
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  {selectedUser.is_locked ? (
                    <Lock size={24} style={{ color: 'var(--color-error)' }} />
                  ) : (
                    <AlertTriangle size={24} style={{ color: 'var(--color-warning)' }} />
                  )}
                  <span
                    className="text-lg font-semibold"
                    style={{ color: selectedUser.is_locked ? 'var(--color-error)' : 'var(--color-warning)' }}
                  >
                    {selectedUser.is_locked ? 'Account Locked' : 'Active Warnings'}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {selectedUser.is_locked
                    ? 'This user has been locked due to repeated scope violations.'
                    : 'This user has received warnings but is not yet locked.'}
                </p>
              </div>
            </SlideInPanelSection>

            <SlideInPanelSection title="Details">
              <div className="space-y-3">
                <div
                  className="flex justify-between py-2"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>User ID</span>
                  <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                    {selectedUser.id}
                  </span>
                </div>
                <div
                  className="flex justify-between py-2"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Email</span>
                  <span style={{ color: 'var(--text-primary)' }}>{selectedUser.email}</span>
                </div>
                <div
                  className="flex justify-between py-2"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Warning Count</span>
                  <span className="font-medium" style={{ color: 'var(--color-warning)' }}>
                    {selectedUser.scope_warning_count}/3
                  </span>
                </div>
                {selectedUser.locked_at && (
                  <div
                    className="flex justify-between py-2"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>Locked At</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      {new Date(selectedUser.locked_at).toLocaleString()}
                    </span>
                  </div>
                )}
                {selectedUser.locked_reason && (
                  <div className="py-2">
                    <span className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Lock Reason
                    </span>
                    <p
                      className="text-sm p-2 rounded"
                      style={{
                        backgroundColor: 'var(--color-surfaceTertiary)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {selectedUser.locked_reason}
                    </p>
                  </div>
                )}
                <div
                  className="flex justify-between py-2"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>Last Login</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {selectedUser.last_login_at
                      ? new Date(selectedUser.last_login_at).toLocaleString()
                      : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span style={{ color: 'var(--text-secondary)' }}>Account Created</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedUser.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </SlideInPanelSection>
          </>
        )}
      </SlideInPanel>
    </div>
  );
};

export default UserLockoutView;
