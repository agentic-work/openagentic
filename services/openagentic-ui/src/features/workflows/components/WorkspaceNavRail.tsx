/**
 * WorkspaceNavRail
 *
 * Left icon rail for the Flows workspace shell. Renders one button per
 * section (Home / Flows / Agents / Tools & Data / Runs / Insights /
 * Library / Team / Settings — see docs/mockups/sidebar-endstate.html).
 *
 * Icons are inlined per `iconId` so the rail is fully self-contained —
 * no dependency on a sibling SVG sprite (the `<use href>` indirection
 * was 404ing in some build/host combinations).
 *
 * Keyboard: ArrowUp/ArrowDown move focus through the rail without
 * wrapping (matching native list semantics — predictable for screen
 * readers + keyboard users).
 */

import React, { useRef } from 'react';

export interface WorkspaceNavItem {
  id: string;
  label: string;
  /** Icon identifier — see ICONS map below for available glyphs. */
  iconId: string;
  /** Numeric badge (e.g. live runs count). 0 / undefined = hidden. */
  badge?: number;
  /** Render a small alert dot in the corner (e.g. agent issues). */
  alertDot?: boolean;
}

const ICON_SIZE = 22;

// Inline icon glyphs. currentColor lets each button's `color` style drive
// the stroke/fill — so active vs idle theming Just Works.
const ICONS: Record<string, JSX.Element> = {
  'i-home': (
    <>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="1.5" fill="currentColor" />
    </>
  ),
  'i-flows': (
    <>
      <circle cx="5" cy="6" r="2.5" fill="currentColor" />
      <circle cx="19" cy="6" r="2.5" fill="currentColor" />
      <circle cx="12" cy="18" r="2.5" fill="currentColor" />
      <path d="M5 8.5v5.5a3 3 0 0 0 3 3h2M19 8.5v5.5a3 3 0 0 1-3 3h-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  'i-agents': (
    <>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <circle cx="5" cy="6" r="1.6" fill="currentColor" opacity="0.6" />
      <circle cx="19" cy="6" r="1.6" fill="currentColor" opacity="0.6" />
      <circle cx="5" cy="18" r="1.6" fill="currentColor" opacity="0.6" />
      <circle cx="19" cy="18" r="1.6" fill="currentColor" opacity="0.6" />
      <path d="M6.4 7.2l3.4 3.4M17.6 7.2l-3.4 3.4M6.4 16.8l3.4-3.4M17.6 16.8l-3.4-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  'i-tools': (
    <>
      <rect x="4" y="9" width="16" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9V5h2v4M14 9V5h2v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="13" r="0.9" fill="currentColor" />
      <circle cx="15" cy="13" r="0.9" fill="currentColor" />
    </>
  ),
  'i-runs': (
    <path d="M7 5l13 7-13 7z" fill="currentColor" />
  ),
  'i-insights': (
    <>
      <rect x="3" y="13" width="4" height="8" rx="0.8" fill="currentColor" />
      <rect x="10" y="8" width="4" height="13" rx="0.8" fill="currentColor" opacity="0.85" />
      <rect x="17" y="4" width="4" height="17" rx="0.8" fill="currentColor" opacity="0.7" />
    </>
  ),
  'i-library': (
    <>
      <path d="M5 4h6v16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6V4z" fill="currentColor" opacity="0.7" />
      <path d="M7 8h2M7 11h2M7 14h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  'i-team': (
    <>
      <circle cx="9" cy="8" r="3" fill="currentColor" />
      <circle cx="17" cy="9" r="2.4" fill="currentColor" opacity="0.75" />
      <path d="M3 19c0-3 3-5 6-5s6 2 6 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 18c1-2 2.5-3 4-3s3 1 4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  'i-settings': (
    <>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
};

export interface WorkspaceNavRailProps {
  items: WorkspaceNavItem[];
  active: string;
  onSelect: (id: string) => void;
}

export const WorkspaceNavRail: React.FC<WorkspaceNavRailProps> = ({
  items,
  active,
  onSelect,
}) => {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (currentIndex: number, delta: 1 | -1) => {
    const next = currentIndex + delta;
    if (next < 0 || next >= items.length) return;
    buttonsRef.current[next]?.focus();
  };

  return (
    <nav
      aria-label="Workspace sections"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 0',
        width: 56,
        background: 'var(--color-bg-secondary, #161b22)',
        borderRight: '1px solid var(--color-border, #2a2a2a)',
        height: '100%',
      }}
    >
      {items.map((item, idx) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            ref={(el) => { buttonsRef.current[idx] = el; }}
            type="button"
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            title={item.label}
            onClick={() => onSelect(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(idx, 1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(idx, -1); }
            }}
            style={{
              position: 'relative',
              width: 40,
              height: 40,
              margin: '0 8px',
              borderRadius: 8,
              background: isActive ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary, #8b949e)',
              border: isActive ? '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' : '1px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width={ICON_SIZE}
              height={ICON_SIZE}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              {ICONS[item.iconId] || (
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              )}
            </svg>
            {item.alertDot ? (
              <span
                data-testid="nav-alert-dot"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--color-error)',
                }}
              />
            ) : null}
            {typeof item.badge === 'number' && item.badge > 0 ? (
              <span
                data-testid="nav-badge"
                style={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--color-info)',
                  color: 'white',
                  fontSize: 10,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
};
