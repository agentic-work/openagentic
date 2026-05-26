/**
 * ToolsIndexedPill — admin-only sanity pill, sits LEFT of the Send button.
 *
 * Reads `/api/admin/mcp/tools/status`, the canonical index status for the
 * tools agents actually use to plan tool calls:
 *
 *   - **Primary**: Milvus collection `mcp_tools_cache` (semantic vectors).
 *     Agents query this for tool selection per turn.
 *   - **Fallback**: Redis cache (`mcp_tools_cache` key + per-server count
 *     keys `mcp:tools:server:<id>:count`).
 *   - **Source**: MCP proxy `/tools` endpoint feeds the indexer; the
 *     indexer writes to Milvus + Redis. The proxy is NOT what agents read.
 *
 * The pill displays the Milvus rowCount (primary) — what agents will
 * actually find. Modal breaks that down: index counts per source, the
 * Redis per-server breakdown, last-index time, and an inSync flag that
 * goes red if the proxy and the index disagree.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, X } from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';

interface ToolsStatus {
  status: string;
  indexing: {
    lastIndexTime: string | null;
    lastIndexSuccess: boolean | null;
    lastIndexError: string | null;
    totalToolsIndexed: number;
  };
  milvus: {
    exists: boolean;
    rowCount: number;
    error?: string;
  };
  redis: {
    serverCounts: Record<string, number>;
    totalServers: number;
  };
  mcpProxy: {
    totalTools: number;
    servers: Array<{ serverId: string; toolCount: number }>;
  };
  inSync: boolean;
}

export const ToolsIndexedPill: React.FC = () => {
  const [data, setData] = useState<ToolsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiEndpoint('/admin/mcp/tools/status'), {
          credentials: 'include',
          headers: { 'X-OpenAgentic-Frontend': 'true' },
        });
        if (!r.ok) {
          if (!cancelled) setError(`HTTP ${r.status}`);
          return;
        }
        const d = await r.json();
        if (!cancelled) setData(d);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Primary index count = what agents actually query against (Milvus).
  // Fall back to Redis count if Milvus collection missing.
  const indexedCount = useMemo(() => {
    if (!data) return null;
    if (data.milvus.exists && data.milvus.rowCount > 0) return data.milvus.rowCount;
    return data.indexing.totalToolsIndexed || 0;
  }, [data]);

  const sortedServers = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.redis.serverCounts || {})
      .map(([server, count]) => ({ server, count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const lastIndex = data?.indexing?.lastIndexTime
    ? new Date(data.indexing.lastIndexTime)
    : null;
  const lastIndexHuman = lastIndex
    ? `${Math.max(0, Math.round((Date.now() - lastIndex.getTime()) / 1000))}s ago`
    : 'never';

  const label = error ? '— tools' : indexedCount === null ? '… tools' : `${indexedCount} tools`;
  const inSyncBad = data && !data.inSync;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 transition-colors text-sm hover:bg-theme-bg-secondary"
        style={{
          color: inSyncBad ? 'var(--color-warn, var(--cm-warning))' : 'var(--text-secondary)',
          backgroundColor: 'var(--color-surfaceSecondary)',
          border: '1px solid ' + (inSyncBad ? 'var(--color-warn, var(--cm-warning))' : 'var(--color-border)'),
          borderRadius: 9999,
          transform: 'translateZ(0)',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 12,
          height: 32,
        }}
        title={
          error
            ? `Failed to load index status: ${error}`
            : `${indexedCount ?? 'loading'} tools indexed in Milvus${inSyncBad ? ' — index out of sync with MCP proxy' : ''}`
        }
        aria-label={`Tools indexed: ${label}`}
      >
        <Layers size={12} />
        <span>{label}</span>
      </button>

      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="MCP tool index status"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'color-mix(in srgb, var(--cm-text) 55%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              minWidth: 420, maxWidth: 540,
              maxHeight: '80vh',
              padding: 18,
              fontFamily: 'system-ui, sans-serif',
              color: 'var(--color-text)',
              boxShadow: '0 18px 64px color-mix(in srgb, var(--cm-text) 45%, transparent)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>MCP tool index status</h3>
                <div style={{ fontSize: 12, color: 'var(--color-textMuted)', marginTop: 2 }}>
                  {error
                    ? `failed: ${error}`
                    : `last indexed ${lastIndexHuman} · ${data?.indexing?.lastIndexSuccess ? 'OK' : 'failed'}`}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--color-textMuted)', cursor: 'pointer',
                  padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </header>

            {data && (
              <>
                <section style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12 }}>
                  <Row
                    label="Primary index (Milvus mcp_tools_cache)"
                    value={data.milvus.exists ? `${data.milvus.rowCount} vectors` : 'collection missing'}
                    bad={!data.milvus.exists}
                  />
                  <Row
                    label="Fallback index (Redis aggregate)"
                    value={`${data.indexing.totalToolsIndexed} tools`}
                  />
                  <Row
                    label="Source feed (MCP proxy /tools)"
                    value={`${data.mcpProxy.totalTools} tools`}
                    bad={data.mcpProxy.totalTools === 0}
                  />
                  <Row
                    label="Index ↔ proxy in sync"
                    value={data.inSync ? 'yes' : 'NO — agents using cached index'}
                    bad={!data.inSync}
                  />
                </section>

                <section>
                  <div style={{ fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Indexed tools per server (Redis · {data.redis.totalServers} servers)
                  </div>
                  <ul
                    style={{
                      listStyle: 'none', margin: 0, padding: 0,
                      overflowY: 'auto', maxHeight: '40vh',
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    {sortedServers.length === 0 && (
                      <li style={{ color: 'var(--color-textMuted)' }}>none</li>
                    )}
                    {sortedServers.map((s) => (
                      <li
                        key={s.server}
                        style={{
                          display: 'flex', justifyContent: 'space-between',
                          padding: '6px 8px',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <span style={{ color: 'var(--color-text)' }}>{s.server}</span>
                        <span style={{ color: 'var(--color-textMuted)' }}>{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

const Row: React.FC<{ label: string; value: string; bad?: boolean }> = ({ label, value, bad }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
    <span style={{ color: 'var(--color-textMuted)' }}>{label}</span>
    <span style={{ color: bad ? 'var(--color-warn, var(--cm-warning))' : 'var(--color-text)' }}>{value}</span>
  </div>
);

export default ToolsIndexedPill;
