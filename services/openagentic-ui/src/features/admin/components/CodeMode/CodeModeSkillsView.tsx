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
 * CodeMode Skills & Plugins View
 *
 * Manage skills and plugins injected into code mode sessions.
 * - Skills: markdown files stored in MinIO, metadata in SystemConfiguration
 * - Plugins: archives stored in MinIO, extracted to ~/.openagentic/plugins/ on session start
 * - Registry: marketplace configuration for skill/plugin discovery
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Plus, Trash2, Save, Edit3, Download, Upload,
  CheckCircle, XCircle, Package, Globe, Search, FileText,
  ChevronDown, ChevronRight, ExternalLink, RefreshCw
} from '@/shared/icons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';
import {
  SEED_SKILLS, SEED_PLUGINS, SEED_REGISTRIES,
  type SeedSkill, type SeedPlugin, type SeedRegistry
} from './codemodeSeeds';

interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  tags: string[];
  enabled: boolean;
  createdAt?: string;
}

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: { skills: number; mcpServers: number; hooks: number };
  enabled: boolean;
  source: 'marketplace' | 'url';
  installedAt?: string;
}

interface Registry {
  name: string;
  url: string;
  official: boolean;
}

interface CodeModeSkillsViewProps {
  theme?: string;
}

export const CodeModeSkillsView: React.FC<CodeModeSkillsViewProps> = ({ theme }) => {
  const confirm = useConfirm();

  // Tab state
  const [activeTab, setActiveTab] = useState<'skills' | 'plugins' | 'registries'>('skills');

  // Skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);

  // Plugins state
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);

  // Registries state
  const [registries, setRegistries] = useState<Registry[]>([]);

  // Skill editor
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<{ name: string; description: string; content: string }>({
    name: '', description: '', content: '---\nname: my-skill\ndescription: One-line description\n---\n\n<instructions>\n',
  });

  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const response = await apiRequest('/admin/codemode/skills');
      if (response.ok) {
        const data = await response.json();
        const apiSkills = data.skills || [];
        setSkills(apiSkills.length > 0 ? apiSkills : SEED_SKILLS as Skill[]);
      } else {
        // API not deployed yet — use seed data
        setSkills(SEED_SKILLS as Skill[]);
      }
    } catch {
      // Endpoint not available — use seed data as platform defaults
      setSkills(SEED_SKILLS as Skill[]);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const fetchPlugins = useCallback(async () => {
    setPluginsLoading(true);
    try {
      const response = await apiRequest('/admin/codemode/plugins');
      if (response.ok) {
        const data = await response.json();
        const apiPlugins = data.plugins || [];
        const apiRegistries = data.registries || [];
        setPlugins(apiPlugins.length > 0 ? apiPlugins : SEED_PLUGINS as Plugin[]);
        setRegistries(apiRegistries.length > 0 ? apiRegistries : SEED_REGISTRIES);
      } else {
        setPlugins(SEED_PLUGINS as Plugin[]);
        setRegistries(SEED_REGISTRIES);
      }
    } catch {
      // Endpoint not available — use seed data as platform defaults
      setPlugins(SEED_PLUGINS as Plugin[]);
      setRegistries(SEED_REGISTRIES);
    } finally {
      setPluginsLoading(false);
    }
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const resp = await apiRequest('/admin/codemode/sync', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        setSuccess(`Synced: ${data.skillCount} skills, ${data.pluginCount} plugins`);
        fetchSkills();
        fetchPlugins();
      } else {
        setError('Sync failed');
      }
    } catch {
      setError('Sync failed');
    } finally {
      setSyncing(false);
      setTimeout(() => setSuccess(null), 5000);
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchPlugins();
  }, [fetchSkills, fetchPlugins]);

  const handleCreateSkill = async () => {
    if (!editingSkill.name) return;
    try {
      const response = await apiRequest('/admin/codemode/skills', {
        method: 'POST',
        body: JSON.stringify(editingSkill),
      });
      if (response.ok) {
        setShowSkillEditor(false);
        setEditingSkill({ name: '', description: '', content: '---\nname: my-skill\ndescription: One-line description\n---\n\n<instructions>\n' });
        fetchSkills();
        setSuccess('Skill created');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to create skill');
      }
    } catch {
      setError('Failed to create skill');
    }
  };

  const handleToggleSkill = async (skill: Skill) => {
    // Optimistic update — toggle locally, persist to API when available
    setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, enabled: !s.enabled } : s));
    try {
      await apiRequest(`/admin/codemode/skills/${skill.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
    } catch {
      // API not available — local toggle still works for now
    }
  };

  const handleDeleteSkill = async (skill: Skill) => {
    if (!await confirm(`Delete skill "${skill.name}"?`, { variant: 'danger', title: 'Delete Skill' })) return;
    try {
      await apiRequest(`/admin/codemode/skills/${skill.id}`, { method: 'DELETE' });
      setSkills(prev => prev.filter(s => s.id !== skill.id));
    } catch {
      setError('Failed to delete skill');
    }
  };

  const handleTogglePlugin = async (plugin: Plugin) => {
    setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, enabled: !p.enabled } : p));
    try {
      await apiRequest(`/admin/codemode/plugins/${plugin.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !plugin.enabled }),
      });
    } catch {
      // API not available — local toggle still works
    }
  };

  const handleDeletePlugin = async (plugin: Plugin) => {
    if (!await confirm(`Uninstall plugin "${plugin.name}"?`, { variant: 'danger', title: 'Uninstall Plugin' })) return;
    try {
      await apiRequest(`/admin/codemode/plugins/${plugin.id}`, { method: 'DELETE' });
      setPlugins(prev => prev.filter(p => p.id !== plugin.id));
    } catch {
      setError('Failed to uninstall plugin');
    }
  };

  const filteredSkills = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase())
  );

  const filteredPlugins = plugins.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { id: 'skills' as const, label: 'Skills', count: skills.length },
    { id: 'plugins' as const, label: 'Plugins', count: plugins.length },
    { id: 'registries' as const, label: 'Registries', count: registries.length },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold mb-1 text-text-primary flex items-center gap-2">
            <Sparkles size={20} />
            Skills & Plugins
          </h2>
          <p className="text-sm text-text-secondary">
            Manage skills, plugins, and registries injected into code mode sessions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary text-text-secondary hover:bg-surface-hover text-sm transition-colors"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync from GitHub'}
          </button>
          {activeTab === 'skills' && (
            <button
              onClick={() => setShowSkillEditor(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 text-sm transition-colors"
            >
              <Plus size={14} />
              Create Skill
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      {success && <div className="p-3 rounded-lg bg-success-500/10 border border-success/30 ap-text-success text-sm">{success}</div>}
      {error && <div className="p-3 rounded-lg bg-error-500/10 border border-error/30 ap-text-error text-sm">{error}</div>}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/10 pb-px">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-primary-500'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-surface-secondary">{tab.count}</span>
            )}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary-500" />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-xs w-48"
            placeholder="Search..."
          />
        </div>
      </div>

      {/* Skill Editor */}
      {showSkillEditor && (
        <div className="glass-card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Create Custom Skill</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
              <input
                value={editingSkill.name}
                onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                placeholder="my-skill"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Description</label>
              <input
                value={editingSkill.description}
                onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                placeholder="One-line description"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Skill Content (Markdown)</label>
            <textarea
              value={editingSkill.content}
              onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
              rows={14}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary font-mono text-xs resize-y"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowSkillEditor(false)}
              className="px-3 py-1.5 rounded-lg bg-surface-secondary text-text-secondary hover:bg-surface-hover text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSkill}
              disabled={!editingSkill.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 text-sm"
            >
              <Save size={14} />
              Create
            </button>
          </div>
        </div>
      )}

      {/* Skills Tab */}
      {activeTab === 'skills' && (
        skillsLoading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Sparkles size={32} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-text-secondary text-sm">No skills configured</p>
            <p className="text-text-tertiary text-xs mt-1">
              Create custom skills or import from a marketplace registry
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {filteredSkills.map(skill => (
              <div key={skill.id} className="glass-card px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => handleToggleSkill(skill)}>
                    {skill.enabled
                      ? <CheckCircle size={18} className="text-green-500" />
                      : <XCircle size={18} className="text-text-tertiary" />
                    }
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{skill.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-text-tertiary">{skill.source}</span>
                    </div>
                    <span className="text-xs text-text-tertiary">{skill.description}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {skill.tags.map(tag => (
                    <span key={tag} className="text-xs px-1.5 py-0.5 rounded-full bg-primary-500/10 text-primary-500">{tag}</span>
                  ))}
                  <button
                    onClick={() => handleDeleteSkill(skill)}
                    className="ml-2 p-1.5 rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Plugins Tab */}
      {activeTab === 'plugins' && (
        pluginsLoading ? (
          <div className="glass-card p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <Package size={32} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-text-secondary text-sm">No plugins installed</p>
            <p className="text-text-tertiary text-xs mt-1">
              Plugins bundle skills, MCP servers, and hooks into installable packages
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPlugins.map(plugin => (
              <div key={plugin.id} className="glass-card px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => handleTogglePlugin(plugin)}>
                    {plugin.enabled
                      ? <CheckCircle size={18} className="text-green-500" />
                      : <XCircle size={18} className="text-text-tertiary" />
                    }
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{plugin.name}</span>
                      <span className="text-xs text-text-tertiary">v{plugin.version}</span>
                    </div>
                    <span className="text-xs text-text-tertiary">{plugin.description}</span>
                    <div className="flex items-center gap-2 mt-1">
                      {plugin.provides.skills > 0 && (
                        <span className="text-xs text-text-tertiary">{plugin.provides.skills} skills</span>
                      )}
                      {plugin.provides.mcpServers > 0 && (
                        <span className="text-xs text-text-tertiary">{plugin.provides.mcpServers} MCP servers</span>
                      )}
                      {plugin.provides.hooks > 0 && (
                        <span className="text-xs text-text-tertiary">{plugin.provides.hooks} hooks</span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDeletePlugin(plugin)}
                  className="p-1.5 rounded hover:bg-error-500/10 text-text-tertiary hover:text-error-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Registries Tab */}
      {activeTab === 'registries' && (
        <div className="space-y-3">
          {registries.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Globe size={32} className="mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary text-sm">No registries configured</p>
              <p className="text-text-tertiary text-xs mt-1">
                Registry management will be available when the /api/admin/codemode/plugins endpoint is deployed
              </p>
            </div>
          ) : (
            registries.map((reg, i) => (
              <div key={i} className="glass-card px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-primary-500" />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{reg.name}</span>
                    {reg.official && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-primary-500/15 text-primary-500">Official</span>
                    )}
                    <div className="text-xs text-text-tertiary font-mono">{reg.url}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CodeModeSkillsView;
