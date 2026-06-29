/**
 * AgenticActivityStream — inline tool-summary renderers.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving):
 * the RichSummary icon map plus the SummaryRich / SummaryLinks inline rows
 * used on the per-tool success row (openagentic#330).
 */
import React from 'react';
import {
  Database,
  Brain,
  Cloud,
  Server,
  Lock,
  Coins,
  Shield,
  Cpu,
  HardDrive,
  Bot,
  FileCode,
  Sparkles,
  Image as ImageIcon,
  Search as SearchIcon,
  Package,
  Globe,
  Terminal,
} from '@/shared/icons';
import type { RichSummary } from '../../utils/toolSummarizer';

/**
 * Inline render: a compact "icon + headline + badges + items" row for
 * summarizers that return `kind: 'rich'`. Used by RAG retrieval, cloud
 * resource creation, cost queries, agent delegation, etc. Items render
 * as small chips with optional hint tooltips. Designed to fit on the
 * single-line success row alongside the duration timestamp.
 *
 * openagentic#330 Tier 2.
 */
/** Map a RichSummary.icon name to a component from `@/shared/icons`. */
export const RICH_ICON_MAP = {
  database:    Database,
  brain:       Brain,
  cloud:       Cloud,
  package:     Package,
  server:      Server,
  globe:       Globe,
  lock:        Lock,
  coins:       Coins,
  shield:      Shield,
  cpu:         Cpu,
  'hard-drive': HardDrive,
  bot:         Bot,
  terminal:    Terminal,
  'file-code': FileCode,
  sparkles:    Sparkles,
  image:       ImageIcon,
  search:      SearchIcon,
} as const;

export const SummaryRich: React.FC<{ summary: RichSummary }> = ({ summary }) => {
  const toneColor = (tone: 'default' | 'success' | 'warn' | 'danger' | 'info' | undefined) => {
    switch (tone) {
      case 'success': return { bg: 'color-mix(in srgb, var(--cm-success) 18%, transparent)', fg: 'var(--cm-success)' };
      case 'warn':    return { bg: 'color-mix(in srgb, var(--cm-warning) 18%, transparent)', fg: 'var(--cm-warning)' };
      case 'danger':  return { bg: 'color-mix(in srgb, var(--cm-error) 18%, transparent)', fg: 'var(--cm-error)' };
      case 'info':    return { bg: 'color-mix(in srgb, var(--cm-accent) 18%, transparent)', fg: 'var(--cm-accent)' };
      default:        return { bg: 'color-mix(in srgb, var(--color-text) 8%, transparent)', fg: 'var(--color-text-secondary)' };
    }
  };
  const IconComp = RICH_ICON_MAP[summary.icon] || Cloud;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <IconComp size={13} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
          flexShrink: 0,
          maxWidth: '40%',
        }}
      >
        {summary.primary}
      </span>
      {summary.secondary && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.8,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          · {summary.secondary}
        </span>
      )}
      {summary.badges?.slice(0, 3).map((b, i) => {
        const c = toneColor(b.tone);
        return (
          <span
            key={i}
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: c.bg,
              color: c.fg,
              flexShrink: 0,
              letterSpacing: '0.2px',
              textTransform: 'uppercase' as const,
            }}
          >
            {b.label}
          </span>
        );
      })}
      {summary.items && summary.items.length > 0 && (
        <span
          role="presentation"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 4,
            overflow: 'hidden',
            flexShrink: 1,
            minWidth: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {summary.items.slice(0, 3).map((item, i) => {
            const inner = (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 10,
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.hint ? `${item.title} — ${item.hint}` : item.title}
              >
                {item.favicon && (
                  <img
                    src={item.favicon}
                    alt=""
                    width={11}
                    height={11}
                    style={{ flexShrink: 0, borderRadius: 2 }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                {item.badge && (() => {
                  // Per-item status pill (✓ / ✕ / running / etc) — used by
                  // delegate_to_agents to surface sub-agent outcomes at a
                  // glance. openagentic#330 Tier 4.
                  const c = toneColor(item.badgeTone);
                  return (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '0 4px',
                        borderRadius: 3,
                        background: c.bg,
                        color: c.fg,
                        flexShrink: 0,
                        marginLeft: 2,
                        letterSpacing: '0.2px',
                      }}
                    >
                      {item.badge}
                    </span>
                  );
                })()}
              </span>
            );
            return item.url ? (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                {inner}
              </a>
            ) : (
              <React.Fragment key={i}>{inner}</React.Fragment>
            );
          })}
          {summary.items.length > 3 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', opacity: 0.6 }}>
              +{summary.items.length - 3}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

/**
 * Inline render: a compact row of favicon + title pills, one per result
 * URL, opening in a new tab. Used for `summary.kind === 'links'` (web
 * search / web fetch). Defensively limits to 4 pills to keep the
 * single-line summary visually balanced; expanding the step still shows
 * the full result JSON.
 */
export const SummaryLinks: React.FC<{ items: Array<{ title: string; url: string; favicon?: string }> }> = ({ items }) => {
  const visible = items.slice(0, 4);
  const overflow = items.length - visible.length;
  return (
    <span
      role="presentation"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {visible.map((item, i) => (
        <a
          key={`${item.url}-${i}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title={item.url}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 6px 1px 4px',
            borderRadius: 4,
            background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 11,
            lineHeight: 1.4,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
        >
          {item.favicon && (
            <img
              src={item.favicon}
              alt=""
              width={12}
              height={12}
              style={{ flexShrink: 0, borderRadius: 2 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
        </a>
      ))}
      {overflow > 0 && (
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', opacity: 0.7 }}>
          +{overflow} more
        </span>
      )}
    </span>
  );
};

