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

/**
 * CodeMode MCP Servers View
 *
 * Manage MCP servers injected into all new code mode sessions.
 * - Managed servers (written to managed-mcp.json)
 * - Allowlist / Blocklist for user-added servers
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Plus, Trash2, Save, Edit3, Globe, Terminal,
  CheckCircle, XCircle, Shield, ChevronDown, ChevronRight
} from '@/shared/icons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';
import { SEED_MCP_SERVERS, type SeedMcpServer } from './codemodeSeeds';

interface ManagedMcpServer {
  id: string;
  name: string;
  description?: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  pluginSource?: string;
  enabled: boolean;
}

interface McpPolicy {
  allowManagedMcpServersOnly: boolean;
  allowlist: string[];
  blocklist: string[];
}

interface CodeModeMcpViewProps {
  theme?: string;
}

export const CodeModeMcpView: React.FC<CodeModeMcpViewProps> = ({ theme }) => {
  const confirm = useConfirm();

  const [servers, setServers] = useState<ManagedMcpServer[]>([]);
  const [policy, setPolicy] = useState<McpPolicy>({ allowManagedMcpServersOnly: false, allowlist: [], blocklist: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add server form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState<Partial<ManagedMcpServer>>({ type: 'stdio', enabled: true } as Partial<ManagedMcpServer>);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/admin/codemode/mcp-servers');
      if (response.ok) {
        const data = await response.json();
        const apiServers = data.servers || [];
        setServers(apiServers.length > 0 ? apiServers : SEED_MCP_SERVERS as ManagedMcpServer[]);
        setPolicy(data.policy || { allowManagedMcpServersOnly: false, allowlist: [], blocklist: [] });
      } else {
        // API not deployed — use seed data from real Claude Code plugins
        setServers(SEED_MCP_SERVERS as ManagedMcpServer[]);
      }
    } catch {
      // Endpoint not available — use seed data as platform defaults
      setServers(SEED_MCP_SERVERS as ManagedMcpServer[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleAddServer = async () => {
    if (!newServer.name) return;
    try {
      const response = await apiRequest('/admin/codemode/mcp-servers', {
        method: 'POST',
        body: JSON.stringify(newServer),
      });
      if (response.ok) {
        setShowAddForm(false);
        setNewServer({ type: 'stdio', enabled: true });
        fetchServers();
        setSuccess('MCP server added');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to add MCP server');
      }
    } catch {
      setError('Failed to add MCP server');
    }
  };

  const handleToggleServer = async (server: ManagedMcpServer) => {
    setServers(prev => prev.map(s => s.id === server.id ? { ...s, enabled: !s.enabled } : s));
    try {
      await apiRequest(`/admin/codemode/mcp-servers/${server.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...server, enabled: !server.enabled }),
      });
    } catch {
      // API not available — local toggle still works
    }
  };

  const handleDeleteServer = async (server: ManagedMcpServer) => {
    if (!await confirm(`Delete MCP server "${server.name}"?`, { variant: 'danger', title: 'Delete Server' })) return;
    try {
      await apiRequest(`/admin/codemode/mcp-servers/${server.id}`, { method: 'DELETE' });
      setServers(prev => prev.filter(s => s.id !== server.id));
      setSuccess('Server removed');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('Failed to delete server');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold mb-1 text-text-primary flex items-center gap-2">
            <Server size={20} />
            MCP Servers
          </h2>
          <p className="text-sm text-text-secondary">
            Managed MCP servers injected into all code mode sessions via managed-mcp.json
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 text-sm transition-colors"
        >
          <Plus size={14} />
          Add Server
        </button>
      </div>

      {/* Messages */}
      {success && <div className="p-3 rounded-lg bg-success-500/10 border border-success/30 ap-text-success text-sm">{success}</div>}
      {error && <div className="p-3 rounded-lg bg-error-500/10 border border-error/30 ap-text-error text-sm">{error}</div>}

      {/* Add Server Form */}
      {showAddForm && (
        <div className="glass-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Add Managed MCP Server</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
              <input
                value={newServer.name || ''}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                placeholder="e.g. filesystem"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Type</label>
              <select
                value={newServer.type}
                onChange={(e) => setNewServer({ ...newServer, type: e.target.value as 'stdio' | 'http' })}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
              >
                <option value="stdio">stdio (subprocess)</option>
                <option value="http">HTTP (remote URL)</option>
              </select>
            </div>
            {newServer.type === 'stdio' ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Command</label>
                  <input
                    value={newServer.command || ''}
                    onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm font-mono"
                    placeholder="npx -y @modelcontextprotocol/server-filesystem"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Args (comma-separated)</label>
                  <input
                    value={(newServer.args || []).join(', ')}
                    onChange={(e) => setNewServer({ ...newServer, args: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm font-mono"
                    placeholder="/workspace"
                  />
                </div>
              </>
            ) : (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-text-secondary mb-1">URL</label>
                <input
                  value={newServer.url || ''}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm font-mono"
                  placeholder="http://mcp-server:3000/sse"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 rounded-lg bg-surface-secondary text-text-secondary hover:bg-surface-hover text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddServer}
              disabled={!newServer.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 text-sm transition-colors"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      )}

      {/* Server List */}
      {loading ? (
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          <p className="text-text-secondary mt-4 text-sm">Loading MCP servers...</p>
        </div>
      ) : servers.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Server size={32} className="mx-auto text-text-tertiary mb-3" />
          <p className="text-text-secondary text-sm">No managed MCP servers configured</p>
          <p className="text-text-tertiary text-xs mt-1">
            Add servers here to inject them into every code mode session's managed-mcp.json
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map(server => (
            <div key={server.id} className="glass-card px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => handleToggleServer(server)} title={server.enabled ? 'Disable' : 'Enable'}>
                  {server.enabled
                    ? <CheckCircle size={18} className="text-green-500" />
                    : <XCircle size={18} className="text-text-tertiary" />
                  }
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{server.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-text-tertiary">
                      {server.type}
                    </span>
                    {server.pluginSource && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary-500/10 text-primary-500">
                        {server.pluginSource}
                      </span>
                    )}
                  </div>
                  {server.description && (
                    <span className="text-xs text-text-secondary block">{server.description}</span>
                  )}
                  <span className="text-xs text-text-tertiary font-mono">
                    {server.type === 'stdio' ? `${server.command} ${(server.args || []).join(' ')}` : server.url}
                  </span>
                </div>
              </div>
              <button
                onClick={() => handleDeleteServer(server)}
                className="p-1.5 rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Policy Section */}
      <div className="glass-card px-5 py-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
          <Shield size={16} className="text-primary-500" />
          Server Policy
        </h3>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="managedOnly"
              checked={policy.allowManagedMcpServersOnly}
              onChange={(e) => setPolicy({ ...policy, allowManagedMcpServersOnly: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="managedOnly" className="text-sm text-text-secondary">
              Only allow managed servers (users cannot add their own)
            </label>
          </div>
          <p className="text-xs text-text-tertiary">
            Allowlist and blocklist patterns will be available when the /api/admin/codemode/mcp-servers endpoint is deployed.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CodeModeMcpView;
