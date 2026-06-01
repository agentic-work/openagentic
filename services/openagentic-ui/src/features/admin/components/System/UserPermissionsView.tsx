import React, { useState, useEffect, useCallback } from 'react';
// Basic UI icons from lucide
import {
  Users, Edit, Save, X, Search, Image, Code, Globe, Upload, Brain,
  Unlock, Sparkles, FileText, Calendar, Terminal, Trash2,
  MessageSquare, Zap, Settings, Workflow
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import {
  User, AlertTriangle, CheckCircle, XCircle, Shield, Cpu, Server,
  Database, Timer as Clock, Lock, DollarSign
} from '../Shared/AdminIcons';
import { useAuth } from '../../../../app/providers/AuthContext';
import { apiRequest } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import {
  SlideInPanel,
  SlideInPanelFooter,
  SlideInPanelSection,
  SlideInPanelField,
} from '@/shared/components/SlideInPanel';
import { PageHeader } from '../../primitives-v2';

// API returns permissions in camelCase format
interface ApiPermissions {
  userId: string;
  allowedLlmProviders: string[];
  deniedLlmProviders: string[];
  allowedMcpServers: string[];
  deniedMcpServers: string[];
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  canUseImageGeneration: boolean;
  canUseCodeExecution: boolean;
  canUseWebSearch: boolean;
  canUseFileUpload: boolean;
  canUseMemory: boolean;
  canUseRag: boolean;
  canUseAwcode: boolean;
  source: 'user' | 'group' | 'default';
}

// API response from /admin/user-management
interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
  groups: string[];
  last_login_at: string | null;
  created_at: string;
  hasCustomPermissions: boolean;
  customPermissions: ApiPermissions | null;
  // Scope enforcement fields from User model
  is_locked?: boolean;
  scope_warning_count?: number;
  locked_at?: string | null;
  locked_reason?: string | null;
  // Prompt assignment
  prompt_template_id?: string | null;
  prompt_template_name?: string | null;
}

// Tab type for the edit panel
type PermissionTab = 'access' | 'features' | 'limits' | 'budget' | 'advanced';

// Normalized format for UI display
interface UserPermission {
  user_id: string;
  email: string;
  name: string;
  is_admin: boolean;
  groups: string[];
  // Permissions - mapped from API
  allowed_llms: string[];
  denied_llms: string[];
  allowed_mcps: string[];
  denied_mcps: string[];
  daily_token_limit: number | null;
  monthly_token_limit: number | null;
  daily_request_limit: number | null;
  monthly_request_limit: number | null;
  feature_flags: {
    image_generation: boolean;
    code_execution: boolean;
    web_search: boolean;
    file_upload: boolean;
    memory: boolean;
    rag: boolean;
    awcode: boolean;
  };
  // Custom permissions flag
  hasCustomPermissions: boolean;
  permissionSource: 'user' | 'group' | 'default';
  // Scope enforcement / lockout
  is_locked: boolean;
  scope_warning_count: number;
  locked_at: string | null;
  locked_reason: string | null;
  // Prompt template assignment
  prompt_template_id: string | null;
  prompt_template_name: string | null;
  created_at: string;
  updated_at: string;
}

interface AvailableLLM {
  id: string;
  name: string;
  provider_type: string;
}

interface AvailableMCP {
  id: string;
  name: string;
  description?: string;
}

// PromptTemplate interface removed (Phase W 2026-05-19) — /api/admin/prompts/templates 404.

interface UserBudget {
  budgetDollars: number | null;
  currentSpendDollars: number;
  remainingDollars: number | null;
  isOverBudget: boolean;
  autoAdjust: boolean;
  warningThreshold: number;
  hardLimit: boolean;
}

// Helper to map API user to UI format
function mapApiUserToPermission(apiUser: ApiUser): UserPermission {
  const perms = apiUser.customPermissions;
  return {
    user_id: apiUser.id,
    email: apiUser.email,
    name: apiUser.name || 'Unknown',
    is_admin: apiUser.is_admin,
    groups: apiUser.groups || [],
    // Map permissions from camelCase to snake_case
    allowed_llms: perms?.allowedLlmProviders || [],
    denied_llms: perms?.deniedLlmProviders || [],
    allowed_mcps: perms?.allowedMcpServers || [],
    denied_mcps: perms?.deniedMcpServers || [],
    daily_token_limit: perms?.dailyTokenLimit ?? null,
    monthly_token_limit: perms?.monthlyTokenLimit ?? null,
    daily_request_limit: perms?.dailyRequestLimit ?? null,
    monthly_request_limit: perms?.monthlyRequestLimit ?? null,
    feature_flags: {
      image_generation: perms?.canUseImageGeneration ?? true,
      code_execution: perms?.canUseCodeExecution ?? true,
      web_search: perms?.canUseWebSearch ?? true,
      file_upload: perms?.canUseFileUpload ?? true,
      memory: perms?.canUseMemory ?? true,
      rag: perms?.canUseRag ?? true,
      awcode: perms?.canUseAwcode ?? false,
    },
    hasCustomPermissions: apiUser.hasCustomPermissions,
    permissionSource: perms?.source || 'default',
    is_locked: apiUser.is_locked ?? false,
    scope_warning_count: apiUser.scope_warning_count ?? 0,
    locked_at: apiUser.locked_at ?? null,
    locked_reason: apiUser.locked_reason ?? null,
    prompt_template_id: apiUser.prompt_template_id ?? null,
    prompt_template_name: apiUser.prompt_template_name ?? null,
    created_at: apiUser.created_at,
    updated_at: apiUser.created_at, // API doesn't return updated_at for user list
  };
}

