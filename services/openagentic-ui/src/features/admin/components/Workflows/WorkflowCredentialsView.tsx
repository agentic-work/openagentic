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

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Edit, Trash2, Save, X, Search, Eye, EyeOff, CheckCircle, RefreshCw
} from '@/shared/icons';
import {
  Shield, AlertTriangle, Key, Lock
} from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import SlideInPanel, {
  SlideInPanelSection,
  SlideInPanelFooter,
  SlideInPanelField,
} from '@/shared/components/SlideInPanel';

interface WorkflowSecret {
  id: string;
  name: string;
  description: string | null;
  scope: 'global' | 'group' | 'workflow';
  workflow_id: string | null;
  group_id: string | null;
  allowed_node_types: string[];
  access_count: number;
  last_accessed_at: string | null;
  last_rotated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SecretFormData {
  name: string;
  description: string;
  value: string;
  scope: 'global' | 'group' | 'workflow';
  workflow_id: string;
  group_id: string;
  allowed_node_types: string[];
}

const defaultForm: SecretFormData = {
  name: '',
  description: '',
  value: '',
  scope: 'global',
  workflow_id: '',
  group_id: '',
  allowed_node_types: [],
};

interface WorkflowCredentialsViewProps {
  theme?: string;
}

const WorkflowCredentialsView: React.FC<WorkflowCredentialsViewProps> = () => {
  const confirm = useConfirm();

  const [secrets, setSecrets] = useState<WorkflowSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterScope, setFilterScope] = useState<string>('');

