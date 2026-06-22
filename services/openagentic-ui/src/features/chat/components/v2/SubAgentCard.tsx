import React from 'react';
import { SharedMarkdownRenderer } from '../MessageContent/SharedMarkdownRenderer';

/**
 * Mock anatomy: `.subagent.agent-{c|g|s|k}` — a card with a coloured
 * left-border per agent type, a head row with avatar + role + stats
 * (turns / tokens / wall-time / cost), and a body that hosts the agent's
 * own thinking + tool calls + a green return-value strip.
 *
 * Reference: mocks/UX/01-cloud-ops.html lines 464-502 (SCSS) and
 * 1083-1133 (live markup with `.sa-head .stats` and `.sa-return`).
 *
 * Drives data from the NDJSON `sub_agent_*` envelope (Phase E₂ /
 * services/openagentic-api/src/utils/ndjson). The card contents are
 * children — pass `<ToolCard>`s, thinking blocks, etc. inline.
 *
 * Sev-0 #930 — the sub-agent's return body (`output` / legacy
 * `returnValue`) renders through SharedMarkdownRenderer, the SAME
 * renderer the main chat agent uses (AgenticActivityStream:3276-3280
 * and EnhancedMessageContent), so `**bold**`, `# heading`, fenced
 * code, lists, links, and tables surface as semantic DOM instead of
 * raw markdown text. Colours resolve via `var(--cm-*)` per CLAUDE.md
 * Rule 8(b) — no hardcoded hex/rgb in this component.
 */

export type SubAgentVariant = 'c' | 'g' | 's' | 'k';

export interface SubAgentStats {
  turns?: number;
  tokens?: number;
  wallMs?: number;
  costUsd?: number;
}

export interface SubAgentCardProps {
  /** Agent display name (e.g. "Cost Analysis"). */
  name: string;
  /** Short role line (e.g. "Bob · cost-analysis"). */
  role?: string;
  /** Long-form description (e.g. "right-size 23 idle VMs across 6 subs"). */
  description?: string;
  /** Variant — drives left-border colour + avatar gradient (c/g/s/k). */
  variant: SubAgentVariant;
  /** Live status — drives running pulse / error strip. Default 'ok' for legacy. */
  status?: 'running' | 'ok' | 'error';
  /** Tool names the sub-agent invoked. Renders one chip per tool. */
  toolsUsed?: ReadonlyArray<string>;
  /** Error message — rendered in red strip when status is 'error'. */
  error?: string | null;
  /** Stats row (right-aligned monospace). */
  stats?: SubAgentStats;
  /** Final return value summary. Rendered in `.sa-return` strip when set. */
  returnValue?: string;
  /**
   * Phase 16 — the sub-agent's full return content from
   * SubagentRunResult.output. Wins over `returnValue` when both are set.
   * Long outputs are clamped to a max-height with scroll inside the
   * cm-sa-return strip. Plain string only — structured returns should
   * marshal to JSON-stringified text upstream so the strip stays simple.
   */
  output?: string;
  /** Body content — sub-agent's thinking, tool cards, etc. */
  children?: React.ReactNode;
  /** Additional className passthrough. */
  className?: string;
}

function fmtMs(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(t?: number): string {
  if (t === undefined || t === null) return '';
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k tok`;
  return `${t} tok`;
}

function fmtUsd(u?: number): string {
  if (u === undefined || u === null) return '';
  return `$${u.toFixed(3)}`;
}

export function SubAgentCard({
  name,
  role,
  description,
  variant,
  status = 'ok',
  toolsUsed,
  error,
  stats,
  returnValue,
  output,
  children,
  className,
}: SubAgentCardProps) {
  // #320 — only render stat bits with meaningful (>0) values. Zero-valued
  // stats from a freshly-spawned/streaming sub-agent rendered as
  // "0 turns / 0 tok / 0 ms / $0.00" garbage; running agents now show
  // no stats row until real numbers arrive.
  const statBits: string[] = [];
  if (stats?.turns) statBits.push(`${stats.turns} turn${stats.turns === 1 ? '' : 's'}`);
  if (stats?.tokens) statBits.push(fmtTokens(stats.tokens));
  if (stats?.wallMs) statBits.push(fmtMs(stats.wallMs));
  if (stats?.costUsd) statBits.push(fmtUsd(stats.costUsd));

  const isRunning = status === 'running';
  const hasTools = toolsUsed && toolsUsed.length > 0;

  return (
    <article
      className={['cm-subagent', `cm-agent-${variant}`, isRunning ? 'cm-running' : '', className || ''].filter(Boolean).join(' ')}
      data-subagent-type={role || name.toLowerCase().replace(/\s+/g, '_')}
      data-status={status}
    >
      <header className="cm-sa-head">
        <span className={`cm-avatar cm-av-sm cm-av-${variant}`} aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="cm-name">{name}</span>
        {role && <span className="cm-role">{role}</span>}
        {isRunning && (
          <span className="cm-sa-running" data-testid="subagent-running">
            <span className="cm-dot" aria-hidden />
            {' '}
            running…
          </span>
        )}
        {statBits.length > 0 && (
          <span className="cm-stats" data-testid="subagent-stats">
            {statBits.map((b, i) => (
              <span key={i}>{b}</span>
            ))}
          </span>
        )}
      </header>
      <div className="cm-sa-body">
        {description && (
          <div className="cm-sa-description" data-testid="subagent-description">
            {description}
          </div>
        )}
        {hasTools && (
          <div className="cm-sa-tools" data-testid="subagent-tools">
            <span className="cm-label">Tools used</span>
            {toolsUsed!.map((t, i) => (
              <span key={`${t}-${i}`} className="cm-sa-tool">
                {t}
              </span>
            ))}
          </div>
        )}
        {/* Mock-07 line 94 — wrap nested child tool-cards in a left-railed
         * container so the sub-agent's inner activity reads as a single
         * stage. Rail border + offsets come from .cm-sa-rail in
         * chatmode-v2.css; no inline styles here. */}
        {children !== undefined && (
          <div className="cm-sa-rail" data-testid="sa-rail">
            {children}
          </div>
        )}
        {status === 'error' && error && (
          <div className="cm-sa-error" data-testid="subagent-error">
            <strong>error</strong>
            <span>{error}</span>
          </div>
        )}
        {status === 'ok' && (output || returnValue) && (
          <div className="cm-sa-return" data-testid="subagent-return">
            <strong>returned</strong>
            {/*
             * #930 — route the sub-agent's return body through the SAME
             * markdown renderer the main chat agent uses. Theme 'dark'
             * matches AgenticActivityStream's inner-text path; the
             * iframe-style `var(--cm-*)` tokens (Rule 8b) resolve from
             * the parent document so light/dark + accent follow the
             * page-level selection.
             */}
            <span className="cm-sa-return-body">
              <SharedMarkdownRenderer
                content={(output || returnValue) as string}
                theme="dark"
              />
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
