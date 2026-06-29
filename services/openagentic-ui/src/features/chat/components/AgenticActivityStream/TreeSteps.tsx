/**
 * AgenticActivityStream — non-interleaved tree-step renderers.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving):
 * TreeStepItem (single step row + nested agent children + expand detail) and
 * TreeStepsContainer (the "N steps" collapsible used when contentBlocks are
 * absent). Both keep their memo identity.
 */
import React, { useState, useEffect, useMemo, memo } from 'react';
import { ChevronRight, ChevronDown } from '@/shared/icons';
import ShikiCodeBlock from '../MessageContent/ShikiCodeBlock';
import { onKeyActivate } from '@/utils/a11y';
import { humanizeToolName } from '../../utils/toolNameHumanizer';
import { StatusDot } from './StatusIndicators';
import { SummaryRich, SummaryLinks } from './SummaryRenderers';
import {
  formatDuration,
  detectErrorInOutput,
  getStructuredSummary,
  getCompactSummary,
} from './activityUtils';
import type { ToolCall } from './types/activity.types';

// ============================================================================
// Tree Step Item - REDESIGNED with left-border, category badge, compact summary
// ============================================================================

interface TreeStepItemProps {
  toolCall: ToolCall;
  isLast: boolean;
  isStreamingDone: boolean;
  childAgents?: ToolCall[];
  depth?: number;
}

