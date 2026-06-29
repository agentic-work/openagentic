import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useThemeTokens } from './hooks/useThemeTokens';
import { onKeyActivate } from '@/utils/a11y';

export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | 'custom';

export const TIME_RANGES: TimeRange[] = ['1h', '6h', '24h', '7d', '30d', '90d'];

export interface ChartExpandModalProps {
  /** Modal heading. */
  title: string;
  /** Optional subhead under the title. */
  subtitle?: string;
  /** Open / closed state. */
  open: boolean;
  /** Called when the user dismisses (close button, click outside, Escape). */
  onClose: () => void;
  /** Optional time-range chip strip. Hidden when omitted. */
  range?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
  /** Available range chips, defaults to TIME_RANGES. */
  ranges?: TimeRange[];
  /** Chart body — typically the same chart rendered larger with wheelZoom="always". */
  children: React.ReactNode;
  /** Optional right-side header content (extra controls). */
  rightControls?: React.ReactNode;
}

/**
 * Fullscreen overlay shell used by every chart's "expand" affordance.
 * The chart itself goes in `children`; the modal supplies title, time
 * range chips (optional), close button, click-outside-to-close, and
 * Escape-to-close.
 *
 * Why "expand" instead of "fullscreen API": fullscreen API trapped the
 * entire viewport including sidebar / page chrome, which made comparison
 * with sibling charts impossible. This modal sits on top of the page,
 * leaves the URL alone, and dismisses to put the user back where they
 * came from.
 */
export function ChartExpandModal({
  title,
  subtitle,
  open,
  onClose,
  range,
  onRangeChange,
  ranges = TIME_RANGES,
  children,
  rightControls,
}: ChartExpandModalProps) {
  const tokens = useThemeTokens();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  // SSR / no-DOM guard: nothing to portal into.
  if (typeof document === 'undefined') return null;

  // Portal to <body> so the position:fixed overlay escapes any transformed /
  // overflow-clipped ancestor in the chat stream (AgenticActivityStream applies
  // `transform`, which would otherwise become the containing block for
  // position:fixed and clip the modal to the message bubble — the "Expand does
  // nothing" bug). Mirrors WidgetRenderer's own modal, which already portals.
  return createPortal(
    <div
      role="presentation"
      tabIndex={-1}
      data-aw-chart-expand
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyActivate(() => onClose())}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--color-shadow) 65%, transparent)',
        backdropFilter: 'blur(2px)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 'min(1400px, 96vw)',
          height: 'min(900px, 90vh)',
          background: tokens.bg1,
          border: `1px solid ${tokens.line2}`,
          borderRadius: 10,
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          overflow: 'hidden',
          fontFamily: tokens.fontUi,
        }}
      >
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            alignItems: 'center',
            gap: 16,
            padding: '14px 20px',
            borderBottom: `1px solid ${tokens.line2}`,
            background: tokens.bg2,
          }}
        >
          <div>
            <h2 style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: tokens.fg0,
              letterSpacing: 0.2,
            }}>
              {title}
            </h2>
            {subtitle && (
              <div style={{
                marginTop: 2,
                fontSize: 11,
                color: tokens.fg3,
                fontFamily: tokens.fontMono,
              }}>
                {subtitle}
              </div>
            )}
          </div>

          {onRangeChange ? (
            <div role="tablist" aria-label="Time range" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{
                color: tokens.fg3, fontSize: 10, fontFamily: tokens.fontMono,
                textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6,
              }}>
                range
              </span>
              {ranges.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  onClick={() => onRangeChange(r)}
                  style={{
                    background: range === r ? tokens.accent : tokens.bg1,
                    color: range === r ? tokens.bg0 : tokens.fg2,
                    border: `1px solid ${range === r ? tokens.accent : tokens.line2}`,
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 11,
                    fontFamily: tokens.fontMono,
                    fontWeight: range === r ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'background 120ms, color 120ms, border-color 120ms',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          ) : <div />}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {rightControls}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'transparent',
                border: `1px solid ${tokens.line2}`,
                color: tokens.fg2,
                fontSize: 14,
                width: 30,
                height: 30,
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        </header>

        <div
          style={{
            padding: '20px',
            overflow: 'auto',
            background: tokens.bg0,
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
