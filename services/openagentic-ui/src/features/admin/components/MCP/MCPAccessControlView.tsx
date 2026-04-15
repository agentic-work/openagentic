/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React, { useState, useEffect } from 'react';
// Basic UI icons from lucide
import {
  Users, Plus, Edit, Trash2, Save, X, Settings, Filter, Search,
  ChevronDown, Key, Unlock, Eye, EyeOff, UserCheck
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import {
  Shield, Server, User, AlertTriangle, CheckCircle, XCircle, Lock
} from '../Shared/AdminIcons';
import { useTheme } from '../../../../contexts/ThemeContext';
import { apiRequestJson } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';

interface MCPServer {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

interface MCPAccessPolicy {
  id: string;
  azure_group_id: string;
  azure_group_name: string;
  server_id: string;
  access_type: 'allow' | 'deny';
  is_enabled: boolean;
  priority: number;
  reason?: string;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
  server: MCPServer;
}

interface MCPDefaultPolicy {
  id: string;
  policy_type: 'user_default' | 'admin_default';
  default_access: 'allow' | 'deny';
  description?: string;
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

interface AccessSummary {
  azure_group_id: string;
  access_summary: {
    server: MCPServer;
    access: 'allow' | 'deny';
    hasExplicitPolicy: boolean;
    policy: MCPAccessPolicy | null;
  }[];
}

const MCPAccessControlView: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const confirm = useConfirm();

  const [policies, setPolicies] = useState<MCPAccessPolicy[]>([]);
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [defaultPolicies, setDefaultPolicies] = useState<MCPDefaultPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<MCPAccessPolicy | null>(null);
  const [formData, setFormData] = useState({
    azure_group_id: '',
    azure_group_name: '',
    server_id: '',
    access_type: 'allow' as 'allow' | 'deny',
    priority: 1000,
    reason: '',
    is_enabled: true
  });

  // Filter state
  const [filterServer, setFilterServer] = useState('');
  const [filterAccess, setFilterAccess] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Group summary state
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupSummary, setGroupSummary] = useState<AccessSummary | null>(null);
  const [showGroupSummary, setShowGroupSummary] = useState(false);

  // Access testing state
  const [showAccessTest, setShowAccessTest] = useState(false);
  const [testUserId, setTestUserId] = useState('');
  const [testServerId, setTestServerId] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  // Tool-level policies tab
  const [activeTab, setActiveTab] = useState<'server' | 'tool'>('server');
  const [toolPolicies, setToolPolicies] = useState<any[]>([]);
  const [toolPolicyForm, setToolPolicyForm] = useState({
    serverId: '',
    toolName: '',
    azureGroupId: '',
    userId: '',
    accessType: 'deny' as 'allow' | 'deny',
    priority: 1000,
    reason: '',
    requireApproval: false,
    isEnabled: true
  });
  const [showToolPolicyForm, setShowToolPolicyForm] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [policiesData, serversData, defaultsData] = await Promise.all([
        apiRequestJson('/admin/mcp/policies'),
        apiRequestJson('/admin/mcp/servers'),
        apiRequestJson('/admin/mcp/default-policies')
      ]);

      // Ensure we have arrays
      setPolicies(Array.isArray(policiesData) ? policiesData : []);
      setServers(Array.isArray(serversData) ? serversData : []);
      setDefaultPolicies(Array.isArray(defaultsData) ? defaultsData : []);

      // Fetch tool-level policies
      try {
        const toolData = await apiRequestJson('/admin/mcp-access/tools');
        setToolPolicies(toolData?.policies || []);
      } catch (e) {
        // Tool policies are optional — don't block main load
        setToolPolicies([]);
      }
    } catch (err) {
      console.error('Failed to fetch MCP access control data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      // Set empty arrays on error to prevent crashes
      setPolicies([]);
      setServers([]);
      setDefaultPolicies([]);
      setToolPolicies([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateToolPolicy = async () => {
    try {
      await apiRequestJson('/admin/mcp-access/tools', {
        method: 'POST',
        body: JSON.stringify(toolPolicyForm),
      });
      await fetchData();
      setShowToolPolicyForm(false);
      setToolPolicyForm({ serverId: '', toolName: '', azureGroupId: '', userId: '', accessType: 'deny', priority: 1000, reason: '', requireApproval: false, isEnabled: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tool policy');
    }
  };

  const handleDeleteToolPolicy = async (id: string) => {
    const ok = await confirm('Delete this tool policy?');
    if (!ok) return;
    try {
      await apiRequestJson(`/admin/mcp-access/tools/${id}`, { method: 'DELETE' });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tool policy');
    }
  };

  const handleToggleToolPolicy = async (id: string, isEnabled: boolean) => {
    try {
      await apiRequestJson(`/admin/mcp-access/tools/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isEnabled }),
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle tool policy');
    }
  };

  const handleCreatePolicy = async () => {
    try {
      await apiRequestJson('/admin/mcp/policies', {
        method: 'POST',
        body: JSON.stringify(formData),
      });

      await fetchData();
      setShowCreateForm(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    }
  };

  const handleUpdatePolicy = async () => {
    if (!editingPolicy) return;

    try {
      await apiRequestJson(`/admin/mcp/policies/${editingPolicy.id}`, {
        method: 'PUT',
        body: JSON.stringify(formData),
      });

      await fetchData();
      setEditingPolicy(null);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update policy');
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!await confirm('Are you sure you want to delete this policy?', { variant: 'danger', title: 'Delete Policy' })) return;

    try {
      await apiRequestJson(`/admin/mcp/policies/${policyId}`, {
        method: 'DELETE',
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete policy');
    }
  };

  const handleUpdateDefaultPolicy = async (policyType: string, defaultAccess: 'allow' | 'deny') => {
    try {
      await apiRequestJson(`/admin/mcp/default-policies/${policyType}`, {
        method: 'PUT',
        body: JSON.stringify({ default_access: defaultAccess }),
      });

      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update default policy');
    }
  };

  const fetchGroupSummary = async (groupId: string) => {
    try {
      const data = await apiRequestJson(`/admin/mcp/access-summary/${groupId}`);
      setGroupSummary(data);
      setShowGroupSummary(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch group summary');
    }
  };

  const handleTestAccess = async () => {
    if (!testUserId || !testServerId) {
      setError('Please provide both User ID and Server ID');
      return;
    }

    try {
      const data = await apiRequestJson('/admin/mcp/test-access', {
        method: 'POST',
        body: JSON.stringify({
          user_id: testUserId,
          server_id: testServerId
        }),
      });

      setTestResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test access');
    }
  };

  const resetForm = () => {
    setFormData({
      azure_group_id: '',
      azure_group_name: '',
      server_id: '',
      access_type: 'allow',
      priority: 1000,
      reason: '',
      is_enabled: true
    });
  };

  const editPolicy = (policy: MCPAccessPolicy) => {
    setFormData({
      azure_group_id: policy.azure_group_id,
      azure_group_name: policy.azure_group_name,
      server_id: policy.server_id,
      access_type: policy.access_type,
      priority: policy.priority,
      reason: policy.reason || '',
      is_enabled: policy.is_enabled
    });
    setEditingPolicy(policy);
  };

  const filteredPolicies = policies.filter(policy => {
    const matchesServer = !filterServer || policy.server_id === filterServer;
    const matchesAccess = !filterAccess || policy.access_type === filterAccess;
    const matchesSearch = !searchTerm ||
      policy.azure_group_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      policy.server.name.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesServer && matchesAccess && matchesSearch;
  });

  const getUniqueGroups = () => {
    const groups = new Set<string>();
    policies.forEach(policy => groups.add(policy.azure_group_id));
    return Array.from(groups);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold mb-2 text-text-primary">
          MCP Access Control
        </h2>
        <p className="text-text-secondary">
          Manage which Azure AD groups can access which MCP servers and tools
        </p>
      </div>

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

      {/* Default Policies */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-semibold mb-4 text-text-primary flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Default Policies
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {defaultPolicies.map(policy => (
            <div key={policy.policy_type} className="p-4 border border-border rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-text-primary">
                    {policy.policy_type === 'user_default' ? 'User Default' : 'Admin Default'}
                  </h4>
                  <p className="text-sm text-text-secondary">
                    Default access for {policy.policy_type === 'user_default' ? 'regular users' : 'admin users'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateDefaultPolicy(policy.policy_type, 'allow')}
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      policy.default_access === 'allow'
                        ? 'ap-btn-success'
                        : 'bg-surface-secondary text-text-secondary hover:bg-success-500/20 hover:ap-text-success'
                    }`}
                  >
                    Allow
                  </button>
                  <button
                    onClick={() => handleUpdateDefaultPolicy(policy.policy_type, 'deny')}
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      policy.default_access === 'deny'
                        ? 'ap-btn-error'
                        : 'bg-surface-secondary text-text-secondary hover:bg-error-500/20 hover:ap-text-error'
                    }`}
                  >
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Access Testing Tool */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Key className="h-5 w-5" />
            Test Access (Admin Tool)
          </h3>
          <button
            onClick={() => setShowAccessTest(!showAccessTest)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              showAccessTest
                ? 'ap-btn-primary'
                : 'bg-surface-secondary text-text-secondary hover:bg-primary-500/20 hover:text-primary-400'
            }`}
          >
            {showAccessTest ? 'Hide' : 'Show'} Test Tool
          </button>
        </div>

        {showAccessTest && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Test if a specific user has access to a specific MCP server based on current policies.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  User ID
                </label>
                <input
                  type="text"
                  value={testUserId}
                  onChange={(e) => setTestUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  placeholder="Enter user UUID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  MCP Server
                </label>
                <select
                  value={testServerId}
                  onChange={(e) => setTestServerId(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                >
                  <option value="">Select Server</option>
                  {servers.map(server => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={handleTestAccess}
              disabled={!testUserId || !testServerId}
              className="px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Test Access
            </button>

            {testResult && (
              <div className="mt-4 p-4 border border-border rounded-lg bg-surface-secondary/50">
                <h4 className="font-medium mb-2 text-text-primary">Test Result:</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-text-secondary">User:</span>{' '}
                    <span className="text-text-primary">{testResult.user?.email || testResult.user?.name}</span>
                  </div>
                  <div>
                    <span className="text-text-secondary">Admin:</span>{' '}
                    <span className="text-text-primary">{testResult.user?.is_admin ? 'Yes' : 'No'}</span>
                  </div>
                  <div>
                    <span className="text-text-secondary">Groups:</span>{' '}
                    <span className="text-text-primary">{testResult.user?.groups?.join(', ') || 'None'}</span>
                  </div>
                  <div className="pt-2 border-t border-border">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded text-sm font-medium ${
                      testResult.access_result?.allowed
                        ? 'bg-success-500/20 ap-text-success'
                        : 'bg-error-500/20 ap-text-error'
                    }`}>
                      {testResult.access_result?.allowed ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      {testResult.access_result?.allowed ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                    </div>
                  </div>
                  <div>
                    <span className="text-text-secondary">Reason:</span>{' '}
                    <span className="text-text-primary">{testResult.access_result?.reason}</span>
                  </div>
                  {testResult.access_result?.policy && (
                    <div className="mt-2 p-2 bg-surface-primary rounded">
                      <div className="text-xs text-text-secondary">Policy Details:</div>
                      <div className="text-xs text-text-primary">
                        Group: {testResult.access_result.policy.azure_group_name}<br />
                        Priority: {testResult.access_result.policy.priority}<br />
                        Type: {testResult.access_result.policy.access_type}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Policies Management */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Access Policies
          </h3>
          <div className="flex gap-3">
            {/* Tab Switcher */}
            <div className="flex bg-surface-secondary rounded-lg p-1">
              <button
                onClick={() => setActiveTab('server')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  activeTab === 'server' ? 'ap-btn-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Server Policies ({policies.length})
              </button>
              <button
                onClick={() => setActiveTab('tool')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  activeTab === 'tool' ? 'ap-btn-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Tool Policies ({toolPolicies.length})
              </button>
            </div>
            {activeTab === 'server' && (
              <>
                <button
                  onClick={() => setShowGroupSummary(!showGroupSummary)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    showGroupSummary
                      ? 'ap-btn-primary'
                      : 'bg-surface-secondary text-text-secondary hover:bg-primary-500/20 hover:text-primary-400'
                  }`}
                >
                  {showGroupSummary ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showGroupSummary ? 'Hide' : 'Show'} Group Summary
                </button>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Policy
                </button>
              </>
            )}
            {activeTab === 'tool' && (
              <button
                onClick={() => setShowToolPolicyForm(true)}
                className="px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Tool Policy
              </button>
            )}
          </div>
        </div>

        {/* Tool Policies Tab Content */}
        {activeTab === 'tool' && (
          <div className="space-y-4">
            {toolPolicies.length === 0 ? (
              <div className="text-center py-8">
                <Shield className="h-12 w-12 mx-auto mb-3 text-text-secondary opacity-50" />
                <p className="text-text-secondary">No tool-level policies configured yet.</p>
                <p className="text-sm text-text-secondary mt-1">Tool policies provide per-tool granularity beyond server-level access control.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Server</th>
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Tool</th>
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Scope</th>
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Access</th>
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Priority</th>
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Approval</th>
                      <th className="text-right py-2 px-3 text-text-secondary font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolPolicies.map((tp: any) => (
                      <tr key={tp.id} className={`border-b border-border/50 ${!tp.isEnabled ? 'opacity-50' : ''}`}>
                        <td className="py-2 px-3 text-text-primary font-mono text-xs">{tp.serverId}</td>
                        <td className="py-2 px-3 text-text-primary">{tp.toolName === '*' ? <span className="text-warning-500">All Tools</span> : tp.toolName}</td>
                        <td className="py-2 px-3 text-text-secondary text-xs">
                          {tp.userId ? `User: ${tp.userId.substring(0, 8)}...` : tp.azureGroupId ? `Group: ${tp.azureGroupId.substring(0, 8)}...` : 'Global'}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            tp.accessType === 'allow' ? 'bg-success-500/20 ap-text-success' : 'bg-error-500/20 ap-text-error'
                          }`}>
                            {tp.accessType.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-text-secondary text-xs">{tp.priority}</td>
                        <td className="py-2 px-3">
                          {tp.requireApproval && <span className="px-2 py-0.5 rounded text-xs bg-warning-500/20 ap-text-warning">Required</span>}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggleToolPolicy(tp.id, !tp.isEnabled)}
                              className="p-1 rounded hover:bg-surface-secondary transition-colors"
                              title={tp.isEnabled ? 'Disable' : 'Enable'}
                            >
                              {tp.isEnabled ? <Eye className="h-4 w-4 text-text-secondary" /> : <EyeOff className="h-4 w-4 text-text-secondary" />}
                            </button>
                            <button
                              onClick={() => handleDeleteToolPolicy(tp.id)}
                              className="p-1 rounded hover:bg-error-500/10 transition-colors"
                            >
                              <Trash2 className="h-4 w-4 ap-text-error" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tool Policy Create Form */}
            {showToolPolicyForm && (
              <div className="border border-border rounded-lg p-4 bg-surface-secondary/30 space-y-3">
                <h4 className="font-medium text-text-primary">New Tool Policy</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Server ID</label>
                    <select
                      value={toolPolicyForm.serverId}
                      onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, serverId: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                    >
                      <option value="">Select server...</option>
                      {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Tool Name</label>
                    <input
                      type="text"
                      value={toolPolicyForm.toolName}
                      onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, toolName: e.target.value })}
                      placeholder="tool_name or * for all"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Access Type</label>
                    <select
                      value={toolPolicyForm.accessType}
                      onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, accessType: e.target.value as any })}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                    >
                      <option value="allow">Allow</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Azure Group ID (optional)</label>
                    <input
                      type="text"
                      value={toolPolicyForm.azureGroupId}
                      onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, azureGroupId: e.target.value })}
                      placeholder="Leave empty for global"
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">Priority (lower = higher)</label>
                    <input
                      type="number"
                      value={toolPolicyForm.priority}
                      onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, priority: parseInt(e.target.value) || 1000 })}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                    />
                  </div>
                  <div className="flex items-end gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={toolPolicyForm.requireApproval}
                        onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, requireApproval: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-sm text-text-primary">Require Approval</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">Reason</label>
                  <input
                    type="text"
                    value={toolPolicyForm.reason}
                    onChange={(e) => setToolPolicyForm({ ...toolPolicyForm, reason: e.target.value })}
                    placeholder="Why this policy exists..."
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateToolPolicy}
                    disabled={!toolPolicyForm.serverId || !toolPolicyForm.toolName}
                    className="px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 text-sm"
                  >
                    Create Policy
                  </button>
                  <button
                    onClick={() => setShowToolPolicyForm(false)}
                    className="px-4 py-2 bg-surface-secondary text-text-secondary rounded-lg hover:bg-surface-primary transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Server Policies Tab Content */}
        {activeTab === 'server' && <>
        {/* Group Summary */}
        {showGroupSummary && (
          <div className="mb-6 p-4 border border-border rounded-lg bg-surface-secondary/50">
            <h4 className="font-medium mb-3 text-text-primary flex items-center gap-2">
              <Users className="h-4 w-4" />
              Group Access Summary
            </h4>
            <div className="flex gap-3 mb-4">
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
              >
                <option value="">Select Azure AD Group</option>
                {getUniqueGroups().map(groupId => {
                  const policy = policies.find(p => p.azure_group_id === groupId);
                  return (
                    <option key={groupId} value={groupId}>
                      {policy?.azure_group_name || groupId}
                    </option>
                  );
                })}
              </select>
              <button
                onClick={() => selectedGroupId && fetchGroupSummary(selectedGroupId)}
                disabled={!selectedGroupId}
                className="px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                View Summary
              </button>
            </div>

            {groupSummary && (
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  Access summary for group: <span className="font-medium text-text-primary">{selectedGroupId}</span>
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {groupSummary.access_summary.map(({ server, access, hasExplicitPolicy }) => (
                    <div key={server.id} className="p-3 border border-border rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-text-primary">{server.name}</p>
                          <p className="text-xs text-text-secondary">
                            {hasExplicitPolicy ? 'Explicit policy' : 'Default policy'}
                          </p>
                        </div>
                        <div className={`px-2 py-1 rounded text-xs font-medium ${
                          access === 'allow'
                            ? 'bg-success-500/20 ap-text-success'
                            : 'bg-error-500/20 ap-text-error'
                        }`}>
                          {access === 'allow' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {access.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-text-secondary" />
            <input
              type="text"
              placeholder="Search groups or servers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary placeholder-text-secondary"
            />
          </div>
          <select
            value={filterServer}
            onChange={(e) => setFilterServer(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
          >
            <option value="">All Servers</option>
            {servers.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
          <select
            value={filterAccess}
            onChange={(e) => setFilterAccess(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
          >
            <option value="">All Access Types</option>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </div>

        {/* Policies Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium text-text-primary">Group</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Server</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Access</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Priority</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Status</th>
                <th className="text-left py-3 px-4 font-medium text-text-primary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPolicies.map((policy) => (
                <tr key={policy.id} className="border-b border-border/50 hover:bg-surface-secondary/20">
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium text-text-primary">{policy.azure_group_name}</p>
                      <p className="text-xs text-text-secondary">{policy.azure_group_id}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium text-text-primary">{policy.server.name}</p>
                      <p className="text-xs text-text-secondary">{policy.server.description}</p>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                      policy.access_type === 'allow'
                        ? 'bg-success-500/20 ap-text-success'
                        : 'bg-error-500/20 ap-text-error'
                    }`}>
                      {policy.access_type === 'allow' ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {policy.access_type.toUpperCase()}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-text-secondary">{policy.priority}</td>
                  <td className="py-3 px-4">
                    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                      policy.is_enabled
                        ? 'bg-success-500/20 ap-text-success'
                        : 'bg-theme-bg-secondary0/20 text-text-secondary400'
                    }`}>
                      {policy.is_enabled ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {policy.is_enabled ? 'Enabled' : 'Disabled'}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editPolicy(policy)}
                        className="p-1 hover:bg-primary-500/20 text-primary-500 rounded"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeletePolicy(policy.id)}
                        className="p-1 hover:bg-error-500/20 ap-text-error rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredPolicies.length === 0 && (
            <div className="text-center py-8 text-text-secondary">
              No policies found matching your filters.
            </div>
          )}
        </div>
        </>}
      </div>

      {/* Create/Edit Form Modal */}
      {(showCreateForm || editingPolicy) && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="glass-card max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {editingPolicy ? 'Edit Policy' : 'Create Policy'}
              </h3>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setEditingPolicy(null);
                  resetForm();
                }}
                className="p-1 hover:bg-surface-secondary rounded"
              >
                <X className="h-5 w-5 text-text-secondary" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Azure AD Group ID
                </label>
                <input
                  type="text"
                  value={formData.azure_group_id}
                  onChange={(e) => setFormData({ ...formData, azure_group_id: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  placeholder="e.g., 12345678-1234-1234-1234-123456789012"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Group Display Name
                </label>
                <input
                  type="text"
                  value={formData.azure_group_name}
                  onChange={(e) => setFormData({ ...formData, azure_group_name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  placeholder="e.g., Data Scientists"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  MCP Server
                </label>
                <select
                  value={formData.server_id}
                  onChange={(e) => setFormData({ ...formData, server_id: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                >
                  <option value="">Select Server</option>
                  {servers.map(server => (
                    <option key={server.id} value={server.id}>
                      {server.name} {server.enabled ? '' : '(Disabled)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Access Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      value="allow"
                      checked={formData.access_type === 'allow'}
                      onChange={(e) => setFormData({ ...formData, access_type: e.target.value as 'allow' | 'deny' })}
                      className="ap-text-success"
                    />
                    <span className="ap-text-success">Allow</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      value="deny"
                      checked={formData.access_type === 'deny'}
                      onChange={(e) => setFormData({ ...formData, access_type: e.target.value as 'allow' | 'deny' })}
                      className="ap-text-error"
                    />
                    <span className="ap-text-error">Deny</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Priority (lower = higher priority)
                </label>
                <input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 1000 })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  min="1"
                  max="9999"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                  placeholder="Explanation for this policy..."
                  rows={3}
                />
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_enabled}
                    onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                    className="text-primary-500"
                  />
                  <span className="text-text-primary">Enable this policy</span>
                </label>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={editingPolicy ? handleUpdatePolicy : handleCreatePolicy}
                className="flex-1 px-4 py-2 ap-btn-primary rounded-lg hover:bg-primary-600 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="h-4 w-4" />
                {editingPolicy ? 'Update' : 'Create'} Policy
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setEditingPolicy(null);
                  resetForm();
                }}
                className="px-4 py-2 border border-border rounded-lg text-text-secondary hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MCPAccessControlView;