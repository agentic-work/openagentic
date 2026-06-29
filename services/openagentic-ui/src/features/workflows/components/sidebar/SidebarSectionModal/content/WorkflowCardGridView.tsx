/**
 * WorkflowCardGridView — shared card grid used by the Deployed, My Workflows,
 * and Templates sections (selected via the `filter` prop).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Rocket, Trash2 } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { TemplateLegend } from '../../../TemplateLegend';
import { inputClass, inputStyle, type WorkflowSummary, type WorkflowNode } from '../sectionShared';

// ---------------------------------------------------------------------------
// TAG COLORS — consistent palette for workflow tags
// ---------------------------------------------------------------------------
// theme-allow: categorical tag identity palette (incl. vendor brand hues — AWS
// #ff9900, Azure #008ad7, GCP #4285f4, k8s #326ce5, GitHub). Same carve-out as the
// node-TYPE identity + vendor brand color allowlist; these are recognizable tag
// identities, not themeable surfaces (soft `${color}10` bg / `${color}30` border tints).
const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'aws':              { bg: '#ff990010', text: '#ff9900', border: '#ff990030' },
  'azure':            { bg: '#008ad710', text: '#008ad7', border: '#008ad730' },
  'gcp':              { bg: '#4285f410', text: '#4285f4', border: '#4285f430' },
  'kubernetes':       { bg: '#326ce510', text: '#326ce5', border: '#326ce530' },
  'github':           { bg: '#8b5cf610', text: '#8b5cf6', border: '#8b5cf630' },
  'security':         { bg: '#ef444410', text: 'var(--color-error)', border: '#ef444430' },
  'multi-agent':      { bg: '#f59e0b10', text: 'var(--color-warning)', border: '#f59e0b30' },
  'ai-analysis':      { bg: '#8b5cf610', text: '#8b5cf6', border: '#8b5cf630' },
  'web-research':     { bg: '#06b6d410', text: 'var(--color-info)', border: '#06b6d430' },
  'mcp-tool':         { bg: '#10b98110', text: 'var(--color-success)', border: '#10b98130' },
  'monitoring':       { bg: '#f9731610', text: 'var(--color-warning)', border: '#f9731630' },
  'cost-analysis':    { bg: '#eab30810', text: 'var(--color-warning)', border: '#eab30830' },
  'seo':              { bg: '#ec489910', text: '#ec4899', border: '#ec489930' },
  'competitive-intel':{ bg: '#6366f110', text: '#6366f1', border: '#6366f130' },
  'content':          { bg: '#14b8a610', text: '#14b8a6', border: '#14b8a630' },
  'feedback':         { bg: '#a855f710', text: '#a855f7', border: '#a855f730' },
  'compliance':       { bg: '#dc262610', text: 'var(--color-error)', border: '#dc262630' },
  'devops':           { bg: '#2563eb10', text: '#2563eb', border: '#2563eb30' },
  'research':         { bg: '#0ea5e910', text: '#0ea5e9', border: '#0ea5e930' },
  'code-execution':   { bg: '#84cc1610', text: '#84cc16', border: '#84cc1630' },
};

const defaultTagColor = { bg: 'var(--color-surface)', text: 'var(--color-text-secondary)', border: 'var(--color-border)' };

function getTagColor(tag: string) {
  return TAG_COLORS[tag] || defaultTagColor;
}

const TagPill: React.FC<{ tag: string; selected?: boolean; onClick?: () => void }> = ({ tag, selected, onClick }) => {
  const colors = getTagColor(tag);
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all"
      style={{
        backgroundColor: selected ? colors.text : colors.bg,
        color: selected ? 'var(--color-on-accent)' : colors.text,
        borderColor: colors.border,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {tag}
    </button>
  );
};

// ---------------------------------------------------------------------------
// WORKFLOW CARD GRID VIEW — shared between Deployed and My Workflows
// ---------------------------------------------------------------------------

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    ops: 'var(--color-warning)', data: 'var(--color-info)', security: 'var(--color-error)', cloud: 'var(--color-info)',
    engineering: 'var(--color-success)', gov: 'var(--color-accent)', research: 'var(--color-accent)', starter: 'var(--color-fg-subtle)',
  };
  return colors[category?.toLowerCase()] || 'var(--color-fg-subtle)';
}

export const WorkflowCardGridView: React.FC<{ filter: 'deployed' | 'my' | 'templates' }> = ({ filter }) => {
  const { getAuthHeaders } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'runs'>('updated');
  const [deleting, setDeleting] = useState<string | null>(null);
  // Per user 2026-05-14 — template gallery cards must surface a legend
  // (purpose / how_it_works / expected_output / useful_when / tools_used)
  // explaining what each flow is for. Single-click expands; double-click
  // still clones+opens (existing behavior preserved).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchWorkflows = React.useCallback(async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      if (filter === 'templates') {
        // Fetch from templates endpoint, fall back to main list
        let templates: WorkflowSummary[] = [];
        try {
          const tplRes = await fetch('/api/workflows/templates', { headers });
          if (tplRes.ok) {
            const tplData = await tplRes.json();
            templates = tplData.templates || tplData || [];
          }
        } catch { /* ignore */ }
        // Also include starter flows and is_template from main list
        if (templates.length === 0) {
          const res = await fetch('/api/workflows', { headers });
          if (res.ok) {
            const data = await res.json();
            const all = data.workflows || data || [];
            templates = all.filter((w: WorkflowSummary) => w.is_template || w.is_public || w.category === 'starter' || (w.tags || []).includes('starter'));
          }
        }
        setWorkflows(templates);
      } else {
        const res = await fetch('/api/workflows', { headers });
        if (res.ok) {
          const data = await res.json();
          const all = data.workflows || data || [];
          if (filter === 'deployed') {
            setWorkflows(all.filter((w: WorkflowSummary) => w.status === 'active'));
          } else {
            // My Workflows: show ALL non-template workflows (both active and draft)
            setWorkflows(all.filter((w: WorkflowSummary) => !w.is_template));
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getAuthHeaders, filter]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    workflows.forEach(w => (w.tags || []).forEach((t: string) => tags.add(t)));
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [workflows]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Filter and sort
  const filtered = useMemo(() => {
    let result = workflows;

    // Text search (name + description + tags)
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(w =>
        w.name?.toLowerCase().includes(q) ||
        w.description?.toLowerCase().includes(q) ||
        (w.tags || []).some((t: string) => t.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (selectedTags.size > 0) {
      result = result.filter(w =>
        (w.tags || []).some((t: string) => selectedTags.has(t))
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'runs') return (b.executionCount || 0) - (a.executionCount || 0);
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });

    return result;
  }, [workflows, searchTerm, selectedTags, sortBy]);

  const handleUndeploy = async (id: string) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE', headers });
      if (res.ok) setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
    setDeleting(null);
  };

  if (loading) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading workflows...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {filter === 'deployed'
          ? 'Manage deployed workflows. Undeploy to move back to draft, or delete permanently.'
          : filter === 'templates'
          ? 'Pre-built workflow templates. Double-click to create a new flow from any template.'
          : 'Your draft and saved workflows. Open in canvas to edit, deploy when ready.'}
      </p>

      {/* Search + Sort bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name, description, or tag..."
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: '2.25rem' }}
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'name' | 'updated' | 'runs')}
          className="glass-field px-3 py-2 text-sm rounded-lg"
        >
          <option value="updated">Recently Updated</option>
          <option value="name">Name A-Z</option>
          <option value="runs">Most Runs</option>
        </select>
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <TagPill key={tag} tag={tag} selected={selectedTags.has(tag)} onClick={() => toggleTag(tag)} />
          ))}
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Rocket className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {searchTerm || selectedTags.size > 0 ? 'No matching workflows' : filter === 'deployed' ? 'No deployed workflows yet' : filter === 'templates' ? 'No templates available' : 'No workflows yet'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
            {filter === 'deployed' ? 'Deploy a workflow from the canvas to see it here.' : filter === 'templates' ? 'Templates will appear here once seeded.' : 'Create a new flow from the sidebar to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(wf => (
            <div
              key={wf.id}
              data-testid={filter === 'templates' ? 'template-gallery-card' : undefined}
              data-template-slug={wf.name}
              role="button"
              tabIndex={0}
              className="glass-card glass-surface-hover group relative p-4 cursor-pointer"
              style={{
                borderColor: filter === 'templates' && expandedId === wf.id
                  ? 'var(--color-accent)'
                  : undefined,
                boxShadow: filter === 'templates' && expandedId === wf.id
                  ? '0 0 0 1px var(--color-accent)' : undefined,
              }}
              onKeyDown={(e) => {
                if (filter !== 'templates') return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedId(prev => prev === wf.id ? null : wf.id);
                }
              }}
              onClick={(e) => {
                // Templates view: single-click toggles legend; clicks on
                // child buttons (Use Template, etc.) stop propagation
                // upstream so this only fires on the card body.
                if (filter !== 'templates') return;
                const tag = (e.target as HTMLElement).tagName.toLowerCase();
                if (tag === 'button' || (e.target as HTMLElement).closest('button')) return;
                setExpandedId(prev => prev === wf.id ? null : wf.id);
              }}
              onDoubleClick={async () => {
                if (filter === 'templates') {
                  // Clone template to user workspace via duplicate API
                  try {
                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                    const token = localStorage.getItem('auth_token');
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    const resp = await fetch(`/api/workflows/${wf.id}/duplicate`, { method: 'POST', headers });
                    if (resp.ok) {
                      const data = await resp.json();
                      const newId = data.workflow?.id || data.id;
                      if (newId) {
                        window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: newId } }));
                      }
                    } else {
                      console.error('Failed to clone template:', resp.status, await resp.text());
                    }
                  } catch (err) {
                    console.error('Failed to clone template:', err);
                  }
                } else {
                  window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: wf.id } }));
                }
              }}
              title={filter === 'templates' ? 'Click to view legend, double-click to use this template' : 'Double-click to open in canvas'}
            >
              {/* Header row */}
              <div className="flex items-start gap-3 mb-2">
                {/* Status indicator */}
                <span className="relative flex-shrink-0 mt-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: filter === 'deployed' ? 'var(--color-success)' : filter === 'templates' ? 'var(--color-accent)' : 'var(--color-fg-subtle)' }}
                  />
                  {filter === 'deployed' && (
                    <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: 'var(--color-success)', opacity: 0.3, width: 10, height: 10 }} />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {wf.name || 'Untitled Workflow'}
                  </div>
                  {wf.description && (
                    <div className="text-xs mt-0.5" style={{
                      color: 'var(--color-text-tertiary)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
                    }}>
                      {wf.description}
                    </div>
                  )}
                  {/* Complexity indicator */}
                  {(() => {
                    const nodes = wf.nodes || wf.definition?.nodes || [];
                    const agentCount = nodes.filter((n: WorkflowNode) =>
                      ['multi_agent', 'agent_spawn', 'agent_single', 'agent_pool', 'agent_supervisor'].includes(n.type)
                    ).length;
                    const toolCount = nodes.filter((n: WorkflowNode) => n.type === 'mcp_tool').length;
                    const llmCount = nodes.filter((n: WorkflowNode) => n.type === 'openagentic_llm').length;
                    if (agentCount === 0 && toolCount === 0 && llmCount === 0) return null;
                    return (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                        {agentCount > 0 && <span>{agentCount} agent{agentCount > 1 ? 's' : ''}</span>}
                        {toolCount > 0 && <span>{toolCount} tool{toolCount > 1 ? 's' : ''}</span>}
                        {llmCount > 0 && <span>{llmCount} LLM</span>}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Category badge + Tags */}
              {wf.category && (
                <div className="mb-1.5">
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    background: getCategoryColor(wf.category) + '20',
                    color: getCategoryColor(wf.category),
                    border: `1px solid ${getCategoryColor(wf.category)}40`,
                  }}>
                    {wf.category}
                  </span>
                </div>
              )}

              {/* Tags */}
              {(wf.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(wf.tags as string[]).slice(0, 6).map((tag: string) => (
                    <TagPill key={tag} tag={tag} onClick={() => toggleTag(tag)} />
                  ))}
                  {(wf.tags as string[]).length > 6 && (
                    <span className="text-[10px] px-1.5 py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      +{(wf.tags as string[]).length - 6} more
                    </span>
                  )}
                </div>
              )}

              {/* Expanded legend (templates view only) — purpose / how it works / expected output / when to use */}
              {filter === 'templates' && expandedId === wf.id && wf.meta && (
                <div
                  data-testid="template-card-legend"
                  style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}
                >
                  <TemplateLegend meta={wf.meta} variant="card" />
                </div>
              )}

              {/* Meta row */}
              <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--color-text-tertiary)', marginTop: filter === 'templates' && expandedId === wf.id ? 10 : 0 }}>
                <div className="flex items-center gap-3">
                  <span>{wf.nodes?.length || 0} nodes</span>
                  <span>{wf.executionCount || 0} runs</span>
                  {wf.updated_at && (
                    <span>{new Date(wf.updated_at).toLocaleDateString()}</span>
                  )}
                  {filter === 'templates' && wf.meta && (
                    <span style={{
                      fontWeight: 600,
                      color: 'var(--color-accent)',
                      cursor: 'pointer',
                    }}>
                      {expandedId === wf.id ? 'Hide legend' : 'Show legend'}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {filter === 'deployed' && (
                    <button
                      onClick={() => handleUndeploy(wf.id)}
                      className="px-2 py-0.5 text-[11px] font-medium rounded border transition-colors hover:bg-[var(--color-surface)]"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                    >
                      Undeploy
                    </button>
                  )}
                  {filter === 'templates' ? (
                    <button
                      onClick={async () => {
                        try {
                          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                          const token = localStorage.getItem('auth_token');
                          if (token) headers['Authorization'] = `Bearer ${token}`;
                          const resp = await fetch(`/api/workflows/${wf.id}/duplicate`, { method: 'POST', headers });
                          if (resp.ok) {
                            const data = await resp.json();
                            const newId = data.workflow?.id || data.id;
                            if (newId) {
                              window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: newId } }));
                            }
                          } else {
                            console.error('Failed to clone template:', resp.status, await resp.text());
                          }
                        } catch (err) {
                          console.error('Failed to clone template:', err);
                        }
                      }}
                      className="px-2 py-0.5 text-[11px] font-medium rounded border transition-colors"
                      style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
                    >
                      Use Template
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDelete(wf.id, wf.name)}
                      disabled={deleting === wf.id}
                      className="p-1 rounded transition-colors hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]"
                      style={{ color: 'var(--color-error)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {filtered.length} of {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
        {selectedTags.size > 0 && ` (filtered by ${selectedTags.size} tag${selectedTags.size !== 1 ? 's' : ''})`}
      </div>
    </div>
  );
};
