/**
 * Phase G (task #152) — `dlp_scan_start`, `dlp_scan_result`,
 * `dlp_scan_performed`, `dlp_blocked` event renderer.
 *
 * Unified security-scan inline indicator. During the scan shows
 * "DLP: scanning tool input". On result:
 *
 *   - passed/redact  → "DLP: passed" (or "DLP: redacted N findings")
 *   - blocked        → "DLP: blocked (severity: high)" — red
 *
 * Backend emits `dlp_blocked` or `dlp_scan_performed` with
 * `{action, severity, categories, rules, findings, scanPoint}`.
 */
import React, { memo } from 'react';

export type DlpScanState = 'scanning' | 'passed' | 'redacted' | 'blocked';

export interface DlpScanStatusProps {
  state: DlpScanState;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string | null;
  categories?: string[] | null;
  findings?: number | null;
  scanPoint?: string | null;
  reason?: string | null;
}

const ShieldIcon = ({ color }: { color: string }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" />
  </svg>
);

function colorForState(state: DlpScanState) {
  switch (state) {
    case 'blocked':
      return {
        fg: 'var(--cm-error)',
        bg: 'color-mix(in srgb, var(--cm-error) 8%, transparent)',
        border: 'color-mix(in srgb, var(--cm-error) 28%, transparent)',
      };
    case 'redacted':
      return {
        fg: 'var(--cm-warning)',
        bg: 'color-mix(in srgb, var(--cm-warning) 8%, transparent)',
        border: 'color-mix(in srgb, var(--cm-warning) 28%, transparent)',
      };
    case 'passed':
      return {
        fg: 'var(--cm-success)',
        bg: 'color-mix(in srgb, var(--cm-success) 8%, transparent)',
        border: 'color-mix(in srgb, var(--cm-success) 28%, transparent)',
      };
    case 'scanning':
    default:
      return {
        fg: 'var(--cm-text-secondary)',
        bg: 'color-mix(in srgb, var(--cm-text) 4%, transparent)',
        border: 'var(--cm-border)',
      };
  }
}

const DlpScanStatusComponent: React.FC<DlpScanStatusProps> = ({
  state,
  severity,
  categories,
  findings,
  scanPoint,
  reason,
}) => {
  const colors = colorForState(state);
  const scanPointLabel = scanPoint ? ` ${scanPoint}` : ' tool input';

  let label: string;
  if (state === 'scanning') label = `DLP: scanning${scanPointLabel}`;
  else if (state === 'blocked')
    label = `DLP: blocked${severity ? ` (severity: ${severity})` : ''}`;
  else if (state === 'redacted')
    label = `DLP: redacted${typeof findings === 'number' ? ` ${findings} finding${findings === 1 ? '' : 's'}` : ''}`;
  else label = 'DLP: passed';

  const detail = [
    state === 'blocked' && reason ? reason : null,
    Array.isArray(categories) && categories.length > 0
      ? categories.slice(0, 3).join(', ')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      data-testid="dlp-scan-status"
      data-state={state}
      data-severity={severity || undefined}
      role={state === 'blocked' ? 'alert' : 'status'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 99,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        fontSize: 11,
        color: colors.fg,
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <ShieldIcon color={colors.fg} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      {detail && <span style={{ color: 'var(--cm-text-muted)' }}>· {detail}</span>}
    </span>
  );
};

export const DlpScanStatus = memo(DlpScanStatusComponent);
DlpScanStatus.displayName = 'DlpScanStatus';
