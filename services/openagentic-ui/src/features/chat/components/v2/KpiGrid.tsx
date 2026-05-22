import React from 'react';

/**
 * KpiGrid — responsive grid of KPI tiles (#502).
 *
 * Used in mocks 02 (k8s-health-report), 04 (multi-region-DR), 06 (merger).
 * Reference DOM: `art-metric-row` blocks in
 * mocks/UX/02-kubernetes-health-report.html (line 927-).
 *
 * Inline styles only — parallel-agent rebuild forbids shared stylesheets
 * (collisions). All tokens defined in KPI_GRID_STYLES below.
 */

export interface KpiTile {
  /** Tile title (e.g. "Cluster CPU"). */
  title: string;
  /** Primary big-number value (e.g. "73%", "42 nodes"). */
  value: string;
  /** Optional delta line (e.g. "+12% vs 1h ago"). Tone-colored. */
  delta?: string;
  /** Delta tone: "g" up-good, "r" up-bad, "n" neutral. */
  deltaTone?: 'g' | 'r' | 'n';
  /** Optional severity: "ok" | "warn" | "err" — applies left-border accent. */
  severity?: 'ok' | 'warn' | 'err';
}

export interface KpiGridProps {
  tiles: KpiTile[];
  /** Min column width before wrapping. Default 180px. */
  minColumnWidth?: number;
  className?: string;
}

const SEVERITY_COLORS: Record<NonNullable<KpiTile['severity']>, string> = {
  ok: '#22c55e',
  warn: '#f59e0b',
  err: '#ef4444',
};

const TONE_COLORS: Record<NonNullable<KpiTile['deltaTone']>, string> = {
  g: '#22c55e',
  r: '#ef4444',
  n: 'var(--fg-2, #a1a1aa)',
};

const KPI_GRID_STYLES = {
  grid: (minCol: number): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${minCol}px, 1fr))`,
    gap: '12px',
  }),
  tile: (severity?: KpiTile['severity']): React.CSSProperties => ({
    background: 'var(--bg-2, #16181c)',
    border: '1px solid var(--line-2, rgba(255,255,255,0.10))',
    padding: '14px 16px',
    borderRadius: '10px',
    ...(severity
      ? {
          borderLeftWidth: '4px',
          borderLeftStyle: 'solid' as const,
          borderLeftColor: SEVERITY_COLORS[severity],
        }
      : null),
  }),
  title: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: 'var(--fg-3, #71717a)',
  },
  value: {
    fontSize: '24px',
    fontWeight: 600,
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontVariantNumeric: 'tabular-nums' as const,
    color: 'var(--fg-0, #f8fafc)',
    marginTop: '4px',
  },
  delta: (tone: NonNullable<KpiTile['deltaTone']>): React.CSSProperties => ({
    fontSize: '12px',
    marginTop: '6px',
    color: TONE_COLORS[tone],
  }),
};

export function KpiGrid({
  tiles,
  minColumnWidth = 180,
  className,
}: KpiGridProps): JSX.Element {
  const rootClass = ['cm-kpi-grid', className].filter(Boolean).join(' ');
  return (
    <div
      className={rootClass}
      style={KPI_GRID_STYLES.grid(minColumnWidth)}
      data-testid="kpi-grid"
    >
      {tiles.map((tile, idx) => {
        const tileClass = ['cm-kpi-tile', tile.severity ? `cm-kpi-sev-${tile.severity}` : '']
          .filter(Boolean)
          .join(' ');
        const tone = tile.deltaTone ?? 'n';
        return (
          <div key={idx} className={tileClass} style={KPI_GRID_STYLES.tile(tile.severity)}>
            <div className="cm-kpi-title" style={KPI_GRID_STYLES.title}>
              {tile.title}
            </div>
            <div className="cm-kpi-value" style={KPI_GRID_STYLES.value}>
              {tile.value}
            </div>
            {tile.delta ? (
              <div
                className={`cm-kpi-delta cm-kpi-tone-${tone}`}
                style={KPI_GRID_STYLES.delta(tone)}
              >
                {tile.delta}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
