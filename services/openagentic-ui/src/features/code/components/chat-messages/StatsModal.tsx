/**
 * StatsModal — rich session statistics dashboard matching openagentic's
 * TUI /stats command. Two tabs:
 *   Overview: token usage sparkline chart, session metrics, activity
 *   Models: per-model token breakdown with SVG bar chart
 *
 * Uses SVG for charts (better than TUI's ASCII art since we have a
 * real browser). Data from useCodeModeChat + sessionMeta + per-turn
 * accumulation from the messages array.
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useMemo, useState } from 'react';
import type { ChatMessage, AssistantChatMessage } from '../../types/streamJson';

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

interface StatsModalProps {
  model: string;
  permissionMode: string;
  sessionId: string;
  contextTokens: number | undefined;
  contextLimit: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  lastTurnMs: number | undefined;
  version: string;
  toolCount: number;
  mcpCount: number;
  messages: ChatMessage[];
  onClose: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

interface TurnData {
  index: number;
  textTokens: number;
  thinkingTokens: number;
  toolCalls: number;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export const StatsModal: React.FC<StatsModalProps> = ({
  model,
  permissionMode,
  sessionId,
  contextTokens,
  contextLimit,
  totalOutputTokens,
  totalCostUsd,
  lastTurnMs,
  version,
  toolCount,
  mcpCount,
  messages,
  onClose,
}) => {
  const [tab, setTab] = useState<'overview' | 'models'>('overview');

  const turnData = useMemo((): TurnData[] => {
    const assistantMsgs = messages.filter(
      (m): m is AssistantChatMessage => m.role === 'assistant',
    );
    return assistantMsgs.map((m, i) => {
      const textChars = m.blocks
        .filter((b) => b.kind === 'text')
        .reduce((s, b) => s + ((b as any).text?.length ?? 0), 0);
      const thinkChars = m.blocks
        .filter((b) => b.kind === 'thinking')
        .reduce((s, b) => s + ((b as any).thinking?.length ?? 0), 0);
      const tools = m.blocks.filter((b) => b.kind === 'tool_use').length;
      return {
        index: i + 1,
        textTokens: Math.round(textChars / 4),
        thinkingTokens: Math.round(thinkChars / 4),
        toolCalls: tools,
        timestamp: m.createdAt,
        model: m.turnModel ?? model ?? 'unknown',
        inputTokens: m.usage?.inputTokens ?? 0,
        outputTokens: m.usage?.outputTokens ?? 0,
      };
    });
  }, [messages]);

  const totals = useMemo(() => {
    const turns = turnData.length;
    const textTok = turnData.reduce((s, t) => s + t.textTokens, 0);
    const thinkTok = turnData.reduce((s, t) => s + t.thinkingTokens, 0);
    const tools = turnData.reduce((s, t) => s + t.toolCalls, 0);
    return { turns, textTok, thinkTok, tools };
  }, [turnData]);

  const contextPct =
    contextTokens != null ? Math.min(100, (contextTokens / contextLimit) * 100) : 0;
  const contextColor = contextPct < 50 ? SUCCESS : contextPct < 80 ? WARNING : ERROR;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
        fontFamily: MONO,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          setTab((t) => (t === 'overview' ? 'models' : 'overview'));
        }
      }}
    >
      <div
        style={{
          maxWidth: 580,
          width: '100%',
          maxHeight: '85vh',
          backgroundColor: BG,
          color: TEXT,
          border: `1px solid ${ACCENT}`,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
          {(['overview', 'models'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: tab === t ? BG_DEEP : 'transparent',
                border: 'none',
                borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
                color: tab === t ? ACCENT : DIM,
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {tab === 'overview' ? (
            <OverviewTab
              turnData={turnData}
              totals={totals}
              model={model}
              permissionMode={permissionMode}
              sessionId={sessionId}
              contextTokens={contextTokens}
              contextLimit={contextLimit}
              contextPct={contextPct}
              contextColor={contextColor}
              totalOutputTokens={totalOutputTokens}
              totalCostUsd={totalCostUsd}
              lastTurnMs={lastTurnMs}
              version={version}
              toolCount={toolCount}
              mcpCount={mcpCount}
            />
          ) : (
            <ModelsTab
              turnData={turnData}
              totals={totals}
              model={model}
              totalOutputTokens={totalOutputTokens}
              totalCostUsd={totalCostUsd}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${BORDER}`,
            fontSize: 11,
            color: DIM,
          }}
        >
          tab to switch · esc to close
        </div>
      </div>
    </div>
  );
};

// ── SVG Sparkline Chart ──────────────────────────────────────────────

const SparklineChart: React.FC<{
  data: Array<{ label: string; values: number[]; color: string }>;
  width?: number;
  height?: number;
}> = ({ data, width = 500, height = 120 }) => {
  if (data.length === 0 || data[0].values.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: DIM, fontSize: 11 }}>
        send a message to see chart data
      </div>
    );
  }

  const maxLen = Math.max(...data.map((d) => d.values.length));
  const allVals = data.flatMap((d) => d.values);
  const maxVal = Math.max(...allVals, 1);
  const pad = { top: 8, right: 12, bottom: 24, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const xScale = (i: number) => pad.left + (i / Math.max(maxLen - 1, 1)) * chartW;
  const yScale = (v: number) => pad.top + chartH - (v / maxVal) * chartH;

  // Y-axis labels
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {/* Grid lines */}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.left} y1={yScale(v)} x2={width - pad.right} y2={yScale(v)} stroke={BORDER} strokeWidth={0.5} />
          <text x={pad.left - 6} y={yScale(v) + 3} textAnchor="end" fontSize={9} fill={DIM} fontFamily={MONO}>
            {formatTokens(v)}
          </text>
        </g>
      ))}

      {/* Lines */}
      {data.map((series) => {
        const points = series.values.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ');
        const areaPoints = [
          ...series.values.map((v, i) => `${xScale(i)},${yScale(v)}`),
          `${xScale(series.values.length - 1)},${yScale(0)}`,
          `${xScale(0)},${yScale(0)}`,
        ].join(' ');
        return (
          <g key={series.label}>
            <polygon points={areaPoints} fill={series.color} opacity={0.08} />
            <polyline points={points} fill="none" stroke={series.color} strokeWidth={1.5} strokeLinejoin="round" />
            {series.values.map((v, i) => (
              <circle key={i} cx={xScale(i)} cy={yScale(v)} r={2.5} fill={series.color} />
            ))}
          </g>
        );
      })}

      {/* X-axis labels (turn numbers) */}
      {Array.from({ length: Math.min(maxLen, 8) }, (_, i) => {
        const idx = maxLen <= 8 ? i : Math.round((i / 7) * (maxLen - 1));
        return (
          <text key={idx} x={xScale(idx)} y={height - 4} textAnchor="middle" fontSize={9} fill={DIM} fontFamily={MONO}>
            T{idx + 1}
          </text>
        );
      })}
    </svg>
  );
};

