/**
 * SkillsMarketplaceView - Admin view for managing agent skills
 * Skills are composable prompt engineering modules that agents can use.
 * Uses CSS variable design system -- no hardcoded hex colors.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Download, Trash2, X, Edit } from '@/shared/icons';

interface AgentSkill {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  type: string;
  source: string;
  source_url: string | null;
  visibility: string;
  tags: string[];
  usage_count: number;
  created_at: string;
}

interface SkillsMarketplaceViewProps {
  theme: string;
}

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  prompt_injection:  { bg: 'color-mix(in srgb, var(--color-secondary) 12%, transparent)', text: 'var(--color-secondary)' },
  tool_bundle:       { bg: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',   text: 'var(--color-primary)' },
  workflow:          { bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',    text: 'var(--color-success)' },
  code_template:     { bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',    text: 'var(--color-warning)' },
  prompt_module:     { bg: 'color-mix(in srgb, var(--color-accent, var(--color-primary)) 12%, transparent)', text: 'var(--color-accent, var(--color-primary))' },
};

export const SkillsMarketplaceView: React.FC<SkillsMarketplaceViewProps> = ({ theme: _theme }) => {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null);
  const [editForm, setEditForm] = useState({ display_name: '', description: '', type: '', tags: '' });

  const handleEditOpen = (skill: AgentSkill) => {
    setEditingSkill(skill);
    setEditForm({
      display_name: skill.display_name,
      description: skill.description || '',
      type: skill.type,
      tags: skill.tags.join(', '),
    });
  };

  const handleEditSave = async () => {
    if (!editingSkill) return;
    try {
      const response = await fetch(`/api/admin/agents/skills/${editingSkill.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: editForm.display_name,
          description: editForm.description,
          type: editForm.type,
          tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error('Failed to update skill');
      setEditingSkill(null);
      fetchSkills();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/agents/skills', { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to fetch skills: ${response.statusText}`);
      const data = await response.json();
      setSkills(data.skills || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const response = await fetch('/api/admin/agents/skills', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `imported-${Date.now()}`,
          display_name: 'Imported Skill',
          type: 'prompt_module',
          source: 'marketplace',
          source_url: importUrl,
          definition: {},
        }),
      });
      if (!response.ok) throw new Error('Failed to import skill');
      setShowImportModal(false);
      setImportUrl('');
      fetchSkills();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this skill?')) return;
    try {
      const response = await fetch(`/api/admin/agents/skills/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete skill');
      fetchSkills();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const filteredSkills = skills.filter(s =>
    s.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.tags || []).some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const typeStyle = (type: string) => TYPE_STYLES[type] || { bg: 'color-mix(in srgb, var(--text-tertiary) 12%, transparent)', text: 'var(--text-tertiary)' };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading skills...</div>;
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '1.2px' }}>
          Skills ({skills.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
            style={{ border: '1px solid var(--color-border)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent, var(--color-primary))'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <Download size={12} /> Import
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: '#fff' }}
          >
            <Plus size={12} /> Create Skill
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2 rounded-md text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)', color: 'var(--color-error)' }}>
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:opacity-70">dismiss</button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          type="text"
          placeholder="Search skills by name or tag..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-md text-xs outline-none"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredSkills.map(skill => {
          const ts = typeStyle(skill.type);
          return (
            <div
              key={skill.id}
              className="rounded-lg p-3.5 transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--color-border) 70%, var(--color-primary))')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{skill.display_name}</span>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: ts.bg, color: ts.text, fontFamily: "'JetBrains Mono', monospace" }}>
                      {skill.type}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 40%, transparent))', color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {skill.source}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {skill.usage_count} uses
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => handleEditOpen(skill)}
                    className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent, var(--color-primary))')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                    title="Edit"
                  ><Edit size={13} /></button>
                  <button
                    onClick={() => handleDelete(skill.id)}
                    className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-error)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                    title="Delete"
                  ><Trash2 size={13} /></button>
                </div>
              </div>
              {skill.description && (
                <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{skill.description}</p>
              )}
              {skill.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 30%, transparent))', color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredSkills.length === 0 && (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No skills found. Import from a URL or create a custom skill.
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowImportModal(false)}>
          <div
            className="rounded-xl w-[500px] shadow-2xl"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Import Skill</h3>
              <button onClick={() => setShowImportModal(false)} className="p-1 rounded transition-opacity hover:opacity-70" style={{ color: 'var(--text-secondary)' }}><X size={14} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Source URL (OpenClaw, GitHub, etc.)</label>
                <input
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full px-3 py-2 rounded-md text-xs outline-none"
                  style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 20%, transparent))', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-md transition-colors"
                style={{ border: '1px solid var(--color-border)', color: 'var(--text-secondary)' }}
              >Cancel</button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md transition-all hover:brightness-110 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: '#fff' }}
              >
                <Download size={12} /> {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Skill Modal */}
      {editingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-lg rounded-xl p-5 shadow-xl" style={{ backgroundColor: 'var(--color-surface, #1c1c1c)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Edit Skill: {editingSkill.name}</h3>
              <button onClick={() => setEditingSkill(null)} className="p-1 rounded-md transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Display Name</label>
                <input value={editForm.display_name} onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs rounded-md border outline-none" style={{ backgroundColor: 'var(--color-surfaceSecondary, #111)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Description</label>
                <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3}
                  className="w-full px-3 py-1.5 text-xs rounded-md border outline-none resize-none" style={{ backgroundColor: 'var(--color-surfaceSecondary, #111)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Type</label>
                <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs rounded-md border outline-none" style={{ backgroundColor: 'var(--color-surfaceSecondary, #111)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }}>
                  <option value="prompt_injection">prompt_injection</option>
                  <option value="tool_bundle">tool_bundle</option>
                  <option value="workflow">workflow</option>
                  <option value="code_template">code_template</option>
                  <option value="prompt_module">prompt_module</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Tags (comma-separated)</label>
                <input value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs rounded-md border outline-none" style={{ backgroundColor: 'var(--color-surfaceSecondary, #111)', border: '1px solid var(--color-border)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditingSkill(null)} className="px-4 py-1.5 text-xs rounded-md" style={{ color: 'var(--text-secondary)', border: '1px solid var(--color-border)' }}>Cancel</button>
              <button onClick={handleEditSave} className="px-4 py-1.5 text-xs font-semibold rounded-md" style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: '#fff' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
