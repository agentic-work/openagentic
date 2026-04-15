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
 * TestHarnessView — Admin system test harness with "Light It Up" button.
 * Tests all providers, models, chat, workflows, and MCP tools.
 */
import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useTestHarness } from './useTestHarness';
import TestPanel from './TestPanel';
import TestLogStream from './TestLogStream';

const CATEGORIES = [
  { id: 'health', label: 'System', icon: '🏥' },
  { id: 'models', label: 'LLM Models', icon: '🧠' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'k8s', label: 'K8s Cluster', icon: '☸️' },
  { id: 'mcp', label: 'MCP Servers', icon: '🔧' },
  { id: 'workflows', label: 'Workflows', icon: '⚡' },
  { id: 'code', label: 'Code Mode', icon: '💻' },
];

const CHART_COLORS = ['#6366f1', '#00D26A', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#14b8a6'];

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
      startTests(['health', 'models', 'chat', 'agents', 'k8s', 'mcp', 'workflows', 'code']);
    }
  };

  const totalPassed = results.filter(r => r.status === 'pass').length;
  const totalFailed = results.filter(r => r.status === 'fail').length;
  const totalTests = results.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', padding: 0 }}>
      {/* Cost Warning */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 6,
        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
        fontSize: 12, color: 'var(--color-warning, #f59e0b)',
      }}>
        <span style={{ fontSize: 16 }}>&#9888;</span>
        Running tests will incur token usage costs for LLM model testing (completions sent to each provider). Chat and agent tests also consume tokens.
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            System Test Harness
          </h2>
          {summary && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              {summary.passed} passed · {summary.failed} failed · {summary.skipped} skipped · {summary.totalTimeMs}ms total
            </div>
          )}
        </div>
        <button
          onClick={handleLightItUp}
          disabled={false}
          style={{
            padding: '10px 24px',
            fontSize: 14,
            fontWeight: 700,
            color: '#fff',
            background: running
              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
              : 'linear-gradient(135deg, #f59e0b, #ef4444, #ec4899)',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            boxShadow: running ? '0 0 20px rgba(239,68,68,0.4)' : '0 0 20px rgba(245,158,11,0.3)',
            transition: 'all 0.3s',
            letterSpacing: 0.5,
          }}
        >
          {running ? `⏹ STOP (${totalTests} tests)` : '🔥 LIGHT IT UP'}
        </button>
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
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border, #1a1a1a)' }}>
                  <td style={{ padding: '6px 12px', color: 'var(--text-primary)' }}>{r.test}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: r.status === 'pass' ? 'rgba(0,210,106,0.15)' : r.status === 'fail' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                      color: r.status === 'pass' ? 'var(--color-success)' : r.status === 'fail' ? 'var(--color-error)' : 'var(--text-tertiary)',
                    }}>
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
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

      {/* Live Log */}
      <div style={{ flex: 1, minHeight: 250 }}>
        <TestLogStream entries={logEntries} onClear={clearResults} />
      </div>
    </div>
  );
}
