/**
 * Auth Access Control View
 *
 * Admin UI for managing allowed users, admins, and domains for OAuth login.
 * Provides CRUD operations for:
 * - Allowed Users (individual emails)
 * - Allowed Domains (entire domains like @company.com)
 * - Access Requests (pending approval from unauthorized users)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Edit, Check, X, Search, RefreshCw,
  Globe, Mail, Shield, ShieldCheck, Clock, UserCheck, UserX
} from '@/shared/icons';
import { useAuth } from '../../../../app/providers/AuthContext';
import { apiRequest } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { PageHeader } from '../../primitives-v2';
import {
  AdminCard,
  StatCard,
  AdminButton,
  StatusBadge,
  SectionHeader,
  EmptyState,
  AdminInput,
} from '../Shell/AdminUI';

// Types
interface AllowedUser {
  id: string;
  email: string;
  is_admin: boolean;
  display_name: string | null;
  notes: string | null;
  added_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AllowedDomain {
  id: string;
  domain: string;
  is_admin_domain: boolean;
  notes: string | null;
  added_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AccessRequest {
  id: string;
  email: string;
  name: string | null;
  google_user_id: string | null;
  hosted_domain: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

type TabType = 'users' | 'domains' | 'requests';

export const AuthAccessControlView: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const token = getAuthHeaders()['Authorization']?.replace('Bearer ', '') || '';
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);

  // Search/filter
  const [searchTerm, setSearchTerm] = useState('');

  // Add/Edit modals
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [editingUser, setEditingUser] = useState<AllowedUser | null>(null);
  const [editingDomain, setEditingDomain] = useState<AllowedDomain | null>(null);

  // Form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);
  const [newUserDisplayName, setNewUserDisplayName] = useState('');
  const [newUserNotes, setNewUserNotes] = useState('');

  const [newDomain, setNewDomain] = useState('');
  const [newDomainIsAdmin, setNewDomainIsAdmin] = useState(false);
  const [newDomainNotes, setNewDomainNotes] = useState('');

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, domainsRes, requestsRes] = await Promise.all([
        apiRequest('/api/admin/auth/users', { headers: { Authorization: `Bearer ${token}` } }),
        apiRequest('/api/admin/auth/domains', { headers: { Authorization: `Bearer ${token}` } }),
        apiRequest('/api/admin/auth/access-requests', { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      // Parse JSON from Response objects
      const usersData = await usersRes.json();
      const domainsData = await domainsRes.json();
      const requestsData = await requestsRes.json();

      setUsers(usersData.users || []);
      setDomains(domainsData.domains || []);
      setRequests(requestsData.requests || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch access control data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Add user
  const handleAddUser = async () => {
    try {
      const response = await apiRequest('/api/admin/auth/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: newUserEmail,
          is_admin: newUserIsAdmin,
          display_name: newUserDisplayName || undefined,
          notes: newUserNotes || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to add user (${response.status})`);
      }

      setShowAddUser(false);
      resetUserForm();
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to add user');
    }
  };

  // Update user
  const handleUpdateUser = async (user: AllowedUser) => {
    try {
      const response = await apiRequest(`/api/admin/auth/users/${user.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: user.email,
          is_admin: user.is_admin,
          display_name: user.display_name,
          notes: user.notes,
          is_active: user.is_active,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to update user (${response.status})`);
      }

      setEditingUser(null);
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    }
  };

  // Delete user
  const handleDeleteUser = async (id: string) => {
    if (!(await confirm('Are you sure you want to remove this user from the allowed list?', { variant: 'danger', title: 'Remove User' }))) return;
    try {
      const response = await apiRequest(`/api/admin/auth/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete user (${response.status})`);
      }

      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user');
    }
  };

  // Add domain
  const handleAddDomain = async () => {
    try {
      const response = await apiRequest('/api/admin/auth/domains', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          domain: newDomain,
          is_admin_domain: newDomainIsAdmin,
          notes: newDomainNotes || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to add domain (${response.status})`);
      }

      setShowAddDomain(false);
      resetDomainForm();
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to add domain');
    }
  };

  // Delete domain
  const handleDeleteDomain = async (id: string) => {
    if (!(await confirm('Are you sure you want to remove this domain from the allowed list?', { variant: 'danger', title: 'Remove Domain' }))) return;
    try {
      const response = await apiRequest(`/api/admin/auth/domains/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete domain (${response.status})`);
      }

      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to delete domain');
    }
  };

  // Approve access request
  const handleApproveRequest = async (id: string, makeAdmin: boolean = false) => {
    try {
      const response = await apiRequest(`/api/admin/auth/access-requests/${id}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_admin: makeAdmin }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to approve request (${response.status})`);
      }

      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to approve request');
    }
  };

  // Deny access request
  const handleDenyRequest = async (id: string) => {
    try {
      const response = await apiRequest(`/api/admin/auth/access-requests/${id}/deny`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to deny request (${response.status})`);
      }

      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to deny request');
    }
  };

  // Sync from environment
  const handleSyncFromEnv = async () => {
    try {
      const response = await apiRequest('/api/admin/auth/sync-from-env', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to sync from environment (${response.status})`);
      }

      const result = await response.json();
      alert(`Imported ${result.results?.users?.added || 0} users and ${result.results?.domains?.added || 0} domains from environment variables`);
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to sync from environment');
    }
  };

  const resetUserForm = () => {
    setNewUserEmail('');
    setNewUserIsAdmin(false);
    setNewUserDisplayName('');
    setNewUserNotes('');
  };

  const resetDomainForm = () => {
    setNewDomain('');
    setNewDomainIsAdmin(false);
    setNewDomainNotes('');
  };

  // Filter data based on search
  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.display_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredDomains = domains.filter(d =>
    d.domain.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredRequests = requests.filter(r =>
    r.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingRequests = requests.filter(r => r.status === 'pending');

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'Security', 'Auth Access']}
        title="Auth Access Control"
        explainer="Manage who can log in via Google OAuth — allowed users, allowed domains, and pending access requests."
        actions={[
          { label: 'Sync from ENV', onClick: () => { void handleSyncFromEnv(); } },
          { label: 'Refresh', primary: true, onClick: () => { void fetchData(); } },
        ]}
      />

      {/* Error display */}
      {error && (
        <div className="bg-error-500/10 border border-error/20 rounded-lg p-4 ap-text-error">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">Dismiss</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label="Allowed Users"
          value={users.filter(u => u.is_active).length}
          icon={<Users className="w-5 h-5" />}
        />
        <StatCard
          label="Admin Users"
          value={users.filter(u => u.is_admin && u.is_active).length}
          icon={<ShieldCheck className="w-5 h-5" />}
        />
        <StatCard
          label="Allowed Domains"
          value={domains.filter(d => d.is_active).length}
          icon={<Globe className="w-5 h-5" />}
        />
        <StatCard
          label="Pending Requests"
          value={pendingRequests.length}
          icon={<Clock className="w-5 h-5" />}
          highlight={pendingRequests.length > 0}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex space-x-8">
          {[
            { id: 'users' as TabType, label: 'Allowed Users', icon: Users, count: users.length },
            { id: 'domains' as TabType, label: 'Allowed Domains', icon: Globe, count: domains.length },
            { id: 'requests' as TabType, label: 'Access Requests', icon: Clock, count: pendingRequests.length },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary-500'
                  : 'border-transparent text-text-secondary hover:text-text-tertiary hover:border-border-hover'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  tab.id === 'requests' && pendingRequests.length > 0
                    ? 'bg-warning-500/20 ap-text-warning'
                    : 'bg-surface text-text-secondary'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Search & Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <AdminInput
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        {activeTab === 'users' && (
          <AdminButton variant="primary" onClick={() => setShowAddUser(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </AdminButton>
        )}
        {activeTab === 'domains' && (
          <AdminButton variant="primary" onClick={() => setShowAddDomain(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Domain
          </AdminButton>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-text-secondary">Loading...</div>
      ) : (
        <>
          {/* Users Tab */}
          {activeTab === 'users' && (
            <AdminCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary text-sm">
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Display Name</th>
                    <th className="pb-3 font-medium">Role</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Added</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-text-tertiary">
                        No allowed users found
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map(user => (
                      <tr key={user.id} className="border-b border-border/50 hover:bg-surface/30">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-text-tertiary" />
                            <span className="text-white">{user.email}</span>
                          </div>
                        </td>
                        <td className="py-3 text-text-secondary">{user.display_name || '-'}</td>
                        <td className="py-3">
                          {user.is_admin ? (
                            <StatusBadge variant="success">Admin</StatusBadge>
                          ) : (
                            <StatusBadge variant="default">User</StatusBadge>
                          )}
                        </td>
                        <td className="py-3">
                          {user.is_active ? (
                            <StatusBadge variant="success">Active</StatusBadge>
                          ) : (
                            <StatusBadge variant="error">Inactive</StatusBadge>
                          )}
                        </td>
                        <td className="py-3 text-text-secondary text-sm">
                          {new Date(user.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingUser(user)}
                              className="p-1.5 text-text-secondary hover:text-white hover:bg-surface rounded"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteUser(user.id)}
                              className="p-1.5 text-text-secondary hover:ap-text-error hover:bg-surface rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </AdminCard>
          )}

          {/* Domains Tab */}
          {activeTab === 'domains' && (
            <AdminCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary text-sm">
                    <th className="pb-3 font-medium">Domain</th>
                    <th className="pb-3 font-medium">Admin Domain</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Notes</th>
                    <th className="pb-3 font-medium">Added</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDomains.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-text-tertiary">
                        No allowed domains found
                      </td>
                    </tr>
                  ) : (
                    filteredDomains.map(domain => (
                      <tr key={domain.id} className="border-b border-border/50 hover:bg-surface/30">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-text-tertiary" />
                            <span className="text-white">@{domain.domain}</span>
                          </div>
                        </td>
                        <td className="py-3">
                          {domain.is_admin_domain ? (
                            <StatusBadge variant="warning">All Admins</StatusBadge>
                          ) : (
                            <StatusBadge variant="default">Users Only</StatusBadge>
                          )}
                        </td>
                        <td className="py-3">
                          {domain.is_active ? (
                            <StatusBadge variant="success">Active</StatusBadge>
                          ) : (
                            <StatusBadge variant="error">Inactive</StatusBadge>
                          )}
                        </td>
                        <td className="py-3 text-text-secondary text-sm truncate max-w-xs">
                          {domain.notes || '-'}
                        </td>
                        <td className="py-3 text-text-secondary text-sm">
                          {new Date(domain.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => handleDeleteDomain(domain.id)}
                            className="p-1.5 text-text-secondary hover:ap-text-error hover:bg-surface rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </AdminCard>
          )}

          {/* Access Requests Tab */}
          {activeTab === 'requests' && (
            <AdminCard>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary text-sm">
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Domain</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Requested</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-text-tertiary">
                        No access requests found
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map(request => (
                      <tr key={request.id} className="border-b border-border/50 hover:bg-surface/30">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-text-tertiary" />
                            <span className="text-white">{request.email}</span>
                          </div>
                        </td>
                        <td className="py-3 text-text-secondary">{request.name || '-'}</td>
                        <td className="py-3 text-text-secondary">{request.hosted_domain || '-'}</td>
                        <td className="py-3">
                          {request.status === 'pending' && (
                            <StatusBadge variant="warning">Pending</StatusBadge>
                          )}
                          {request.status === 'approved' && (
                            <StatusBadge variant="success">Approved</StatusBadge>
                          )}
                          {request.status === 'denied' && (
                            <StatusBadge variant="error">Denied</StatusBadge>
                          )}
                        </td>
                        <td className="py-3 text-text-secondary text-sm">
                          {new Date(request.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          {request.status === 'pending' && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleApproveRequest(request.id, false)}
                                className="p-1.5 text-text-secondary hover:ap-text-success hover:bg-surface rounded"
                                title="Approve as User"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleApproveRequest(request.id, true)}
                                className="p-1.5 text-text-secondary hover:text-primary-500 hover:bg-surface rounded"
                                title="Approve as Admin"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDenyRequest(request.id)}
                                className="p-1.5 text-text-secondary hover:ap-text-error hover:bg-surface rounded"
                                title="Deny"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </AdminCard>
          )}
        </>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md border border-border">
            <h3 className="text-lg font-semibold text-white mb-4">Add Allowed User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Email *</label>
                <AdminInput
                  type="email"
                  placeholder="user@example.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Display Name</label>
                <AdminInput
                  type="text"
                  placeholder="John Doe"
                  value={newUserDisplayName}
                  onChange={(e) => setNewUserDisplayName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Notes</label>
                <AdminInput
                  type="text"
                  placeholder="Optional notes..."
                  value={newUserNotes}
                  onChange={(e) => setNewUserNotes(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={newUserIsAdmin}
                  onChange={(e) => setNewUserIsAdmin(e.target.checked)}
                  className="rounded border-border-hover bg-surface text-primary-500"
                />
                <label htmlFor="isAdmin" className="text-sm text-text-secondary">
                  Grant admin privileges
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <AdminButton variant="secondary" onClick={() => { setShowAddUser(false); resetUserForm(); }}>
                Cancel
              </AdminButton>
              <AdminButton variant="primary" onClick={handleAddUser} disabled={!newUserEmail}>
                Add User
              </AdminButton>
            </div>
          </div>
        </div>
      )}

      {/* Add Domain Modal */}
      {showAddDomain && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md border border-border">
            <h3 className="text-lg font-semibold text-white mb-4">Add Allowed Domain</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Domain *</label>
                <AdminInput
                  type="text"
                  placeholder="example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                />
                <p className="text-xs text-text-tertiary mt-1">
                  All users with @{newDomain || 'domain.com'} email addresses will be allowed to log in
                </p>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Notes</label>
                <AdminInput
                  type="text"
                  placeholder="Optional notes..."
                  value={newDomainNotes}
                  onChange={(e) => setNewDomainNotes(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAdminDomain"
                  checked={newDomainIsAdmin}
                  onChange={(e) => setNewDomainIsAdmin(e.target.checked)}
                  className="rounded border-border-hover bg-surface text-primary-500"
                />
                <label htmlFor="isAdminDomain" className="text-sm text-text-secondary">
                  All users from this domain are admins
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <AdminButton variant="secondary" onClick={() => { setShowAddDomain(false); resetDomainForm(); }}>
                Cancel
              </AdminButton>
              <AdminButton variant="primary" onClick={handleAddDomain} disabled={!newDomain}>
                Add Domain
              </AdminButton>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-full max-w-md border border-border">
            <h3 className="text-lg font-semibold text-white mb-4">Edit User</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Email</label>
                <AdminInput
                  type="email"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Display Name</label>
                <AdminInput
                  type="text"
                  value={editingUser.display_name || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, display_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Notes</label>
                <AdminInput
                  type="text"
                  value={editingUser.notes || ''}
                  onChange={(e) => setEditingUser({ ...editingUser, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editIsAdmin"
                    checked={editingUser.is_admin}
                    onChange={(e) => setEditingUser({ ...editingUser, is_admin: e.target.checked })}
                    className="rounded border-border-hover bg-surface text-primary-500"
                  />
                  <label htmlFor="editIsAdmin" className="text-sm text-text-secondary">
                    Admin
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editIsActive"
                    checked={editingUser.is_active}
                    onChange={(e) => setEditingUser({ ...editingUser, is_active: e.target.checked })}
                    className="rounded border-border-hover bg-surface text-primary-500"
                  />
                  <label htmlFor="editIsActive" className="text-sm text-text-secondary">
                    Active
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <AdminButton variant="secondary" onClick={() => setEditingUser(null)}>
                Cancel
              </AdminButton>
              <AdminButton variant="primary" onClick={() => handleUpdateUser(editingUser)}>
                Save Changes
              </AdminButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthAccessControlView;
