/**
 * TestHarnessView — Admin system test harness with "Light It Up" button.
 * Tests all providers, models, chat, workflows, and MCP tools.
 */
import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useTestHarness } from './useTestHarness';
import TestPanel from './TestPanel';
import TestLogStream from './TestLogStream';
import E2eHarnessSection from './E2eHarnessSection';
import { PageHeader } from '../../primitives-v2';

// Order matches POST /api/admin/test-harness/run defaultCategories on the
// server. Each tile gates the same-named test set; clicking LIGHT IT UP
// runs every category sequentially and live-streams results into the tiles.
const CATEGORIES = [
  { id: 'health',    label: 'System Health',    icon: '🏥' },
  { id: 'infra',     label: 'K8s Resources',    icon: '☸️' },
  { id: 'milvus',    label: 'Milvus Collections', icon: '🧬' },
  { id: 'mcp',       label: 'MCP Servers',      icon: '🔧' },
  { id: 'models',    label: 'Model Registry',   icon: '🧠' },
  { id: 'rbac',      label: 'RBAC + Permissions', icon: '🔐' },
  { id: 'chat',      label: 'Chat Pipeline',    icon: '💬' },
  { id: 'agents',    label: 'Sub-Agents',       icon: '🤖' },
  { id: 'workflows', label: 'Workflows',        icon: '⚡' },
  { id: 'code',      label: 'Code Mode',        icon: '💻' },
];

// Chart palette: teal #14b8a6 is an extended-series slot with no --ap-* equivalent.
// eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
const CHART_COLORS = ['var(--ap-accent)', 'var(--ap-ok)', 'var(--ap-warn)', 'var(--ap-err)', 'var(--ap-info)', 'var(--ap-accent)', 'var(--ap-accent)', '#14b8a6'];

export default function TestHarnessView() {
  const { results, logEntries, running, summary, startTests, stopTests, clearResults } = useTestHarness();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Group results by category
  const resultsByCategory = useMemo(() => {
    const map: Record<string, typeof results> = {};
    for (const cat of CATEGORIES) map[cat.id] = [];
    for (const r of results) {
      if (map[r.category]) map[r.category].push(r);
    }
    return map;
  }, [results]);

  // TTFT chart data from model results
  const ttftData = useMemo(() => {
    return results
      .filter(r => r.category === 'models' && r.status === 'pass' && r.details?.ttft != null)
      .map(r => ({
        name: r.test.length > 25 ? r.test.substring(0, 25) + '...' : r.test,
        ttft: r.details.ttft,
        fullName: r.test,
      }))
      .sort((a, b) => a.ttft - b.ttft);
  }, [results]);

  // Active category results for table
  const activeResults = activeCategory ? (resultsByCategory[activeCategory] || []) : results;

  const handleLightItUp = () => {
    if (running) {
      stopTests();
    } else {
      startTests(['health', 'infra', 'milvus', 'mcp', 'models', 'rbac', 'chat', 'agents', 'workflows', 'code']);
    }
  };

  const totalPassed = results.filter(r => r.status === 'pass').length;
  const totalFailed = results.filter(r => r.status === 'fail').length;
  const totalTests = results.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', padding: 0 }}>
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Monitoring', 'Test Harness']}
        title="Test Harness"
        explainer={summary
          ? `${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped · ${summary.totalTimeMs}ms total`
          : 'System test harness — exercises providers, models, chat, agents, MCP, workflows, and code mode end-to-end.'}
        actions={[
          {
            label: running ? `STOP (${totalTests} tests)` : 'LIGHT IT UP',
            primary: true,
            onClick: handleLightItUp,
          },
        ]}
      />

      {/* Cost Warning */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 6,
        background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-warn) 30%, transparent)',
        fontSize: 12, color: 'var(--color-warning)',
      }}>
        <span style={{ fontSize: 16 }}>&#9888;</span>
        <span>Running tests will incur token usage costs for LLM model testing (completions sent to each provider). Chat and agent tests also consume tokens.</span>
      </div>

      {/* Category Panels */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <TestPanel
            key={cat.id}
            category={cat.id}
            label={cat.label}
            icon={cat.icon}
            results={resultsByCategory[cat.id] || []}
            isActive={activeCategory === cat.id}
            onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
          />
        ))}
      </div>

      {/* Summary Cards */}
      {totalTests > 0 && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{
            flex: 1, padding: '12px 16px', borderRadius: 8,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-success)' }}>{totalPassed}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Passed</div>
          </div>
          <div style={{
            flex: 1, padding: '12px 16px', borderRadius: 8,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: totalFailed > 0 ? 'var(--color-error)' : 'var(--text-tertiary)' }}>{totalFailed}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Failed</div>
          </div>
          <div style={{
            flex: 1, padding: '12px 16px', borderRadius: 8,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{totalTests}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total</div>
          </div>
          {summary && (
            <div style={{
              flex: 1, padding: '12px 16px', borderRadius: 8,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-info)' }}>{(summary.totalTimeMs / 1000).toFixed(1)}s</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Duration</div>
            </div>
          )}
        </div>
      )}

      {/* TTFT Chart */}
      {ttftData.length > 0 && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            TTFT Comparison (Time to First Token)
          </div>
          <ResponsiveContainer width="100%" height={Math.max(120, ttftData.length * 40)}>
            <BarChart data={ttftData} layout="vertical" margin={{ left: 10, right: 40 }}>
              <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={v => `${v}ms`} />
              <YAxis type="category" dataKey="name" width={180} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip
                formatter={(value: number) => [`${value}ms`, 'TTFT']}
                contentStyle={{ background: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Bar dataKey="ttft" radius={[0, 4, 4, 0]}>
                {ttftData.map((_entry, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Results Table */}
      {activeCategory && activeResults.length > 0 && (
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {CATEGORIES.find(c => c.id === activeCategory)?.label} Results
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Test</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: 80 }}>Status</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, width: 80 }}>Duration</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {activeResults.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '6px 12px', color: 'var(--text-primary)' }}>{r.test}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: r.status === 'pass' ? 'color-mix(in srgb, var(--color-ok) 15%, transparent)' : r.status === 'fail' ? 'color-mix(in srgb, var(--color-err) 15%, transparent)' : 'color-mix(in srgb, var(--color-fg) 5%, transparent)',
                      color: r.status === 'pass' ? 'var(--color-success)' : r.status === 'fail' ? 'var(--color-error)' : 'var(--text-tertiary)',
                    }}>
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {r.durationMs != null ? `${r.durationMs}ms` : '-'}
                  </td>
                  <td style={{ padding: '6px 12px', color: 'var(--text-tertiary)', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.error || (r.details ? JSON.stringify(r.details).substring(0, 100) : '-')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* REAL E2E integration sweep — exercises every provider, model,
          T1 / T2 / T3 tool, and a flow. Used by GH Actions self-hosted
          runners; mirrors the gates from CLAUDE.md rule 3a. */}
      <E2eHarnessSection />

      {/* Live Log */}
      <div style={{ flex: 1, minHeight: 250 }}>
        <TestLogStream entries={logEntries} onClear={clearResults} />
      </div>
    </div>
  );
}
