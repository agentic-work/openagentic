/**
 * LLM Performance Metrics - GCP Cloud Monitoring-style Dashboard
 *
 * Displays real-time LLM performance: latency percentiles, throughput,
 * cost attribution, provider health, model comparison, and tool analytics.
 * Uses Recharts for time series and shared design components.
 *
 * Router Health section (added): reads /api/metrics Prometheus endpoint
 * every 15 s and renders 8 panels covering routing decisions, escalations,
 * quality bonus, floor exclusions, latency overhead, tuning audit trail,
 * current tuning values, and current tenant defaults.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Users, HelpCircle } from '@/shared/icons';
import {
  Activity, Zap, DollarSign, TrendingUp, RefreshCw,
  Timer as Clock, CheckCircle, XCircle
} from '../Shared/AdminIcons';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { AdminStatusBadge } from '../Shared/AdminStatusBadge';
import { AdminTooltip, InfoTooltip } from '../Shared/AdminTooltip';
import { AdminCard } from '../Shared/AdminCard';
import { CHART_COLORS } from '../Shared/chartColors';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

// ════════════════════════════════════════════════════════════════════════
// Router Health — Prometheus metrics helpers
// ════════════════════════════════════════════════════════════════════════

/** CSS color-mix tint helper — no hardcoded hex or rgba(). */
const tint = (tok: string, pct: number): string =>
  `color-mix(in srgb, ${tok} ${pct}%, transparent)`;

/** One parsed Prometheus sample. */
interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * Minimal Prometheus text-format parser.
 * Handles lines of the form:
 *   metric_name{k="v",...} VALUE [timestamp]
 * Comment and empty lines are skipped.
 */
export function parsePromText(text: string): PrometheusSample[] {
  const samples: PrometheusSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Split off timestamp (optional 3rd token)
    const spaceIdx = line.lastIndexOf(' ');
    if (spaceIdx < 0) continue;
    const valueStr = line.slice(spaceIdx + 1);
    const valueNum = parseFloat(valueStr);
    if (isNaN(valueNum)) continue;
    const metricPart = line.slice(0, spaceIdx).trim();

    let name: string;
    let labels: Record<string, string> = {};

    const brace = metricPart.indexOf('{');
    if (brace < 0) {
      name = metricPart;
    } else {
      name = metricPart.slice(0, brace);
      const labelStr = metricPart.slice(brace + 1, metricPart.lastIndexOf('}'));
      // Parse k="v" pairs
      const re = /(\w+)="([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(labelStr)) !== null) {
        labels[m[1]] = m[2];
      }
    }
    samples.push({ name, labels, value: valueNum });
  }
  return samples;
}

/** Filter samples by metric name (exact match). */
function bySeries(samples: PrometheusSample[], metricName: string): PrometheusSample[] {
  return samples.filter((s) => s.name === metricName);
}

/** Sum values across label groups. */
function sumByLabel(samples: PrometheusSample[], labelKey: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples) {
    const k = s.labels[labelKey] ?? '(none)';
    out[k] = (out[k] ?? 0) + s.value;
  }
  return out;
}

// 16 router tuning field names (mirrors RouterTuning interface)
export const TUNING_FIELDS = [
  'costWeight',
  'qualityWeight',
  'costBonusMaxPoints',
  'latencyBonusMaxPoints',
  'toolCallingBonusMaxPoints',
  'reasoningBonusMaxPoints',
  'fcaQualityFloor',
  'fcaQualityMultiplier',
  'fcaQualityGatedByComplexity',
  'costNormalizationCeiling',
  'fcaChatPoolFloor',
  'fcaSimpleToolFloor',
  'fcaComplexToolFloor',
  'fcaDestructiveFloor',
  'fcaInfraOpsFloor',
  'fcaComplexityBiasFloor',
] as const;

// 5 tenant default categories
export const DEFAULT_CATEGORIES = ['chat', 'code', 'embeddings', 'vision', 'image_gen'] as const;

// ── Escalation types
const ESCALATION_TYPES = [
  'destructive',
  'infra_ops',
  'complexity_bias',
  'chat_pool_filter',
  'quality_bonus_gated',
] as const;

// ── Floor keys
const FLOOR_KEYS = [
  'chat_pool',
  'simple_tool',
  'complex_tool',
  'destructive',
  'infra_ops',
  'complexity_bias',
] as const;

// ── Token colors for escalation types (CSS var tokens, no hex)
const ESCALATION_COLORS: Record<string, string> = {
  destructive:         'var(--color-error)',
  infra_ops:           'var(--color-warning)',
  complexity_bias:     'var(--color-primary)',
  chat_pool_filter:    'var(--color-success)',
  quality_bonus_gated: 'var(--color-accent-secondary, var(--color-warning))',
};

// ════════════════════════════════════════════════════════════════════════
// RouterHealthSection — reads /api/metrics every 15 s
// ════════════════════════════════════════════════════════════════════════

interface RouterHealthData {
  samples: PrometheusSample[];
  fetchedAt: Date;
  error: string | null;
}