const UserPermissionsView: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [availableLLMs, setAvailableLLMs] = useState<AvailableLLM[]>([]);
  const [availableMCPs, setAvailableMCPs] = useState<AvailableMCP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserPermission | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<Partial<UserPermission> | null>(null);
  // editingPromptTemplateId removed (Phase W 2026-05-19) — dead endpoint.
  const [showEditModal, setShowEditModal] = useState(false);
  // 2026-04-20 — all slider state purged (task #144 final pass).
  // Budget state
  const [userBudget, setUserBudget] = useState<UserBudget | null>(null);
  const [editingBudget, setEditingBudget] = useState<{
    budgetDollars: number | null;
    autoAdjust: boolean;
    warningThreshold: number;
    hardLimit: boolean;
  } | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);
  // New fields
  const [activeTab, setActiveTab] = useState<PermissionTab>('access');
  const [editingCodeModeCli, setEditingCodeModeCli] = useState<string | null>(null);
  const [editingAdminNotes, setEditingAdminNotes] = useState<string>('');
  const [editingWorkflowsEnabled, setEditingWorkflowsEnabled] = useState(false);
  const [editingDailyRequestLimit, setEditingDailyRequestLimit] = useState<number | null>(null);
  const [editingMonthlyRequestLimit, setEditingMonthlyRequestLimit] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      // Phase W (2026-05-19): /admin/prompts/templates removed from parallel fetch —
      // endpoint returns 404 (PromptTemplate Prisma model dropped).
      const [usersData, llmsData, mcpsData] = await Promise.all([
        apiRequest('/admin/user-management', { headers }).then(r => r.json()),
        apiRequest('/admin/permissions/available-llms', { headers }).then(r => r.json()),
        apiRequest('/admin/permissions/available-mcps', { headers }).then(r => r.json()),
      ]);

      // Map API users to normalized UI format
      const apiUsers: ApiUser[] = Array.isArray(usersData) ? usersData : usersData.users || [];
      const mappedUsers = apiUsers.map(mapApiUserToPermission);

      setUsers(mappedUsers);
      setAvailableLLMs(Array.isArray(llmsData) ? llmsData : llmsData.providers || []);
      setAvailableMCPs(Array.isArray(mcpsData) ? mcpsData : mcpsData.servers || []);
    } catch (err) {
      console.error('Failed to fetch user permissions data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setUsers([]);
      setAvailableLLMs([]);
      setAvailableMCPs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = async (user: UserPermission) => {
    try {
      const headers = getAuthHeaders();

      // 2026-04-20 (task #144 tail cleanup) — slider fully gone from admin.
      // Phase W (2026-05-19): /admin/prompts/users/:id/templates removed — dead endpoint.
      const [permissionsResponse, budgetResponse] = await Promise.all([
        apiRequest(`/admin/user-management/${user.user_id}/permissions`, { headers }),
        apiRequest(`/admin/user-permissions/${user.user_id}/budget`, { headers }).catch(() => ({ json: async () => null })),
      ]);

      const permissions = await permissionsResponse.json();
      const budgetData = budgetResponse?.json ? await budgetResponse.json() : null;

      // API returns permissions in camelCase format
      const apiPerms = permissions.permissions || permissions;

      setSelectedUser(user);
      // Try to load effective permissions (includes rate limit tier source)
      let rateTier = 'standard';
      let rateTierSource = 'default';
      try {
        const effectiveResp = await apiRequest(`/admin/user-management/${user.user_id}/effective-permissions`, { headers });
        const effectiveData = await effectiveResp.json();
        if (effectiveData.effectiveRateLimits) {
          rateTier = effectiveData.effectiveRateLimits.tier || 'standard';
          rateTierSource = effectiveData.effectiveRateLimits.source || 'default';
        }
      } catch (e) {
        // Not critical
      }

      setEditingPermissions({
        user_id: user.user_id,
        // Map from API camelCase to UI snake_case
        allowed_llms: apiPerms.allowedLlmProviders || [],
        denied_llms: apiPerms.deniedLlmProviders || [],
        allowed_mcps: apiPerms.allowedMcpServers || [],
        denied_mcps: apiPerms.deniedMcpServers || [],
        daily_token_limit: apiPerms.dailyTokenLimit ?? null,
        monthly_token_limit: apiPerms.monthlyTokenLimit ?? null,
        daily_request_limit: apiPerms.dailyRequestLimit ?? null,
        monthly_request_limit: apiPerms.monthlyRequestLimit ?? null,
        rate_limit_tier: rateTier,
        _rateTierSource: rateTierSource,
        feature_flags: {
          image_generation: apiPerms.canUseImageGeneration ?? true,
          code_execution: apiPerms.canUseCodeExecution ?? true,
          web_search: apiPerms.canUseWebSearch ?? true,
          file_upload: apiPerms.canUseFileUpload ?? true,
          memory: apiPerms.canUseMemory ?? true,
          rag: apiPerms.canUseRag ?? true,
          awcode: apiPerms.canUseAwcode ?? false
        }
      } as any);

      // Set new field states
      setEditingCodeModeCli(apiPerms.codeModeCli ?? null);
      setEditingAdminNotes(apiPerms.adminNotes ?? '');
      setEditingWorkflowsEnabled(apiPerms.workflowsEnabled ?? false);
      setEditingDailyRequestLimit(apiPerms.dailyRequestLimit ?? null);
      setEditingMonthlyRequestLimit(apiPerms.monthlyRequestLimit ?? null);
      setActiveTab('access');

      // Set budget state
      if (budgetData && !budgetData.error) {
        setUserBudget(budgetData);
        setEditingBudget({
          budgetDollars: budgetData.budgetDollars,
          autoAdjust: budgetData.autoAdjust ?? false,
          warningThreshold: budgetData.warningThreshold ?? 80,
          hardLimit: budgetData.hardLimit ?? false,
        });
      } else {
        setUserBudget(null);
        setEditingBudget({
          budgetDollars: null,
          autoAdjust: false,
          warningThreshold: 80,
          hardLimit: false,
        });
      }

      setShowEditModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user permissions');
    }
  };

  const handleSavePermissions = async () => {
    if (!editingPermissions || !selectedUser) return;

    setIsSaving(true);
    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      // Map UI field names back to API camelCase format
      const apiPermissions = {
        allowedLlmProviders: editingPermissions.allowed_llms || [],
        deniedLlmProviders: editingPermissions.denied_llms || [],
        allowedMcpServers: editingPermissions.allowed_mcps || [],
        deniedMcpServers: editingPermissions.denied_mcps || [],
        workflowsEnabled: editingWorkflowsEnabled,
        dailyTokenLimit: editingPermissions.daily_token_limit,
        monthlyTokenLimit: editingPermissions.monthly_token_limit,
        dailyRequestLimit: editingDailyRequestLimit,
        monthlyRequestLimit: editingMonthlyRequestLimit,
        canUseImageGeneration: editingPermissions.feature_flags?.image_generation ?? true,
        canUseCodeExecution: editingPermissions.feature_flags?.code_execution ?? true,
        canUseWebSearch: editingPermissions.feature_flags?.web_search ?? true,
        canUseFileUpload: editingPermissions.feature_flags?.file_upload ?? true,
        canUseMemory: editingPermissions.feature_flags?.memory ?? true,
        canUseRag: editingPermissions.feature_flags?.rag ?? true,
        canUseAwcode: editingPermissions.feature_flags?.awcode ?? false,
        adminNotes: editingAdminNotes || undefined,
      };

      // Save permissions
      await apiRequest(`/admin/user-management/${selectedUser.user_id}/permissions`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(apiPermissions)
      });

      // 2026-04-19 — slider save block removed (task #144, slider rip).
      // Phase W (2026-05-19): prompt template assignment block removed — dead endpoint.

      // Save budget settings inline
      if (editingBudget) {
        await apiRequest(`/admin/user-permissions/${selectedUser.user_id}/budget`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            budgetDollars: editingBudget.budgetDollars,
            autoAdjust: editingBudget.autoAdjust,
            warningThreshold: editingBudget.warningThreshold,
            hardLimit: editingBudget.hardLimit,
          }),
        }).catch(() => {}); // Budget endpoint might not exist yet
      }

      await fetchData();
      closeEditPanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    } finally {
      setIsSaving(false);
    }
  };

  const closeEditPanel = useCallback(() => {
    setShowEditModal(false);
    setSelectedUser(null);
    setEditingPermissions(null);
    setUserBudget(null);
    setEditingBudget(null);
    setEditingCodeModeCli(null);
    setEditingAdminNotes('');
    setEditingWorkflowsEnabled(false);
    setEditingDailyRequestLimit(null);
    setEditingMonthlyRequestLimit(null);
    setActiveTab('access');
  }, []);

  const handleDeletePermissions = async (userId: string) => {
    if (!(await confirm('Are you sure you want to delete all custom permissions for this user? They will inherit default permissions.', { variant: 'danger', title: 'Delete Permissions' }))) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/permissions`, {
        method: 'DELETE',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete permissions');
    }
  };

  /**
   * Unlock a user account that was locked due to scope violations
   */
  const handleUnlockUser = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to unlock ${userName}'s account? This will also reset their warning count.`)) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/unlock`, {
        method: 'POST',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock user');
    }
  };

  /**
   * Reset a user's warning count without unlocking
   */
  const handleResetWarnings = async (userId: string, userName: string) => {
    if (!confirm(`Reset ${userName}'s warning count? They have not been locked yet.`)) return;

    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-management/${userId}/reset-warnings`, {
        method: 'POST',
        headers
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset warnings');
    }
  };

  /**
   * Permanently delete a user and all their data
   */
  const handleDeleteUser = async (userId: string, userEmail: string, isAdmin: boolean) => {
    // Prevent deletion of admin users
    if (isAdmin) {
      alert('Cannot delete admin users. Please demote them first.');
      return;
    }

    // First confirmation
    if (!confirm(`Are you sure you want to PERMANENTLY delete ${userEmail}?\n\nThis will remove:\n- All chat sessions and messages\n- All code sessions\n- All permissions\n- All usage metrics\n- The user account\n\nThis action CANNOT be undone!`)) {
      return;
    }

    // Second confirmation with typed email
    const typedEmail = prompt(`Type the user's email to confirm deletion:\n\n${userEmail}`);
    if (typedEmail !== userEmail) {
      alert('Email did not match. Deletion cancelled.');
      return;
    }

    try {
      const headers = getAuthHeaders();
      const response = await apiRequest(`/admin/users/${userId}?confirm=true`, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to delete user (${response.status})`);
      }

      await fetchData();
      alert(`User ${userEmail} has been permanently deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  /**
   * Save user budget settings
   */
  const handleSaveBudget = async () => {
    if (!selectedUser || !editingBudget) return;

    setBudgetLoading(true);
    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      await apiRequest(`/admin/user-permissions/${selectedUser.user_id}/budget`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          budgetDollars: editingBudget.budgetDollars,
          autoAdjust: editingBudget.autoAdjust,
          warningThreshold: editingBudget.warningThreshold,
          hardLimit: editingBudget.hardLimit,
        }),
      });

      // Refresh budget data
      const budgetResponse = await apiRequest(`/admin/user-permissions/${selectedUser.user_id}/budget`, { headers: getAuthHeaders() });
      const budgetData = await budgetResponse.json();
      setUserBudget(budgetData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save budget');
    } finally {
      setBudgetLoading(false);
    }
  };

  /**
   * Reset user budget period
   */
  const handleResetBudget = async () => {
    if (!selectedUser) return;
    if (!confirm(`Reset budget period for ${selectedUser.name}? This will reset their current spending.`)) return;

    setBudgetLoading(true);
    try {
      const headers = getAuthHeaders();
      await apiRequest(`/admin/user-permissions/${selectedUser.user_id}/budget/reset`, {
        method: 'POST',
        headers
      });

      // Refresh budget data
      const budgetResponse = await apiRequest(`/admin/user-permissions/${selectedUser.user_id}/budget`, { headers });
      const budgetData = await budgetResponse.json();
      setUserBudget(budgetData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset budget period');
    } finally {
      setBudgetLoading(false);
    }
  };

  const toggleArrayItem = (array: string[], item: string): string[] => {
    if (array.includes(item)) {
      return array.filter(i => i !== item);
    }
    return [...array, item];
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'Security', 'Permissions']}
        title="User Permissions"
        explainer="Manage user-level permissions for LLM providers, MCP servers, and features."
        actions={[
          { label: 'Refresh', onClick: fetchData },
        ]}
      />

      {error && (
        <div className="glass-card border-error/50 bg-error-500/10 p-4 rounded-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 ap-text-error" />
            <span className="ap-text-error">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 hover:bg-error-500/20 rounded"
            >
              <X className="h-4 w-4 ap-text-error" />
            </button>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
            type="text"
            placeholder="Search users by email or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary placeholder-text-secondary"
          />
        </div>
      </div>

      {/* Users List */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-semibold mb-4 text-text-primary flex items-center gap-2">
          <Users className="h-5 w-5" />
          Users ({filteredUsers.length})
        </h3>

        <div className="overflow-x-auto rounded-lg">
          <table className="admin-table-excel">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>LLM Access</th>
                <th>MCP Access</th>
                <th>Features</th>
                <th>Token Limits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.user_id}>
                  <td>
                    <div>
                      <p className="font-medium">{user.name || 'Unknown'}</p>
                      <p className="text-xs opacity-70">{user.email}</p>
                    </div>
                  </td>
                  {/* Account Status Column */}
                  <td>
                    {user.is_locked ? (
                      <div className="flex items-center gap-2">
                        <span className="status-badge error">
                          <Lock className="h-3 w-3" />
                          Locked
                        </span>
                        {user.locked_at && (
                          <span className="text-xs opacity-60">
                            {new Date(user.locked_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ) : user.scope_warning_count > 0 ? (
                      <span className="status-badge warning">
                        ⚠️ {user.scope_warning_count}/3 warnings
                      </span>
                    ) : (
                      <span className="status-badge success">
                        <CheckCircle className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {(user.allowed_llms?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" style={{ color: 'var(--color-success)' }} />
                          <span className="text-xs opacity-70">{user.allowed_llms?.length ?? 0} allowed</span>
                        </div>
                      )}
                      {(user.denied_llms?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <XCircle className="h-3 w-3" style={{ color: 'var(--color-error)' }} />
                          <span className="text-xs opacity-70">{user.denied_llms?.length ?? 0} denied</span>
                        </div>
                      )}
                      {(user.allowed_llms?.length ?? 0) === 0 && (user.denied_llms?.length ?? 0) === 0 && (
                        <span className="text-xs opacity-70">Default</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-1">
                      {(user.allowed_mcps?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" style={{ color: 'var(--color-success)' }} />
                          <span className="text-xs opacity-70">{user.allowed_mcps?.length ?? 0} allowed</span>
                        </div>
                      )}
                      {(user.denied_mcps?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1">
                          <XCircle className="h-3 w-3" style={{ color: 'var(--color-error)' }} />
                          <span className="text-xs opacity-70">{user.denied_mcps?.length ?? 0} denied</span>
                        </div>
                      )}
                      {(user.allowed_mcps?.length ?? 0) === 0 && (user.denied_mcps?.length ?? 0) === 0 && (
                        <span className="text-xs opacity-70">Default</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {user.feature_flags?.image_generation && (
                        <span className="status-badge info">Img</span>
                      )}
                      {user.feature_flags?.code_execution && (
                        <span className="status-badge success">Code</span>
                      )}
                      {user.feature_flags?.web_search && (
                        <span className="status-badge info">Web</span>
                      )}
                      {user.feature_flags?.awcode && (
                        <span className="status-badge success">Openagentic</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      {user.daily_token_limit && (
                        <span className="text-xs opacity-70">D: {user.daily_token_limit.toLocaleString()}</span>
                      )}
                      {user.monthly_token_limit && (
                        <span className="text-xs opacity-70">M: {user.monthly_token_limit.toLocaleString()}</span>
                      )}
                      {!user.daily_token_limit && !user.monthly_token_limit && (
                        <span className="text-xs opacity-70">Unlimited</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="p-1 hover:bg-primary-500/20 text-primary-500 rounded"
                        title="Edit Permissions"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeletePermissions(user.user_id)}
                        className="p-1 hover:bg-error-500/20 ap-text-error rounded"
                        title="Reset to Default"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      {/* Lock/Unlock buttons */}
                      {user.is_locked ? (
                        <button
                          onClick={() => handleUnlockUser(user.user_id, user.name || user.email)}
                          className="p-1 hover:bg-success-500/20 ap-text-success rounded"
                          title="Unlock Account"
                        >
                          <Unlock className="h-4 w-4" />
                        </button>
                      ) : user.scope_warning_count > 0 ? (
                        <button
                          onClick={() => handleResetWarnings(user.user_id, user.name || user.email)}
                          className="p-1 hover:bg-warning-500/20 ap-text-warning rounded"
                          title="Reset Warnings"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </button>
                      ) : null}
                      {/* Delete user button - only for non-admin users */}
                      {!user.is_admin && (
                        <button
                          onClick={() => handleDeleteUser(user.user_id, user.email, user.is_admin)}
                          className="p-1 hover:bg-error-500/20 ap-text-error rounded opacity-50 hover:opacity-100"
                          title="Delete User Permanently"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredUsers.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              No users found matching your search.
            </div>
          )}
        </div>
      </div>

      {/* Edit Panel (SlideInPanel) */}
      <SlideInPanel
        isOpen={showEditModal && !!selectedUser && !!editingPermissions}
        onClose={closeEditPanel}
        title={selectedUser ? `${selectedUser.name || 'User'}` : 'Edit Permissions'}
        subtitle={selectedUser?.email}
        width="lg"
        icon={<Shield size={18} />}
        footer={
          <SlideInPanelFooter
            onCancel={closeEditPanel}
            onSubmit={handleSavePermissions}
            isSubmitting={isSaving}
            submitText="Save All Changes"
          />
        }
      >
        {editingPermissions && selectedUser && (
          <>
            {/* Permission Source Badge */}
            <div className="flex items-center gap-2 mb-4 p-2 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Source:</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{
                backgroundColor: selectedUser.permissionSource === 'user' ? 'rgba(var(--ap-success-rgb, 34, 197, 94), 0.15)' : 'rgba(var(--ap-info-rgb, 59, 130, 246), 0.15)',
                color: selectedUser.permissionSource === 'user' ? 'var(--ap-success)' : 'var(--ap-info)',
              }}>
                {selectedUser.permissionSource === 'user' ? 'Custom (User)' : selectedUser.permissionSource === 'group' ? 'Group' : 'Default'}
              </span>
              {selectedUser.is_admin && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-err) 15%, transparent)', color: 'var(--color-err)' }}>
                  Admin
                </span>
              )}
              {selectedUser.is_locked && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-err) 15%, transparent)', color: 'var(--color-err)' }}>
                  Locked
                </span>
              )}
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 mb-5 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
              {([
                { id: 'access' as PermissionTab, label: 'Access', icon: <Lock size={14} /> },
                { id: 'features' as PermissionTab, label: 'Features', icon: <Zap size={14} /> },
                { id: 'limits' as PermissionTab, label: 'Limits', icon: <Clock size={14} /> },
                { id: 'budget' as PermissionTab, label: 'Budget', icon: <DollarSign size={14} /> },
                { id: 'advanced' as PermissionTab, label: 'Advanced', icon: <Settings size={14} /> },
              ]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all"
                  style={{
                    backgroundColor: activeTab === tab.id ? 'var(--color-background)' : 'transparent',
                    color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-textMuted)',
                    boxShadow: activeTab === tab.id ? '0 1px 3px color-mix(in srgb, var(--color-shadow) 10%, transparent)' : 'none',
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* === ACCESS TAB === */}
            {activeTab === 'access' && (
              <div className="space-y-1">
                <SlideInPanelSection title="LLM Provider Access" description="Control which AI models this user can use. Empty = inherit from defaults.">
                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Allowed Providers" hint="Checked providers are explicitly allowed">
                      <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg p-2" style={{ border: '1px solid var(--color-border)' }}>
                        {availableLLMs.map(llm => (
                          <label key={llm.id} className="flex items-center gap-2 cursor-pointer p-1.5 rounded transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                            <input
                              type="checkbox"
                              checked={editingPermissions.allowed_llms?.includes(llm.id) || false}
                              onChange={() => setEditingPermissions({
                                ...editingPermissions,
                                allowed_llms: toggleArrayItem(editingPermissions.allowed_llms || [], llm.id)
                              })}
                            />
                            <span className="text-sm" style={{ color: 'var(--color-text)' }}>{llm.name}</span>
                            <span className="text-xs ml-auto" style={{ color: 'var(--color-textMuted)' }}>{llm.provider_type}</span>
                          </label>
                        ))}
                        {availableLLMs.length === 0 && (
                          <p className="text-xs p-2" style={{ color: 'var(--color-textMuted)' }}>No providers configured</p>
                        )}
                      </div>
                    </SlideInPanelField>
                    <SlideInPanelField label="Denied Providers" hint="Checked providers are explicitly blocked">
                      <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg p-2" style={{ border: '1px solid var(--color-border)' }}>
                        {availableLLMs.map(llm => (
                          <label key={llm.id} className="flex items-center gap-2 cursor-pointer p-1.5 rounded transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                            <input
                              type="checkbox"
                              checked={editingPermissions.denied_llms?.includes(llm.id) || false}
                              onChange={() => setEditingPermissions({
                                ...editingPermissions,
                                denied_llms: toggleArrayItem(editingPermissions.denied_llms || [], llm.id)
                              })}
                            />
                            <span className="text-sm" style={{ color: 'var(--color-text)' }}>{llm.name}</span>
                            <span className="text-xs ml-auto" style={{ color: 'var(--color-textMuted)' }}>{llm.provider_type}</span>
                          </label>
                        ))}
                      </div>
                    </SlideInPanelField>
                  </div>
                </SlideInPanelSection>

                <SlideInPanelSection title="MCP Server Access" description="Control which MCP tool servers this user can access.">
                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Allowed Servers">
                      <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg p-2" style={{ border: '1px solid var(--color-border)' }}>
                        {availableMCPs.map(mcp => (
                          <label key={mcp.id} className="flex items-center gap-2 cursor-pointer p-1.5 rounded transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                            <input
                              type="checkbox"
                              checked={editingPermissions.allowed_mcps?.includes(mcp.id) || false}
                              onChange={() => setEditingPermissions({
                                ...editingPermissions,
                                allowed_mcps: toggleArrayItem(editingPermissions.allowed_mcps || [], mcp.id)
                              })}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm block truncate" style={{ color: 'var(--color-text)' }}>{mcp.name}</span>
                              {mcp.description && (
                                <span className="text-xs block truncate" style={{ color: 'var(--color-textMuted)' }}>{mcp.description}</span>
                              )}
                            </div>
                          </label>
                        ))}
                        {availableMCPs.length === 0 && (
                          <p className="text-xs p-2" style={{ color: 'var(--color-textMuted)' }}>No MCP servers configured</p>
                        )}
                      </div>
                    </SlideInPanelField>
                    <SlideInPanelField label="Denied Servers">
                      <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg p-2" style={{ border: '1px solid var(--color-border)' }}>
                        {availableMCPs.map(mcp => (
                          <label key={mcp.id} className="flex items-center gap-2 cursor-pointer p-1.5 rounded transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                            <input
                              type="checkbox"
                              checked={editingPermissions.denied_mcps?.includes(mcp.id) || false}
                              onChange={() => setEditingPermissions({
                                ...editingPermissions,
                                denied_mcps: toggleArrayItem(editingPermissions.denied_mcps || [], mcp.id)
                              })}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm block truncate" style={{ color: 'var(--color-text)' }}>{mcp.name}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </SlideInPanelField>
                  </div>
                </SlideInPanelSection>
              </div>
            )}

            {/* === FEATURES TAB === */}
            {activeTab === 'features' && (
              <div className="space-y-1">
                <SlideInPanelSection title="Feature Permissions" description="Toggle platform capabilities for this user.">
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'image_generation', label: 'Image Generation', icon: <Image size={16} />, color: 'var(--color-primary)' },
                      { key: 'code_execution', label: 'Code Execution', icon: <Code size={16} />, color: 'var(--ap-success)' },
                      { key: 'web_search', label: 'Web Search', icon: <Globe size={16} />, color: 'var(--ap-info)' },
                      { key: 'file_upload', label: 'File Upload', icon: <Upload size={16} />, color: 'var(--ap-warning)' },
                      { key: 'memory', label: 'Memory', icon: <Brain size={16} />, color: 'var(--ap-info)' },
                      { key: 'rag', label: 'RAG / Knowledge', icon: <Database size={16} />, color: 'var(--color-primary)' },
                      { key: 'awcode', label: 'Openagentic', icon: <Terminal size={16} />, color: 'var(--ap-success)' },
                    ] as const).map(feature => (
                      <label
                        key={feature.key}
                        className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                        style={{
                          border: '1px solid var(--color-border)',
                          backgroundColor: editingPermissions.feature_flags?.[feature.key] ? 'rgba(var(--ap-success-rgb, 34, 197, 94), 0.05)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editingPermissions.feature_flags?.[feature.key] || false}
                          onChange={(e) => setEditingPermissions({
                            ...editingPermissions,
                            feature_flags: {
                              ...editingPermissions.feature_flags!,
                              [feature.key]: e.target.checked
                            }
                          })}
                        />
                        <span style={{ color: feature.color }}>{feature.icon}</span>
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{feature.label}</span>
                      </label>
                    ))}
                  </div>
                </SlideInPanelSection>

                {/* 2026-04-19 — Intelligence Slider section removed (task
                    #144). Per-user × per-model spend caps live on the
                    Budget tab (UserModelBudgetService). */}
                {/* 2026-05-19 — Prompt Template section removed (Phase W).
                    /api/admin/prompts/templates returns 404 (model dropped).
                    RBAC role prompts are now edited via Admin → Prompts → RBAC Templates. */}
              </div>
            )}

            {/* === LIMITS TAB === */}
            {activeTab === 'limits' && (
              <div className="space-y-1">
                <SlideInPanelSection title="Rate Limit Tier" description="Controls API request throttling for this user.">
                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Assigned Tier">
                      <select
                        value={(editingPermissions as any)?.rate_limit_tier || 'standard'}
                        onChange={(e) => {
                          setEditingPermissions({ ...editingPermissions, rate_limit_tier: e.target.value } as any);
                          const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
                          apiRequest(`/admin/rate-limits/users/${selectedUser?.user_id}`, {
                            method: 'PUT', headers, body: JSON.stringify({ tier: e.target.value })
                          }).catch(() => {});
                        }}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      >
                        <option value="free">Free (5 req/min)</option>
                        <option value="standard">Standard (20 req/min)</option>
                        <option value="premium">Premium (60 req/min)</option>
                        <option value="unlimited">Unlimited</option>
                      </select>
                    </SlideInPanelField>
                    <SlideInPanelField label="Source">
                      <div className="flex items-center h-[38px]">
                        <span className="text-xs font-medium px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-primary)' }}>
                          {(editingPermissions as any)?._rateTierSource || 'default'}
                        </span>
                      </div>
                    </SlideInPanelField>
                  </div>
                </SlideInPanelSection>

                <SlideInPanelSection title="Token Limits" description="Limit token consumption per day/month. Empty = unlimited.">
                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Daily Token Limit">
                      <input
                        type="number"
                        value={editingPermissions.daily_token_limit || ''}
                        onChange={(e) => setEditingPermissions({
                          ...editingPermissions,
                          daily_token_limit: e.target.value ? parseInt(e.target.value) : null
                        })}
                        placeholder="Unlimited"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                    <SlideInPanelField label="Monthly Token Limit">
                      <input
                        type="number"
                        value={editingPermissions.monthly_token_limit || ''}
                        onChange={(e) => setEditingPermissions({
                          ...editingPermissions,
                          monthly_token_limit: e.target.value ? parseInt(e.target.value) : null
                        })}
                        placeholder="Unlimited"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                  </div>
                </SlideInPanelSection>

                <SlideInPanelSection title="Request Limits" description="Limit API requests per day/month. Empty = unlimited.">
                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Daily Request Limit">
                      <input
                        type="number"
                        value={editingDailyRequestLimit || ''}
                        onChange={(e) => setEditingDailyRequestLimit(e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="Unlimited"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                    <SlideInPanelField label="Monthly Request Limit">
                      <input
                        type="number"
                        value={editingMonthlyRequestLimit || ''}
                        onChange={(e) => setEditingMonthlyRequestLimit(e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="Unlimited"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                  </div>
                </SlideInPanelSection>
              </div>
            )}

            {/* === BUDGET TAB === */}
            {activeTab === 'budget' && (
              <div className="space-y-1">
                <SlideInPanelSection title="Budget Management" description="Control monthly spending limits and auto-adjustment behavior.">
                  {/* Spending progress */}
                  {userBudget && (
                    <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm" style={{ color: 'var(--color-textMuted)' }}>Current Spending</span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                            ${userBudget.currentSpendDollars.toFixed(2)}
                            {userBudget.budgetDollars != null && (
                              <span className="text-sm font-normal" style={{ color: 'var(--color-textMuted)' }}>
                                {' '}/ ${userBudget.budgetDollars.toFixed(2)}
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-medium px-2 py-0.5 rounded" style={{
                            backgroundColor: userBudget.isOverBudget ? 'color-mix(in srgb, var(--color-err) 15%, transparent)' : 'color-mix(in srgb, var(--color-ok) 15%, transparent)',
                            color: userBudget.isOverBudget ? 'var(--color-err)' : 'var(--color-ok)',
                          }}>
                            {userBudget.isOverBudget ? 'Over Budget' : 'On Track'}
                          </span>
                        </div>
                      </div>
                      {userBudget.budgetDollars != null && (
                        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                          <div
                            className="h-full transition-all rounded-full"
                            style={{
                              width: `${Math.min((userBudget.currentSpendDollars / userBudget.budgetDollars) * 100, 100)}%`,
                              backgroundColor: userBudget.isOverBudget ? 'var(--color-err)'
                                : userBudget.currentSpendDollars > (userBudget.budgetDollars * 0.8) ? 'var(--color-warn)'
                                : 'var(--color-ok)',
                            }}
                          />
                        </div>
                      )}
                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => { void handleResetBudget(); }}
                          disabled={budgetLoading}
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ color: 'var(--color-textMuted)' }}
                        >
                          Reset Period
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <SlideInPanelField label="Monthly Budget ($)">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingBudget?.budgetDollars ?? ''}
                        onChange={(e) => setEditingBudget({
                          ...editingBudget!,
                          budgetDollars: e.target.value ? parseFloat(e.target.value) : null
                        })}
                        placeholder="Unlimited"
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                    <SlideInPanelField label="Warning Threshold (%)">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={editingBudget?.warningThreshold ?? 80}
                        onChange={(e) => setEditingBudget({
                          ...editingBudget!,
                          warningThreshold: parseInt(e.target.value) || 80
                        })}
                        className="w-full px-3 py-2 rounded-lg text-sm"
                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                      />
                    </SlideInPanelField>
                  </div>

                  {/* 2026-04-19 — Auto-adjust slider checkbox removed
                      (task #144, slider rip). Per-user × per-model caps
                      handle budget enforcement at dispatch time. */}
                  <div className="space-y-2 mt-4">
                    <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors" style={{ border: '1px solid var(--color-border)' }}>
                      <input
                        type="checkbox"
                        checked={editingBudget?.hardLimit ?? false}
                        onChange={(e) => setEditingBudget({ ...editingBudget!, hardLimit: e.target.checked })}
                      />
                      <div className="flex-1">
                        <span className="text-sm block" style={{ color: 'var(--color-text)' }}>Hard limit</span>
                        <span className="text-xs" style={{ color: 'var(--color-err)' }}>Block all requests when budget is exceeded</span>
                      </div>
                    </label>
                  </div>
                </SlideInPanelSection>
              </div>
            )}

            {/* === ADVANCED TAB === */}
            {activeTab === 'advanced' && (
              <div className="space-y-1">
                <SlideInPanelSection title="Code Mode CLI" description="Which CLI backend to use for code mode sessions.">
                  <select
                    value={editingCodeModeCli || ''}
                    onChange={(e) => setEditingCodeModeCli(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                  >
                    <option value="">Use global default (Claude Code)</option>
                    <option value="claude-code">Claude Code CLI</option>
                    <option value="openagentic">OpenAgentic AI CLI</option>
                  </select>
                </SlideInPanelSection>

                <SlideInPanelSection title="OpenAgenticflows Access" description="Allow this user to create and trigger workflow automations.">
                  <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors" style={{ border: '1px solid var(--color-border)' }}>
                    <input
                      type="checkbox"
                      checked={editingWorkflowsEnabled}
                      onChange={(e) => setEditingWorkflowsEnabled(e.target.checked)}
                    />
                    <div className="flex-1">
                      <span className="text-sm block" style={{ color: 'var(--color-text)' }}>Enable Workflows</span>
                      <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Allow creating and triggering workflow automations</span>
                    </div>
                    <Workflow size={16} style={{ color: 'var(--color-textMuted)' }} />
                  </label>
                </SlideInPanelSection>

                <SlideInPanelSection title="Admin Notes" description="Internal notes about this user's permission configuration. Not visible to the user.">
                  <textarea
                    value={editingAdminNotes}
                    onChange={(e) => setEditingAdminNotes(e.target.value)}
                    rows={4}
                    placeholder="Add notes about why these permissions were configured..."
                    className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
                  />
                </SlideInPanelSection>

                {/* Account Status Info (read-only) */}
                <SlideInPanelSection title="Account Status">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Scope Warnings</span>
                      <span className="text-xs font-medium" style={{ color: selectedUser.scope_warning_count > 0 ? 'var(--color-warn)' : 'var(--color-text)' }}>
                        {selectedUser.scope_warning_count}/3
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Account Locked</span>
                      <span className="text-xs font-medium" style={{ color: selectedUser.is_locked ? 'var(--color-err)' : 'var(--ap-success)' }}>
                        {selectedUser.is_locked ? `Yes (${selectedUser.locked_reason || 'Scope violations'})` : 'No'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Groups</span>
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                        {selectedUser.groups.length > 0 ? selectedUser.groups.join(', ') : 'None'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 rounded" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Created</span>
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                        {new Date(selectedUser.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </SlideInPanelSection>
              </div>
            )}
          </>
        )}
      </SlideInPanel>
    </div>
  );
};

export default UserPermissionsView;