const TreeStepItem: React.FC<TreeStepItemProps> = memo(({
  toolCall,
  isLast,
  isStreamingDone,
  childAgents = [],
  depth = 0,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Determine effective status
  const rawStatus = toolCall.status === 'calling' ? 'running' : toolCall.status;
  // If streaming is done and tool is still 'running', it either succeeded silently or failed.
  // Check output for errors; default to 'success' for historical (not 'error' — that shows red X everywhere).
  const effectiveStatus = (rawStatus === 'running' && isStreamingDone)
    ? (detectErrorInOutput(toolCall.output) ? 'error' : 'success')
    : rawStatus;
  const hasError = effectiveStatus === 'error' || detectErrorInOutput(toolCall.output);
  const finalStatus = hasError ? 'error' : effectiveStatus;

  const hasOutput = Boolean(toolCall.output);
  const hasInput = Boolean(toolCall.input);
  const isExpandable = hasOutput || hasInput; // Allow expanding for running tools too
  const isAgentSpawn = toolCall.toolName === 'spawn_parallel_agents';

  // Live elapsed time counter for running tools
  useEffect(() => {
    if (finalStatus !== 'running') return;
    const start = toolCall.startTime || Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [finalStatus, toolCall.startTime]);

  // Humanize the tool name
  const humanized = useMemo(() => humanizeToolName(toolCall.toolName), [toolCall.toolName]);

  // Compact summary — structured form preserves favicon/link items so the
  // success row can render them as pills (web_search, web_fetch). Falls
  // back to the flat string for tools that return text-only summaries.
  const structuredSummary = useMemo(() => getStructuredSummary(toolCall), [toolCall.output, toolCall.toolName]);
  const summary = useMemo(() => getCompactSummary(toolCall), [toolCall.output, toolCall.toolName]);

  // Brief input preview for running tools (e.g. "resourceGroupName: myRG, ...")
  const inputPreview = useMemo(() => {
    if (!toolCall.input || finalStatus !== 'running') return null;
    try {
      const obj = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;
      if (typeof obj === 'object' && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length === 0) return null;
        // Show first 2 key=value pairs as a compact preview
        const preview = entries.slice(0, 2).map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          const truncVal = val && val.length > 40 ? val.slice(0, 40) + '...' : val;
          return `${k}: ${truncVal}`;
        }).join(', ');
        return entries.length > 2 ? preview + ` (+${entries.length - 2} more)` : preview;
      }
    } catch { /* ignore */ }
    return null;
  }, [toolCall.input, finalStatus]);

  // Error message extraction — prefer a clean message field if the
  // tool output is a structured error object; fall back to the first
  // `error:` / `exception:` match; only last-resort shows a truncated
  // JSON fragment so the user isn't staring at `": 5,\n "unknown": 1`
  // leaked from the middle of an error payload.
  const errorMessage = useMemo(() => {
    if (!hasError) return null;
    if (!toolCall.output) return 'error';
    const out = toolCall.output;
    if (typeof out === 'object' && out !== null) {
      const obj = out as Record<string, unknown>;
      const msg = (obj.error || obj.message || obj.detail || obj.reason);
      if (typeof msg === 'string' && msg.trim()) {
        return msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
      }
    }
    const outStr = typeof out === 'string' ? out : JSON.stringify(out);
    const match = outStr.match(/(?:error|failed|exception)[:\s]*(.{1,80})/i);
    if (match) return match[1].trim();
    // Last resort — don't paste ANY raw JSON fragment, just say error.
    return 'error';
  }, [hasError, toolCall.output]);

  // Formatted output for detail view
  const outputForDetail = useMemo(() => {
    if (!toolCall.output) return null;
    if (typeof toolCall.output === 'string') return toolCall.output;
    return JSON.stringify(toolCall.output, null, 2);
  }, [toolCall.output]);

  // Input for detail view
  const inputForDetail = useMemo(() => {
    if (!toolCall.input) return null;
    if (typeof toolCall.input === 'string') return toolCall.input;
    return JSON.stringify(toolCall.input, null, 2);
  }, [toolCall.input]);

  // CSS class for the step border
  const stepClass = finalStatus === 'running'
    ? 'activity-step activity-step--running'
    : finalStatus === 'error'
      ? 'activity-step activity-step--error'
      : finalStatus === 'success'
        ? 'activity-step activity-step--success'
        : 'activity-step activity-step--pending';

  // Display label — match mockup 02-kubernetes-health-report.html: raw MCP
  // tool function name in JetBrains Mono, e.g. `kubectl_get_events` not
  // "Cluster Health". Humanized form is kept only for sub-agents (where
  // the role is the signal) and during running state when activeForm is
  // more descriptive than a function name (e.g. "Listing Kubernetes pods").
  const rawToolName = toolCall.toolName || 'tool';
  const baseLabel = toolCall.agentId
    ? toolCall.agentRole || rawToolName
    : isAgentSpawn && childAgents.length > 0
      ? `Orchestrating ${childAgents.length} agent${childAgents.length !== 1 ? 's' : ''}`
      : rawToolName;
  const displayLabel = finalStatus === 'running' && humanized.activeForm && !toolCall.agentId
    ? humanized.activeForm
    : baseLabel;

  const isAgent = toolCall.agentId || isAgentSpawn;

  // Format elapsed seconds to Xm Ys or Xs
  const elapsedStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  // The row body can contain nested interactive content (e.g. SummaryLinks
  // renders <a> tags), so the clickable wrapper must stay a <div> with an
  // explicit button role rather than a native <button>. Splitting the
  // expandable / non-expandable cases keeps role + tabIndex statically paired.
  const rowStyle: React.CSSProperties = {
    paddingTop: depth > 0 ? 2 : 4,
    paddingBottom: depth > 0 ? 2 : 4,
    cursor: isExpandable ? 'pointer' : 'default',
  };
  const rowInner = (
    <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status dot */}
          <StatusDot
            status={finalStatus as 'pending' | 'running' | 'success' | 'error'}
            size={depth > 0 ? 12 : 14}
          />

          {/* Mockup-parity: tiny colored dot encoding the tool's category
              instead of the large "Kubernetes" / "Monitoring" pill. Mock 02
              has just `<span class="t-name">kubectl_get_events</span>` with
              no category badge — the tool name is the signal. The dot lets
              a user scan vs. mono text column for cluster/cloud/web-type
              tools quickly without the badge eating horizontal space. */}
          {!isAgent && (
            <span
              aria-label={`${humanized.category} tool`}
              title={humanized.category}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: humanized.color,
                flexShrink: 0,
              }}
            />
          )}

          {/* Agent indicator */}
          {isAgent && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Agent
            </span>
          )}

          {/* Tool label — matches mock .t-name: JetBrains Mono, 12px,
              weight 500. For sub-agents / running activeForm strings,
              keep a non-mono fallback since they're human sentences. */}
          <span style={{
            fontFamily: isAgent || (finalStatus === 'running' && humanized.activeForm && !toolCall.agentId)
              ? undefined
              : "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: depth > 0 ? 12 : 13,
            fontWeight: 500,
            color: depth > 0 ? 'var(--color-text-secondary)' : 'var(--color-text, var(--fg-0))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: finalStatus === 'running' ? '40%' : undefined,
            flex: finalStatus === 'running' ? undefined : 1,
          }}>
            {displayLabel}
          </span>

          {/* Running: show progress message if different from activeForm */}
          {finalStatus === 'running' && toolCall.progressMessage && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.8,
            }}>
              {toolCall.progressMessage}
            </span>
          )}

          {/* Completed: show compact result preview inline. Dispatch by
              summary kind so each tool gets the richest representation
              its summarizer produces:
                - 'rich'  → SummaryRich (icon + headline + badges + items)
                - 'links' → SummaryLinks (favicon + title pills)
                - 'text'  → flat text span
              Anything else (kind 'none' or null) renders nothing.
              See openagentic#330. */}
          {finalStatus === 'success' && structuredSummary?.kind === 'rich' ? (
            <SummaryRich summary={structuredSummary} />
          ) : finalStatus === 'success' && structuredSummary?.kind === 'links' && structuredSummary.items.length > 0 ? (
            <SummaryLinks items={structuredSummary.items} />
          ) : finalStatus === 'success' && summary ? (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.7,
            }}>
              {summary}
            </span>
          ) : null}

          {/* Compact result summary or error message */}
          {finalStatus === 'error' && errorMessage && (
            <span style={{
              fontSize: 11,
              color: 'var(--cm-error)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMessage}
            </span>
          )}
          {finalStatus === 'success' && summary && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {summary}
            </span>
          )}

          {/* Duration / Elapsed timer */}
          <span style={{
            fontSize: depth > 0 ? 10 : 11,
            color: finalStatus === 'error' ? 'var(--color-err)' : finalStatus === 'running' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontWeight: finalStatus === 'running' ? 500 : 400,
          }}>
            {finalStatus === 'running' ? elapsedStr :
             toolCall.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {isExpandable && !showDetail && (
            <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {showDetail && (
            <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
        </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      {/* Main step row */}
      {isExpandable ? (
        <div
          className={stepClass}
          style={rowStyle}
          role="button"
          tabIndex={0}
          onClick={() => setShowDetail(!showDetail)}
          onKeyDown={onKeyActivate(() => setShowDetail(!showDetail))}
        >
          {rowInner}
        </div>
      ) : (
        <div className={stepClass} style={rowStyle}>
          {rowInner}
        </div>
      )}

      {/* Nested agent children */}
      {childAgents.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          {childAgents.map((agent, aIdx) => (
            <TreeStepItem
              key={agent.id}
              toolCall={agent}
              isLast={aIdx === childAgents.length - 1}
              isStreamingDone={isStreamingDone}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Expanded detail — Shiki-highlighted Input/Result sections that
          match mock 02's `<pre class="json">` + `<pre class="result">`
          styling. The section labels use the mockup terminology (Input /
          Result / Error) rather than Request/Response so the live tool
          cards scan like the mock. */}
      {showDetail && (inputForDetail || outputForDetail) && (
        <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
          {inputForDetail && (
            <div
              style={{
                borderBottom: outputForDetail
                  ? '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)'
                  : 'none',
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-3, var(--color-text-muted))',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Input
              </div>
              <ShikiCodeBlock
                language={(() => {
                  try { JSON.parse(inputForDetail); return 'json'; } catch { return 'text'; }
                })()}
                code={inputForDetail.length > 2000 ? inputForDetail.slice(0, 2000) + '\n// …truncated' : inputForDetail}
                theme="dark"
                onCopy={async (t: string) => {
                  try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                }}
              />
            </div>
          )}
          {outputForDetail && (
            <div style={{ padding: '10px 12px' }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: hasError
                    ? 'var(--cm-err)'
                    : 'var(--fg-3, var(--color-text-muted))',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                {hasError ? 'Error' : 'Result'}
              </div>
              <ShikiCodeBlock
                language={(() => {
                  try { JSON.parse(outputForDetail); return 'json'; } catch { return 'text'; }
                })()}
                code={outputForDetail.length > 4000 ? outputForDetail.slice(0, 4000) + '\n// …truncated' : outputForDetail}
                theme="dark"
                onCopy={async (t: string) => {
                  try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

TreeStepItem.displayName = 'TreeStepItem';

// ============================================================================
// Tree Steps Container - REDESIGNED with category chips in collapsed state
// ============================================================================

interface TreeStepsContainerProps {
  toolCalls: ToolCall[];
  isStreaming: boolean;
  totalDuration?: number;
  isHistorical?: boolean;
}

export const TreeStepsContainer: React.FC<TreeStepsContainerProps> = memo(({
  toolCalls,
  isStreaming,
  totalDuration,
  isHistorical = false,
}) => {
  const runningCount = toolCalls.filter(t => t.status === 'calling').length;
  const errorCount = toolCalls.filter(t => t.status === 'error' || detectErrorInOutput(t.output)).length;
  const successCount = toolCalls.filter(t => t.status === 'success' && !detectErrorInOutput(t.output)).length;
  const allComplete = runningCount === 0 && !isStreaming;
  // Walls of tool calls (3+ steps) ALWAYS start minimized — the summary header
  // ("Running N steps...") carries the live signal; the user expands on demand.
  // Small step lists (1-2) stay expanded while streaming so a single running
  // tool is visible. Historical loads always start collapsed.
  const topLevelCount = toolCalls.filter(tc => !tc.parentToolId).length;
  const isWall = topLevelCount >= 3;
  const [isExpanded, setIsExpanded] = useState(
    isWall ? false : isHistorical ? false : !allComplete
  );

  // Auto-collapse 300ms after all complete
  useEffect(() => {
    if (allComplete && toolCalls.length > 0) {
      const t = setTimeout(() => setIsExpanded(false), 300);
      return () => clearTimeout(t);
    }
  }, [allComplete, toolCalls.length]);

  // Build grouped category summary for collapsed state: "4x Azure . 3x K8s . 2x Web"
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tc of toolCalls) {
      if (tc.parentToolId) continue; // skip nested
      const h = humanizeToolName(tc.toolName);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [toolCalls]);

  // Summary icon
  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  // Summary text
  const stepCount = toolCalls.filter(tc => !tc.parentToolId).length;
  const summaryText = isStreaming
    ? `Running ${stepCount} step${stepCount !== 1 ? 's' : ''}...`
    : `${stepCount} step${stepCount !== 1 ? 's' : ''} completed`;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header line */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {summaryIcon}
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}>
          {summaryText}
        </span>
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--cm-bg)',
            background: 'var(--cm-error)',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {!isStreaming && totalDuration != null && totalDuration > 0 && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            ({formatDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {/* Collapsed: per-tool one-line summary (Claude Code style) */}
      {!isExpanded && toolCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {toolCalls.filter(tc => !tc.parentToolId).slice(0, 6).map((tc) => {
            const h = humanizeToolName(tc.toolName);
            const sum = getCompactSummary(tc);
            const isErr = tc.status === 'error' || detectErrorInOutput(tc.output);
            return (
              <div key={tc.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: '18px',
              }}>
                <StatusDot status={isErr ? 'error' : tc.status === 'calling' ? 'running' : 'success'} size={11} />
                <span
                  aria-label={`${h.category} tool`}
                  title={h.category}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: h.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  color: 'var(--color-text, var(--fg-0))',
                  whiteSpace: 'nowrap',
                }}>{h.label}</span>
                {sum && <span style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sum}</span>}
                {tc.duration != null && tc.duration > 0 && (
                  <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {formatDuration(tc.duration)}
                  </span>
                )}
              </div>
            );
          })}
          {toolCalls.filter(tc => !tc.parentToolId).length > 6 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', paddingLeft: 17 }}>
              +{toolCalls.filter(tc => !tc.parentToolId).length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Expanded: full step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {toolCalls.filter(tc => !tc.parentToolId).map((toolCall, idx, filtered) => {
            const children = toolCall.toolName === 'spawn_parallel_agents'
              ? toolCalls.filter(tc => tc.parentToolId === toolCall.id && tc.agentId)
              : [];
            return (
              <TreeStepItem
                key={toolCall.id}
                toolCall={toolCall}
                isLast={idx === filtered.length - 1}
                isStreamingDone={!isStreaming}
                childAgents={children}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

TreeStepsContainer.displayName = 'TreeStepsContainer';
