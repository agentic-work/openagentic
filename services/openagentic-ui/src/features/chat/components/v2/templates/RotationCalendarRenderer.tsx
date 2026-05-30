/**
 * RotationCalendarRenderer — compose_app:rotation_calendar template.
 *
 * Month calendar grid with primary on-call (top) + secondary (bottom)
 * per day. Stable per-primary accent rail. UTC-stable rendering.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-08-incident-triage.html.
 */

import React, { useMemo } from 'react';

export interface RotationShift {
  date: string;
  primary: string;
  secondary?: string;
  team?: string;
}

export interface RotationCalendarRendererProps {
  title?: string;
  rotation_name?: string;
  month?: string;
  shifts?: ReadonlyArray<RotationShift>;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Use named CSS vars so the palette swaps with theme — no hex.
const PALETTE_VARS = [
  'var(--cm-accent, currentColor)',
  'var(--cm-info, currentColor)',
  'var(--cm-success, currentColor)',
  'var(--cm-warn, currentColor)',
  'var(--cm-error, currentColor)',
];

export function RotationCalendarRenderer(props: RotationCalendarRendererProps) {
  const { title, rotation_name, month, shifts } = props;
  const safeShifts = Array.isArray(shifts) ? shifts : [];

  const monthData = useMemo(() => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return null;
    const [year, m] = month.split('-').map(Number);
    if (!year || !m) return null;
    const first = new Date(Date.UTC(year, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const firstWeekday = first.getUTCDay();
    const monthName = first.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { year, month: m, daysInMonth, firstWeekday, monthName };
  }, [month]);

  const byDate = useMemo(() => {
    const map = new Map<string, RotationShift>();
    for (const s of safeShifts) map.set(s.date, s);
    return map;
  }, [safeShifts]);

  const colorFor = useMemo(() => {
    const primaries = Array.from(new Set(safeShifts.map((s) => s.primary)));
    const m = new Map<string, string>();
    primaries.forEach((p, i) => m.set(p, PALETTE_VARS[i % PALETTE_VARS.length]));
    return m;
  }, [safeShifts]);

  if (!monthData) {
    return (
      <div data-testid="rotation-calendar-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        invalid rotation month
      </div>
    );
  }

  const totalCells = monthData.firstWeekday + monthData.daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  const cells: Array<{ day: number | null; shift?: RotationShift }> = [];
  for (let i = 0; i < rows * 7; i++) {
    const dayNum = i - monthData.firstWeekday + 1;
    if (dayNum < 1 || dayNum > monthData.daysInMonth) {
      cells.push({ day: null });
    } else {
      const dateStr = `${monthData.year}-${String(monthData.month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      cells.push({ day: dayNum, shift: byDate.get(dateStr) });
    }
  }

  return (
    <div
      data-testid="rotation-calendar-renderer"
      className="cm-rotation-calendar"
      style={{
        background: 'var(--cm-bg-2)',
        border: '1px solid var(--cm-border)',
        borderRadius: 'var(--cm-radius, 6px)',
        padding: '12px 14px',
        color: 'var(--cm-fg)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        {title && (
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</span>
        )}
        {rotation_name && (
          <span
            style={{
              fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              fontSize: 11,
              color: 'var(--cm-fg-dim)',
            }}
          >
            {rotation_name}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--cm-fg-dim)', fontSize: 12 }}>
          {monthData.monthName}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
          fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
          fontSize: 10,
          color: 'var(--cm-fg-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ padding: '2px 4px' }}>
            {d}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
        }}
      >
        {cells.map((c, i) => {
          if (c.day === null) {
            return (
              <div
                key={`empty-${i}`}
                style={{ minHeight: 64, opacity: 0.3 }}
                aria-hidden
                data-testid="rotation-cell-empty"
              />
            );
          }
          const tone = c.shift ? colorFor.get(c.shift.primary) ?? 'var(--cm-fg-dim)' : 'var(--cm-fg-dim)';
          return (
            <div
              key={`d-${c.day}`}
              data-testid="rotation-cell"
              data-day={c.day}
              data-primary={c.shift?.primary ?? ''}
              style={{
                minHeight: 64,
                padding: '4px 6px',
                background: 'var(--cm-bg-3, var(--cm-bg-2))',
                border: '1px solid var(--cm-border)',
                borderLeft: c.shift ? `3px solid ${tone}` : '1px solid var(--cm-border)',
                borderRadius: 4,
                display: 'grid',
                gridTemplateRows: 'auto 1fr',
                gap: 2,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--cm-fg-dim)',
                  fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                }}
              >
                {c.day}
              </div>
              {c.shift && (
                <div style={{ display: 'grid', gap: 1 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: tone,
                      fontWeight: 600,
                      fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                    }}
                  >
                    {c.shift.primary}
                  </div>
                  {c.shift.secondary && (
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--cm-fg-dim)',
                        fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                      }}
                    >
                      {c.shift.secondary}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RotationCalendarRenderer;
