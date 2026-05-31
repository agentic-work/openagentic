/**
 * ShareDialog - Comprehensive workflow sharing panel with 4 tabs:
 *   1. Visibility  - Private / Team / Public with group picker
 *   2. People & Groups - Granular user/group sharing with roles
 *   3. API Access  - Webhooks, API keys, code snippets
 *   4. Embed       - Widget, iFrame, React component snippets
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Globe,
  Lock,
  Users,
  Key,
  Link,
  Code,
  Copy,
  Eye,
  Edit,
  Play,
  Trash2,
  Plus,
  Search,
  Shield,
  Check,
  AlertCircle,
  ExternalLink,
  Settings,
  ChevronDown,
  RefreshCw,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Visibility = 'private' | 'team' | 'public';

type ShareRole = 'viewer' | 'editor' | 'executor' | 'admin';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
  currentVisibility: Visibility;
  onVisibilityChange: (visibility: Visibility) => Promise<void>;
}

interface UserGroup {
  id: string;
  name: string;
  memberCount?: number;
}

interface ShareEntry {
  id: string;
  type: 'user' | 'group';
  name: string;
  email?: string;
  role: ShareRole;
  avatarUrl?: string;
}

interface SearchUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

interface ApiKeyEntry {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface WebhookInfo {
  id: string;
  key: string;
  active: boolean;
  responseMode: 'sync' | 'async';
  rateLimit: number;
}

type TabId = 'visibility' | 'people' | 'api' | 'embed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'visibility', label: 'Visibility', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'people', label: 'People & Groups', icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'api', label: 'API Access', icon: <Key className="w-3.5 h-3.5" /> },
  { id: 'embed', label: 'Embed', icon: <Code className="w-3.5 h-3.5" /> },
];

const VISIBILITY_OPTIONS: { value: Visibility; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only you can see and edit this workflow',
    icon: <Lock className="w-5 h-5" />,
  },
  {
    value: 'team',
    label: 'Team',
    description: 'Members of selected groups can view and run this workflow',
    icon: <Users className="w-5 h-5" />,
  },
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone in the organization can view and run this workflow',
    icon: <Globe className="w-5 h-5" />,
  },
];

const ROLE_OPTIONS: { value: ShareRole; label: string; description: string }[] = [
  { value: 'viewer', label: 'Viewer', description: 'Can view workflow and results' },
  { value: 'editor', label: 'Editor', description: 'Can edit workflow configuration' },
  { value: 'executor', label: 'Executor', description: 'Can run the workflow' },
  { value: 'admin', label: 'Admin', description: 'Full control including sharing' },
];

const SNIPPET_LANGUAGES = ['cURL', 'Python', 'JavaScript', 'Go'] as const;
type SnippetLanguage = typeof SNIPPET_LANGUAGES[number];

const BORDER = 'var(--color-border, rgba(255,255,255,0.08))';
const TEXT = 'var(--color-text, #FFFFFF)';
const TEXT_TERTIARY = 'var(--color-text-tertiary, #636366)';
const SURFACE = 'var(--color-surface, #1C1C1E)';
const BG_SECONDARY = 'var(--color-bg-secondary, #2C2C2E)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleIcon(role: ShareRole) {
  switch (role) {
    case 'viewer': return <Eye className="w-3.5 h-3.5" />;
    case 'editor': return <Edit className="w-3.5 h-3.5" />;
    case 'executor': return <Play className="w-3.5 h-3.5" />;
    case 'admin': return <Shield className="w-3.5 h-3.5" />;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function generateSnippet(
  lang: SnippetLanguage,
  webhookUrl: string,
  apiKey: string,
): string {
  const safeKey = apiKey || '<YOUR_API_KEY>';

  switch (lang) {
    case 'cURL':
      return `curl -X POST '${webhookUrl}' \\
  -H 'Authorization: Bearer ${safeKey}' \\
  -H 'Content-Type: application/json' \\
  -d '{"input": {"message": "Hello"}}'`;

    case 'Python':
      return `import requests

response = requests.post(
    "${webhookUrl}",
    headers={
        "Authorization": "Bearer ${safeKey}",
        "Content-Type": "application/json",
    },
    json={"input": {"message": "Hello"}},
)
print(response.json())`;

    case 'JavaScript':
      return `const response = await fetch("${webhookUrl}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${safeKey}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ input: { message: "Hello" } }),
});
const data = await response.json();
console.log(data);`;

    case 'Go':
      return `package main

import (
\t"bytes"
\t"encoding/json"
\t"fmt"
\t"net/http"
\t"io"
)

func main() {
\tbody, _ := json.Marshal(map[string]any{
\t\t"input": map[string]string{"message": "Hello"},
\t})
\treq, _ := http.NewRequest("POST", "${webhookUrl}", bytes.NewReader(body))
\treq.Header.Set("Authorization", "Bearer ${safeKey}")
\treq.Header.Set("Content-Type", "application/json")
\tresp, _ := http.DefaultClient.Do(req)
\tdefer resp.Body.Close()
\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))
}`;
  }
}

// ---------------------------------------------------------------------------
// Clipboard hook
// ---------------------------------------------------------------------------

function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback for insecure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedKey(key);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    }
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { copy, isCopied: (key: string) => copiedKey === key };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CopyButton: React.FC<{ text: string; copyKey: string; copy: (t: string, k: string) => Promise<void>; isCopied: (k: string) => boolean }> = ({
  text, copyKey, copy, isCopied,
}) => (
  <button
    onClick={() => copy(text, copyKey)}
    className="flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors hover:bg-white/10"
    style={{ color: isCopied(copyKey) ? 'var(--color-success)' : TEXT_TERTIARY }}
    title="Copy to clipboard"
  >
    {isCopied(copyKey) ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    {isCopied(copyKey) ? 'Copied!' : 'Copy'}
  </button>
);

const CodeBlock: React.FC<{ code: string; copyKey: string; copy: (t: string, k: string) => Promise<void>; isCopied: (k: string) => boolean }> = ({
  code, copyKey, copy, isCopied,
}) => (
  <div className="relative rounded-lg overflow-hidden" style={{ background: BG_SECONDARY }}>
    <div className="absolute top-2 right-2 z-10">
      <CopyButton text={code} copyKey={copyKey} copy={copy} isCopied={isCopied} />
    </div>
    <pre className="p-3 pr-20 text-xs leading-relaxed overflow-x-auto" style={{ color: TEXT, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
      <code>{code}</code>
    </pre>
  </div>
);

const Spinner: React.FC<{ size?: string }> = ({ size = 'w-4 h-4' }) => (
  <RefreshCw className={`${size} animate-spin`} style={{ color: TEXT_TERTIARY }} />
);

const EmptyState: React.FC<{ icon: React.ReactNode; message: string }> = ({ icon, message }) => (
  <div className="flex flex-col items-center justify-center py-8 gap-2" style={{ color: TEXT_TERTIARY }}>
    {icon}
    <span className="text-xs">{message}</span>
  </div>
);

// ---------------------------------------------------------------------------
// RoleDropdown
// ---------------------------------------------------------------------------

const RoleDropdown: React.FC<{
  value: ShareRole;
  onChange: (role: ShareRole) => void;
  compact?: boolean;
}> = ({ value, onChange, compact }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 rounded-md border text-xs transition-colors hover:bg-white/5 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}
        style={{ borderColor: BORDER, color: TEXT }}
      >
        {roleIcon(value)}
        <span className="capitalize">{value}</span>
        <ChevronDown className="w-3 h-3" style={{ color: TEXT_TERTIARY }} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-44 rounded-lg border shadow-xl z-50 py-1"
          style={{ background: SURFACE, borderColor: BORDER }}
        >
          {ROLE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
              style={{ color: value === opt.value ? 'var(--user-accent-primary, #FF5722)' : TEXT }}
            >
              {roleIcon(opt.value)}
              <div>
                <div className="font-medium capitalize">{opt.label}</div>
                <div className="text-[10px]" style={{ color: TEXT_TERTIARY }}>{opt.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab 1: Visibility
// ---------------------------------------------------------------------------

const VisibilityTab: React.FC<{
  workflowId: string;
  selected: Visibility;
  setSelected: (v: Visibility) => void;
  saving: boolean;
  onSave: () => void;
  getAuthHeaders: () => Record<string, string>;
}> = ({ workflowId: _workflowId, selected, setSelected, saving, onSave, getAuthHeaders }) => {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);

  // Fetch groups when team is selected
  useEffect(() => {
    if (selected !== 'team') return;
    let cancelled = false;
    setLoadingGroups(true);
    fetch('/api/user/groups', { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        if (!cancelled) setGroups(Array.isArray(data) ? data : data.groups ?? []);
      })
      .catch(() => { if (!cancelled) setGroups([]); })
      .finally(() => { if (!cancelled) setLoadingGroups(false); });
    return () => { cancelled = true; };
  }, [selected, getAuthHeaders]);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {VISIBILITY_OPTIONS.map(option => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              onClick={() => setSelected(option.value)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all"
              style={{
                borderColor: isSelected ? 'var(--user-accent-primary, #FF5722)' : BORDER,
                background: isSelected ? 'color-mix(in srgb, var(--user-accent-primary, #FF5722) 10%, transparent)' : 'transparent',
              }}
            >
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                style={{
                  background: isSelected ? 'color-mix(in srgb, var(--user-accent-primary, #FF5722) 20%, transparent)' : BG_SECONDARY,
                  color: isSelected ? 'var(--user-accent-primary, #FF5722)' : TEXT_TERTIARY,
                }}
              >
                {option.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: TEXT }}>{option.label}</div>
                <div className="text-xs" style={{ color: TEXT_TERTIARY }}>{option.description}</div>
              </div>
              <div
                className="flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                style={{ borderColor: isSelected ? 'var(--user-accent-primary, #FF5722)' : TEXT_TERTIARY }}
              >
                {isSelected && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--user-accent-primary, #FF5722)' }} />}
              </div>
            </button>
          );
        })}

        {/* Team group picker */}
        {selected === 'team' && (
          <div className="mt-3 rounded-lg border p-3" style={{ borderColor: BORDER, background: BG_SECONDARY }}>
            <label className="text-xs font-medium mb-2 block" style={{ color: TEXT }}>
              Select groups to share with
            </label>
            {loadingGroups ? (
              <div className="flex items-center gap-2 py-2">
                <Spinner /> <span className="text-xs" style={{ color: TEXT_TERTIARY }}>Loading groups...</span>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-xs py-2" style={{ color: TEXT_TERTIARY }}>No groups found. Create groups in the Admin panel.</p>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setGroupDropdownOpen(o => !o)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs"
                  style={{ borderColor: BORDER, color: TEXT }}
                >
                  <span>
                    {selectedGroupIds.size === 0
                      ? 'Choose groups...'
                      : `${selectedGroupIds.size} group${selectedGroupIds.size > 1 ? 's' : ''} selected`}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" style={{ color: TEXT_TERTIARY }} />
                </button>
                {groupDropdownOpen && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 rounded-lg border shadow-xl z-50 max-h-40 overflow-y-auto py-1"
                    style={{ background: SURFACE, borderColor: BORDER }}
                  >
                    {groups.map(g => (
                      <button
                        key={g.id}
                        onClick={() => toggleGroup(g.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                        style={{ color: TEXT }}
                      >
                        <div
                          className="w-4 h-4 rounded border flex items-center justify-center"
                          style={{
                            borderColor: selectedGroupIds.has(g.id) ? 'var(--user-accent-primary, #FF5722)' : BORDER,
                            background: selectedGroupIds.has(g.id) ? 'var(--user-accent-primary, #FF5722)' : 'transparent',
                          }}
                        >
                          {selectedGroupIds.has(g.id) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <Users className="w-3.5 h-3.5" style={{ color: TEXT_TERTIARY }} />
                        <span>{g.name}</span>
                        {g.memberCount != null && (
                          <span className="ml-auto" style={{ color: TEXT_TERTIARY }}>{g.memberCount} members</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Public warning */}
        {selected === 'public' && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border p-3" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#eab308' }} />
            <div className="text-xs leading-relaxed" style={{ color: '#eab308' }}>
              <strong>Organization-wide access.</strong> All members of your organization will be able to view
              and run this workflow. Sensitive data within the workflow may be visible to others.
            </div>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: BORDER }}>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab 2: People & Groups
// ---------------------------------------------------------------------------

const PeopleTab: React.FC<{
  workflowId: string;
  getAuthHeaders: () => Record<string, string>;
}> = ({ workflowId, getAuthHeaders }) => {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [addRole, setAddRole] = useState<ShareRole>('viewer');
  const [groupResults, setGroupResults] = useState<UserGroup[]>([]);
  const [searchingGroups, setSearchingGroups] = useState(false);
  const [showUserResults, setShowUserResults] = useState(false);
  const [showGroupResults, setShowGroupResults] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Fetch current shares
  useEffect(() => {
    let cancelled = false;
    setLoadingShares(true);
    fetch(`/api/workflows/${workflowId}/shares`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => { if (!cancelled) setShares(Array.isArray(data) ? data : data.shares ?? []); })
      .catch(() => { if (!cancelled) setShares([]); })
      .finally(() => { if (!cancelled) setLoadingShares(false); });
    return () => { cancelled = true; };
  }, [workflowId, getAuthHeaders]);

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setGroupResults([]);
      setShowUserResults(false);
      setShowGroupResults(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const q = encodeURIComponent(searchQuery.trim());
      // Search users
      setSearchingUsers(true);
      try {
        const r = await fetch(`/api/admin/users?search=${q}`, { headers: getAuthHeaders() });
        if (r.ok) {
          const data = await r.json();
          const users: SearchUser[] = (Array.isArray(data) ? data : data.users ?? []).map((u: any) => ({
            id: u.id,
            name: u.name || u.displayName || u.email,
            email: u.email,
            avatarUrl: u.avatarUrl,
          }));
          setSearchResults(users);
          setShowUserResults(users.length > 0);
        }
      } catch { /* ignore */ }
      setSearchingUsers(false);

      // Search groups
      setSearchingGroups(true);
      try {
        const r = await fetch('/api/user/groups', { headers: getAuthHeaders() });
        if (r.ok) {
          const data = await r.json();
          const all: UserGroup[] = Array.isArray(data) ? data : data.groups ?? [];
          const filtered = all.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
          setGroupResults(filtered);
          setShowGroupResults(filtered.length > 0);
        }
      } catch { /* ignore */ }
      setSearchingGroups(false);
    }, 300);

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, getAuthHeaders]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowUserResults(false);
        setShowGroupResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const addShare = async (entry: Omit<ShareEntry, 'role'>) => {
    const existing = shares.find(s => s.id === entry.id && s.type === entry.type);
    if (existing) return;

    const newShare: ShareEntry = { ...entry, role: addRole };
    setShares(prev => [...prev, newShare]);
    setSearchQuery('');
    setShowUserResults(false);
    setShowGroupResults(false);

    try {
      await fetch(`/api/workflows/${workflowId}/shares`, {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: entry.id, targetType: entry.type, role: addRole }),
      });
    } catch {
      // Revert on failure
      setShares(prev => prev.filter(s => !(s.id === entry.id && s.type === entry.type)));
    }
  };

  const updateRole = async (shareId: string, shareType: string, role: ShareRole) => {
    setShares(prev => prev.map(s => (s.id === shareId && s.type === shareType) ? { ...s, role } : s));
    try {
      await fetch(`/api/workflows/${workflowId}/shares/${shareId}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
    } catch { /* best effort */ }
  };

  const removeShare = async (shareId: string, shareType: string) => {
    const prev = shares;
    setShares(s => s.filter(e => !(e.id === shareId && e.type === shareType)));
    try {
      await fetch(`/api/workflows/${workflowId}/shares/${shareId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    } catch {
      setShares(prev);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Search + Add */}
        <div className="relative" ref={resultsRef}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: TEXT_TERTIARY }} />
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border bg-transparent outline-none transition-colors focus:border-blue-500"
                style={{ borderColor: BORDER, color: TEXT }}
              />
              {(searchingUsers || searchingGroups) && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2"><Spinner size="w-3.5 h-3.5" /></div>
              )}
            </div>
            <RoleDropdown value={addRole} onChange={setAddRole} compact />
          </div>

          {/* Search results dropdown */}
          {(showUserResults || showGroupResults) && (
            <div
              className="absolute left-0 right-0 top-full mt-1 rounded-lg border shadow-xl z-50 max-h-48 overflow-y-auto py-1"
              style={{ background: SURFACE, borderColor: BORDER }}
            >
              {searchResults.map(u => (
                <button
                  key={`user-${u.id}`}
                  onClick={() => addShare({ id: u.id, type: 'user', name: u.name, email: u.email, avatarUrl: u.avatarUrl })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                >
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'rgba(59,130,246,0.2)', color: '#3b82f6' }}>
                    {u.avatarUrl ? <img src={u.avatarUrl} className="w-6 h-6 rounded-full" alt="" /> : userInitials(u.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div style={{ color: TEXT }} className="truncate">{u.name}</div>
                    <div style={{ color: TEXT_TERTIARY }} className="truncate">{u.email}</div>
                  </div>
                  <Plus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TEXT_TERTIARY }} />
                </button>
              ))}
              {showGroupResults && groupResults.map(g => (
                <button
                  key={`group-${g.id}`}
                  onClick={() => addShare({ id: g.id, type: 'group', name: g.name })}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5"
                >
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(168,85,247,0.2)', color: '#a855f7' }}>
                    <Users className="w-3 h-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div style={{ color: TEXT }} className="truncate">{g.name}</div>
                    <div style={{ color: TEXT_TERTIARY }}>Group</div>
                  </div>
                  <Plus className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TEXT_TERTIARY }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Current shares */}
        <div>
          <h4 className="text-xs font-medium mb-2" style={{ color: TEXT_TERTIARY }}>
            Shared with ({shares.length})
          </h4>
          {loadingShares ? (
            <div className="flex items-center gap-2 py-4 justify-center"><Spinner /> <span className="text-xs" style={{ color: TEXT_TERTIARY }}>Loading...</span></div>
          ) : shares.length === 0 ? (
            <EmptyState icon={<Users className="w-8 h-8" />} message="Not shared with anyone yet" />
          ) : (
            <div className="space-y-1">
              {shares.map(share => (
                <div
                  key={`${share.type}-${share.id}`}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg transition-colors hover:bg-white/[0.03]"
                >
                  {/* Avatar / Icon */}
                  {share.type === 'user' ? (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>
                      {share.avatarUrl ? <img src={share.avatarUrl} className="w-8 h-8 rounded-full" alt="" /> : userInitials(share.name)}
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
                      <Users className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: TEXT }}>{share.name}</div>
                    {share.email && <div className="text-[10px] truncate" style={{ color: TEXT_TERTIARY }}>{share.email}</div>}
                  </div>
                  <RoleDropdown value={share.role} onChange={r => updateRole(share.id, share.type, r)} compact />
                  <button
                    onClick={() => removeShare(share.id, share.type)}
                    className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
                    style={{ color: TEXT_TERTIARY }}
                    title="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Role legend */}
      <div className="px-5 py-3 border-t" style={{ borderColor: BORDER }}>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ROLE_OPTIONS.map(r => (
            <div key={r.value} className="flex items-center gap-1 text-[10px]" style={{ color: TEXT_TERTIARY }}>
              {roleIcon(r.value)} <span className="capitalize font-medium">{r.label}</span> — {r.description}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab 3: API Access
// ---------------------------------------------------------------------------

const ApiAccessTab: React.FC<{
  workflowId: string;
  workflowName: string;
  getAuthHeaders: () => Record<string, string>;
}> = ({ workflowId, workflowName, getAuthHeaders }) => {
  const { copy, isCopied } = useCopyToClipboard();

  // Webhook state
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(true);
  const [togglingWebhook, setTogglingWebhook] = useState(false);

  // API key state
  const [apiKeys, setApiKeys] = useState<ApiKeyEntry[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);

  // Snippets
  const [snippetLang, setSnippetLang] = useState<SnippetLanguage>('cURL');

  const webhookUrl = webhook?.key
    ? `${window.location.origin}/api/v1/hooks/${webhook.key}`
    : `${window.location.origin}/api/v1/hooks/<webhook_key>`;

  // Fetch webhook
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workflows/${workflowId}/webhook`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setWebhook(data.webhook ?? data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingWebhook(false); });
    return () => { cancelled = true; };
  }, [workflowId, getAuthHeaders]);

  // Fetch API keys
  useEffect(() => {
    let cancelled = false;
    fetch('/api/user/api-keys', { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => { if (!cancelled) setApiKeys(Array.isArray(data) ? data : data.keys ?? []); })
      .catch(() => { if (!cancelled) setApiKeys([]); })
      .finally(() => { if (!cancelled) setLoadingKeys(false); });
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  const toggleWebhook = async () => {
    setTogglingWebhook(true);
    try {
      if (webhook?.active) {
        // Deactivate
        const r = await fetch(`/api/workflows/${workflowId}/webhook`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        if (r.ok) setWebhook(prev => prev ? { ...prev, active: false } : null);
      } else {
        // Create / activate
        const r = await fetch(`/api/workflows/${workflowId}/webhook`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ responseMode: 'sync' }),
        });
        if (r.ok) {
          const data = await r.json();
          setWebhook(data.webhook ?? data);
        }
      }
    } catch { /* ignore */ }
    setTogglingWebhook(false);
  };

  const toggleResponseMode = async () => {
    if (!webhook) return;
    const newMode = webhook.responseMode === 'sync' ? 'async' : 'sync';
    setWebhook(prev => prev ? { ...prev, responseMode: newMode } : null);
    try {
      await fetch(`/api/workflows/${workflowId}/webhook`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseMode: newMode }),
      });
    } catch { /* best effort */ }
  };

  const generateApiKey = async () => {
    setGeneratingKey(true);
    setNewlyGeneratedKey(null);
    try {
      const r = await fetch('/api/user/api-keys', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Workflow: ${workflowName}` }),
      });
      if (r.ok) {
        const data = await r.json();
        const key = data.key ?? data.apiKey ?? data.token;
        if (key) setNewlyGeneratedKey(key);
        // Refresh list
        const listR = await fetch('/api/user/api-keys', { headers: getAuthHeaders() });
        if (listR.ok) {
          const listData = await listR.json();
          setApiKeys(Array.isArray(listData) ? listData : listData.keys ?? []);
        }
      }
    } catch { /* ignore */ }
    setGeneratingKey(false);
  };

  const revokeApiKey = async (keyId: string) => {
    const prev = apiKeys;
    setApiKeys(k => k.filter(k2 => k2.id !== keyId));
    try {
      await fetch(`/api/user/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    } catch {
      setApiKeys(prev);
    }
  };

  const currentApiKey = newlyGeneratedKey || apiKeys[0]?.prefix ? `${apiKeys[0]?.prefix}...` : '';

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
      {/* Webhook */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT_TERTIARY }}>
            <span className="flex items-center gap-1.5"><Link className="w-3.5 h-3.5" /> Webhook</span>
          </h4>
          <button
            onClick={toggleWebhook}
            disabled={togglingWebhook || loadingWebhook}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{ background: webhook?.active ? 'var(--user-accent-primary, #FF5722)' : BG_SECONDARY }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{ left: webhook?.active ? '22px' : '2px' }}
            />
          </button>
        </div>

        {loadingWebhook ? (
          <div className="flex items-center gap-2 py-2"><Spinner /> <span className="text-xs" style={{ color: TEXT_TERTIARY }}>Loading...</span></div>
        ) : webhook?.active ? (
          <div className="space-y-3">
            {/* URL */}
            <div className="rounded-lg border p-3" style={{ borderColor: BORDER, background: BG_SECONDARY }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-green-500/20 text-green-400">POST</span>
                <span className="text-[10px]" style={{ color: TEXT_TERTIARY }}>Webhook URL</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs break-all" style={{ color: TEXT, fontFamily: 'monospace' }}>{webhookUrl}</code>
                <CopyButton text={webhookUrl} copyKey="webhook-url" copy={copy} isCopied={isCopied} />
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: TEXT_TERTIARY }}>Response mode:</span>
                <button
                  onClick={toggleResponseMode}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border text-xs transition-colors hover:bg-white/5"
                  style={{ borderColor: BORDER, color: TEXT }}
                >
                  {webhook.responseMode === 'sync' ? 'Sync' : 'Async'}
                  <RefreshCw className="w-3 h-3" style={{ color: TEXT_TERTIARY }} />
                </button>
              </div>
              {webhook.rateLimit > 0 && (
                <span className="text-[10px]" style={{ color: TEXT_TERTIARY }}>
                  Rate limit: {webhook.rateLimit} req/min
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: TEXT_TERTIARY }}>
            Enable the webhook to receive HTTP POST requests that trigger this workflow.
          </p>
        )}
      </section>

      {/* API Keys */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: TEXT_TERTIARY }}>
            <span className="flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> API Keys</span>
          </h4>
          <button
            onClick={generateApiKey}
            disabled={generatingKey}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-accent-primary text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {generatingKey ? <Spinner size="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            Generate Key
          </button>
        </div>

        {/* Newly generated key warning */}
        {newlyGeneratedKey && (
          <div className="rounded-lg border p-3 mb-3" style={{ borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)' }}>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#eab308' }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium mb-1" style={{ color: '#eab308' }}>
                  Save this key now -- it will not be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all" style={{ color: TEXT, fontFamily: 'monospace' }}>{newlyGeneratedKey}</code>
                  <CopyButton text={newlyGeneratedKey} copyKey="new-api-key" copy={copy} isCopied={isCopied} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Key list */}
        {loadingKeys ? (
          <div className="flex items-center gap-2 py-2"><Spinner /> <span className="text-xs" style={{ color: TEXT_TERTIARY }}>Loading...</span></div>
        ) : apiKeys.length === 0 ? (
          <p className="text-xs py-2" style={{ color: TEXT_TERTIARY }}>No API keys yet. Generate one to use with the webhook or API.</p>
        ) : (
          <div className="space-y-1">
            {apiKeys.map(k => (
              <div key={k.id} className="flex items-center gap-2 p-2 rounded-lg transition-colors hover:bg-white/[0.03]">
                <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: TEXT_TERTIARY }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: TEXT }}>{k.name}</div>
                  <div className="text-[10px]" style={{ color: TEXT_TERTIARY }}>
                    {k.prefix}... &middot; Created {formatDate(k.createdAt)} &middot; Last used {formatDate(k.lastUsedAt)}
                  </div>
                </div>
                <button
                  onClick={() => revokeApiKey(k.id)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-colors hover:bg-red-500/10 text-red-400"
                  title="Revoke"
                >
                  <Trash2 className="w-3 h-3" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Code Snippets */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT_TERTIARY }}>
          <span className="flex items-center gap-1.5"><Code className="w-3.5 h-3.5" /> Code Snippets</span>
        </h4>
        <div className="flex items-center gap-1 mb-3">
          {SNIPPET_LANGUAGES.map(lang => (
            <button
              key={lang}
              onClick={() => setSnippetLang(lang)}
              className="px-2.5 py-1 text-xs rounded-md transition-colors"
              style={{
                background: snippetLang === lang ? 'color-mix(in srgb, var(--user-accent-primary, #FF5722) 15%, transparent)' : 'transparent',
                color: snippetLang === lang ? 'var(--user-accent-primary, #FF5722)' : TEXT_TERTIARY,
              }}
            >
              {lang}
            </button>
          ))}
        </div>
        <CodeBlock
          code={generateSnippet(snippetLang, webhookUrl, currentApiKey)}
          copyKey={`snippet-${snippetLang}`}
          copy={copy}
          isCopied={isCopied}
        />
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab 4: Embed
// ---------------------------------------------------------------------------

const EmbedTab: React.FC<{ workflowId: string }> = ({ workflowId }) => {
  const { copy, isCopied } = useCopyToClipboard();
  const origin = window.location.origin;

  const widgetSnippet = `<script src="${origin}/embed/widget.js"></script>
<script>
  OpenAgenticWidget.init({
    workflowId: '${workflowId}',
    theme: 'dark'
  });
</script>`;

  const iframeSnippet = `<iframe
  src="${origin}/embed/${workflowId}?theme=dark"
  width="400"
  height="600"
  style="border:none;border-radius:12px"
></iframe>`;

  const reactSnippet = `import { OpenAgenticFlow } from '@openagentic/react';

<OpenAgenticFlow
  workflowId="${workflowId}"
  theme="dark"
  onComplete={(result) => console.log(result)}
/>`;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
      {/* Chat Widget */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT_TERTIARY }}>
          <span className="flex items-center gap-1.5"><ExternalLink className="w-3.5 h-3.5" /> Chat Widget</span>
        </h4>
        <p className="text-xs mb-3" style={{ color: TEXT_TERTIARY }}>
          Add a floating chat widget to any webpage. Users can interact with the workflow directly.
        </p>
        <CodeBlock code={widgetSnippet} copyKey="widget" copy={copy} isCopied={isCopied} />
      </section>

      {/* iFrame */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT_TERTIARY }}>
          <span className="flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> iFrame Embed</span>
        </h4>
        <p className="text-xs mb-3" style={{ color: TEXT_TERTIARY }}>
          Embed the workflow as an inline frame in your page. Customize dimensions as needed.
        </p>
        <CodeBlock code={iframeSnippet} copyKey="iframe" copy={copy} isCopied={isCopied} />
      </section>

      {/* React Component */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT_TERTIARY }}>
          <span className="flex items-center gap-1.5"><Code className="w-3.5 h-3.5" /> React Component</span>
        </h4>
        <p className="text-xs mb-3" style={{ color: TEXT_TERTIARY }}>
          Install <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: BG_SECONDARY }}>@openagentic/react</code> and
          use the component in your React app.
        </p>
        <CodeBlock code={reactSnippet} copyKey="react" copy={copy} isCopied={isCopied} />
      </section>

      {/* Mini preview */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: TEXT_TERTIARY }}>
          Preview
        </h4>
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: BORDER, background: BG_SECONDARY, maxWidth: 280 }}
        >
          {/* Mock widget header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: BORDER, background: 'rgba(59,130,246,0.1)' }}>
            <div className="w-6 h-6 rounded-full bg-accent-primary flex items-center justify-center">
              <Play className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-medium" style={{ color: TEXT }}>OpenAgentic</span>
          </div>
          {/* Mock messages */}
          <div className="px-3 py-3 space-y-2">
            <div className="flex justify-start">
              <div className="rounded-lg px-2.5 py-1.5 text-[10px] max-w-[180px]" style={{ background: 'rgba(59,130,246,0.1)', color: TEXT }}>
                Hi! How can I help you today?
              </div>
            </div>
            <div className="flex justify-end">
              <div className="rounded-lg px-2.5 py-1.5 text-[10px] max-w-[180px] bg-accent-primary text-white">
                Run the workflow
              </div>
            </div>
            <div className="flex justify-start">
              <div className="rounded-lg px-2.5 py-1.5 text-[10px] max-w-[180px]" style={{ background: 'rgba(59,130,246,0.1)', color: TEXT }}>
                Processing your request...
              </div>
            </div>
          </div>
          {/* Mock input */}
          <div className="px-3 py-2 border-t" style={{ borderColor: BORDER }}>
            <div className="rounded-md px-2.5 py-1.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.05)', color: TEXT_TERTIARY }}>
              Type a message...
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main ShareDialog
// ---------------------------------------------------------------------------

export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  workflowId,
  workflowName,
  currentVisibility,
  onVisibilityChange,
}) => {
  const { getAuthHeaders } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('visibility');
  const [selected, setSelected] = useState<Visibility>(currentVisibility);
  const [saving, setSaving] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setSelected(currentVisibility);
      setActiveTab('visibility');
    }
  }, [isOpen, currentVisibility]);

  const handleSaveVisibility = useCallback(async () => {
    if (selected === currentVisibility) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onVisibilityChange(selected);
      onClose();
    } catch (err) {
      console.error('Failed to update visibility:', err);
    } finally {
      setSaving(false);
    }
  }, [selected, currentVisibility, onVisibilityChange, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-full max-w-2xl rounded-xl border shadow-2xl flex flex-col"
              style={{
                background: SURFACE,
                borderColor: BORDER,
                maxHeight: 'min(680px, calc(100vh - 2rem))',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: BORDER }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ color: TEXT }}>
                    Share Workflow
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: TEXT_TERTIARY }}>
                    {workflowName}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                  style={{ color: TEXT_TERTIARY }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tab bar */}
              <div className="flex border-b flex-shrink-0 px-5" style={{ borderColor: BORDER }}>
                {TABS.map(tab => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative"
                      style={{ color: isActive ? 'var(--user-accent-primary, #FF5722)' : 'rgba(156,163,175,1)' }}
                    >
                      {tab.icon}
                      {tab.label}
                      {isActive && (
                        <motion.div
                          layoutId="share-tab-indicator"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary"
                          transition={{ duration: 0.2 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {activeTab === 'visibility' && (
                  <VisibilityTab
                    workflowId={workflowId}
                    selected={selected}
                    setSelected={setSelected}
                    saving={saving}
                    onSave={handleSaveVisibility}
                    getAuthHeaders={getAuthHeaders}
                  />
                )}
                {activeTab === 'people' && (
                  <PeopleTab workflowId={workflowId} getAuthHeaders={getAuthHeaders} />
                )}
                {activeTab === 'api' && (
                  <ApiAccessTab workflowId={workflowId} workflowName={workflowName} getAuthHeaders={getAuthHeaders} />
                )}
                {activeTab === 'embed' && (
                  <EmbedTab workflowId={workflowId} />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
