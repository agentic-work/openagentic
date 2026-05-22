/**
 * FlowCostsView - Admin dashboard for workflow cost analytics (FlowFinOps)
 * Shows per-workflow, per-user cost breakdowns with model-level detail.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';
import {
  Activity,
  DollarSign,
  TrendingUp,
  Zap,
  Users,
  BarChart2,
  Clock,
} from '@/shared/icons';

interface ModelCost {
  model: string;
  tokens: number;
  cost: number;
  calls: number;
}

interface CostGroup {
  key: string;
  label: string;
  totalCost: number;
  totalExecutions: number;
  totalTokens: number;
  avgCostPerExecution: number;
  models: ModelCost[];
}

interface CostSummary {
  totalCost: number;
  totalExecutions: number;
  totalTokens: number;
  avgCostPerExecution: number;
}

interface CostData {
  success: boolean;
  period: string;
  groupBy: string;
  summary: CostSummary;
  results: CostGroup[];
}

interface FlowCostsViewProps {
  theme?: string;
}

export const FlowCostsView: React.FC<FlowCostsViewProps> = ({ theme }) => {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');
  const [groupBy, setGroupBy] = useState('workflow');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const _isDark = theme === 'dark';
  void _isDark;

  const fetchCosts = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiRequest(`/api/admin/workflows/cost?period=${period}&groupBy=${groupBy}`);
      const json = await resp.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch workflow costs:', err);
    } finally {
      setLoading(false);
    }
  }, [period, groupBy]);

  useEffect(() => { fetchCosts(); }, [fetchCosts]);

  const formatCost = (cost: number) => cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
  const formatTokens = (tokens: number) => tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000
      ? `${(tokens / 1_000).toFixed(1)}K`
      : tokens.toLocaleString();

  const cardStyle: React.CSSProperties = {
    background: 'var(--ap-bg-1)',
    border: '1px solid var(--ap-ln-1)',
    borderRadius: 12,
    padding: 16,
  };

  const headerColor = 'var(--ap-fg-0)';
  const mutedColor = 'var(--ap-fg-3)';
  const accentGreen = 'var(--ap-ok)';
  const accentBlue = 'var(--ap-accent)';

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200 }}>
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Flows', 'Flow Costs']}
        title="Flow Costs"
        explainer="Per-workflow cost tracking from real LLM usage. Drill into model-level breakdowns by row."
        actions={[
          { label: 'Refresh', onClick: fetchCosts },
        ]}
      />

      {/* Filter bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 20, marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Period selector */}
          {['7d', '30d', '90d'].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--ap-ln-1)',
                background: period === p ? accentBlue : 'transparent',
                color: period === p ? 'var(--ap-fg-0)' : mutedColor,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {p}
            </button>
          ))}
          {/* Group by selector */}
          <select
            value={groupBy}
            onChange={e => setGroupBy(e.target.value)}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid var(--ap-ln-1)',
              background: 'var(--ap-bg-0)',
              color: headerColor,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="workflow">By Workflow</option>
            <option value="user">By User</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      {data?.summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { icon: <DollarSign className="w-4 h-4" />, label: 'Total Cost', value: formatCost(data.summary.totalCost), color: accentGreen },
            { icon: <Activity className="w-4 h-4" />, label: 'Executions', value: data.summary.totalExecutions.toLocaleString(), color: accentBlue },
            { icon: <Zap className="w-4 h-4" />, label: 'Total Tokens', value: formatTokens(data.summary.totalTokens), color: 'var(--ap-warn)' },
            { icon: <TrendingUp className="w-4 h-4" />, label: 'Avg Cost/Run', value: formatCost(data.summary.avgCostPerExecution), color: 'var(--ap-accent)' },
          ].map((card, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ color: card.color }}>{card.icon}</div>
                <span style={{ color: mutedColor, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{card.label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cost table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: mutedColor }}>Loading cost data...</div>
      ) : !data?.results?.length ? (
        <div style={{ textAlign: 'center', padding: 40, color: mutedColor }}>
          No workflow execution cost data found for this period.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ap-ln-1)' }}>
                {['Name', 'Executions', 'Tokens', 'Total Cost', 'Avg/Run'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Name' ? 'left' : 'right', padding: '10px 12px', color: mutedColor, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.results.map(row => (
                <React.Fragment key={row.key}>
                  <tr
                    onClick={() => setExpandedRow(expandedRow === row.key ? null : row.key)}
                    style={{
                      borderBottom: '1px solid var(--ap-ln-3)',
                      cursor: 'pointer',
                      background: expandedRow === row.key ? 'var(--ap-bg-2)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 12px', color: headerColor, fontWeight: 600 }}>{row.label}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: headerColor }}>{row.totalExecutions}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: headerColor }}>{formatTokens(row.totalTokens)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: accentGreen, fontWeight: 700 }}>{formatCost(row.totalCost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: mutedColor }}>{formatCost(row.avgCostPerExecution)}</td>
                  </tr>
                  {/* Expanded model breakdown */}
                  {expandedRow === row.key && row.models.length > 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '0 12px 12px 32px' }}>
                        <div style={{ fontSize: 11, color: mutedColor, marginBottom: 6, fontWeight: 600 }}>Model Breakdown</div>
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              {['Model', 'Calls', 'Tokens', 'Cost'].map(h => (
                                <th key={h} style={{ textAlign: h === 'Model' ? 'left' : 'right', padding: '4px 8px', color: mutedColor, fontWeight: 500 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {row.models.map((m, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--ap-ln-3)' }}>
                                <td style={{ padding: '4px 8px', color: headerColor, fontFamily: 'monospace' }}>{m.model}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: headerColor }}>{m.calls}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: headerColor }}>{formatTokens(m.tokens)}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', color: accentGreen }}>{formatCost(m.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default FlowCostsView;