const RouterHealthSection: React.FC = () => {
  const [data, setData] = useState<RouterHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProm = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const samples = parsePromText(text);
      setData({ samples, fetchedAt: new Date(), error: null });
    } catch (e) {
      setData((prev) => prev ? { ...prev, error: String(e) } : { samples: [], fetchedAt: new Date(), error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProm();
    timerRef.current = setInterval(fetchProm, 15_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchProm]);

  if (loading && !data) {
    return (
      <div
        data-testid="router-health-loading"
        className="flex items-center gap-2 py-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        <div className="animate-spin rounded-full h-4 w-4 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
        <span className="text-sm">Loading Router Health metrics…</span>
      </div>
    );
  }

  const samples = data?.samples ?? [];

  // ── Panel 1: Decision distribution by tier ──────────────────────────
  const decisionSamples = bySeries(samples, 'openagentic_router_decision_total');
  const tierMap = sumByLabel(decisionSamples, 'tier');
  const totalDecisions = Object.values(tierMap).reduce((a, b) => a + b, 0);
  const frontierPct = totalDecisions > 0
    ? ((tierMap['frontier'] ?? 0) / totalDecisions * 100).toFixed(1)
    : '—';
  const tierEntries = Object.entries(tierMap).sort((a, b) => b[1] - a[1]);

  // ── Panel 2: Escalation firing rates ────────────────────────────────
  const escalationMap = sumByLabel(
    bySeries(samples, 'openagentic_router_escalation_fires_total'),
    'type',
  );

  // ── Panel 3: Quality bonus behavior ─────────────────────────────────
  const bonusMap = sumByLabel(
    bySeries(samples, 'openagentic_router_quality_bonus_applied_total'),
    'applied',
  );
  const bonusTotal = Object.values(bonusMap).reduce((a, b) => a + b, 0);
  const bonusPct = (key: string) =>
    bonusTotal > 0 ? ((bonusMap[key] ?? 0) / bonusTotal * 100).toFixed(1) : '0.0';

  // ── Panel 4: Floor exclusions ────────────────────────────────────────
  const floorMap = sumByLabel(
    bySeries(samples, 'openagentic_router_floor_excluded_total'),
    'floor',
  );
  const floorEntries = Object.entries(floorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxFloorVal = floorEntries[0]?.[1] ?? 1;

  // ── Panel 5: Route request latency ──────────────────────────────────
  const latencyHistogram = bySeries(samples, 'openagentic_router_route_request_duration_ms');
  const latSum = latencyHistogram.find((s) => s.name === 'openagentic_router_route_request_duration_ms' && s.labels['quantile'] === '0.5')?.value;
  const latp50Sample = samples.find(
    (s) => s.name === 'openagentic_router_route_request_duration_ms_bucket' && s.labels['quantile'] === '0.5',
  );
  // For histograms exposed as _sum/_count we compute mean; p-quantile needs Prometheus server.
  // We approximate from _sum / _count as median proxy when quantile data isn't in raw scrape.
  const latSumVal = samples.find((s) => s.name === 'openagentic_router_route_request_duration_ms_sum')?.value ?? 0;
  const latCountVal = samples.find((s) => s.name === 'openagentic_router_route_request_duration_ms_count')?.value ?? 0;
  const latMean = latCountVal > 0 ? latSumVal / latCountVal : 0;

  // bucket-based p50 / p95 approximation
  const buckets = samples
    .filter((s) => s.name === 'openagentic_router_route_request_duration_ms_bucket' && s.labels['le'])
    .map((s) => ({ le: parseFloat(s.labels['le']), count: s.value }))
    .sort((a, b) => a.le - b.le);

  function approxPercentile(pct: number): number | null {
    if (buckets.length === 0 || latCountVal === 0) return null;
    const target = pct * latCountVal;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].count >= target) {
        if (i === 0) return buckets[0].le;
        const prevCount = buckets[i - 1].count;
        const prevLe = buckets[i - 1].le;
        const curLe = buckets[i].le;
        const fraction = (target - prevCount) / (buckets[i].count - prevCount);
        return prevLe + fraction * (curLe - prevLe);
      }
    }
    return buckets[buckets.length - 1]?.le ?? null;
  }

  const p50 = approxPercentile(0.50);
  const p95 = approxPercentile(0.95);

  // ── Panel 6: Tuning audit trail ──────────────────────────────────────
  const tuningUpdated = bySeries(samples, 'openagentic_router_tuning_updated_total');
  const tuningAuditRows = [...tuningUpdated]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // ── Panel 7: Current tuning values ──────────────────────────────────
  const tuningCurrent = bySeries(samples, 'openagentic_router_tuning_current');
  const tuningValueMap: Record<string, number> = {};
  for (const s of tuningCurrent) {
    if (s.labels['field']) tuningValueMap[s.labels['field']] = s.value;
  }

  // ── Panel 8: Current tenant defaults ────────────────────────────────
  const defaultsCurrent = bySeries(samples, 'openagentic_defaults_current');
  const defaultsMap: Record<string, string> = {};
  for (const s of defaultsCurrent) {
    if (s.value === 1 && s.labels['category'] && s.labels['model']) {
      defaultsMap[s.labels['category']] = s.labels['model'];
    }
  }

  // ── Tier colors ──────────────────────────────────────────────────────
  const TIER_COLORS: Record<string, string> = {
    frontier: 'var(--color-primary)',
    mid:      'var(--color-warning)',
    cheap:    'var(--color-success)',
  };

  const statCell = (label: string, value: string | number, color?: string) => (
    <div
      key={label}
      className="rounded-md p-3"
      style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
    >
      <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
      <div className="text-sm font-bold" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="router-health-section">
      {/* Section heading */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Router Health
        </h3>
        {data?.fetchedAt && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Updated {data.fetchedAt.toLocaleTimeString()} (15 s auto)
          </span>
        )}
      </div>
      {data?.error && (
        <div
          className="rounded-md px-3 py-2 text-xs"
          style={{
            backgroundColor: tint('var(--color-error)', 10),
            border: `1px solid ${tint('var(--color-error)', 40)}`,
            color: 'var(--color-error)',
          }}
        >
          Could not load /api/metrics: {data.error}
        </div>
      )}

      {/* ── Row 1: 5 main panels ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Panel 1 — Decision distribution by tier */}
        <AdminCard>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Last 24h · Routing Decisions by Tier
          </div>
          <div className="text-2xl font-bold mb-1" style={{ color: 'var(--color-primary)' }}>
            {frontierPct}%
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
            frontier
          </div>
          <div
            className="space-y-2"
            data-testid="panel-decisions-tier"
          >
            {tierEntries.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data yet</div>
            ) : (
              tierEntries.map(([tier, count]) => {
                const pct = totalDecisions > 0 ? count / totalDecisions * 100 : 0;
                return (
                  <div key={tier}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: TIER_COLORS[tier] ?? 'var(--text-primary)' }}
                            data-testid={`tier-label-${tier}`}>
                        {tier}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)' }}>{count.toLocaleString()}</span>
                    </div>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ backgroundColor: tint('var(--color-border)', 50) }}
                    >
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: TIER_COLORS[tier] ?? 'var(--color-primary)',
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </AdminCard>

        {/* Panel 2 — Escalation firing rates */}
        <AdminCard>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Escalation Triggers (24h)
          </div>
          <div className="space-y-2" data-testid="panel-escalations">
            {ESCALATION_TYPES.map((type) => {
              const count = escalationMap[type] ?? 0;
              const color = ESCALATION_COLORS[type] ?? 'var(--color-primary)';
              return (
                <div key={type} className="flex items-center justify-between">
                  <span
                    className="text-xs truncate"
                    style={{ color }}
                    data-testid={`escalation-type-${type}`}
                  >
                    {type}
                  </span>
                  <span
                    className="text-xs font-semibold ml-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {count.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </AdminCard>

        {/* Panel 3 — Quality bonus behavior */}
        <AdminCard>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Quality bonus application (last 1h)
          </div>
          <div data-testid="panel-quality-bonus" className="space-y-2">
            {(
              [
                ['yes',                `${bonusPct('yes')}% applied`,          'var(--color-success)'],
                ['no_complexity_gate', `${bonusPct('no_complexity_gate')}% gated off`, 'var(--color-warning)'],
                ['disabled_globally',  `${bonusPct('disabled_globally')}% disabled globally`, 'var(--color-error)'],
              ] as [string, string, string][]
            ).map(([key, label, color]) => (
              <div key={key} className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color }}
                  data-testid={`bonus-label-${key}`}
                >
                  {label}
                </span>
                <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  {(bonusMap[key] ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <div
            className="mt-3 text-xs rounded-md px-2 py-1"
            style={{
              backgroundColor: tint('var(--color-warning)', 8),
              color: 'var(--text-tertiary)',
            }}
          >
            High gated-off % on chat traffic? Check fcaQualityGatedByComplexity.
          </div>
        </AdminCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Panel 4 — Floor exclusions top 5 */}
        <AdminCard>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Which FCA floor is filtering most?
          </div>
          <div data-testid="panel-floor-exclusions" className="space-y-2">
            {floorEntries.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No exclusions recorded</div>
            ) : (
              floorEntries.map(([floor, count]) => {
                const pct = maxFloorVal > 0 ? count / maxFloorVal * 100 : 0;
                return (
                  <div key={floor}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: 'var(--text-primary)' }} data-testid={`floor-label-${floor}`}>{floor}</span>
                      <span style={{ color: 'var(--text-tertiary)' }}>{count.toLocaleString()}</span>
                    </div>
                    <div
                      className="h-1.5 rounded-full"
                      style={{ backgroundColor: tint('var(--color-border)', 50) }}
                    >
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: 'var(--color-primary)',
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </AdminCard>

        {/* Panel 5 — Route request latency */}
        <AdminCard>
          <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Router decision overhead
          </div>
          <div data-testid="panel-latency" className="grid grid-cols-2 gap-3">
            <div
              className="rounded-md p-3"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}
                   data-testid="latency-p50-label">p50</div>
              <div
                className="text-xl font-bold"
                style={{
                  color: (p50 ?? 0) < 10 ? 'var(--color-success)' : (p50 ?? 0) < 50 ? 'var(--color-warning)' : 'var(--color-error)',
                }}
              >
                {p50 !== null ? `${p50.toFixed(1)}ms` : '—'}
              </div>
            </div>
            <div
              className="rounded-md p-3"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}
                   data-testid="latency-p95-label">p95</div>
              <div
                className="text-xl font-bold"
                style={{
                  color: (p95 ?? 0) < 25 ? 'var(--color-success)' : (p95 ?? 0) < 100 ? 'var(--color-warning)' : 'var(--color-error)',
                }}
              >
                {p95 !== null ? `${p95.toFixed(1)}ms` : '—'}
              </div>
            </div>
            <div
              className="rounded-md p-3 col-span-2"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>mean (count={latCountVal.toLocaleString()})</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {latCountVal > 0 ? `${latMean.toFixed(2)}ms` : '—'}
              </div>
            </div>
          </div>
        </AdminCard>
      </div>

      {/* ── Panel 6: Tuning audit trail ──────────────────────────────── */}
      <AdminCard>
        <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
          Router Tuning changes (last hour)
        </div>
        <div data-testid="panel-tuning-audit" className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--text-secondary)' }}>
                <th className="text-left pb-2 font-medium">Field</th>
                <th className="text-left pb-2 font-medium">Updated by</th>
                <th className="text-right pb-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {tuningAuditRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-center"
                      style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                    No tuning updates recorded
                  </td>
                </tr>
              ) : (
                tuningAuditRows.map((s, i) => (
                  <tr
                    key={`${s.labels['field']}-${s.labels['updated_by']}-${i}`}
                    style={{ borderBottom: `1px solid ${tint('var(--color-border)', 50)}` }}
                  >
                    <td className="py-2 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {s.labels['field'] ?? '—'}
                    </td>
                    <td className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {s.labels['updated_by'] ?? '—'}
                    </td>
                    <td className="py-2 text-right font-semibold" style={{ color: 'var(--color-primary)' }}>
                      {s.value.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>

      {/* ── Panel 7: Current tuning values ───────────────────────────── */}
      <AdminCard>
        <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
          Current tuning values
        </div>
        <div
          data-testid="panel-tuning-current"
          className="grid gap-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {TUNING_FIELDS.map((field) => {
            const val = tuningValueMap[field];
            return (
              <div
                key={field}
                className="rounded-md p-2"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
                data-testid={`tuning-field-${field}`}
              >
                <div className="text-xs truncate mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {field}
                </div>
                <div className="text-sm font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                  {val !== undefined ? String(val) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </AdminCard>

      {/* ── Panel 8: Current tenant defaults ─────────────────────────── */}
      <AdminCard>
        <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
          Current tenant defaults
        </div>
        <div
          data-testid="panel-defaults-current"
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {DEFAULT_CATEGORIES.map((cat) => (
            <div
              key={cat}
              className="rounded-md p-3"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                border: `1px solid ${tint('var(--color-border)', 60)}`,
              }}
              data-testid={`defaults-category-${cat}`}
            >
              <div className="text-xs mb-1 capitalize" style={{ color: 'var(--text-tertiary)' }}>
                {cat.replace('_', ' ')}
              </div>
              <div
                className="text-xs font-semibold font-mono truncate"
                style={{ color: 'var(--color-primary)' }}
              >
                {defaultsMap[cat] ?? '—'}
              </div>
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  );
};

// ── Tooltip Descriptions ──────────────────────────────────────────────

const TIPS = {
  totalQueries: 'Total LLM API requests in the selected time window',
  totalTokens: 'Combined prompt + completion tokens processed',
  estimatedCost: 'Estimated cost based on per-model token pricing',
  mcpToolCalls: 'MCP tool invocations triggered by the LLM',
  ttft: 'Time to First Token — how quickly the LLM begins generating. Lower is better.',
  tokensPerSec: 'Output generation speed. Higher is better.',
  responseTime: 'Total end-to-end request duration',
  modelLatency: 'Average response time per model',
  errorRate: 'Failed request percentage per model',
  concurrent: 'Simultaneous in-flight requests',
  cacheHitRate: 'Cache hit ratio — higher means lower cost and faster responses',
  providerCost: 'Cost breakdown by LLM provider from request logs',
  modelUsage: 'Token consumption and cost per model',
  userCost: 'Per-user cost attribution for billing',
  toolStats: 'MCP tool call success rates and execution times',
};

// ── Interfaces ────────────────────────────────────────────────────────

interface LLMPerformanceMetricsProps { theme: string }

interface OverviewMetrics {
  totalQueries: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgResponseTime: number;
  uniqueUsers: number;
  successCount: number;
  failureCount: number;
  successRate: string;
  toolCalls: number;
}
interface ModelBreakdown { model: string; queries: number; tokens: number; cost: number; avgTokensPerQuery: number }
interface UserMetrics { userId: string; email: string; totalQueries: number; totalTokens: number; promptTokens: number; completionTokens: number; estimatedCost: number; toolCalls: number; avgResponseTime: number }
interface ToolMetrics { toolName: string; serverName: string; totalCalls: number; successCount: number; failureCount: number; successRate: number; avgExecutionTime: number; estimatedCost: number }
interface TrendData { timestamp: string; queries: number; tokens: number; cost: number; toolCalls: number }
interface ProviderMetrics { provider: string; totalRequests: number; successfulRequests: number; failedRequests: number; successRate: string; promptTokens: number; completionTokens: number; totalTokens: number; totalCost: string; avgLatencyMs: number; avgTokensPerSecond: number }
interface PerformanceTrendPoint {
  timestamp: string;
  requestCount: number;
  avgTTFT: number | null;
  p95TTFT: number | null;
  p99TTFT: number | null;
  avgTokensPerSecond: number | null;
  p95TokensPerSecond: number | null;
  avgTotalLatency: number | null;
  p95TotalLatency: number | null;
  avgInputLatency: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgChunkLatency: number | null;
  p95ChunkLatency: number | null;
}
interface PerformanceKPIs {
  avgTTFT: number; p50TTFT: number; p95TTFT: number; p99TTFT: number;
  avgTokensPerSecond: number; p50TokensPerSecond: number; p95TokensPerSecond: number;
  avgResponseTime: number; p50ResponseTime: number; p95ResponseTime: number; p99ResponseTime: number;
  totalPromptTokens: number; totalCompletionTokens: number; totalTokens: number;
  avgPromptTokens: number; avgCompletionTokens: number;
  modelLatencyByModel: { model: string; avgLatency: number; count: number }[];
  errorRateByModel: { model: string; errorRate: number; totalRequests: number }[];
  totalCost: number; avgCostPerRequest: number;
  costByModel: { model: string; totalCost: number; count: number }[];
  avgConcurrentRequests: number; maxConcurrentRequests: number;
  avgQueueWait: number; p95QueueWait: number;
  cacheHitRate: number; totalCacheHits: number; totalCacheMisses: number;
}

// ── Time range map ────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS = [
  { value: '1', label: '1h' },
  { value: '6', label: '6h' },
  { value: '24', label: '24h' },
  { value: '168', label: '7d' },
  { value: '720', label: '30d' },
];

// ── Helpers ───────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmtMs = (n: number) => `${n.toFixed(0)}ms`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── Custom Recharts tooltip ───────────────────────────────────────────

const ChartTooltipContent: React.FC<{ active?: boolean; payload?: any[]; label?: string; valueFormatter?: (v: number) => string }> = ({
  active, payload, label, valueFormatter = String,
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--color-surfaceSecondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{valueFormatter(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Section Header ────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; tooltip?: string; extra?: React.ReactNode }> = ({ icon, title, tooltip, extra }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tooltip && <InfoTooltip content={tooltip} />}
    {extra && <div className="ml-auto">{extra}</div>}
  </div>
);

// ── Percentile gauge row ──────────────────────────────────────────────

const PercentileRow: React.FC<{
  label: string; avg: number; p50: number; p95: number; p99?: number;
  unit?: string; goodBelow?: number;
}> = ({ label, avg, p50, p95, p99, unit = 'ms', goodBelow }) => {
  const color = (v: number) => {
    if (goodBelow && v <= goodBelow) return 'var(--color-success)';
    if (goodBelow && v <= goodBelow * 2) return 'var(--color-warning)';
    return 'var(--color-error)';
  };
  const vals = [
    { label: 'Avg', value: avg },
    { label: 'P50', value: p50 },
    { label: 'P95', value: p95 },
    ...(p99 !== undefined ? [{ label: 'P99', value: p99 }] : []),
  ];
  return (
    <div className="mb-3">
      <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${vals.length}, 1fr)` }}>
        {vals.map((v) => (
          <div key={v.label} className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
            <div className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{v.label}</div>
            <div className="text-lg font-bold" style={{ color: goodBelow ? color(v.value) : 'var(--text-primary)' }}>
              {v.value}{unit}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════

const LLMPerformanceMetrics: React.FC<LLMPerformanceMetricsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [modelBreakdown, setModelBreakdown] = useState<ModelBreakdown[]>([]);
  const [userMetrics, setUserMetrics] = useState<UserMetrics[]>([]);
  const [toolMetrics, setToolMetrics] = useState<ToolMetrics[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [providerMetrics, setProviderMetrics] = useState<ProviderMetrics[]>([]);
  const [providerTotalCost, setProviderTotalCost] = useState('0.000000');
  const [performanceKPIs, setPerformanceKPIs] = useState<PerformanceKPIs | null>(null);
  const [performanceTrends, setPerformanceTrends] = useState<PerformanceTrendPoint[]>([]);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const [overviewRes, usersRes, toolsRes, trendsRes, providersRes, performanceRes, perfTrendsRes] = await Promise.all([
        apiRequest(`/admin/metrics/llm/overview?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/users?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/tools?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/trends?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/providers?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/performance?hours=${timeRange}`),
        apiRequest(`/admin/metrics/llm/performance-trends?hours=${timeRange}`),
      ]);

      if (overviewRes.ok) { const d = await overviewRes.json(); setOverview(d.overview); setModelBreakdown(d.modelBreakdown || []); }
      if (usersRes.ok) { const d = await usersRes.json(); setUserMetrics(d.users || []); }
      if (toolsRes.ok) { const d = await toolsRes.json(); setToolMetrics(d.tools || []); }
      if (trendsRes.ok) { const d = await trendsRes.json(); setTrends(d.trends || []); }
      if (providersRes.ok) { const d = await providersRes.json(); setProviderMetrics(d.providers || []); setProviderTotalCost(d.totalCost || '0.000000'); }
      if (performanceRes.ok) { const d = await performanceRes.json(); setPerformanceKPIs(d.kpis || null); }
      if (perfTrendsRes.ok) { const d = await perfTrendsRes.json(); setPerformanceTrends(d.trends || []); }
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Failed to fetch LLM metrics:', e);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchMetrics]);

  // Format trend timestamps for chart labels
  const chartTrends = trends.map((t) => ({
    ...t,
    time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  // Format performance trend timestamps
  const chartPerfTrends = performanceTrends.map((t) => ({
    ...t,
    time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));

  // Filter tool / user metrics by search
  const filteredTools = toolMetrics.filter(
    (t) => !searchTerm || t.toolName.toLowerCase().includes(searchTerm.toLowerCase()) || t.serverName.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const filteredUsers = userMetrics.filter(
    (u) => !searchTerm || u.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // ── Loading state ─────────────────────────────────────────────────

  if (loading && !overview) {
    return (
      <div className="space-y-5">
        <PageHeader
          crumbs={['Admin', 'LLM', 'Performance']}
          title="LLM Performance"
          explainer="Real-time latency, throughput, cost, and tool analytics across providers and models. Auto-refreshes every 30 seconds."
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'LLM', 'Performance']}
        title="LLM Performance"
        explainer="Real-time latency, throughput, cost, and tool analytics across providers and models. Auto-refreshes every 30 seconds."
        actions={[
          { label: 'Refresh', onClick: fetchMetrics },
        ]}
      />

      {/* ── Header + Filter Bar ────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Updated {lastUpdated.toLocaleTimeString()} {autoRefresh && '(auto-refresh 30s)'}
          </p>
        </div>
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          timeRangeOptions={TIME_RANGE_OPTIONS}
          onRefresh={fetchMetrics}
          refreshing={loading}
          extraFilters={
            <AdminTooltip content={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  border: `1px solid ${autoRefresh ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  backgroundColor: autoRefresh ? 'color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'var(--color-surface)',
                  color: autoRefresh ? 'var(--color-primary)' : 'var(--text-secondary)',
                }}
              >
                <RefreshCw size={14} />
              </button>
            </AdminTooltip>
          }
        />
      </div>

      {/* ── Router Health (Prometheus telemetry) ─────────────── */}
      <RouterHealthSection />

      {/* ── Top-level KPI Cards ────────────────────────────────── */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <AdminMetricCard
            label="Total Queries"
            value={fmt(overview.totalQueries)}
            subtext={`${overview.uniqueUsers} unique users`}
            icon={<Activity size={18} />}
            tooltip={TIPS.totalQueries}
            sparklineData={chartTrends.map((t) => t.queries)}
          />
          <AdminMetricCard
            label="Total Tokens"
            value={fmt(performanceKPIs?.totalTokens ?? overview.totalTokens)}
            subtext={`${fmt(performanceKPIs?.totalPromptTokens ?? overview.totalPromptTokens)} in / ${fmt(performanceKPIs?.totalCompletionTokens ?? overview.totalCompletionTokens)} out`}
            icon={<Zap size={18} />}
            tooltip={TIPS.totalTokens}
            sparklineData={chartTrends.map((t) => t.tokens)}
          />
          <AdminMetricCard
            label="Total Cost"
            value={fmtUsd(performanceKPIs?.totalCost ?? overview.totalCost)}
            subtext={`${fmtMs(performanceKPIs?.avgResponseTime ?? overview.avgResponseTime)} avg response`}
            icon={<DollarSign size={18} />}
            tooltip={TIPS.estimatedCost}
            sparklineData={chartTrends.map((t) => t.cost)}
          />
          <AdminMetricCard
            label="MCP Tool Calls"
            value={fmt(overview.toolCalls)}
            subtext={`${overview.successRate}% success rate`}
            icon={<CheckCircle size={18} />}
            tooltip={TIPS.mcpToolCalls}
            sparklineData={chartTrends.map((t) => t.toolCalls)}
          />
        </div>
      )}

      {/* ── Trend Charts (2-col) ───────────────────────────────── */}
      {chartTrends.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Queries over time */}
          <AdminCard>
            <SectionHeader icon={<Activity size={16} />} title="Requests Over Time" tooltip="Query volume trend across the selected window" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="queryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-accent)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--ap-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => fmt(v)} />} />
                  <Area type="monotone" dataKey="queries" name="Queries" stroke="var(--ap-accent)" fill="url(#queryGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Cost over time */}
          <AdminCard>
            <SectionHeader icon={<DollarSign size={16} />} title="Cost Over Time" tooltip="Cumulative LLM cost trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-ok)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--ap-ok)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `$${v}`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtUsd} />} />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="var(--ap-ok)" fill="url(#costGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Tokens over time */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Token Usage Over Time" tooltip="Token consumption trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-warn)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--ap-warn)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={fmt} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmt} />} />
                  <Area type="monotone" dataKey="tokens" name="Tokens" stroke="var(--ap-warn)" fill="url(#tokenGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Tool calls over time */}
          <AdminCard>
            <SectionHeader icon={<CheckCircle size={16} />} title="Tool Calls Over Time" tooltip="MCP tool invocation trend" />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartTrends}>
                  <defs>
                    <linearGradient id="toolGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-info)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--ap-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmt} />} />
                  <Area type="monotone" dataKey="toolCalls" name="Tool Calls" stroke="var(--ap-info)" fill="url(#toolGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Provider Health Grid ───────────────────────────────── */}
      {providerMetrics.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<Activity size={16} />} title="Provider Health" tooltip="Real-time status of each LLM provider based on success rates" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {providerMetrics.map((p) => {
              const pct = parseFloat(p.successRate) || 0;
              const status = pct >= 99 ? 'Healthy' : pct >= 95 ? 'Degraded' : 'Unhealthy';
              return (
                <div
                  key={p.provider}
                  className="rounded-lg p-3 flex flex-col gap-1.5"
                  style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                      {p.provider.replace(/-/g, ' ')}
                    </span>
                    <AdminStatusBadge status={status.toLowerCase()} size="sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Requests</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(p.totalRequests)}</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Latency</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{p.avgLatencyMs}ms</div>
                    </div>
                    <div>
                      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cost</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>${p.totalCost}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </AdminCard>
      )}

      {/* ── Performance KPIs ───────────────────────────────────── */}
      {performanceKPIs && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* TTFT + Response Time */}
          <AdminCard>
            <SectionHeader icon={<Clock size={16} />} title="Latency Percentiles" tooltip={TIPS.ttft} />
            <PercentileRow label="Time to First Token" avg={performanceKPIs.avgTTFT} p50={performanceKPIs.p50TTFT} p95={performanceKPIs.p95TTFT} p99={performanceKPIs.p99TTFT} goodBelow={500} />
            <PercentileRow label="Total Response Time" avg={performanceKPIs.avgResponseTime} p50={performanceKPIs.p50ResponseTime} p95={performanceKPIs.p95ResponseTime} p99={performanceKPIs.p99ResponseTime} goodBelow={3000} />
          </AdminCard>

          {/* Throughput + Concurrency */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Throughput & Concurrency" tooltip={TIPS.tokensPerSec} />
            <PercentileRow label="Output Speed (tok/s)" avg={performanceKPIs.avgTokensPerSecond} p50={performanceKPIs.p50TokensPerSecond} p95={performanceKPIs.p95TokensPerSecond} unit=" tok/s" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Avg Concurrent</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.avgConcurrentRequests}</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max Concurrent</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.maxConcurrentRequests}</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Avg Queue Wait</div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{performanceKPIs.avgQueueWait}ms</div>
              </div>
              <div className="rounded-md p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cache Hit Rate</div>
                <div className="text-lg font-bold" style={{ color: performanceKPIs.cacheHitRate >= 50 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                  {fmtPct(performanceKPIs.cacheHitRate)}
                </div>
              </div>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Performance Trend Charts ────────────────────────────── */}
      {chartPerfTrends.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* TTFT Trend */}
          <AdminCard>
            <SectionHeader icon={<Clock size={16} />} title="TTFT Over Time" tooltip="Time to First Token trend — avg and P95 per time bucket. Lower is better for perceived responsiveness." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms`} />} />
                  <Line type="monotone" dataKey="avgTTFT" name="Avg TTFT" stroke="var(--ap-accent)" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95TTFT" name="P95 TTFT" stroke="var(--ap-err)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                  <Line type="monotone" dataKey="p99TTFT" name="P99 TTFT" stroke="var(--ap-warn)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Token Throughput Trend */}
          <AdminCard>
            <SectionHeader icon={<Zap size={16} />} title="Token Throughput Over Time" tooltip="Output generation speed (tokens/second) — avg and P95 per time bucket. Higher is better." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} tok/s`} />} />
                  <Line type="monotone" dataKey="avgTokensPerSecond" name="Avg tok/s" stroke="var(--ap-ok)" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95TokensPerSecond" name="P95 tok/s" stroke="var(--ap-info)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Latency Breakdown */}
          <AdminCard>
            <SectionHeader icon={<Activity size={16} />} title="Latency Breakdown" tooltip="Input processing time (time to first token) vs total end-to-end latency. The gap represents output generation time." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartPerfTrends}>
                  <defs>
                    <linearGradient id="totalLatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-accent)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--ap-accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="inputLatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--ap-warn)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--ap-warn)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms`} />} />
                  <Area type="monotone" dataKey="avgTotalLatency" name="Total Latency" stroke="var(--ap-accent)" fill="url(#totalLatGrad)" strokeWidth={2} connectNulls />
                  <Area type="monotone" dataKey="avgTTFT" name="Input Processing (TTFT)" stroke="var(--ap-warn)" fill="url(#inputLatGrad)" strokeWidth={2} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Streaming Performance */}
          <AdminCard>
            <SectionHeader icon={<TrendingUp size={16} />} title="Streaming Chunk Latency" tooltip="Average time between streamed output chunks (ms per token). Lower means smoother streaming experience." />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPerfTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v}ms/tok`} />} />
                  <Line type="monotone" dataKey="avgChunkLatency" name="Avg Chunk Latency" stroke="var(--ap-accent)" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="p95ChunkLatency" name="P95 Chunk Latency" stroke="var(--ap-accent)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>
        </div>
      )}

      {/* ── Model Comparison Charts ────────────────────────────── */}
      {modelBreakdown.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Model cost bar chart */}
          <AdminCard>
            <SectionHeader icon={<DollarSign size={16} />} title="Cost by Model" tooltip={TIPS.modelUsage} />
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelBreakdown.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={75} />
                  <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtUsd} />} />
                  <Bar dataKey="cost" name="Cost" radius={[0, 4, 4, 0]}>
                    {modelBreakdown.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </AdminCard>

          {/* Model latency bar chart */}
          {performanceKPIs && performanceKPIs.modelLatencyByModel.length > 0 && (
            <AdminCard>
              <SectionHeader icon={<Clock size={16} />} title="Latency by Model" tooltip={TIPS.modelLatency} />
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performanceKPIs.modelLatencyByModel.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }} tickFormatter={(v) => `${v}ms`} />
                    <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} width={75} />
                    <RechartsTooltip content={<ChartTooltipContent valueFormatter={fmtMs} />} />
                    <Bar dataKey="avgLatency" name="Avg Latency" radius={[0, 4, 4, 0]}>
                      {performanceKPIs.modelLatencyByModel.slice(0, 8).map((m, i) => (
                        <Cell key={i} fill={m.avgLatency > 3000 ? 'var(--ap-err)' : m.avgLatency > 1000 ? 'var(--ap-warn)' : 'var(--ap-ok)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* ── Error Rate by Model ────────────────────────────────── */}
      {performanceKPIs && performanceKPIs.errorRateByModel.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<XCircle size={16} />} title="Error Rates by Model" tooltip={TIPS.errorRate} />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {performanceKPIs.errorRateByModel.map((m) => {
              const status = m.errorRate < 1 ? 'healthy' : m.errorRate < 5 ? 'degraded' : 'unhealthy';
              return (
                <div key={m.model} className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)' }}>
                  <div className="text-xs font-medium truncate mb-1" style={{ color: 'var(--text-secondary)' }}>{m.model}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold" style={{ color: m.errorRate < 1 ? 'var(--color-success)' : m.errorRate < 5 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                      {fmtPct(m.errorRate)}
                    </span>
                    <AdminStatusBadge status={status} size="sm" showDot={false} />
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{fmt(m.totalRequests)} requests</div>
                </div>
              );
            })}
          </div>
        </AdminCard>
      )}

      {/* ── Provider Cost Table ─────────────────────────────────── */}
      {providerMetrics.length > 0 && (
        <AdminCard>
          <SectionHeader
            icon={<DollarSign size={16} />}
            title="Provider Cost Breakdown"
            tooltip={TIPS.providerCost}
            extra={<span className="text-sm font-semibold" style={{ color: 'var(--color-success)' }}>Total: ${providerTotalCost}</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">Provider</th>
                  <th className="text-right pb-2 font-medium">Requests</th>
                  <th className="text-right pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">Success <InfoTooltip content="Percentage of non-error responses" size={12} /></span>
                  </th>
                  <th className="text-right pb-2 font-medium">Prompt Tok</th>
                  <th className="text-right pb-2 font-medium">Completion Tok</th>
                  <th className="text-right pb-2 font-medium">Latency</th>
                  <th className="text-right pb-2 font-medium">Tok/s</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {providerMetrics.map((p) => {
                  const pct = parseFloat(p.successRate) || 0;
                  return (
                    <tr key={p.provider} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                      <td className="py-2.5 font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{p.provider.replace(/-/g, ' ')}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.totalRequests)}</td>
                      <td className="py-2.5 text-right">
                        <span style={{ color: pct >= 95 ? 'var(--color-success)' : pct >= 80 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                          {p.successRate}%
                        </span>
                      </td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.promptTokens)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(p.completionTokens)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{p.avgLatencyMs}ms</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{p.avgTokensPerSecond}</td>
                      <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--color-success)' }}>${p.totalCost}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* ── Top Users by Cost ──────────────────────────────────── */}
      {filteredUsers.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<Users size={16} />} title="Top Users by Cost" tooltip={TIPS.userCost} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">User</th>
                  <th className="text-right pb-2 font-medium">Queries</th>
                  <th className="text-right pb-2 font-medium">Tokens</th>
                  <th className="text-right pb-2 font-medium">Tool Calls</th>
                  <th className="text-right pb-2 font-medium">Avg Response</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.slice(0, 10).map((u) => (
                  <tr key={u.userId} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                    <td className="py-2.5 font-medium" style={{ color: 'var(--text-primary)' }}>{u.email}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.totalQueries)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.totalTokens)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(u.toolCalls)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-primary)' }}>{u.avgResponseTime}ms</td>
                    <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--color-success)' }}>{fmtUsd(u.estimatedCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {/* ── MCP Tool Stats ─────────────────────────────────────── */}
      {filteredTools.length > 0 && (
        <AdminCard>
          <SectionHeader icon={<CheckCircle size={16} />} title="MCP Tool Statistics" tooltip={TIPS.toolStats} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left pb-2 font-medium">Tool</th>
                  <th className="text-left pb-2 font-medium">Server</th>
                  <th className="text-right pb-2 font-medium">Calls</th>
                  <th className="text-right pb-2 font-medium">Success</th>
                  <th className="text-right pb-2 font-medium">Avg Time</th>
                  <th className="text-right pb-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredTools.slice(0, 15).map((t) => {
                  const sr = t.successRate ?? 0;
                  return (
                    <tr key={t.toolName} style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-border) 50%, transparent)' }}>
                      <td className="py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{t.toolName}</td>
                      <td className="py-2" style={{ color: 'var(--text-secondary)' }}>{t.serverName}</td>
                      <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{fmt(t.totalCalls)}</td>
                      <td className="py-2 text-right">
                        <span style={{ color: sr >= 95 ? 'var(--color-success)' : sr >= 80 ? 'var(--color-warning)' : 'var(--color-error)' }}>
                          {fmtPct(sr)}
                        </span>
                      </td>
                      <td className="py-2 text-right" style={{ color: 'var(--text-primary)' }}>{t.avgExecutionTime}ms</td>
                      <td className="py-2 text-right" style={{ color: 'var(--color-success)' }}>{fmtUsd(t.estimatedCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </div>
  );
};

export default LLMPerformanceMetrics;
