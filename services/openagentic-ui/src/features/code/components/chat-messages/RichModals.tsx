import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ToolDetail,
  McpServerDetail,
  PluginDetail,
  SkillDetail,
  AgentDetail,
  SystemInitDetail,
} from '../../types/_sdk-bindings';
import { useEscToClose } from './CommandModals';

// ── Design tokens (same as StatusModal / StatsModal) ──────────────

const MONO =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TEXT = 'var(--cm-text, #e6edf3)';
const ACCENT = 'var(--cm-accent, #58a6ff)';
const BG = 'var(--cm-bg-secondary, #161b22)';
const BG_DEEP = 'var(--cm-bg, #0d1117)';
const BORDER = 'var(--cm-border, #30363d)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const WARNING = 'var(--cm-warning, #d29922)';
const ERROR = 'var(--cm-error, #f85149)';
const PURPLE = '#a371f7';

// ── Shared components ─────────────────────────────────────────────

interface RichModalShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
}

const RichModalShell: React.FC<RichModalShellProps> = ({
  title, subtitle, onClose, children, width = 520, tabs, activeTab, onTabChange,
}) => {
  // Document-level Esc — the dialog's onKeyDown only fires while the
  // dialog owns focus, but the floating composer textarea swallows
  // Escape before it bubbles. Pinning at document scope routes around
  // that. See `useEscToClose` for full rationale.
  useEscToClose(onClose);
  return (
  <div
    role="dialog"
    aria-modal="true"
    style={{
      position: 'absolute', inset: 0, zIndex: 55,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: MONO, padding: 16,
    }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  >
    <div style={{
      maxWidth: width, width: '100%', maxHeight: 'calc(100vh - 80px)',
      display: 'flex', flexDirection: 'column',
      backgroundColor: BG, color: TEXT,
      border: `1px solid ${BORDER}`, borderRadius: 8,
      boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: DIM, cursor: 'pointer',
              fontSize: 16, padding: '2px 6px', borderRadius: 4,
            }}
            aria-label="Close"
          >×</button>
        </div>
        {subtitle && <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{subtitle}</div>}
        {/* Tabs */}
        {tabs && tabs.length > 1 && (
          <div style={{
            display: 'flex', gap: 0, marginTop: 10,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => onTabChange?.(t.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '6px 14px', fontSize: 12, fontFamily: MONO,
                  color: activeTab === t.id ? ACCENT : DIM,
                  borderBottom: activeTab === t.id ? `2px solid ${ACCENT}` : '2px solid transparent',
                  fontWeight: activeTab === t.id ? 600 : 400,
                  marginBottom: -1,
                }}
              >{t.label}</button>
            ))}
          </div>
        )}
      </div>
      {/* Body */}
      <div style={{ padding: '12px 16px 14px', overflowY: 'auto', flex: 1 }}>
        {children}
      </div>
    </div>
  </div>
  );
};

const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const color =
    status === 'connected' ? SUCCESS :
    status === 'failed' ? ERROR :
    status === 'needs-auth' ? WARNING :
    status === 'pending' ? WARNING :
    DIM; // disabled
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: color, flexShrink: 0,
    }} />
  );
};

const Badge: React.FC<{ text: string; color?: string }> = ({ text, color = DIM }) => (
  <span style={{
    fontSize: 10, padding: '1px 6px', borderRadius: 3,
    border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
  }}>{text}</span>
);

const ActionBtn: React.FC<{
  label: string; onClick: () => void; variant?: 'default' | 'accent' | 'danger';
}> = ({ label, onClick, variant = 'default' }) => {
  const c = variant === 'accent' ? ACCENT : variant === 'danger' ? ERROR : DIM;
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: `1px solid ${c}`, color: c,
        borderRadius: 4, padding: '3px 10px', fontSize: 11, fontFamily: MONO,
        cursor: 'pointer',
      }}
    >{label}</button>
  );
};

const SearchBar: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({
  value, onChange, placeholder = 'Search...',
}) => (
  <input
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    autoFocus
    style={{
      width: '100%', boxSizing: 'border-box',
      padding: '6px 10px', fontSize: 12, fontFamily: MONO,
      backgroundColor: BG_DEEP, color: TEXT,
      border: `1px solid ${BORDER}`, borderRadius: 4,
      outline: 'none', marginBottom: 10,
    }}
  />
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ textAlign: 'center', color: DIM, padding: '24px 0', fontSize: 12 }}>
    {text}
  </div>
);

