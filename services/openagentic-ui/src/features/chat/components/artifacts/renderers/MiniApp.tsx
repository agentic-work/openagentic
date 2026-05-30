/**
 * #781 Phase C6 — MiniApp renderer.
 *
 * Sandbox-backed executable mini-app: iframe sourced from
 * /api/synth/mini-app/<exec_id> (server proxies to synth-executor pod
 * with declared capabilities + CPU/RAM/TTL caps). Provenance panel
 * mirrors mock 10's Stripe/Linear/Figma technical-light aesthetic.
 *
 * Contract:
 *   - sandbox="allow-scripts allow-same-origin" (same-origin needed for
 *     postMessage param-tuning bridge to /api/synth/mini-app/* endpoints)
 *   - TTL countdown ticks every second; at 0, replace iframe with a
 *     "Session expired · Re-run" CTA (NOT silent failure)
 *   - error prop renders a structured error in the body — used by the
 *     caller when capabilities scope outside declared set
 */
import React, { useEffect, useState } from 'react';

export interface MiniAppCaps {
  /** CPU core count cap (e.g. 1.0 for 1 vCPU). */
  cpu: number;
  /** RAM cap in MiB. */
  ramMiB: number;
  /** Wall-time TTL in seconds. After this, iframe is replaced with re-run CTA. */
  ttlSec: number;
}

export interface MiniAppProps {
  execId: string;
  capabilities: string[];
  caps: MiniAppCaps;
  /** Optional structured error to display instead of the iframe. */
  error?: string;
  /** Called when user clicks "Re-run" after TTL expiry. */
  onRerun?: () => void;
}

const COLORS = {
  ink: 'var(--cm-text)',
  graphite: 'var(--cm-text-muted)',
  rule: 'var(--cm-border)',
  accent: 'var(--cm-accent)',
  paper: 'var(--cm-bg)',
  paper2: 'var(--cm-bg-secondary)',
  err: 'var(--cm-error)',
};

const FONT_SANS =
  'Switzer, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", monospace';

export const MiniApp: React.FC<MiniAppProps> = ({
  execId,
  capabilities,
  caps,
  error,
  onRerun,
}) => {
  const [remaining, setRemaining] = useState(caps.ttlSec);
  const expired = remaining <= 0;

  useEffect(() => {
    if (expired || error) return;
    const id = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [expired, error]);

  return (
    <div
      data-testid="miniapp-root"
      style={{
        display: 'grid',
        gridTemplateRows: '1fr auto',
        gap: 12,
        fontFamily: FONT_SANS,
        color: COLORS.ink,
        background: COLORS.paper,
      }}
    >
      {error ? (
        <div
          data-testid="miniapp-error"
          style={{
            padding: '24px 20px',
            border: `1px solid ${COLORS.err}`,
            borderLeft: `4px solid ${COLORS.err}`,
            background: 'color-mix(in srgb, var(--cm-error) 4%, transparent)',
            fontSize: 13,
            color: COLORS.err,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, letterSpacing: 0.04, textTransform: 'uppercase' }}>
            Capability Error
          </div>
          {error}
        </div>
      ) : expired ? (
        <div
          data-testid="miniapp-expired"
          style={{
            padding: '40px 24px',
            border: `1px solid ${COLORS.rule}`,
            background: COLORS.paper2,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10.5,
              letterSpacing: 0.16,
              textTransform: 'uppercase',
              color: COLORS.graphite,
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            TTL exceeded
          </div>
          <div style={{ fontSize: 15, marginBottom: 16, color: COLORS.ink, fontWeight: 500 }}>
            Sandbox session expired
          </div>
          <button
            type="button"
            onClick={onRerun}
            style={{
              padding: '8px 16px',
              background: COLORS.accent,
              color: COLORS.paper,
              border: 'none',
              fontFamily: FONT_SANS,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Re-run
          </button>
        </div>
      ) : (
        <iframe
          src={`/api/synth/mini-app/${execId}`}
          title={`Mini-app ${execId}`}
          sandbox="allow-scripts allow-same-origin"
          style={{
            width: '100%',
            minHeight: 400,
            border: `1px solid ${COLORS.rule}`,
            background: COLORS.paper,
          }}
        />
      )}
      <div
        data-testid="miniapp-provenance"
        style={{
          padding: '10px 14px',
          background: COLORS.paper2,
          border: `1px solid ${COLORS.rule}`,
          display: 'grid',
          gridTemplateColumns: '1fr auto auto auto',
          gap: 14,
          alignItems: 'center',
          fontFamily: FONT_MONO,
          fontSize: 10.5,
          letterSpacing: 0.04,
          color: COLORS.graphite,
        }}
      >
        <div>
          <span style={{ color: COLORS.graphite, marginRight: 6, textTransform: 'uppercase', fontSize: 9.5, letterSpacing: 0.16, fontWeight: 600 }}>
            caps
          </span>
          {capabilities.length === 0 ? (
            <span style={{ color: COLORS.graphite }}>none</span>
          ) : (
            capabilities.map((c) => (
              <span
                key={c}
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  marginRight: 4,
                  background: COLORS.accent,
                  color: COLORS.paper,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.04,
                }}
              >
                {c}
              </span>
            ))
          )}
        </div>
        <div>
          <span style={{ fontSize: 9.5, letterSpacing: 0.16, textTransform: 'uppercase', fontWeight: 600 }}>cpu</span>{' '}
          <span style={{ color: COLORS.ink, fontWeight: 600 }}>{caps.cpu}</span>c
        </div>
        <div>
          <span style={{ fontSize: 9.5, letterSpacing: 0.16, textTransform: 'uppercase', fontWeight: 600 }}>ram</span>{' '}
          <span style={{ color: COLORS.ink, fontWeight: 600 }}>{caps.ramMiB}</span>m
        </div>
        <div>
          <span style={{ fontSize: 9.5, letterSpacing: 0.16, textTransform: 'uppercase', fontWeight: 600 }}>ttl</span>{' '}
          <span data-testid="miniapp-ttl" style={{ color: expired ? COLORS.err : COLORS.ink, fontWeight: 600 }}>
            {remaining}
          </span>
          s
        </div>
      </div>
    </div>
  );
};