// ── Overview Tab ─────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  turnData: TurnData[];
  totals: { turns: number; textTok: number; thinkTok: number; tools: number };
  model: string;
  permissionMode: string;
  sessionId: string;
  contextTokens: number | undefined;
  contextLimit: number;
  contextPct: number;
  contextColor: string;
  totalOutputTokens: number;
  totalCostUsd: number;
  lastTurnMs: number | undefined;
  version: string;
  toolCount: number;
  mcpCount: number;
}> = (p) => {
  const chartData = useMemo(() => {
    if (p.turnData.length === 0) return [];
    return [
      { label: 'Text', values: p.turnData.map((t) => t.textTokens), color: ACCENT },
      { label: 'Thinking', values: p.turnData.map((t) => t.thinkingTokens), color: PURPLE },
      { label: 'Tool calls', values: p.turnData.map((t) => t.toolCalls * 50), color: SUCCESS },
    ];
  }, [p.turnData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Token usage chart */}
      <div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Tokens per Turn</div>
        <div
          style={{
            backgroundColor: BG_DEEP,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: '8px 4px',
            overflow: 'hidden',
          }}
        >
          <SparklineChart data={chartData} width={520} height={130} />
        </div>
        {chartData.length > 0 && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10, color: DIM }}>
            {chartData.map((s) => (
              <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color, display: 'inline-block' }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Context gauge */}
      <div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 4 }}>Context Window</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: BORDER, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${p.contextPct}%`, backgroundColor: p.contextColor, borderRadius: 5, transition: 'width 300ms' }} />
          </div>
          <span style={{ fontSize: 12, color: p.contextColor, minWidth: '10ch', textAlign: 'right' }}>
            {p.contextTokens != null ? `${formatTokens(p.contextTokens)}/${formatTokens(p.contextLimit)}` : '—'}
          </span>
        </div>
      </div>

      {/* Metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <MetricCard label="Model" value={p.model || '(default)'} color={ACCENT} />
        <MetricCard label="Turns" value={String(p.totals.turns)} color={ACCENT} />
        <MetricCard label="Tool Calls" value={String(p.totals.tools)} color={SUCCESS} />
        <MetricCard label="Output Tokens" value={formatTokens(p.totalOutputTokens)} color={ACCENT} />
        <MetricCard label="Cost" value={p.totalCostUsd > 0 ? `$${p.totalCostUsd.toFixed(4)}` : '—'} color={WARNING} />
        <MetricCard label="Last Turn" value={typeof p.lastTurnMs === 'number' ? formatDuration(p.lastTurnMs) : '—'} color={TEXT} />
      </div>

      {/* Session info */}
      <div style={{ fontSize: 11, color: DIM, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span>
          session <span style={{ color: ACCENT }}>{p.sessionId?.slice(0, 12)}</span> · {p.permissionMode} ·{' '}
          openagentic <span style={{ color: TEXT }}>{p.version}</span>
        </span>
        <span>
          tools: <span style={{ color: TEXT }}>{p.toolCount}</span> · mcp: <span style={{ color: TEXT }}>{p.mcpCount}</span>
        </span>
      </div>
    </div>
  );
};

// ── Models Tab ───────────────────────────────────────────────────────

const MODEL_COLORS = [ACCENT, SUCCESS, PURPLE, WARNING, ERROR, '#8be9fd', '#ff79c6', '#f1fa8c'];

const ModelsTab: React.FC<{
  turnData: TurnData[];
  totals: { turns: number; textTok: number; thinkTok: number; tools: number };
  model: string;
  totalOutputTokens: number;
  totalCostUsd: number;
}> = ({ turnData, totals, model, totalOutputTokens, totalCostUsd }) => {
  // Group turns by model and build per-model token-per-turn chart
  const { modelSeries, modelTotals } = useMemo(() => {
    const modelMap = new Map<string, { input: number[]; output: number[] }>();
    for (const t of turnData) {
      const m = t.model;
      if (!modelMap.has(m)) modelMap.set(m, { input: [], output: [] });
      const entry = modelMap.get(m)!;
      entry.input.push(t.inputTokens);
      entry.output.push(t.outputTokens);
    }

    const models = Array.from(modelMap.keys());
    const series = models.map((m, i) => ({
      label: m,
      values: modelMap.get(m)!.output,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
    }));

    const modelTotals = models.map((m, i) => {
      const d = modelMap.get(m)!;
      const inp = d.input.reduce((a, b) => a + b, 0);
      const out = d.output.reduce((a, b) => a + b, 0);
      return {
        name: m,
        inputTokens: inp,
        outputTokens: out,
        turns: d.output.length,
        color: MODEL_COLORS[i % MODEL_COLORS.length],
      };
    });

    return { modelSeries: series, modelTotals };
  }, [turnData]);

  // Also build a unified per-turn chart (all models stacked as separate lines)
  const perTurnByModel = useMemo(() => {
    if (turnData.length === 0) return [];
    const models = [...new Set(turnData.map((t) => t.model))];
    return models.map((m, i) => ({
      label: m,
      values: turnData.map((t) => (t.model === m ? t.outputTokens : 0)),
      color: MODEL_COLORS[i % MODEL_COLORS.length],
    }));
  }, [turnData]);

  const totalAllModels = modelTotals.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Tokens per turn by model chart */}
      <div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 6 }}>Tokens per Turn by Model</div>
        <div
          style={{
            backgroundColor: BG_DEEP,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: '8px 4px',
            overflow: 'hidden',
          }}
        >
          <SparklineChart data={perTurnByModel} width={520} height={130} />
        </div>
        {perTurnByModel.length > 0 && (
          <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10, color: DIM, flexWrap: 'wrap' }}>
            {perTurnByModel.map((s) => (
              <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color, display: 'inline-block' }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-model breakdown */}
      <div>
        <div style={{ fontSize: 11, color: DIM, marginBottom: 8 }}>Model Usage</div>
        {modelTotals.map((m) => {
          const total = m.inputTokens + m.outputTokens;
          const pct = (total / totalAllModels) * 100;
          return (
            <div
              key={m.name}
              style={{
                marginBottom: 10,
                padding: '8px 10px',
                backgroundColor: BG_DEEP,
                border: `1px solid ${BORDER}`,
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ color: m.color, fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                <span style={{ fontSize: 11, color: DIM }}>{m.turns} turn{m.turns !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, marginBottom: 6 }}>
                <span>
                  <span style={{ color: DIM }}>in: </span>
                  <span style={{ color: TEXT }}>{formatTokens(m.inputTokens)}</span>
                </span>
                <span>
                  <span style={{ color: DIM }}>out: </span>
                  <span style={{ color: TEXT }}>{formatTokens(m.outputTokens)}</span>
                </span>
                <span style={{ color: DIM }}>{pct.toFixed(0)}% of total</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: BORDER, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: m.color, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MetricCard label="Total Output" value={formatTokens(totalOutputTokens)} color={ACCENT} />
        <MetricCard label="Session Cost" value={totalCostUsd > 0 ? `$${totalCostUsd.toFixed(4)}` : '—'} color={WARNING} />
        <MetricCard label="Models Used" value={String(modelTotals.length)} color={PURPLE} />
        <MetricCard label="Tool Calls" value={String(totals.tools)} color={SUCCESS} />
      </div>
    </div>
  );
};

// ── Metric Card ──────────────────────────────────────────────────────

const MetricCard: React.FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div
    style={{
      padding: '8px 10px',
      backgroundColor: BG_DEEP,
      border: `1px solid ${BORDER}`,
      borderRadius: 4,
    }}
  >
    <div style={{ fontSize: 10, color: DIM, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color }}>{value}</div>
  </div>
);