const SectionHeader: React.FC<{ label: string; count?: number }> = ({ label, count }) => (
  <div style={{
    fontSize: 11, fontWeight: 600, color: DIM, textTransform: 'uppercase',
    letterSpacing: '0.05em', padding: '8px 0 4px',
    borderBottom: `1px solid ${BORDER}`, marginBottom: 4,
    display: 'flex', justifyContent: 'space-between',
  }}>
    <span>{label}</span>
    {count !== undefined && <span style={{ color: ACCENT }}>{count}</span>}
  </div>
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. MCP Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface MCPModalProps {
  servers: McpServerDetail[];
  fallbackServers: Array<{ name: string; status: string }>;
  onClose: () => void;
  onSend: (cmd: string) => void;
}

export const MCPModal: React.FC<MCPModalProps> = ({ servers, fallbackServers, onClose, onSend }) => {
  const [search, setSearch] = useState('');
  const items = servers.length > 0 ? servers : fallbackServers.map(s => ({
    name: s.name, status: s.status, tools: [] as string[], error: undefined, version: undefined,
  }));

  const filtered = items.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const connected = filtered.filter(s => s.status === 'connected');
  const other = filtered.filter(s => s.status !== 'connected');

  return (
    <RichModalShell
      title="MCP Servers"
      subtitle={`${items.filter(s => s.status === 'connected').length}/${items.length} connected`}
      onClose={onClose}
      width={540}
    >
      <SearchBar value={search} onChange={setSearch} placeholder="Filter servers..." />

      {filtered.length === 0 && <EmptyState text="No MCP servers configured" />}

      {connected.length > 0 && (
        <>
          <SectionHeader label="Connected" count={connected.length} />
          {connected.map(s => (
            <McpServerRow key={s.name} server={s} onSend={onSend} />
          ))}
        </>
      )}

      {other.length > 0 && (
        <>
          <SectionHeader label={connected.length > 0 ? 'Other' : 'Servers'} count={other.length} />
          {other.map(s => (
            <McpServerRow key={s.name} server={s} onSend={onSend} />
          ))}
        </>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <ActionBtn label="Add Server" variant="accent" onClick={() => onSend('/mcp add')} />
        <ActionBtn label="Reconnect All" onClick={() => onSend('/mcp reconnect')} />
      </div>
    </RichModalShell>
  );
};

const McpServerRow: React.FC<{
  server: { name: string; status: string; tools?: string[]; error?: string; version?: string };
  onSend: (cmd: string) => void;
}> = ({ server, onSend }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      padding: '8px 0', borderBottom: `1px solid ${BORDER}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot status={server.status} />
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{server.name}</span>
        {server.version && <Badge text={`v${server.version}`} />}
        <Badge text={server.status} color={
          server.status === 'connected' ? SUCCESS :
          server.status === 'failed' ? ERROR : WARNING
        } />
        {server.tools && server.tools.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: 'none', color: ACCENT,
              cursor: 'pointer', fontSize: 11, fontFamily: MONO,
            }}
          >{expanded ? '▾' : '▸'} {server.tools.length} tools</button>
        )}
      </div>

      {server.error && (
        <div style={{ fontSize: 11, color: ERROR, marginTop: 4, paddingLeft: 16 }}>
          {server.error}
        </div>
      )}

      {expanded && server.tools && server.tools.length > 0 && (
        <div style={{
          marginTop: 6, paddingLeft: 16,
          display: 'flex', flexWrap: 'wrap', gap: 4,
        }}>
          {server.tools.map(t => {
            // Strip the mcp__serverName__ prefix for display
            const short = t.replace(/^mcp__[^_]+__/, '');
            return (
              <span key={t} style={{
                fontSize: 10, padding: '1px 5px', borderRadius: 3,
                backgroundColor: BG_DEEP, color: DIM, border: `1px solid ${BORDER}`,
              }}>{short}</span>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 16 }}>
        {server.status === 'failed' && (
          <ActionBtn label="Reconnect" variant="accent" onClick={() => onSend(`/mcp reconnect ${server.name}`)} />
        )}
        {server.status === 'connected' && (
          <ActionBtn label="Disable" variant="danger" onClick={() => onSend(`/mcp disable ${server.name}`)} />
        )}
        {server.status === 'disabled' && (
          <ActionBtn label="Enable" variant="accent" onClick={() => onSend(`/mcp enable ${server.name}`)} />
        )}
      </div>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Tools Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ToolsModalProps {
  tools: ToolDetail[];
  fallbackTools: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
}

const CATEGORY_ORDER = [
  'read', 'shell', 'write', 'web', 'dispatch', 'verify',
  'introspect', 'state', 'platform', 'mcp', 'other',
];

export const ToolsModal: React.FC<ToolsModalProps> = ({ tools, fallbackTools, onClose, onSend }) => {
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const items: ToolDetail[] = tools.length > 0 ? tools : fallbackTools.map(name => ({
    name, category: 'other', categoryLabel: 'Other', isMcp: false, enabled: true,
  }));

  const filtered = items.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.searchHint?.toLowerCase().includes(search.toLowerCase()))
  );

  const byCat = useMemo(() => {
    const map = new Map<string, ToolDetail[]>();
    for (const t of filtered) {
      if (selectedCat && t.category !== selectedCat) continue;
      const cat = t.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(t);
    }
    return map;
  }, [filtered, selectedCat]);

  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const t of items) {
      cats.set(t.category, (cats.get(t.category) ?? 0) + 1);
    }
    return Array.from(cats.entries())
      .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]));
  }, [items]);

  return (
    <RichModalShell
      title="Tools"
      subtitle={`${items.filter(t => t.enabled).length} enabled · ${items.length} total`}
      onClose={onClose}
      width={560}
    >
      <SearchBar value={search} onChange={setSearch} placeholder="Filter tools..." />

      {/* Category pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
        <button
          onClick={() => setSelectedCat(null)}
          style={{
            background: selectedCat === null ? ACCENT : 'none',
            color: selectedCat === null ? BG : DIM,
            border: `1px solid ${selectedCat === null ? ACCENT : BORDER}`,
            borderRadius: 12, padding: '2px 10px', fontSize: 10, fontFamily: MONO,
            cursor: 'pointer',
          }}
        >all ({items.length})</button>
        {categories.map(([cat, count]) => (
          <button
            key={cat}
            onClick={() => setSelectedCat(cat === selectedCat ? null : cat)}
            style={{
              background: selectedCat === cat ? ACCENT : 'none',
              color: selectedCat === cat ? BG : DIM,
              border: `1px solid ${selectedCat === cat ? ACCENT : BORDER}`,
              borderRadius: 12, padding: '2px 10px', fontSize: 10, fontFamily: MONO,
              cursor: 'pointer',
            }}
          >{cat} ({count})</button>
        ))}
      </div>

      {/* Tool list by category */}
      {CATEGORY_ORDER.filter(c => byCat.has(c)).map(cat => (
        <div key={cat}>
          <SectionHeader
            label={byCat.get(cat)![0]?.categoryLabel ?? cat}
            count={byCat.get(cat)!.length}
          />
          {byCat.get(cat)!.sort((a, b) => a.name.localeCompare(b.name)).map(t => (
            <div key={t.name} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 0', fontSize: 12,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                backgroundColor: t.enabled ? SUCCESS : DIM,
              }} />
              <span style={{ fontWeight: 500, minWidth: 120 }}>{t.name}</span>
              {t.searchHint && (
                <span style={{ color: DIM, fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.searchHint}
                </span>
              )}
              {t.isMcp && t.serverName && (
                <Badge text={t.serverName} color={PURPLE} />
              )}
              <button
                onClick={() => onSend(`/tools ${t.name}`)}
                style={{
                  background: 'none', border: 'none', color: ACCENT,
                  cursor: 'pointer', fontSize: 11, fontFamily: MONO,
                }}
              >details</button>
            </div>
          ))}
        </div>
      ))}

      {byCat.size === 0 && <EmptyState text="No tools match" />}
    </RichModalShell>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Plugins Modal — full marketplace browser matching openagentic TUI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Format install count like the TUI: 42, 1.2K, 36.2K, 1.2M */
function fmtInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface MarketplacePlugin {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  tags?: string[];
}

interface MarketplaceState {
  loading: boolean;
  error: string | null;
  plugins: MarketplacePlugin[];
  installCounts: Record<string, number>;
  marketplaceName: string;
  fetchedAt: string | null;
}

interface PluginsModalProps {
  plugins: PluginDetail[];
  fallbackPlugins: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
}

export const PluginsModal: React.FC<PluginsModalProps> = ({ plugins, fallbackPlugins, onClose, onSend }) => {
  const [tab, setTab] = useState<'discover' | 'installed' | 'marketplaces'>('discover');
  const [search, setSearch] = useState('');
  const [marketplace, setMarketplace] = useState<MarketplaceState>({
    loading: true, error: null, plugins: [], installCounts: {}, marketplaceName: '', fetchedAt: null,
  });

  // Fetch marketplace data from API on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/code/plugins/marketplace', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const mp = data.marketplace || {};
        setMarketplace({
          loading: false,
          error: null,
          plugins: Array.isArray(mp.plugins) ? mp.plugins : [],
          installCounts: data.installCounts || {},
          marketplaceName: mp.name || 'claude-plugins-official',
          fetchedAt: data.fetchedAt || null,
        });
      } catch (err: any) {
        if (cancelled) return;
        setMarketplace(prev => ({ ...prev, loading: false, error: err.message }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const items: PluginDetail[] = plugins.length > 0 ? plugins : fallbackPlugins.map(name => ({
    name, source: 'unknown', path: '', enabled: true, hasMcpServers: false,
  }));

  const enabled = items.filter(p => p.enabled);

  // Installed plugin names (lowercase) for filtering discover tab
  const installedNames = useMemo(() => new Set(items.map(p => p.name.toLowerCase())), [items]);

  // Discover tab: marketplace plugins minus already-installed, filtered by search
  const discoverPlugins = useMemo(() => {
    let list = marketplace.plugins.filter(p => !installedNames.has(p.name.toLowerCase()));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    // Sort by install count (descending)
    list.sort((a, b) => {
      const ca = marketplace.installCounts[`${a.name}@${marketplace.marketplaceName}`] || 0;
      const cb = marketplace.installCounts[`${b.name}@${marketplace.marketplaceName}`] || 0;
      return cb - ca;
    });
    return list;
  }, [marketplace, installedNames, search]);

  // Installed tab filtering
  const filteredInstalled = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(p => p.name.toLowerCase().includes(q));
  }, [items, search]);

  const tabList = [
    { id: 'discover', label: `Discover${marketplace.loading ? '' : ` (${discoverPlugins.length})`}` },
    { id: 'installed', label: `Installed (${items.length})` },
    { id: 'marketplaces', label: 'Marketplaces' },
  ];

  return (
    <RichModalShell
      title="Plugins"
      subtitle={`${enabled.length} enabled · ${items.length} installed`}
      onClose={onClose}
      width={560}
      tabs={tabList}
      activeTab={tab}
      onTabChange={(id) => { setTab(id as any); setSearch(''); }}
    >
      {/* ─── Discover Tab ─── */}
      {tab === 'discover' && (
        <>
          <SearchBar value={search} onChange={setSearch} placeholder="Search plugins..." />

          {marketplace.loading && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: DIM, fontSize: 12 }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              {' '}Loading marketplace...
            </div>
          )}

          {marketplace.error && !marketplace.loading && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ color: ERROR, fontSize: 12, marginBottom: 8 }}>
                Failed to load marketplace: {marketplace.error}
              </div>
              <ActionBtn label="Retry" variant="accent" onClick={() => {
                setMarketplace(prev => ({ ...prev, loading: true, error: null }));
                // Re-trigger fetch
                fetch('/api/code/plugins/marketplace?refresh=1', {
                  headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
                }).then(r => r.json()).then(data => {
                  const mp = data.marketplace || {};
                  setMarketplace({
                    loading: false, error: null,
                    plugins: Array.isArray(mp.plugins) ? mp.plugins : [],
                    installCounts: data.installCounts || {},
                    marketplaceName: mp.name || 'claude-plugins-official',
                    fetchedAt: data.fetchedAt || null,
                  });
                }).catch(err => setMarketplace(prev => ({ ...prev, loading: false, error: err.message })));
              }} />
            </div>
          )}

          {!marketplace.loading && !marketplace.error && discoverPlugins.length === 0 && (
            <EmptyState text={search ? 'No plugins match your search' : 'All marketplace plugins are installed!'} />
          )}

          {!marketplace.loading && !marketplace.error && discoverPlugins.length > 0 && (
            <SectionHeader
              label={`${marketplace.marketplaceName}`}
              count={discoverPlugins.length}
            />
          )}

          {!marketplace.loading && !marketplace.error && discoverPlugins.map(mp => {
            const installs = marketplace.installCounts[`${mp.name}@${marketplace.marketplaceName}`] || 0;
            return (
              <div key={mp.name} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 0', borderBottom: `1px solid ${BORDER}22`,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                  backgroundColor: DIM,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{mp.name}</span>
                    <span style={{ fontSize: 10, color: DIM }}>·</span>
                    <span style={{ fontSize: 10, color: DIM }}>{marketplace.marketplaceName}</span>
                    {installs > 0 && (
                      <>
                        <span style={{ fontSize: 10, color: DIM }}>·</span>
                        <span style={{ fontSize: 10, color: DIM }}>{fmtInstalls(installs)} installs</span>
                      </>
                    )}
                  </div>
                  {mp.description && (
                    <div style={{
                      fontSize: 11, color: DIM, marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{mp.description}</div>
                  )}
                </div>
                <button
                  onClick={() => onSend(`/plugin install ${mp.name}@${marketplace.marketplaceName}`)}
                  style={{
                    background: 'none', border: `1px solid ${SUCCESS}`, color: SUCCESS,
                    borderRadius: 4, padding: '2px 8px', fontSize: 10, fontFamily: MONO,
                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >Install</button>
              </div>
            );
          })}
        </>
      )}

      {/* ─── Installed Tab ─── */}
      {tab === 'installed' && (
        <>
          <SearchBar value={search} onChange={setSearch} placeholder="Filter plugins..." />

          {filteredInstalled.length === 0 && <EmptyState text="No plugins installed" />}

          {filteredInstalled.filter(p => p.enabled).length > 0 && (
            <>
              <SectionHeader label="Enabled" count={filteredInstalled.filter(p => p.enabled).length} />
              {filteredInstalled.filter(p => p.enabled).map(p => (
                <PluginRow key={p.name} plugin={p} onSend={onSend} />
              ))}
            </>
          )}

          {filteredInstalled.filter(p => !p.enabled).length > 0 && (
            <>
              <SectionHeader label="Disabled" count={filteredInstalled.filter(p => !p.enabled).length} />
              {filteredInstalled.filter(p => !p.enabled).map(p => (
                <PluginRow key={p.name} plugin={p} onSend={onSend} />
              ))}
            </>
          )}
        </>
      )}

      {/* ─── Marketplaces Tab ─── */}
      {tab === 'marketplaces' && (
        <>
          <SectionHeader label="Marketplace Sources" />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 0', borderBottom: `1px solid ${BORDER}22`,
          }}>
            <span style={{ fontSize: 14 }}>●</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500 }}>
                ✻ {marketplace.marketplaceName || 'claude-plugins-official'} ✻
              </div>
              <div style={{ fontSize: 10, color: DIM }}>
                anthropics/claude-plugins-official
              </div>
              <div style={{ fontSize: 10, color: DIM }}>
                {marketplace.plugins.length} available
                {marketplace.fetchedAt && ` · Updated ${new Date(marketplace.fetchedAt).toLocaleDateString()}`}
              </div>
            </div>
            <Badge text="official" color={SUCCESS} />
          </div>

          <div style={{ marginTop: 16, fontSize: 11, color: DIM, textAlign: 'center' }}>
            Marketplace plugins are distributed via a third-party plugin marketplace
            authored by their respective maintainers.
          </div>
        </>
      )}
    </RichModalShell>
  );
};

const PluginRow: React.FC<{
  plugin: PluginDetail;
  onSend: (cmd: string) => void;
}> = ({ plugin, onSend }) => {
  const [srcName, srcOrigin] = plugin.source.includes('@')
    ? plugin.source.split('@', 2)
    : [plugin.source, ''];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0', borderBottom: `1px solid ${BORDER}22`,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        backgroundColor: plugin.enabled ? SUCCESS : DIM,
      }} />
      <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{plugin.name}</span>
      {srcOrigin && <Badge text={srcOrigin} color={PURPLE} />}
      {plugin.hasMcpServers && <Badge text="MCP" color={ACCENT} />}
      <button
        onClick={() => onSend(`/plugin ${plugin.enabled ? 'disable' : 'enable'} ${plugin.name}`)}
        style={{
          background: 'none', border: `1px solid ${plugin.enabled ? ERROR : SUCCESS}`,
          color: plugin.enabled ? ERROR : SUCCESS,
          borderRadius: 4, padding: '2px 8px', fontSize: 10, fontFamily: MONO,
          cursor: 'pointer',
        }}
      >{plugin.enabled ? 'Disable' : 'Enable'}</button>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Skills Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface SkillsModalProps {
  skills: SkillDetail[];
  fallbackSkills: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
}

// Group by `source` (SettingSource) to match openagentic TUI SkillsMenu grouping
const SOURCE_LABELS: Record<string, string> = {
  projectSettings: 'Project Skills',
  userSettings: 'User Skills',
  policySettings: 'Managed Skills',
  localSettings: 'Local Skills',
  flagSettings: 'Flag Skills',
  plugin: 'Plugin Skills',
  mcp: 'MCP Skills',
  bundled: 'Built-in',
  unknown: 'Other',
};

const SOURCE_ORDER = ['projectSettings', 'userSettings', 'policySettings', 'localSettings', 'flagSettings', 'plugin', 'mcp', 'bundled', 'unknown'];

export const SkillsModal: React.FC<SkillsModalProps> = ({ skills, fallbackSkills, onClose, onSend }) => {
  const [search, setSearch] = useState('');

  const items: SkillDetail[] = skills.length > 0 ? skills : fallbackSkills.map(name => ({
    name, description: '', loadedFrom: 'unknown', source: 'unknown',
  }));

  const filtered = items.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  const bySource = useMemo(() => {
    const map = new Map<string, SkillDetail[]>();
    for (const s of filtered) {
      // SDKSystemInitDetail.skills only carries `loadedFrom` — the
      // older hand-rolled type also had `source` but it was never
      // populated by the daemon (dead-code drift, removed in Phase B).
      const src = s.loadedFrom || 'unknown';
      if (!map.has(src)) map.set(src, []);
      map.get(src)!.push(s);
    }
    return map;
  }, [filtered]);

  return (
    <RichModalShell
      title="Skills"
      subtitle={`${items.length} skills available`}
      onClose={onClose}
      width={520}
    >
      <SearchBar value={search} onChange={setSearch} placeholder="Filter skills..." />

      {filtered.length === 0 && <EmptyState text="No skills available" />}

      {SOURCE_ORDER.filter(src => bySource.has(src)).map(src => (
        <div key={src}>
          <SectionHeader label={SOURCE_LABELS[src] ?? src} count={bySource.get(src)!.length} />
          {bySource.get(src)!.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
            // TUI parity (tui-skills.txt): the picker annotates each
            // skill with "~<N> description tokens". The SDK SkillDetail
            // doesn't yet expose a tokenCost field, but tests + future
            // daemon payloads can pass one through; render when present.
            const tokenCost = (s as { tokenCost?: number }).tokenCost;
            return (
            <div key={s.name} style={{
              padding: '5px 0', borderBottom: `1px solid ${BORDER}11`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: ACCENT }}>/{s.name}</span>
                {typeof tokenCost === 'number' && (
                  <span style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>
                    · ~{tokenCost} description tokens
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => onSend(`/${s.name}`)}
                  style={{
                    background: 'none', border: 'none', color: ACCENT,
                    cursor: 'pointer', fontSize: 11, fontFamily: MONO,
                  }}
                >run</button>
              </div>
              {s.description && (
                <div style={{
                  fontSize: 11, color: DIM, marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.description}</div>
              )}
            </div>
          );})}
        </div>
      ))}
    </RichModalShell>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Agents Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AgentsModalProps {
  agents: AgentDetail[];
  fallbackAgents: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
}

// TUI parity (2026-05-02 — tui-vs-codemode-artifacts/tui-agents.txt):
// Section headers in the TUI's /agents picker are phrased as
//   "Plugin agents"
//   "Built-in agents (always available)"
// Codemode previously used the bare bucket names ("Built-in", "Plugin"),
// which read like a stub next to the TUI. Bring the labels in line so
// the "feels the same" test passes the eye-test.
const AGENT_SOURCE_LABELS: Record<string, string> = {
  'built-in': 'Built-in agents (always available)',
  plugin: 'Plugin agents',
  userSettings: 'User agents',
  projectSettings: 'Project agents',
  policySettings: 'Managed agents',
  flagSettings: 'Flag agents',
};

export const AgentsModal: React.FC<AgentsModalProps> = ({ agents, fallbackAgents, onClose, onSend }) => {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const items: AgentDetail[] = agents.length > 0 ? agents : fallbackAgents.map(name => ({
    name, description: '', source: 'built-in',
  }));

  const filtered = items.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.description.toLowerCase().includes(search.toLowerCase())
  );

  const bySource = useMemo(() => {
    const map = new Map<string, AgentDetail[]>();
    for (const a of filtered) {
      const src = a.source || 'built-in';
      if (!map.has(src)) map.set(src, []);
      map.get(src)!.push(a);
    }
    return map;
  }, [filtered]);

  return (
    <RichModalShell
      title="Agents"
      // TUI parity (tui-agents.txt): the picker shows "<N> agents".
      // Codemode previously said "<N> agent types available" which
      // read awkwardly; align with the TUI phrasing.
      subtitle={`${items.length} agents`}
      onClose={onClose}
      width={560}
    >
      <SearchBar value={search} onChange={setSearch} placeholder="Filter agents..." />

      {/* TUI parity (tui-agents.txt): "Create new agent" appears as the
          first selectable row above the source-grouped list. Mirrors the
          AgentsPicker's "+ New Agent" header button so users typing
          /agents in either UI see the same affordance. */}
      <button
        type="button"
        onClick={() => onSend('/agents create')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '8px 10px', marginBottom: 6,
          background: 'transparent', border: `1px dashed ${ACCENT}`,
          color: ACCENT, borderRadius: 4, cursor: 'pointer',
          fontFamily: MONO, fontSize: 12, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14 }}>+</span>
        <span>Create new agent</span>
      </button>

      {filtered.length === 0 && <EmptyState text="No agents configured" />}

      {/* TUI capture orders Plugin agents BEFORE Built-in agents. */}
      {['plugin', 'built-in', 'userSettings', 'projectSettings', 'policySettings'].filter(src => bySource.has(src)).map(src => (
        <div key={src}>
          <SectionHeader label={AGENT_SOURCE_LABELS[src] ?? src} count={bySource.get(src)!.length} />
          {bySource.get(src)!.sort((a, b) => a.name.localeCompare(b.name)).map(a => (
            <div key={a.name} style={{
              padding: '6px 0', borderBottom: `1px solid ${BORDER}22`,
            }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setExpanded(expanded === a.name ? null : a.name)}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: PURPLE }}>{a.name}</span>
                {a.model && <Badge text={a.model} color={ACCENT} />}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: DIM }}>{expanded === a.name ? '▾' : '▸'}</span>
              </div>

              {a.description && expanded !== a.name && (
                <div style={{
                  fontSize: 11, color: DIM, marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}>{a.description}</div>
              )}

              {expanded === a.name && (
                <div style={{ marginTop: 6, paddingLeft: 12, fontSize: 11 }}>
                  <div style={{ color: DIM, marginBottom: 4 }}>{a.description || 'No description'}</div>
                  {a.model && <div>Model: <span style={{ color: ACCENT }}>{a.model}</span></div>}
                  {a.tools && a.tools.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: DIM }}>Tools: </span>
                      <span style={{ color: TEXT }}>{a.tools.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </RichModalShell>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. Config Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ConfigModalProps {
  model: string;
  permissionMode: string;
  cwd: string;
  version: string;
  toolCount: number;
  mcpServerCount: number;
  agentCount: number;
  pluginCount: number;
  skillCount: number;
  onClose: () => void;
  onSend: (cmd: string) => void;
}

// TUI parity (tui-config.txt): the /config picker shows three tabs
// — Status / Config / Usage — plus a search box and a list of toggle
// settings (Auto-compact, Show tips, Reduce motion, Thinking mode,
// Theme, Notifications, etc). Codemode's previous Configuration modal
// dumped read-only Session/Resources/Actions rows; rebuild around tabs
// + toggleable settings so the surface matches what TUI users expect.
type ConfigTabId = 'status' | 'config' | 'usage';

// Each setting exposes its own getter / setter so the toggle is
// directly bound to localStorage (or a daemon RPC, post-Phase 1). For
// now everything that can be advisory uses localStorage with the
// `cm-setting-<key>` prefix — non-destructive even if a setting maps
// to a no-op until the daemon side wires up.
interface BoolSetting {
  key: string;
  label: string;
  description?: string;
  defaultValue: boolean;
}

const BOOL_SETTINGS: BoolSetting[] = [
  { key: 'auto-compact', label: 'Auto-compact', description: 'Compact when context fills', defaultValue: true },
  { key: 'show-tips', label: 'Show tips', description: 'Show contextual tips in the composer', defaultValue: true },
  { key: 'reduce-motion', label: 'Reduce motion', defaultValue: false },
  { key: 'thinking-mode', label: 'Thinking mode', description: 'Surface model reasoning when available', defaultValue: true },
  { key: 'rewind-checkpoints', label: 'Rewind code (checkpoints)', defaultValue: true },
  { key: 'verbose-output', label: 'Verbose output', defaultValue: false },
  { key: 'terminal-progress', label: 'Terminal progress bar', defaultValue: true },
  { key: 'show-turn-duration', label: 'Show turn duration', defaultValue: true },
];

// Single-select settings (Theme / Notifications / etc) shown as a
// label + value row (no toggle widget — clicking the row dispatches
// the matching slash command).
interface ChoiceSetting {
  key: string;
  label: string;
  value: string;
  onClick?: () => void;
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`cm-setting-${key}`);
    if (v === null) return fallback;
    return v === 'on' || v === 'true';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try { localStorage.setItem(`cm-setting-${key}`, value ? 'on' : 'off'); }
  catch { /* quota */ }
}

const ConfigToggleRow: React.FC<{
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}> = ({ label, description, value, onChange }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '6px 0', borderBottom: `1px solid ${BORDER}22`,
  }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: TEXT }}>{label}</div>
      {description && <div style={{ fontSize: 10, color: DIM, marginTop: 1 }}>{description}</div>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, border: 'none',
        cursor: 'pointer', flexShrink: 0,
        backgroundColor: value ? SUCCESS : BORDER,
        position: 'relative', transition: 'background-color 150ms',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        backgroundColor: '#fff', transition: 'left 150ms',
      }} />
    </button>
  </div>
);

const ConfigChoiceRow: React.FC<{ setting: ChoiceSetting }> = ({ setting }) => (
  <button
    type="button"
    onClick={setting.onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
      padding: '6px 0', borderBottom: `1px solid ${BORDER}22`,
      background: 'transparent', border: 'none', cursor: setting.onClick ? 'pointer' : 'default',
      textAlign: 'left',
    }}
  >
    <span style={{ fontSize: 12, color: TEXT, flex: 1 }}>{setting.label}</span>
    <span style={{ fontSize: 11, color: DIM, fontFamily: MONO }}>{setting.value}</span>
  </button>
);

export const ConfigModal: React.FC<ConfigModalProps> = (props) => {
  const { model, permissionMode, cwd, version, toolCount, mcpServerCount, agentCount, pluginCount, skillCount, onClose, onSend } = props;
  const [tab, setTab] = useState<ConfigTabId>('status');
  const [search, setSearch] = useState('');
  // Mirror the bool-setting state in React so toggles re-render. Using
  // a single object keeps the toggle handlers simple.
  const [bools, setBools] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BOOL_SETTINGS.map((s) => [s.key, readBool(s.key, s.defaultValue)])),
  );
  const setBool = (key: string, value: boolean) => {
    writeBool(key, value);
    setBools((b) => ({ ...b, [key]: value }));
  };

  // Theme / notifications / etc — single-select rows.
  const choices: ChoiceSetting[] = [
    { key: 'theme', label: 'Theme', value: 'Dark mode', onClick: () => { onSend('/theme'); onClose(); } },
    { key: 'notifications', label: 'Notifications', value: 'Auto' },
    { key: 'output-style', label: 'Output style', value: 'default' },
    { key: 'editor-mode', label: 'Editor mode', value: 'vim' },
  ];

  const filteredBools = BOOL_SETTINGS.filter((s) =>
    !search || s.label.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredChoices = choices.filter((s) =>
    !search || s.label.toLowerCase().includes(search.toLowerCase()),
  );

  const tabs = [
    { id: 'status' as const, label: 'Status' },
    { id: 'config' as const, label: 'Config' },
    { id: 'usage' as const, label: 'Usage' },
  ];

  return (
    <RichModalShell
      title="Configuration"
      onClose={onClose}
      width={560}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as ConfigTabId)}
    >
      {tab === 'status' && (
        <div>
          <SectionHeader label="Session" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Version</span>
            <span style={{ flex: 1 }}>{version}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Model</span>
            <span style={{ flex: 1 }}>{model}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Permission Mode</span>
            <span style={{ flex: 1 }}>{permissionMode}</span>
            <button
              onClick={() => { onSend('/permissions'); onClose(); }}
              style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}
            >open</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Working Dir</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cwd}</span>
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div>
          <SearchBar value={search} onChange={setSearch} placeholder="Search settings…" />

          {filteredBools.map((s) => (
            <ConfigToggleRow
              key={s.key}
              label={s.label}
              description={s.description}
              value={bools[s.key] ?? s.defaultValue}
              onChange={(next) => setBool(s.key, next)}
            />
          ))}

          {filteredChoices.length > 0 && filteredBools.length > 0 && (
            <div style={{ marginTop: 8 }} />
          )}

          {filteredChoices.map((s) => (
            <ConfigChoiceRow key={s.key} setting={s} />
          ))}

          {filteredBools.length === 0 && filteredChoices.length === 0 && (
            <EmptyState text="No settings match your search" />
          )}
        </div>
      )}

      {tab === 'usage' && (
        <div>
          <SectionHeader label="Resources" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Tools</span>
            <span style={{ flex: 1 }}>{toolCount} available</span>
            <button onClick={() => { onSend('/tools'); onClose(); }} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}>open</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>MCP Servers</span>
            <span style={{ flex: 1 }}>{mcpServerCount} configured</span>
            <button onClick={() => { onSend('/mcp'); onClose(); }} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}>open</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Agents</span>
            <span style={{ flex: 1 }}>{agentCount} types</span>
            <button onClick={() => { onSend('/agents'); onClose(); }} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}>open</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Plugins</span>
            <span style={{ flex: 1 }}>{pluginCount} installed</span>
            <button onClick={() => { onSend('/plugins'); onClose(); }} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}>open</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12 }}>
            <span style={{ color: DIM, minWidth: 120 }}>Skills</span>
            <span style={{ flex: 1 }}>{skillCount} available</span>
            <button onClick={() => { onSend('/skills'); onClose(); }} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontSize: 11, fontFamily: MONO }}>open</button>
          </div>

          <SectionHeader label="Actions" />
          <button
            type="button"
            onClick={() => { onSend('/reload-plugins'); onClose(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 0', background: 'transparent', border: 'none', color: ACCENT, cursor: 'pointer', fontFamily: MONO, fontSize: 12 }}
          >Reload Plugins</button>
          <button
            type="button"
            onClick={() => { onSend('/compact'); onClose(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 0', background: 'transparent', border: 'none', color: ACCENT, cursor: 'pointer', fontFamily: MONO, fontSize: 12 }}
          >Compact context</button>
        </div>
      )}
    </RichModalShell>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. Permissions Modal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface PermissionsModalProps {
  permissionMode: string;
  tools: string[];
  onClose: () => void;
  onSend: (cmd: string) => void;
  /**
   * Update the local React mode state. Without this prop the modal's
   * mode-switch buttons couldn't propagate to the composer chip — they
   * only sent a `/permissions <key>` slash that the daemon ignores in
   * remote-session mode. The chip's `useEffect` on `mode` is what sends
   * `set_permission_mode` to the running child, so we MUST update the
   * local state to make a UI mode switch real.
   */
  onSetMode?: (mode: string) => void;
}

/**
 * Modal mode rows. Keys are SDK names (must match permissionMode.ts:
 * `default | acceptEdits | plan | bypassPermissions`) so the
 * `permissionMode === key` highlight check works against the wire value
 * the chip emits. `bypassPermissions` is labelled "Permissive" in the
 * UI to match the openagentic TUI footer chip — internal id stays SDK.
 */
const PERMISSION_MODE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  default: { label: 'Default', color: ACCENT, desc: 'Ask before potentially dangerous actions' },
  acceptEdits: { label: 'Accept edits', color: '#3fb950', desc: 'Auto-approve file edits, still ask for shell commands' },
  plan: { label: 'Plan', color: PURPLE, desc: 'Read-only — suggest changes but don\'t execute' },
  bypassPermissions: { label: 'Permissive', color: WARNING, desc: 'Allow every tool without asking' },
};

// TUI parity (tui-permissions.txt): the picker offers tabs along the
// top — `Recently denied / Allow / Ask / Deny / Workspace` — plus a
// search box and an "Add a new rule…" first row. Codemode previously
// dumped all 73 tools in a single grid, so users couldn't see which
// rule scope they were editing.
type PermissionTab = 'recently-denied' | 'allow' | 'ask' | 'deny' | 'workspace';
const PERMISSION_TABS: { id: PermissionTab; label: string }[] = [
  { id: 'recently-denied', label: 'Recently denied' },
  { id: 'allow', label: 'Allow' },
  { id: 'ask', label: 'Ask' },
  { id: 'deny', label: 'Deny' },
  { id: 'workspace', label: 'Workspace' },
];

export const PermissionsModal: React.FC<PermissionsModalProps> = ({ permissionMode, tools, onClose, onSend, onSetMode }) => {
  const mode = PERMISSION_MODE_LABELS[permissionMode] ?? {
    label: permissionMode, color: DIM, desc: '',
  };
  const [tab, setTab] = useState<PermissionTab>('allow');
  const [search, setSearch] = useState('');

  return (
    <RichModalShell
      title="Permissions"
      subtitle={`Mode: ${mode.label}`}
      onClose={onClose}
      width={520}
    >
      {/* Tab bar — matches TUI capture. */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 12,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        {PERMISSION_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 12px', fontSize: 11, fontFamily: MONO,
              color: tab === t.id ? ACCENT : DIM,
              borderBottom: tab === t.id ? `2px solid ${ACCENT}` : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      <SearchBar value={search} onChange={setSearch} placeholder="Search rules…" />

      {/* "Add a new rule…" row — TUI-parity affordance for opening the
          rule editor. Routes through the daemon's /permissions add path. */}
      <button
        type="button"
        onClick={() => onSend(`/permissions add ${tab}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '8px 10px', marginBottom: 12,
          background: 'transparent', border: `1px dashed ${ACCENT}`,
          color: ACCENT, borderRadius: 4, cursor: 'pointer',
          fontFamily: MONO, fontSize: 12, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14 }}>+</span>
        <span>Add a new rule…</span>
      </button>

      {/* Current mode */}
      <div style={{
        padding: '10px 12px', borderRadius: 6,
        backgroundColor: BG_DEEP, border: `1px solid ${mode.color}44`,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            backgroundColor: mode.color,
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: mode.color }}>
            {mode.label} Mode
          </span>
        </div>
        <div style={{ fontSize: 11, color: DIM }}>{mode.desc}</div>
      </div>

      {/* Mode switcher.

          The previous implementation only sent `/permissions ${key}` as
          a slash command. In remote-session mode that text just goes to
          the LLM — the daemon never updates the local `mode` state, so
          the composer chip stayed stale and `set_permission_mode`
          control_request never fired. Calling `onSetMode(key)` updates
          the React state which triggers the `useEffect` in
          CodeModeChatView that sends the SDK control frame — same path
          the chip click uses. The slash is no longer needed. */}
      <SectionHeader label="Switch Mode" />
      <div style={{ display: 'flex', gap: 8, padding: '8px 0', flexWrap: 'wrap' }}>
        {Object.entries(PERMISSION_MODE_LABELS).map(([key, val]) => (
          <button
            key={key}
            onClick={() => {
              if (onSetMode) onSetMode(key);
              else onSend(`/permissions ${key}`); // fallback for test harness
              onClose();
            }}
            style={{
              flex: '1 1 calc(50% - 8px)', minWidth: 110,
              padding: '8px 0', borderRadius: 6, fontSize: 12, fontFamily: MONO,
              border: `1px solid ${key === permissionMode ? val.color : BORDER}`,
              backgroundColor: key === permissionMode ? `${val.color}18` : 'transparent',
              color: key === permissionMode ? val.color : DIM,
              cursor: 'pointer',
            }}
          >
            {val.label}
          </button>
        ))}
      </div>

      {/* Tool list */}
      <SectionHeader label="Available Tools" count={tools.length} />
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 0',
        maxHeight: 200, overflowY: 'auto',
      }}>
        {[...tools].sort((a, b) => a.localeCompare(b)).map(t => (
          <span key={t} style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 3,
            backgroundColor: BG_DEEP, color: DIM, border: `1px solid ${BORDER}`,
          }}>{t}</span>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: DIM }}>
        Use <span style={{ color: ACCENT }}>/allowed-tools</span> to see current permission rules
      </div>
    </RichModalShell>
  );
};
