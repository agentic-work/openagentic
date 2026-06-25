/**
 * RiskScoreCardRenderer — compose_app:risk_score_card template.
 *
 * Hero score 0-100 with category breakdown bars and a trend sparkline.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-09-hipaa-storage-audit.html.
 */

import React, { useMemo } from 'react';

export interface RiskCategory {
  name: string;
  score: number;
  weight?: number;
}

export interface RiskScoreCardRendererProps {
  title?: string;
  subtitle?: string;
  score?: number;
  categories?: ReadonlyArray<RiskCategory>;
  trend?: ReadonlyArray<number>;
  trend_label?: string;
}

function scoreTone(s: number): string {
  if (s >= 70) return 'var(--cm-error, currentColor)';
  if (s >= 40) return 'var(--cm-warn, currentColor)';
  return 'var(--cm-success, currentColor)';
}

export function RiskScoreCardRenderer(props: RiskScoreCardRendererProps) {
  const { title, subtitle, score, categories, trend, trend_label = 'last 12 scans' } = props;
  const safeScore = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null;
  const safeCats = Array.isArray(categories) ? categories : [];
  const safeTrend = Array.isArray(trend) && trend.length >= 2 ? trend.map(Number) : [];

  const trendSvg = useMemo(() => {
    if (safeTrend.length < 2) return null;
    const W = 220;
    const H = 56;
    const PAD = 4;
    const max = Math.max(...safeTrend, 1);
    const pts = safeTrend.map((v, i) => {
      const x = PAD + (i / (safeTrend.length - 1)) * (W - PAD * 2);
      const y = H - PAD - (v / max) * (H - PAD * 2);
      return [x, y] as const;
    });
    const polyline = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${PAD},${H - PAD} ${polyline} ${W - PAD},${H - PAD}`;
    const last = safeTrend[safeTrend.length - 1];
    const prev = safeTrend[0];
    const delta = last - prev;
    return { W, H, polyline, area, delta };
  }, [safeTrend]);

  if (safeScore === null && safeCats.length === 0 && safeTrend.length === 0) {
    return (
      <div data-testid="risk-score-card-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no risk data
      </div>
    );
  }

  return (
    <div
      data-testid="risk-score-card-renderer"
      className="cm-risk-score-card"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        color: 'var(--cm-fg)',
      }}
    >
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          display: 'grid',
          gap: 6,
          alignContent: 'start',
        }}
      >
        {title && (
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
        )}
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--cm-fg-dim)' }}>{subtitle}</div>
        )}
        {safeScore !== null && (
          <div data-testid="risk-score-value">
            <span
              style={{
                fontSize: 56,
                fontWeight: 700,
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                lineHeight: 1,
                color: scoreTone(safeScore),
              }}
            >
              {safeScore}
            </span>
            <span style={{ fontSize: 18, color: 'var(--cm-fg-dim)', fontWeight: 500 }}>/100</span>
          </div>
        )}
        {trendSvg && (
          <div style={{ marginTop: 8 }}>
            <svg
              viewBox={`0 0 ${trendSvg.W} ${trendSvg.H}`}
              width={trendSvg.W}
              height={trendSvg.H}
              role="img"
              aria-label={trend_label}
              style={{ display: 'block' }}
            >
              <polygon
                points={trendSvg.area}
                fill="var(--cm-accent, currentColor)"
                fillOpacity={0.18}
              />
              <polyline
                points={trendSvg.polyline}
                fill="none"
                stroke="var(--cm-accent, currentColor)"
                strokeWidth={1.5}
              />
            </svg>
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                display: 'flex',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <span>{trend_label}</span>
              <span
                style={{
                  color:
                    trendSvg.delta < 0
                      ? 'var(--cm-success, currentColor)'
                      : trendSvg.delta > 0
                      ? 'var(--cm-error, currentColor)'
                      : 'var(--cm-fg-dim)',
                }}
              >
                {trendSvg.delta >= 0 ? '+' : ''}
                {trendSvg.delta.toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </div>
      <div
        data-testid="risk-categories"
        style={{
          padding: '16px 18px',
          background: 'var(--cm-bg-2)',
          border: '1px solid var(--cm-border)',
          borderRadius: 'var(--cm-radius, 6px)',
          display: 'grid',
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--cm-fg-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Breakdown
        </div>
        {safeCats.map((c, i) => {
          const v = Math.max(0, Math.min(100, c.score || 0));
          return (
            <div key={`${c.name}-${i}`} data-cat={c.name} style={{ display: 'grid', gap: 4 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  fontSize: 12,
                  color: 'var(--cm-fg)',
                }}
              >
                <span>{c.name}</span>
                <span
                  style={{
                    fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    color: scoreTone(v),
                    fontWeight: 600,
                  }}
                >
                  {v}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: 'var(--cm-bg-3, var(--cm-bg-2))',
                  border: '1px solid var(--cm-border)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${v}%`,
                    height: '100%',
                    background: scoreTone(v),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RiskScoreCardRenderer;
