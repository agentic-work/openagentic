/**
 * GenericTemplate — fallback renderer for newly-added mock template slugs
 * that don't yet have a polished React component.
 *
 * Phase A2 ships the SDK + chatLoop emit side for 21 template slugs
 * (mocks/UX/AI/Chatmode/end-state-07..16). Polished primitives exist for
 * about a third of them (StreamingTable, Findings, SavingsCard, KpiGrid,
 * Runbook, WaveTimeline, AgentTree, StackGrid, DcMap, Gate, Gap, VizHead,
 * Sankey, BuildProgress, CloudRunGrid, MultiRegionEksDashboard).
 *
 * The remaining 20 slugs need their own component eventually — but
 * shipping that as a single multi-thousand-LOC PR risks integration drift.
 * Instead, GenericTemplate provides a clean visual fallback that:
 *
 *   - Renders the template name as a card header (so designers can spot
 *     which slug is in use)
 *   - Renders `payload.title` if present
 *   - Renders the structured `data` as a clean JSON tree
 *
 * Registered against every "new mock" slug in FrameRendererRegistry; gets
 * replaced one-at-a-time as polished components land.
 */

import * as React from 'react';

export interface GenericTemplateProps {
  template?: string;
  title?: string;
  data?: unknown;
  /** Free-form payload — registry passes the whole `structuredContent`
   * or `payload` shape so the component can pull what it needs. */
  payload?: Record<string, unknown>;
}

const styles = {
  card: {
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-chip)',
    padding: '10px 12px',
    background: 'var(--glass-bg)',
    backdropFilter: 'var(--glass-blur)',
    WebkitBackdropFilter: 'var(--glass-blur)',
    boxShadow: 'var(--glass-card-shadow)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    margin: '6px 0',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 6,
    color: 'var(--color-fg-muted)',
  } as React.CSSProperties,
  slug: {
    background: 'var(--ctl-surf)',
    color: 'var(--color-fg)',
    border: '1px solid var(--glass-border)',
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  title: {
    color: 'var(--color-fg)',
    fontWeight: 600,
  } as React.CSSProperties,
  pre: {
    margin: 0,
    color: 'var(--color-fg)',
    background: 'var(--ctl-surf)',
    border: '1px solid var(--glass-border)',
    padding: 8,
    borderRadius: 4,
    overflowX: 'auto',
    fontSize: 11,
    lineHeight: '1.5em',
    maxHeight: 360,
    overflowY: 'auto',
  } as React.CSSProperties,
};

export const GenericTemplate: React.FC<GenericTemplateProps> = (props) => {
  const slug = props.template ?? 'unknown';
  const title = props.title ?? (props.payload?.title as string) ?? '';
  const data = props.data ?? props.payload?.data ?? props.payload ?? {};

  let pretty: string;
  try {
    pretty = JSON.stringify(data, null, 2);
  } catch {
    pretty = String(data);
  }
  // Bound the rendered text — these fallbacks aren't meant for huge payloads.
  if (pretty.length > 8_000) {
    pretty = pretty.slice(0, 8_000) + '\n…<truncated>';
  }

  return (
    <div style={styles.card} data-template-slug={slug}>
      <div style={styles.header}>
        <span style={styles.slug}>{slug}</span>
        {title ? <span style={styles.title}>{title}</span> : null}
      </div>
      <pre style={styles.pre}>{pretty}</pre>
    </div>
  );
};
GenericTemplate.displayName = 'GenericTemplate';

/**
 * Factory that binds a fixed template slug to GenericTemplate. Used by
 * FrameRendererRegistry so each registered slug renders with its own
 * `data-template-slug` attribute (helps designers + Playwright probes
 * confirm the right route fired).
 */
export function makeGenericTemplate(slug: string): React.FC<GenericTemplateProps> {
  const Bound: React.FC<GenericTemplateProps> = (props) => (
    <GenericTemplate {...props} template={props.template ?? slug} />
  );
  Bound.displayName = `Generic_${slug}`;
  return Bound;
}
