import React from 'react';

/**
 * SavingsCard — #502 P0 chatmode UX rebuild.
 *
 * 3-cell KPI tile rendered inline below right-sizing / cost-analysis
 * output so the user sees the headline savings number at a glance.
 *
 * Reference mock: /home/trent/openagentic/agentic/mocks/UX/01-cloud-ops.html
 * lines 1142-1155 (the `.savings-card` block — 3 cells, each with a
 * `.k` label + a `.v.g` big-number value + an optional `<small>` decimal
 * tail). Mock-01 always emits 3 cells (Monthly, Annual, % reduction); we
 * accept 2..4 here for future flexibility (over-budget warnings, fleet
 * splits, etc.).
 *
 * Inline styles (vs chatmode-v2.css) so parallel-agent rebuild does not
 * collide on the shared stylesheet — every visual property is exported
 * via `SAVINGS_CARD_STYLES` so a downstream test or themed wrapper can
 * cherry-pick from the same SoT.
 */

/** Tone tokens — green (savings), red (over-budget), neutral default. */
const TONE_COLOR_G = '#22c55e';
const TONE_COLOR_R = '#ef4444';
const TONE_COLOR_N = 'var(--fg-0, #f8fafc)';

/**
 * Inline style map. Exported so other v2 components / tests can cherry-pick
 * the same tokens (e.g. a derived "BudgetCard" would reuse the same root
 * frame). Per-tone colors live in `valueByTone` so callers don't have to
 * pattern-match strings.
 */
export const SAVINGS_CARD_STYLES = {
  root: {
    display: 'flex',
    gap: '32px',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    padding: '20px 24px',
    margin: '12px 0',
    background: 'var(--bg-2, #16181c)',
    border: '1px solid var(--line-2, rgba(255,255,255,0.10))',
    borderRadius: '10px',
  } satisfies React.CSSProperties,
  cell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: '1 1 0',
    minWidth: 0,
  } satisfies React.CSSProperties,
  label: {
    fontSize: '12px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg-3, #71717a)',
    fontWeight: 500,
  } satisfies React.CSSProperties,
  value: {
    fontSize: '32px',
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
  } satisfies React.CSSProperties,
  suffix: {
    fontSize: '0.6em',
    opacity: 0.7,
    fontWeight: 500,
    marginLeft: '2px',
  } satisfies React.CSSProperties,
  valueByTone: {
    g: { color: TONE_COLOR_G } satisfies React.CSSProperties,
    r: { color: TONE_COLOR_R } satisfies React.CSSProperties,
    n: { color: TONE_COLOR_N } satisfies React.CSSProperties,
  },
} as const;

export interface SavingsCardCell {
  /** Label rendered in `.cm-sc-k` (uppercase tracking-tight). */
  label: string;
  /** Large number string. May contain a small decimal tail (e.g. "$2,847"). */
  value: string;
  /** Optional small/decimal suffix shown after `value` in smaller font (e.g. ".12" or "%"). */
  suffix?: string;
  /** Tone: "g" green (savings), "r" red (over-budget), "n" neutral default. */
  tone?: 'g' | 'r' | 'n';
}

export interface SavingsCardProps {
  /** Always 3 cells in mock 01, but accept 2-4 for future flexibility. */
  cells: SavingsCardCell[];
  /** ARIA label for the card. */
  ariaLabel?: string;
  className?: string;
}

export function SavingsCard({
  cells,
  ariaLabel,
  className,
}: SavingsCardProps): JSX.Element {
  const rootClassName = ['cm-savings-card', className].filter(Boolean).join(' ');

  return (
    <div
      className={rootClassName}
      style={SAVINGS_CARD_STYLES.root}
      role="group"
      aria-label={ariaLabel}
      data-testid="savings-card"
    >
      {cells.map((cell, idx) => {
        const tone: 'g' | 'r' | 'n' = cell.tone ?? 'n';
        const valueClassName = `cm-sc-v cm-sc-tone-${tone}`;
        return (
          <div
            key={`${cell.label}-${idx}`}
            className="cm-sc-cell"
            style={SAVINGS_CARD_STYLES.cell}
          >
            <div className="cm-sc-k" style={SAVINGS_CARD_STYLES.label}>
              {cell.label}
            </div>
            <div
              className={valueClassName}
              style={{
                ...SAVINGS_CARD_STYLES.value,
                ...SAVINGS_CARD_STYLES.valueByTone[tone],
              }}
            >
              {cell.value}
              {cell.suffix && (
                <small style={SAVINGS_CARD_STYLES.suffix}>{cell.suffix}</small>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
