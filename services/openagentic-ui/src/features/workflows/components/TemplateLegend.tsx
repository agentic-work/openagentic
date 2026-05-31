/**
 * TemplateLegend — renders the human-readable legend block authored on
 * each template under `meta.{purpose,how_it_works,expected_output,
 * useful_when,tools_used,version,tags}`.
 *
 * Two surface modes:
 *   - `card` (default) — used inside expanded template gallery cards.
 *     Compact spacing, no card chrome.
 *   - `panel` — used inside the canvas-side "About this workflow" panel
 *     when a workflow opened from a template. Slightly more breathing
 *     room, optional title header, dismiss button.
 *
 * Authored per user 2026-05-14 — operators staring at "Prometheus Target
 * Down RCA" with zero context need a legend explaining what the flow is
 * for, what it does, how it works, and how to determine its usefulness.
 */

import React from 'react';

export interface TemplateMeta {
  purpose?: string;
  how_it_works?: string[];
  expected_output?: string;
  useful_when?: string;
  tools_used?: string[];
  version?: string;
  tags?: string[];
}

interface Props {
  meta: TemplateMeta;
  variant?: 'card' | 'panel';
  title?: string;
  onClose?: () => void;
}

const TONE_ACCENT = 'var(--user-accent-primary, #FF5722)';

export const TemplateLegend: React.FC<Props> = ({ meta, variant = 'card', title, onClose }) => {
  if (!meta || (!meta.purpose && !meta.how_it_works?.length && !meta.expected_output && !meta.useful_when)) {
    return null;
  }

  const isPanel = variant === 'panel';
  const sectionGap = isPanel ? 14 : 10;

  return (
    <div
      data-testid="template-legend"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: sectionGap,
        padding: isPanel ? 16 : 0,
        background: isPanel ? 'var(--color-bg-secondary, #161b22)' : 'transparent',
        border: isPanel ? '1px solid var(--color-border, #30363d)' : 'none',
        borderRadius: isPanel ? 12 : 0,
        boxShadow: isPanel ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
        color: 'var(--color-text, #e6edf3)',
        fontSize: 13,
        lineHeight: 1.5,
        maxWidth: isPanel ? 420 : 'none',
      }}
    >
      {isPanel && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: TONE_ACCENT,
            }}>
              About this workflow
            </div>
            {title && (
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text, #e6edf3)', letterSpacing: '-0.01em' }}>
                {title}
              </div>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close legend"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-tertiary, #8b949e)', fontSize: 18, lineHeight: 1, padding: 4,
              }}
            >
              x
            </button>
          )}
        </div>
      )}

      {meta.purpose && (
        <Section heading="Purpose">
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #c9d1d9)' }}>{meta.purpose}</p>
        </Section>
      )}

      {meta.useful_when && (
        <Section heading="When to use this">
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #c9d1d9)' }}>{meta.useful_when}</p>
        </Section>
      )}

      {meta.how_it_works && meta.how_it_works.length > 0 && (
        <Section heading="How it works">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {meta.how_it_works.map((step, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--color-text-secondary, #c9d1d9)' }}>
                <span style={{
                  flexShrink: 0,
                  minWidth: 22, height: 22,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 6,
                  fontSize: 10, fontWeight: 700, fontFamily: "'SF Mono', Monaco, monospace",
                  background: `${TONE_ACCENT}1f`,
                  color: TONE_ACCENT,
                  border: `1px solid ${TONE_ACCENT}40`,
                  marginTop: 1,
                }}>{i + 1}</span>
                <span style={{ flex: 1 }}>{step.replace(/^\d+\.\s*/, '')}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {meta.expected_output && (
        <Section heading="What you'll get">
          <p style={{ margin: 0, color: 'var(--color-text-secondary, #c9d1d9)' }}>{meta.expected_output}</p>
        </Section>
      )}

      {meta.tools_used && meta.tools_used.length > 0 && (
        <Section heading="Tools used">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {meta.tools_used.map((tool) => (
              <span key={tool} style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 10,
                fontFamily: "'SF Mono', Monaco, monospace",
                background: 'rgba(14,165,233,0.10)',
                color: '#67e8f9',
                border: '1px solid rgba(14,165,233,0.28)',
                borderRadius: 999,
                letterSpacing: 0.2,
              }}>{tool}</span>
            ))}
          </div>
        </Section>
      )}

      {(meta.version || (meta.tags && meta.tags.length > 0)) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 8, marginTop: 4,
          borderTop: '1px solid var(--color-border, #30363d)',
          fontSize: 10, color: 'var(--color-text-tertiary, #8b949e)', letterSpacing: 0.2,
        }}>
          <div>{meta.version && <span>v{meta.version}</span>}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(meta.tags ?? []).map((t) => (
              <span key={t} style={{
                padding: '1px 6px', borderRadius: 4,
                background: 'var(--color-bg-tertiary, rgba(255,255,255,0.04))',
                color: 'var(--color-text-tertiary, #8b949e)',
                fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600,
              }}>{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ heading: string; children: React.ReactNode }> = ({ heading, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: TONE_ACCENT,
    }}>
      {heading}
    </div>
    <div>{children}</div>
  </div>
);