  // Panel state
  const [showPanel, setShowPanel] = useState(false);
  const [editingSecret, setEditingSecret] = useState<WorkflowSecret | null>(null);
  const [formData, setFormData] = useState<SecretFormData>(defaultForm);
  const [actionLoading, setActionLoading] = useState(false);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, 'pass' | 'fail' | null>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterScope) params.set('scope', filterScope);

      const response = await apiRequest(`/admin/workflow-secrets?${params}`);
      const data = await response.json();
      setSecrets(data.secrets || []);
    } catch (err) {
      console.error('Failed to fetch workflow secrets:', err);
      setError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }, [filterScope]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = () => {
    setEditingSecret(null);
    setFormData(defaultForm);
    setShowPanel(true);
  };

  const handleEdit = (secret: WorkflowSecret) => {
    setEditingSecret(secret);
    setFormData({
      name: secret.name,
      description: secret.description || '',
      value: '', // Never pre-fill value
      scope: secret.scope,
      workflow_id: secret.workflow_id || '',
      group_id: secret.group_id || '',
      allowed_node_types: secret.allowed_node_types || [],
    });
    setShowPanel(true);
  };

  const handleSave = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const body: Record<string, any> = {
        name: formData.name,
        description: formData.description || null,
        scope: formData.scope,
        allowed_node_types: formData.allowed_node_types,
      };

      if (formData.value) body.value = formData.value;
      if (formData.scope === 'workflow' && formData.workflow_id) body.workflow_id = formData.workflow_id;
      if (formData.scope === 'group' && formData.group_id) body.group_id = formData.group_id;

      if (editingSecret) {
        await apiRequest(`/admin/workflow-secrets/${editingSecret.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        setSuccess(`Updated secret "${formData.name}"`);
      } else {
        if (!formData.value) {
          setError('Value is required when creating a new secret');
          setActionLoading(false);
          return;
        }
        await apiRequest('/admin/workflow-secrets', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setSuccess(`Created secret "${formData.name}"`);
      }

      setShowPanel(false);
      setEditingSecret(null);
      setFormData(defaultForm);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (secret: WorkflowSecret) => {
    if (!(await confirm(`Delete secret "${secret.name}"? This cannot be undone.`, { variant: 'danger', title: 'Delete Secret' }))) return;

    try {
      await apiRequest(`/admin/workflow-secrets/${secret.id}`, {
        method: 'DELETE',
      });
      setSuccess(`Deleted secret "${secret.name}"`);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete secret');
    }
  };

  const handleTest = async (secret: WorkflowSecret) => {
    setTestingId(secret.id);
    try {
      const response = await apiRequest(`/admin/workflow-secrets/${secret.id}/test`, {
        method: 'POST',
      });
      const data = await response.json();
      setTestResults(prev => ({ ...prev, [secret.id]: data.success ? 'pass' : 'fail' }));
    } catch {
      setTestResults(prev => ({ ...prev, [secret.id]: 'fail' }));
    } finally {
      setTestingId(null);
    }
  };

  const filteredSecrets = secrets.filter(s => {
    if (searchTerm && !s.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterScope && s.scope !== filterScope) return false;
    return true;
  });

  // Stats
  const totalSecrets = secrets.length;
  const globalSecrets = secrets.filter(s => s.scope === 'global').length;
  const workflowSecrets = secrets.filter(s => s.scope === 'workflow').length;
  const groupSecrets = secrets.filter(s => s.scope === 'group').length;

  const scopeBadgeClass = (scope: string) => {
    switch (scope) {
      case 'global': return 'bg-primary-500/20 text-primary-400';
      case 'workflow': return 'bg-success-500/20 ap-text-success';
      case 'group': return 'bg-warning-500/20 ap-text-warning';
      default: return 'bg-surface-secondary text-text-secondary';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">Workflow Credentials</h2>
          <p className="text-text-secondary">
            Manage encrypted secrets for workflow nodes (PagerDuty, ServiceNow, etc.)
          </p>
        </div>
        <button onClick={handleCreate} className="ap-btn-primary px-4 py-2 rounded-lg flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Secret
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 50%, transparent)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-error)' }} />
            <span style={{ color: 'var(--color-error)' }}>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto p-1 rounded" style={{ color: 'var(--color-error)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-success) 50%, transparent)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
            <span style={{ color: 'var(--color-success)' }}>{success}</span>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Secrets', value: totalSecrets, color: 'var(--color-primary)' },
          { label: 'Global', value: globalSecrets, color: 'var(--color-primary)' },
          { label: 'Workflow-scoped', value: workflowSecrets, color: 'var(--color-success)' },
          { label: 'Group-scoped', value: groupSecrets, color: 'var(--color-warning)' },
        ].map(stat => (
          <div key={stat.label} className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)', borderLeft: `4px solid ${stat.color}` }}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{stat.label}</p>
            <p className="text-3xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', borderRadius: '0.5rem', padding: '1rem' }}>
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-5 w-5 text-text-secondary" />
          <input
            type="text"
            placeholder="Search secrets..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
          />
        </div>
        <select
          value={filterScope}
          onChange={(e) => setFilterScope(e.target.value)}
          className="px-3 py-2 rounded-lg"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
        >
          <option value="">All Scopes</option>
          <option value="global">Global</option>
          <option value="workflow">Workflow</option>
          <option value="group">Group</option>
        </select>
        <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors" style={{ border: '1px solid var(--color-border)', color: 'var(--text-secondary)' }}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Secrets Table */}
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}>
        {filteredSecrets.length === 0 ? (
          <div className="text-center py-12">
            <Lock className="h-12 w-12 mx-auto mb-3 text-text-secondary opacity-50" />
            <p className="text-text-secondary">No secrets configured yet.</p>
            <p className="text-sm text-text-secondary mt-1">
              Add secrets to use <code className="bg-surface-secondary px-1 rounded text-xs">{'{{secret:name}}'}</code> in workflow nodes.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Scope</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Last Rotated</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Access Count</th>
                  <th className="text-left py-3 px-4 font-medium text-text-secondary">Allowed Nodes</th>
                  <th className="text-right py-3 px-4 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSecrets.map((secret) => (
                  <tr key={secret.id} className="border-b hover:bg-surface-secondary/20" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium text-text-primary font-mono text-xs">{secret.name}</p>
                        {secret.description && (
                          <p className="text-xs text-text-secondary mt-0.5">{secret.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${scopeBadgeClass(secret.scope)}`}>
                        {secret.scope}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-secondary text-xs">
                      {secret.last_rotated_at
                        ? new Date(secret.last_rotated_at).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="py-3 px-4 text-text-secondary text-xs">
                      {secret.access_count}
                    </td>
                    <td className="py-3 px-4 text-text-secondary text-xs">
                      {secret.allowed_node_types.length > 0
                        ? secret.allowed_node_types.join(', ')
                        : 'All'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTest(secret)}
                          disabled={testingId === secret.id}
                          className="p-1.5 rounded transition-colors hover:bg-surface-secondary"
                          title="Test secret resolution"
                          style={{ color: testResults[secret.id] === 'pass' ? 'var(--color-success)' : testResults[secret.id] === 'fail' ? 'var(--color-error)' : 'var(--text-secondary)' }}
                        >
                          {testingId === secret.id ? (
                            <div className="h-4 w-4 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(secret)}
                          className="p-1.5 rounded transition-colors hover:bg-surface-secondary"
                          style={{ color: 'var(--text-secondary)' }}
                          title="Edit secret"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(secret)}
                          className="p-1.5 rounded transition-colors hover:bg-error-500/10"
                          style={{ color: 'var(--color-error)' }}
                          title="Delete secret"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Usage Guide */}
      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}>
        <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
          <Key className="h-4 w-4" />
          Usage in Workflow Nodes
        </h4>
        <p className="text-xs text-text-secondary">
          Reference secrets in any workflow node field using{' '}
          <code className="bg-surface-primary px-1.5 py-0.5 rounded font-mono text-xs text-primary-400">
            {'{{secret:secret_name}}'}
          </code>
          . Secrets are resolved at execution time and never stored in workflow definitions.
        </p>
      </div>

      {/* Create/Edit Panel */}
      <SlideInPanel
        isOpen={showPanel}
        onClose={() => { setShowPanel(false); setEditingSecret(null); }}
        title={editingSecret ? `Edit Secret: ${editingSecret.name}` : 'Create Secret'}
        subtitle="Secrets are encrypted at rest with AES-256-GCM"
        width="md"
        icon={<Lock className="h-5 w-5" />}
        footer={
          <SlideInPanelFooter
            onCancel={() => { setShowPanel(false); setEditingSecret(null); }}
            onSubmit={handleSave}
            cancelText="Cancel"
            submitText={editingSecret ? 'Update Secret' : 'Create Secret'}
            isSubmitting={actionLoading}
          />
        }
      >
        <SlideInPanelSection title="Secret Details">
          <SlideInPanelField label="Name" htmlFor="secretName" hint="Used in {{secret:name}} references">
            <input
              id="secretName"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., pagerduty_api_key"
              className="w-full px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
            />
          </SlideInPanelField>
          <SlideInPanelField label="Description" htmlFor="secretDesc">
            <input
              id="secretDesc"
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What this secret is for..."
              className="w-full px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
            />
          </SlideInPanelField>
          <SlideInPanelField label={editingSecret ? 'New Value (leave blank to keep current)' : 'Value'} htmlFor="secretValue">
            <input
              id="secretValue"
              type="password"
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
              placeholder={editingSecret ? '••••••••' : 'Enter secret value'}
              className="w-full px-3 py-2 rounded-lg font-mono"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
            />
          </SlideInPanelField>
        </SlideInPanelSection>

        <SlideInPanelSection title="Scope" description="Determines where this secret can be used">
          <SlideInPanelField label="Scope" htmlFor="secretScope">
            <select
              id="secretScope"
              value={formData.scope}
              onChange={(e) => setFormData({ ...formData, scope: e.target.value as any })}
              className="w-full px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
            >
              <option value="global">Global (all workflows)</option>
              <option value="workflow">Workflow-specific</option>
              <option value="group">Group-specific</option>
            </select>
          </SlideInPanelField>
          {formData.scope === 'workflow' && (
            <SlideInPanelField label="Workflow ID" htmlFor="workflowId">
              <input
                id="workflowId"
                type="text"
                value={formData.workflow_id}
                onChange={(e) => setFormData({ ...formData, workflow_id: e.target.value })}
                placeholder="Enter workflow UUID"
                className="w-full px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
              />
            </SlideInPanelField>
          )}
          {formData.scope === 'group' && (
            <SlideInPanelField label="Group ID" htmlFor="groupId">
              <input
                id="groupId"
                type="text"
                value={formData.group_id}
                onChange={(e) => setFormData({ ...formData, group_id: e.target.value })}
                placeholder="Enter Azure AD group ID"
                className="w-full px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
              />
            </SlideInPanelField>
          )}
        </SlideInPanelSection>

        <SlideInPanelSection title="Access Restrictions" description="Optional: limit which node types can access this secret">
          <SlideInPanelField label="Allowed Node Types" htmlFor="nodeTypes" hint="Comma-separated, empty = all types">
            <input
              id="nodeTypes"
              type="text"
              value={formData.allowed_node_types.join(', ')}
              onChange={(e) => setFormData({ ...formData, allowed_node_types: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="e.g., http, webhook, pagerduty"
              className="w-full px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
            />
          </SlideInPanelField>
        </SlideInPanelSection>
      </SlideInPanel>
    </div>
  );
};

export default WorkflowCredentialsView;
