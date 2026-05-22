/**
 * Prompt Effectiveness View
 *
 * Dashboard showing prompt module usage, feedback, and performance stats.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from '@/shared/icons';
import { AdminButton } from '../Shared/AdminButton';
import { apiRequestJson } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

interface EffectivenessData {
  totalModules: number;
  enabledModules: number;
  averageTokenCost: number;
  totalTokenBudgetUsed: number;
  moduleUsage: ModuleUsageRow[];
  recentCompositions: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  pendingOutcomes: number;
}

interface ModuleUsageRow {
  moduleName: string;
  usageCount: number;
  positiveCount: number;
  negativeCount: number;
  averageTokenCost?: number;
}

const StatCard: React.FC<{ label: string; value: string | number; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <div
    style={{
      padding: '14px 16px',
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      backgroundColor: 'var(--color-surface)',
      flex: 1,
      minWidth: '140px',
    }}
  >
    <div style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', lineHeight: 1.1 }}>
      {value}
    </div>
    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
      {label}
    </div>
    {sub && (
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', opacity: 0.7, marginTop: '2px' }}>
        {sub}
      </div>
    )}
  </div>
);

export const EffectivenessView: React.FC = () => {
  const [data, setData] = useState<EffectivenessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequestJson<EffectivenessData>('/admin/prompts/effectiveness');
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load effectiveness data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const positiveRate =
    data && (data.positiveOutcomes + data.negativeOutcomes) > 0
      ? Math.round(
          (data.positiveOutcomes / (data.positiveOutcomes + data.negativeOutcomes)) * 100,
        )
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Prompts', 'Effectiveness']}
        title="Prompt Effectiveness"
        explainer="Module usage frequency and feedback outcomes."
        actions={[
          { label: 'Refresh', onClick: fetchData },
        ]}
      />

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)',
            color: 'var(--color-error)',
          }}
        >
          {error}
        </div>
      )}

      {/* Stat cards */}
      {data && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <StatCard label="Total Modules" value={data.totalModules} />
          <StatCard
            label="Enabled Modules"
            value={data.enabledModules}
            sub={`${data.totalModules - data.enabledModules} disabled`}
          />
          <StatCard
            label="Avg Token Cost"
            value={`~${Math.round(data.averageTokenCost)}`}
            sub="per module"
          />
          <StatCard
            label="Token Budget Used"
            value={data.totalTokenBudgetUsed.toLocaleString()}
            sub="last 24h"
          />
          <StatCard
            label="Positive Rate"
            value={positiveRate !== null ? `${positiveRate}%` : '—'}
            sub={
              data.positiveOutcomes + data.negativeOutcomes > 0
                ? `${data.positiveOutcomes} positive / ${data.negativeOutcomes} negative`
                : 'No rated outcomes yet'
            }
          />
          <StatCard
            label="Recent Compositions"
            value={data.recentCompositions}
            sub="last 24h"
          />
        </div>
      )}

      {/* Module usage table */}
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
              {['Module', 'Uses', 'Positive', 'Negative', 'Win Rate'].map((h) => (
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
                <td
                  colSpan={5}
                  style={{
                    padding: '32px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                  }}
                >
                  Loading...
                </td>
              </tr>
            ) : !data || data.moduleUsage.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: '32px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                  }}
                >
                  No usage data yet — effectiveness is tracked per composition
                </td>
              </tr>
            ) : (
              data.moduleUsage.map((row, idx) => {
                const total = row.positiveCount + row.negativeCount;
                const winRate =
                  total > 0 ? Math.round((row.positiveCount / total) * 100) : null;
                return (
                  <tr
                    key={row.moduleName}
                    style={{
                      borderBottom:
                        idx < data.moduleUsage.length - 1
                          ? '1px solid var(--color-border)'
                          : 'none',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {row.moduleName}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {row.usageCount.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--ap-ok)',
                      }}
                    >
                      {row.positiveCount}
                    </td>
                    <td
                      style={{
                        padding: '10px 12px',
                        fontSize: '13px',
                        color: 'var(--color-error)',
                      }}
                    >
                      {row.negativeCount}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {winRate !== null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div
                            style={{
                              flex: 1,
                              maxWidth: '80px',
                              height: '6px',
                              borderRadius: '3px',
                              backgroundColor: 'var(--color-border)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${winRate}%`,
                                backgroundColor:
                                  winRate >= 60 ? 'var(--ap-ok)' : winRate >= 40 ? 'var(--ap-warn)' : 'var(--ap-err)',
                                borderRadius: '3px',
                                transition: 'width 300ms',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: '13px',
                              fontWeight: '500',
                              color:
                                winRate >= 60
                                  ? 'var(--ap-ok)'
                                  : winRate >= 40
                                  ? 'var(--ap-warn)'
                                  : 'var(--color-error)',
                            }}
                          >
                            {winRate}%
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Placeholder chart area */}
      <div
        style={{
          padding: '24px',
          border: '1px dashed var(--color-border)',
          borderRadius: '8px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '13px',
        }}
      >
        Recharts timeline chart — coming soon (wire to /admin/prompts/effectiveness/timeseries)
      </div>
    </div>
  );
};

export default EffectivenessView;
