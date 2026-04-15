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
 * Prompt Modules View
 *
 * Admin view for managing composable prompt modules.
 * Shows all modules with filtering, search, and inline editing.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw } from '@/shared/icons';
import { AdminBadge } from '../Shared/AdminBadge';
import { AdminButton } from '../Shared/AdminButton';
import { apiRequestJson } from '@/utils/api';
import { ModuleEditor } from './ModuleEditor';

interface InjectionRules {
  toolPatterns?: string[];
  requiresCapabilities?: string[];
  requiresModes?: string[];
  alwaysInject?: boolean;
  semanticMatch?: boolean;
}

interface PromptModule {
  id: string;
  name: string;
  category: 'core' | 'domain' | 'mode' | 'capability';
  description?: string;
  content: string;
  priority: number;
  tokenCost: number;
  enabled: boolean;
  injection: InjectionRules;
  variants?: Record<string, string>;
  updatedAt?: string;
  createdAt?: string;
}

type CategoryFilter = 'all' | 'core' | 'domain' | 'mode' | 'capability';

const CATEGORY_COLORS: Record<string, string> = {
  core: '#3b82f6',
  domain: '#22c55e',
  mode: '#a855f7',
  capability: '#f97316',
};

export const PromptModulesView: React.FC = () => {
  const [modules, setModules] = useState<PromptModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedModule, setSelectedModule] = useState<PromptModule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const fetchModules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequestJson<any>('/admin/prompts/modules');
      setModules(data.modules || data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load prompt modules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModules();
  }, [fetchModules]);

  const filteredModules = modules.filter((m) => {
    const matchesSearch =
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.description || '').toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || m.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleRowClick = (mod: PromptModule) => {
    setSelectedModule(mod);
    setEditorOpen(true);
  };

  const handleSaved = (updated: PromptModule) => {
    setModules((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditorOpen(false);
    setSelectedModule(null);
  };

  const categories: CategoryFilter[] = ['all', 'core', 'domain', 'mode', 'capability'];
  const categoryCounts: Record<string, number> = { all: modules.length };
  for (const m of modules) {
    categoryCounts[m.category] = (categoryCounts[m.category] || 0) + 1;
  }

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="font-bold"
            style={{ fontSize: '16px', color: 'var(--text-primary)' }}
          >
            Prompt Modules
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Composable prompt building blocks — select, score, and inject per-context
          </p>
        </div>
        <AdminButton
          variant="secondary"
          icon={<RefreshCw size={13} />}
          loading={loading}
          onClick={fetchModules}
          size="sm"
        >
          Refresh
        </AdminButton>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            style={{
              padding: '4px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: categoryFilter === cat ? '600' : '400',
              color: categoryFilter === cat ? 'var(--color-primary)' : 'var(--text-secondary)',
              backgroundColor: categoryFilter === cat
                ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)'
                : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
            {' '}
            <span style={{ fontSize: '11px', opacity: 0.7 }}>
              ({categoryCounts[cat] || 0})
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: '320px' }}>
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-secondary)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          placeholder="Search modules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            paddingLeft: '32px',
            paddingRight: '12px',
            paddingTop: '6px',
            paddingBottom: '6px',
            fontSize: '13px',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            backgroundColor: 'var(--color-bg-secondary)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            color: 'var(--color-error)',
            border: '1px solid color-mix(in srgb, var(--color-error) 20%, transparent)',
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Name', 'Category', 'Priority', 'Tokens', 'Enabled', 'Last Edited'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--color-border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  Loading modules...
                </td>
              </tr>
            ) : filteredModules.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  No modules found
                </td>
              </tr>
            ) : (
              filteredModules.map((mod, idx) => (
                <tr
                  key={mod.id}
                  onClick={() => handleRowClick(mod)}
                  style={{
                    cursor: 'pointer',
                    borderBottom: idx < filteredModules.length - 1 ? '1px solid var(--color-border)' : 'none',
                    transition: 'background-color 100ms',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surfaceHover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  }}
                >
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>
                      {mod.name}
                    </span>
                    {mod.description && (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                        {mod.description}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <AdminBadge
                      color={CATEGORY_COLORS[mod.category] || '#6b7280'}
                      label={mod.category}
                      size="sm"
                    />
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--text-primary)' }}>
                    {mod.priority}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    ~{mod.tokenCost}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: mod.enabled ? '#22c55e' : 'var(--text-secondary)',
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: mod.enabled ? '#22c55e' : 'var(--color-border)',
                        }}
                      />
                      {mod.enabled ? 'On' : 'Off'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {mod.updatedAt
                      ? new Date(mod.updatedAt).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Module Editor */}
      {selectedModule && (
        <ModuleEditor
          isOpen={editorOpen}
          module={selectedModule}
          onClose={() => {
            setEditorOpen(false);
            setSelectedModule(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

export default PromptModulesView;
