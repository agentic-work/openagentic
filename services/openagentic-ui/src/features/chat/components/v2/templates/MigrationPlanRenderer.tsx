/**
 * MigrationPlanRenderer — compose_app:migration_plan template.
 *
 * Wave-grouped item list. Each wave: { wave, start?, end?, items[], complete_pct?, blockers[] }.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-10-mssql-migration-plan.html.
 */

import React from 'react';

export type MigrationItemStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface MigrationItem {
  id: string;
  name: string;
  status?: MigrationItemStatus;
}

export interface MigrationWave {
  wave: string;
  start?: string;
  end?: string;
  items?: ReadonlyArray<MigrationItem>;
  complete_pct?: number;
  blockers?: ReadonlyArray<string>;
}

export interface MigrationPlanRendererProps {
  title?: string;
  subtitle?: string;
  waves?: ReadonlyArray<MigrationWave>;
}

function itemTone(s?: MigrationItemStatus): string {
  switch (s) {
    case 'done':
      return 'var(--cm-success, currentColor)';
    case 'in_progress':
      return 'var(--cm-accent, currentColor)';
    case 'blocked':
      return 'var(--cm-error, currentColor)';
    case 'pending':
    default:
      return 'var(--cm-fg-dim, currentColor)';
  }
}

function computePct(w: MigrationWave): number {
  if (typeof w.complete_pct === 'number') return Math.max(0, Math.min(100, w.complete_pct));
  const items = w.items ?? [];
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.status === 'done').length;
  return Math.round((done / items.length) * 100);
}

export function MigrationPlanRenderer({ title, subtitle, waves }: MigrationPlanRendererProps) {
  const safe = Array.isArray(waves) ? waves : [];

  if (safe.length === 0) {
    return (
      <div data-testid="migration-plan-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no migration plan
      </div>
    );
  }

  return (
    <div
      data-testid="migration-plan-renderer"
      className="cm-migration-plan"
      style={{ display: 'grid', gap: 12, color: 'var(--cm-fg)' }}
    >
      {(title || subtitle) && (
        <div>
          {title && (
            <div style={{ fontWeight: 600, color: 'var(--cm-fg)', fontSize: 14 }}>{title}</div>
          )}
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      {safe.map((w, idx) => {
        const pct = computePct(w);
        const items = w.items ?? [];
        const blockers = w.blockers ?? [];
        return (
          <div
            key={`${w.wave}-${idx}`}
            data-wave={w.wave}
            style={{
              background: 'var(--cm-bg-2)',
              border: '1px solid var(--cm-border)',
              borderRadius: 'var(--cm-radius, 6px)',
              padding: '12px 14px',
              display: 'grid',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                alignItems: 'baseline',
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--cm-fg)', fontSize: 13 }}>
                {w.wave}
              </span>
              <span
                style={{
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                  fontSize: 11,
                  color: 'var(--cm-fg-dim)',
                }}
              >
                {w.start ?? '—'} → {w.end ?? '—'}
              </span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--cm-bg-3, var(--cm-bg-2))',
                border: '1px solid var(--cm-border)',
                overflow: 'hidden',
              }}
            >
              <div
                data-testid="migration-wave-progress"
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--cm-accent, currentColor)',
                  transition: 'width 200ms ease',
                }}
              />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 6,
              }}
            >
              {items.map((it, i) => (
                <div
                  key={`${it.id}-${i}`}
                  data-item-id={it.id}
                  data-status={it.status ?? 'pending'}
                  style={{
                    padding: '6px 8px',
                    background: 'var(--cm-bg-3, var(--cm-bg-2))',
                    border: '1px solid var(--cm-border)',
                    borderLeft: `3px solid ${itemTone(it.status)}`,
                    borderRadius: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--cm-fg)' }}>{it.name}</span>
                  <span
                    style={{
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      fontSize: 10,
                      color: itemTone(it.status),
                    }}
                  >
                    {it.status ?? 'pending'}
                  </span>
                </div>
              ))}
            </div>
            {blockers.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  padding: '6px 8px',
                  background: 'transparent',
                  border: '1px solid var(--cm-error, currentColor)',
                  borderRadius: 4,
                  fontSize: 12,
                  color: 'var(--cm-error, currentColor)',
                }}
              >
                <strong>Blockers ({blockers.length}):</strong>
                <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                  {blockers.map((b, i) => (
                    <li key={`b-${i}`}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MigrationPlanRenderer;
