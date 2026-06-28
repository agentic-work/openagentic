/**
 * CredentialsSection - Secrets management, MCP health, and LLM provider overview
 * Replaces the old "Connections" section with full CRUD for workflow secrets
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Key,
  Copy,
  Plus,
  X,
  Check,
  Globe,
  Lock,
  Shield,
  Settings,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { useMCP } from '@/app/providers/MCPContext';
import { workflowEndpoint } from '@/utils/api';

interface CredentialsSectionProps {
  workflowId?: string;
}

interface WorkflowSecret {
  id: string;
  name: string;
  scope: 'global' | 'group' | 'workflow';
  description?: string;
  created_at?: string;
}

const scopeColors: Record<string, string> = {
  global: 'var(--color-info)',
  group: 'var(--color-accent)',
  workflow: 'var(--color-warning)',
};

const scopeIcons: Record<string, React.ReactNode> = {
  global: <Globe className="w-3 h-3" />,
  group: <Shield className="w-3 h-3" />,
  workflow: <Lock className="w-3 h-3" />,
};

export const CredentialsSection: React.FC<CredentialsSectionProps> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const { mcps } = useMCP();

  const [secrets, setSecrets] = useState<WorkflowSecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [providerCount, setProviderCount] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'group' | 'workflow'>('workflow');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch secrets
  const fetchSecrets = useCallback(async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/secrets'), { headers });
      if (res.ok) {
        const data = await res.json();
        setSecrets(Array.isArray(data) ? data : data.secrets || []);
      }
    } catch {
      /* silently handle - endpoint may not exist yet */
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Fetch LLM provider count
  const fetchProviders = useCallback(async () => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/admin/llm-providers', { headers });
      if (res.ok) {
        const data = await res.json();
        setProviderCount(Array.isArray(data) ? data.length : data.providers?.length || 0);
      }
    } catch {
      /* non-admin users may not have access */
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchSecrets();
    fetchProviders();
  }, [fetchSecrets, fetchProviders]);

  // MCP health summary
  const mcpHealth = useMemo(() => {
    if (!mcps || mcps.length === 0) return { total: 0, connected: 0, disconnected: 0 };
    const connected = mcps.filter(m => m.status === 'connected' || m.isConnected).length;
    return { total: mcps.length, connected, disconnected: mcps.length - connected };
  }, [mcps]);

  const mcpToolCount = useMemo(() => {
    if (!mcps || mcps.length === 0) return 0;
    return mcps.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
  }, [mcps]);

  // Copy secret expression
  const handleCopy = useCallback((name: string, id: string) => {
    navigator.clipboard.writeText(`{{secret:${name}}}`).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // Add new secret
  const handleAddSecret = useCallback(async () => {
    if (!newName.trim() || !newValue.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint('/workflows/secrets'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newName.trim(),
          value: newValue,
          scope: newScope,
          description: newDescription.trim() || undefined,
          workflow_id: workflowId,
        }),
      });
      if (res.ok) {
        setNewName('');
        setNewValue('');
        setNewScope('workflow');
        setNewDescription('');
        setShowAddForm(false);
        fetchSecrets();
      }
    } catch {
      /* silently handle */
    } finally {
      setSaving(false);
    }
  }, [newName, newValue, newScope, newDescription, workflowId, getAuthHeaders, fetchSecrets]);

  return (
    <div className="px-4 py-2 space-y-3">
      {/* Secrets List */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
            Secrets
          </span>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: 'var(--color-text-tertiary, #999)' }}
          >
            {showAddForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          </button>
        </div>

        {/* Add Form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mb-2"
            >
              <div
                className="glass-card p-2 space-y-1.5"
              >
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Secret name"
                  className="w-full px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                <input
                  type="password"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder="Secret value"
                  className="w-full px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                <select
                  value={newScope}
                  onChange={e => setNewScope(e.target.value as 'global' | 'group' | 'workflow')}
                  className="w-full px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="workflow">Workflow</option>
                  <option value="group">Group</option>
                  <option value="global">Global</option>
                </select>
                <input
                  type="text"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-2 py-1 text-[12px] rounded border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                <button
                  onClick={handleAddSecret}
                  disabled={saving || !newName.trim() || !newValue.trim()}
                  className="glass-btn glass-btn-primary w-full py-1 text-[12px]"
                >
                  {saving ? 'Saving...' : 'Add Secret'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Secrets list */}
        {loading ? (
          <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            Loading secrets...
          </div>
        ) : secrets.length === 0 ? (
          <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            No secrets configured
          </div>
        ) : (
          <div className="space-y-1">
            {secrets.map(secret => (
              <div
                key={secret.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--ctl-radius-sm)] border border-transparent transition-[background,border-color] glass-row-hover"
              >
                <Key className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-text-tertiary, #999)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {secret.name}
                  </div>
                </div>
                <span
                  className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${scopeColors[secret.scope]}20`,
                    color: scopeColors[secret.scope],
                  }}
                >
                  {scopeIcons[secret.scope]}
                  {secret.scope}
                </span>
                <button
                  onClick={() => handleCopy(secret.name, secret.id)}
                  className="p-0.5 rounded transition-colors hover:bg-[var(--color-surface)]"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                  title={`Copy {{secret:${secret.name}}}`}
                >
                  {copiedId === secret.id ? (
                    <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MCP Server Health */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-tertiary, #777)' }}>
          MCP Servers
        </div>
        <div className="space-y-1">
          {mcps && mcps.length > 0 ? (
            mcps.map(server => (
              <div
                key={server.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded transition-colors hover:bg-[var(--color-surface)]"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: server.status === 'connected' || server.isConnected ? 'var(--color-success)' : 'var(--color-error)',
                  }}
                />
                <span className="text-[12px] flex-1 truncate" style={{ color: 'var(--color-text)' }}>
                  {server.name}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                  {server.tools?.length || 0} tools
                </span>
              </div>
            ))
          ) : (
            <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
              No MCP servers available
            </div>
          )}
          <div className="text-[11px] mt-1 px-2" style={{ color: 'var(--color-text-tertiary, #777)' }}>
            {mcpToolCount} tools across {mcpHealth.total} servers
          </div>
        </div>
      </div>

      {/* LLM Providers */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-tertiary, #777)' }}>
          LLM Providers
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="text-[12px]" style={{ color: 'var(--color-text-secondary, #666)' }}>
            Configured
          </span>
          <span
            className="text-[12px] px-1.5 rounded font-medium"
            style={{ background: 'var(--color-surface)' }}
          >
            {providerCount !== null ? providerCount : '...'}
          </span>
        </div>
      </div>

      {/* Manage in Admin */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('openAdminPortal'))}
        className="flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:opacity-80"
        style={{ color: 'var(--user-accent-primary, #FF5722)' }}
      >
        <Settings className="w-3 h-3" />
        Manage in Admin
      </button>
    </div>
  );
};
