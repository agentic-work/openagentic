/**
 * E2eHarnessSection — REAL E2E sweep (run-e2e endpoint).
 *
 * Sits inside TestHarnessView under the existing "LIGHT IT UP" section.
 *
 *  - "Run Full E2E" / "Run Smoke" buttons
 *  - filter chips per kind (Providers / Models / T1 / T2 / T3 / Flows / Cache)
 *  - live per-test row table with TTFT + tokens
 *  - summary card with p50/p95 TTFT + pass/fail
 *  - "Download JSON" of the structured result
 *
 * All colors via global tokens; no hex literals.
 */
import { useMemo, useState } from 'react';
import { useE2eHarness, type E2eTestKind } from './useE2eHarness';

const KIND_FILTERS: Array<{ id: E2eTestKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'provider', label: 'Providers' },
  { id: 'chat_model', label: 'Chat Models' },
  { id: 'embedding_model', label: 'Embedding Models' },
  { id: 't1_tool', label: 'T1' },
  { id: 't2_mcp', label: 'T2 MCP' },
  { id: 't3_artifact', label: 'T3 Artifacts' },
  { id: 'flow_e2e', label: 'Flows' },
  { id: 'cache_verify', label: 'Cache' },
];

export default function E2eHarnessSection() {
  const { rows, summary, running, error, start, stop, downloadJson } = useE2eHarness();
  const [filter, setFilter] = useState<E2eTestKind | 'all'>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter(r => r.kind === filter)),
    [rows, filter],
  );

  const passCount = rows.filter(r => r.status === 'pass').length;
  const failCount = rows.filter(r => r.status === 'fail').length;
  const runCount = rows.filter(r => r.status === 'running').length;

  return (
    <div
      data-testid="e2e-harness-section"
      style={{
        marginTop: 16,
        padding: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          Real E2E Integration Sweep
        </div>
        <div style={{ flex: 1 }} />
        <button
          data-testid="e2e-run-smoke"
          disabled={running}
          onClick={() => start({ mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false })}
          style={{
            padding: '6px 14px',
            background: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
            color: 'var(--text-primary)',
            borderRadius: 6,
            cursor: running ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: running ? 0.5 : 1,
          }}
        >
          Run Smoke
        </button>
        <button
          data-testid="e2e-run-full"
          onClick={() => (running ? stop() : start({ mode: 'full' }))}
          style={{
            padding: '6px 14px',
            background: running ? 'var(--color-error)' : 'var(--color-accent)',
            color: 'var(--color-onAccent, var(--text-primary))',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {running ? `STOP (${rows.length} so far)` : 'Run Full E2E'}
        </button>
        <button
          data-testid="e2e-download-json"
          disabled={rows.length === 0}
          onClick={downloadJson}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--text-secondary)',
            borderRadius: 6,
            cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: rows.length === 0 ? 0.4 : 1,
          }}
        >
          Download JSON
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {KIND_FILTERS.map(f => (
          <button
            key={f.id}
            data-testid={`e2e-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              borderRadius: 12,
              border: '1px solid var(--color-border)',
              background:
                filter === f.id ? 'var(--color-accent)' : 'var(--color-surfaceSecondary)',
              color:
                filter === f.id
                  ? 'var(--color-onAccent, var(--text-primary))'
                  : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary line */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {summary
          ? `${summary.passed}/${summary.total} passed · p50 ${summary.durations?.p50 ?? 0}ms · p95 ${summary.durations?.p95 ?? 0}ms`
          : running
            ? `${runCount} running · ${passCount} passed · ${failCount} failed`
            : rows.length === 0
              ? 'Click Run Full E2E to start.'
              : `${passCount} passed · ${failCount} failed`}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>
          Error: {error}
        </div>
      )}

      {/* Per-test row table */}
      {filtered.length > 0 && (
        <div
          data-testid="e2e-rows-table"
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            overflow: 'hidden',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: 'var(--color-surfaceSecondary)' }}>
              <tr>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-secondary)' }}>Kind</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-secondary)' }}>Target</th>
                <th style={{ padding: '6px 10px', textAlign: 'center', width: 70, color: 'var(--text-secondary)' }}>Status</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: 80, color: 'var(--text-secondary)' }}>Duration</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: 70, color: 'var(--text-secondary)' }}>TTFT</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: 60, color: 'var(--text-secondary)' }}>Tokens</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', width: 60, color: 'var(--text-secondary)' }}>Dim</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--text-secondary)' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.testId} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '4px 10px', color: 'var(--text-tertiary)' }}>{r.kind}</td>
                  <td style={{ padding: '4px 10px', color: 'var(--text-primary)' }}>{r.target}</td>
                  <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background:
                          r.status === 'pass'
                            ? 'var(--color-successSoft, var(--color-surfaceSecondary))'
                            : r.status === 'fail'
                              ? 'var(--color-errorSoft, var(--color-surfaceSecondary))'
                              : 'var(--color-surfaceSecondary)',
                        color:
                          r.status === 'pass'
                            ? 'var(--color-success)'
                            : r.status === 'fail'
                              ? 'var(--color-error)'
                              : 'var(--text-tertiary)',
                      }}
                    >
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {r.durationMs != null ? `${r.durationMs}ms` : '-'}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {r.ttftMs != null ? `${r.ttftMs}ms` : '-'}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {r.tokensOut != null ? r.tokensOut : '-'}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {r.embeddingDim != null ? r.embeddingDim : '-'}
                  </td>
                  <td
                    style={{
                      padding: '4px 10px',
                      color: 'var(--text-tertiary)',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.error || (r.evidence ? JSON.stringify(r.evidence).slice(0, 120) : '-')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
