/**
 * AgenticActivityStream — serial tool-cluster group (the local renderer).
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving).
 * The exported component was the file-local `ToolCallGroup`; it is renamed
 * here to `TreeToolCallGroup` to remove the name collision with the imported
 * `ToolCallGroup` (aliased `ParallelFanOutGroup`) from UnifiedAgentActivity/.
 * Contains ToolTreeNode, ExpandableToolItem, CollapsedToolRow, and the group.
 */
import React, { useState, useMemo, memo } from 'react';
import { ChevronRight, ChevronDown } from '@/shared/icons';
import ShikiCodeBlock from '../MessageContent/ShikiCodeBlock';
import { onKeyActivate } from '@/utils/a11y';
import { humanizeToolName } from '../../utils/toolNameHumanizer';
import { getRendererForTool, GenericMCPRenderer } from './MCPRenderers';
import { ToolCallCard } from './components/ToolCallCard';
import { StatusDot } from './StatusIndicators';
import { HitlInlineCard } from './HitlInlineCard';
import {
  formatDuration,
  detectErrorInOutput,
  getCompactSummary,
  extractInlineChips,
  readClusterExpand,
  writeClusterExpand,
} from './activityUtils';
import type { ContentBlock, ToolCall, HitlApprovalEntry } from './types/activity.types';

interface ToolCallGroupProps {
  blocks: ContentBlock[];
  toolCalls: ToolCall[];
  theme: string;
  isStreaming?: boolean;
  isHistorical?: boolean;
  /** Stable session-scoped id for sessionStorage expand-state persistence. */
  clusterKey?: string;
  /**
   * #922 + #831 — HITL approval entries keyed by ContentBlock.id. When a
   * child tool-card's block.id is present in the map, the matching
   * HitlInlineCard renders INSIDE that child's tool-card wrapper so the
   * approval prompt stays glued to the specific tool that triggered it
   * even as the cluster grows with additional consecutive tool_use blocks.
   *
   * Pre-fix the HITL nodes were appended as siblings AFTER the whole
   * cluster wrapper — when the model emitted N tools back-to-back, the
   * card "migrated" to the end of the cluster (visually below tool #N),
   * far from the gated tool. Customer-visible "where did my approval
   * prompt go?" regression.
   */
  hitlByBlockId?: ReadonlyMap<string, HitlApprovalEntry>;
  onApproveHitl?: (requestId: string) => void;
  onDenyHitl?: (requestId: string) => void;
}

/** Tree node for building hierarchical tool call structure */
interface ToolTreeNode {
  block: ContentBlock;
  children: ToolTreeNode[];
}

/** Expandable tool item with category badge, summary, and structured detail */
const ExpandableToolItem: React.FC<{
  block: ContentBlock;
  toolCall?: ToolCall;
  isRunning: boolean;
  hasError: boolean;
  isLastRunning: boolean;
  children?: ToolTreeNode[];
  allToolCalls: ToolCall[];
  depth?: number;
  isHistorical?: boolean;
  // v0.6.7 task #159 — threaded through so the embedded ToolCallCard
  // (live input_json_delta pane) can inherit the surrounding theme.
  theme?: 'light' | 'dark';
}> = memo(({ block, toolCall, isRunning, hasError, isLastRunning, children = [], allToolCalls, depth = 0, isHistorical = false, theme = 'dark' }) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isChildrenOpen, setIsChildrenOpen] = useState(!isHistorical);
  const toolName = block.toolName || toolCall?.toolName || 'Tool';
  const isAgentSpawn = toolName === 'spawn_parallel_agents';
  const isAgentBlock = !!block.agentId;
  const hasChildren = children.length > 0;

  // Humanize
  const humanized = useMemo(() => humanizeToolName(toolName), [toolName]);

  // Compact summary
  const summary = useMemo(() => {
    if (!toolCall) return null;
    return getCompactSummary(toolCall);
  }, [toolCall]);

  // Error message — prefer a proper .error/.message/.detail field from a
  // structured error object. Fall back to first `error:` / `failed:` /
  // `exception:` regex match. Never leak a middle-of-JSON fragment
  // (`": 5,\n "unknown": 1`) into the tool row — just say "error" if we
  // can't find a clean message.
  const errorMsg = useMemo(() => {
    if (!hasError) return null;
    if (!toolCall?.output) return 'error';
    const out = toolCall.output;
    if (typeof out === 'object' && out !== null) {
      const obj = out as Record<string, unknown>;
      const msg = obj.error || obj.message || obj.detail || obj.reason;
      if (typeof msg === 'string' && msg.trim()) {
        return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
      }
    }
    const outStr = typeof out === 'string' ? out : JSON.stringify(out);
    const match = outStr.match(/(?:error|failed|exception)[:\s]*([^"}{\n]{1,60})/i);
    if (match) return match[1].trim();
    return 'error';
  }, [hasError, toolCall?.output]);

  // Format tool input/output for display
  const toolInput = toolCall?.input || (toolCall as { arguments?: unknown } | undefined)?.arguments;
  const toolOutput = toolCall?.output;
  const inputStr = toolInput
    ? (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2))
    : null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2))
    : null;

  // Determine step status
  const status: 'running' | 'success' | 'error' | 'pending' = isRunning
    ? 'running'
    : hasError
      ? 'error'
      : 'success';

  const stepClass = `activity-step activity-step--${status}`;

  return (
    <div>
      <div
        className={stepClass}
        style={{
          paddingTop: depth > 0 ? 2 : 4,
          paddingBottom: depth > 0 ? 2 : 4,
          cursor: (hasChildren || (!isRunning && (inputStr || outputStr))) ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (hasChildren) {
            setIsChildrenOpen(!isChildrenOpen);
          } else if (!isRunning) {
            setIsDetailOpen(!isDetailOpen);
          }
        }}
        onKeyDown={onKeyActivate(() => {
          if (hasChildren) {
            setIsChildrenOpen(!isChildrenOpen);
          } else if (!isRunning) {
            setIsDetailOpen(!isDetailOpen);
          }
        })}
        role="button"
        tabIndex={0}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status */}
          <StatusDot status={status} size={depth > 0 ? 12 : 14} />

          {/* Category badge or Agent badge */}
          {isAgentBlock ? (
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
          ) : isAgentSpawn ? (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Orchestration
            </span>
          ) : (
            /* Mock 02 parity — tiny colored dot (6px) encoding tool
               category instead of the verbose "Kubernetes"/"Monitoring"
               pill. The mock shows bare `<span class="t-name">` with
               only the raw MCP function name. */
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

          {/* Tool name in JetBrains Mono to match mock .t-name. For
              sub-agents (role is the signal) or delegate-to-agent
              synthetic rows (description text, not a function name)
              keep sans. */}
          <span style={{
            fontFamily: isAgentBlock || isAgentSpawn
              ? undefined
              : "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: depth > 1 ? 12 : 13,
            fontWeight: 500,
            color: depth > 1 ? 'var(--color-text-secondary)' : 'var(--color-text, var(--fg-0))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {isAgentBlock
              ? (block.agentRole || toolName)
              : isAgentSpawn
                ? `Delegate to ${children.length} Agent${children.length !== 1 ? 's' : ''}`
                : (toolName || humanized.label)}
          </span>

          {/* Summary or error */}
          {hasError && errorMsg && (
            <span style={{
              fontSize: 11,
              color: 'var(--cm-error)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMsg}
            </span>
          )}
          {!isRunning && !hasError && summary && (
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

          {/* Duration */}
          <span style={{
            fontSize: 11,
            color: hasError ? 'var(--color-err)' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {isRunning ? 'running...' :
             toolCall?.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {!isRunning && !hasChildren && (inputStr || outputStr) && (
            isDetailOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {hasChildren && (
            isChildrenOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{children.length}</span>
                </span>
          )}
        </div>
      </div>

      {/* Agent streamed content */}
      {isAgentBlock && block.content && block.content.trim() && (isRunning || isDetailOpen || isChildrenOpen) && (
        <div style={{
          marginLeft: 16,
          padding: '4px 10px',
          borderLeft: '2px solid var(--color-border)',
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
            {block.content.length > 2000 ? block.content.slice(0, 2000) + '...' : block.content}
          </pre>
        </div>
      )}

      {/* v0.6.7 task #159 — live input_json_delta pane for executing tools.
          Uses the premium ToolCallCard with status="calling" and the
          partial JSON piped into inputDeltaContent. The card is rendered
          *below* the summary row so the row keeps its compact Claude-Code
          look and the live JSON streams inside the card with a blinking
          caret + "streaming…" label. Phase F.1 (tool_input_delta) behavior
          is preserved — block.content still carries the partial JSON.
          #515 — drop the content-truthy gate so fast tools (no/small
          delta payload) still get a streaming card on dispatch (mock 01
          parity: card visible the moment a tool is dispatched). */}
      {!isAgentBlock && isRunning && !hasChildren && (
        <div style={{ marginLeft: depth > 0 ? 12 : 16, marginTop: 2, marginBottom: 4 }}>
          <ToolCallCard
            toolName={toolName}
            displayName={humanized.label}
            toolInput={toolInput}
            toolOutput={undefined}
            status="calling"
            startTime={block.startTime}
            progressMessage={(block as { progressMessage?: string }).progressMessage}
            inputDeltaContent={block.content}
            collapsible={true}
            isCollapsed={true}
            theme={theme}
          />
        </div>
      )}

      {/* Nested children */}
      {hasChildren && isChildrenOpen && (
        <div style={{ paddingLeft: 16 }}>
          {children.map((child, cIdx) => {
            const childToolCall = allToolCalls.find(tc => tc.id === child.block.toolId);
            const childHasError = child.block.isComplete ? detectErrorInOutput(childToolCall?.output) : false;
            const childIsRunning = !child.block.isComplete;
            const childIsLast = cIdx === children.length - 1;
            return (
              <ExpandableToolItem
                key={child.block.id}
                block={child.block}
                toolCall={childToolCall}
                isRunning={childIsRunning}
                hasError={childHasError}
                isLastRunning={childIsRunning && childIsLast}
                allToolCalls={allToolCalls}
                depth={depth + 1}
                isHistorical={isHistorical}
                theme={theme}
              >
                {child.children}
              </ExpandableToolItem>
            );
          })}
        </div>
      )}

      {/* Expandable detail panel
          First try a specialized MCPToolRenderer (WebSearchRenderer, WebFetchRenderer,
          SerenaFileRenderer, etc.) — these render rich views with favicons + links
          for web_search, line-numbered excerpts for file reads, etc. If the tool
          has no specialized renderer, fall back to raw Request/Response JSON dump. */}
      {isDetailOpen && !isRunning && !isAgentBlock && !hasChildren && (() => {
        const Specialized = getRendererForTool(toolName);
        const hasSpecialized = Specialized !== GenericMCPRenderer;
        if (hasSpecialized) {
          return (
            <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
              <Specialized
                toolName={toolName}
                toolId={toolCall?.id || block.toolId || ''}
                input={toolInput}
                output={toolOutput}
                status={hasError ? 'error' : 'success'}
                isComplete={true}
                duration={toolCall?.duration}
              />
            </div>
          );
        }
        return (
          <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
            {inputStr && (
              <div
                style={{
                  borderBottom: outputStr
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
                    try { JSON.parse(inputStr); return 'json'; } catch { return 'text'; }
                  })()}
                  code={inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n// …truncated' : inputStr}
                  theme="dark"
                  onCopy={async (t: string) => {
                    try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                  }}
                />
              </div>
            )}
            {outputStr && (
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
                    try { JSON.parse(outputStr); return 'json'; } catch { return 'text'; }
                  })()}
                  code={outputStr.length > 4000 ? outputStr.slice(0, 4000) + '\n// …truncated' : outputStr}
                  theme="dark"
                  onCopy={async (t: string) => {
                    try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                  }}
                />
              </div>
            )}
            {!inputStr && !outputStr && (
              <div style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>No data available</div>
            )}
          </div>
        );
      })()}
    </div>
  );
});
ExpandableToolItem.displayName = 'ExpandableToolItem';

/**
 * B3 / mock 06:267-349 — completed tool-card opens to INPUT/RESULT panels.
 *
 * Round 18 chatmode parity gap: the "11 tools completed" group rendered each
 * tool as a one-line summary row that was a dead-click. Mock 06 specifies
 * each completed tool MUST be independently openable to a body with an
 * INPUT pill and a RESULT pill — same anatomy as the in-flight v2/ToolCard.
 *
 * `<CollapsedToolRow>` is the openable inline row used inside the
 * `!isExpanded` branch of `<ToolCallGroup>`. Click toggles a body with
 * `data-testid="tool-input"` + `data-testid="tool-result"` panels rendered
 * via `ShikiCodeBlock` (same renderer as the expanded detail panel —
 * keeps JSON-pretty + copy semantics consistent across both paths).
 *
 * Test contract: `services/openagentic-ui/src/features/chat/components/
 * __tests__/AgenticActivityStream.collapsedRowClickToExpand.test.tsx`.
 */
interface CollapsedToolRowProps {
  block: ContentBlock;
  toolCall?: ToolCall;
  rowOpen: boolean;
  onToggle: () => void;
}

const CollapsedToolRow: React.FC<CollapsedToolRowProps> = memo(({ block, toolCall, rowOpen, onToggle }) => {
  const name = block.toolName || 'Tool';
  const h = humanizeToolName(name);
  const tc = toolCall;
  const sum = tc ? getCompactSummary(tc) : null;
  const isErr = block.isComplete && (block.error || (tc && detectErrorInOutput(tc.output)));
  const inlineChips = extractInlineChips(name, tc, block);

  // `arguments` is a legacy wire field not on the ToolCall type (owned by
  // activity.types in another shard) — cast locally to read the fallback.
  const toolInput = tc?.input || (tc as { arguments?: unknown } | undefined)?.arguments;
  const toolOutput = tc?.output;
  const inputStr = toolInput
    ? (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2))
    : null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2))
    : null;
  const hasBody = !!(inputStr || outputStr);

  return (
    <div data-collapsed-row data-tool-name={name} data-tool-status={isErr ? 'err' : (!block.isComplete ? 'running' : 'ok')}>
      <button
        type="button"
        aria-expanded={rowOpen}
        onClick={(e) => { e.stopPropagation(); if (hasBody) onToggle(); }}
        disabled={!hasBody}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: '18px',
          background: 'transparent',
          border: 'none',
          padding: '2px 0',
          width: '100%',
          textAlign: 'left',
          cursor: hasBody ? 'pointer' : 'default',
        }}
      >
        <StatusDot status={isErr ? 'error' : !block.isComplete ? 'running' : 'success'} size={11} />
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
        {inlineChips.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {inlineChips.map((chip, i) => {
              const pillStyle: React.CSSProperties = {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--color-border) 25%, transparent)',
                color: 'var(--color-text-secondary)',
                textDecoration: 'none',
                maxWidth: 160,
              };
              const inner = (
                <>
                  {chip.favicon && (
                    <img
                      src={chip.favicon}
                      alt=""
                      width={12}
                      height={12}
                      style={{ borderRadius: 2, flexShrink: 0 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chip.label}
                  </span>
                </>
              );
              if (chip.url) {
                return (
                  <a
                    key={chip.url + i}
                    href={chip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={chip.tooltip}
                    onClick={(e) => e.stopPropagation()}
                    style={pillStyle}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span key={chip.label + i} title={chip.tooltip} style={pillStyle}>
                  {inner}
                </span>
              );
            })}
          </span>
        )}
        {block.duration != null && block.duration > 0 && (
          <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {formatDuration(block.duration)}
          </span>
        )}
        {hasBody && (
          rowOpen
            ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden />
            : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden />
        )}
      </button>
      {rowOpen && hasBody && (
        <div
          data-tool-card-body
          style={{
            marginLeft: 22,
            marginTop: 4,
            marginBottom: 6,
            borderLeft: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
            paddingLeft: 10,
          }}
        >
          {inputStr && (
            <section data-testid="tool-input" style={{ marginBottom: outputStr ? 8 : 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--fg-3, var(--color-text-muted))', fontWeight: 600,
              }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, background: 'var(--color-surface-2)',
                  color: 'var(--fg-2, var(--color-text-secondary))', fontSize: 9,
                }}>INPUT</span>
              </div>
              <ShikiCodeBlock
                language={(() => { try { JSON.parse(inputStr); return 'json'; } catch { return 'text'; } })()}
                code={inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n// …truncated' : inputStr}
                theme="dark"
                onCopy={async (t: string) => { try { await navigator.clipboard.writeText(t); } catch { /* swallow */ } }}
              />
            </section>
          )}
          {outputStr && (
            <section data-testid="tool-result">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: isErr ? 'var(--cm-err)' : 'var(--fg-3, var(--color-text-muted))',
                fontWeight: 600,
              }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, background: 'var(--color-surface-2)',
                  color: 'var(--fg-2, var(--color-text-secondary))', fontSize: 9,
                }}>{isErr ? 'ERROR' : (<>RESULT</>)}</span>
              </div>
              <ShikiCodeBlock
                language={(() => { try { JSON.parse(outputStr); return 'json'; } catch { return 'text'; } })()}
                code={outputStr.length > 4000 ? outputStr.slice(0, 4000) + '\n// …truncated' : outputStr}
                theme="dark"
                onCopy={async (t: string) => { try { await navigator.clipboard.writeText(t); } catch { /* swallow */ } }}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
});
CollapsedToolRow.displayName = 'CollapsedToolRow';

export const TreeToolCallGroup: React.FC<ToolCallGroupProps> = memo(({ blocks, toolCalls, theme, isStreaming, isHistorical = false, clusterKey, hitlByBlockId, onApproveHitl, onDenyHitl }) => {
  const allComplete = blocks.every(b => b.isComplete);
  const isCluster = blocks.length >= 2;
  const storedExpand = useMemo(() => readClusterExpand(clusterKey), [clusterKey]);
  // Stream ≡ final-render invariant (CLAUDE.md rule 8a + user direction
  // 2026-05-17 PM: "stream and finished result have to be EXACTLY THE
  // SAME"). Default to expanded so children stay visible at all times —
  // no flip from "individual cards" → "cluster summary" when the 2nd
  // tool arrives mid-stream, no auto-collapse 300ms after completion.
  // User's manual click-to-collapse persists via sessionStorage.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (storedExpand !== null) return storedExpand;
    return true;
  });
  // B3 / mock 06:267-349 — per-row open state for the collapsed summary view.
  // Tracks which inline rows the user has opened to inspect INPUT/RESULT
  // without expanding the whole group tree.
  const [openRowIds, setOpenRowIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (): void => {
    setIsExpanded((prev) => {
      const next = !prev;
      writeClusterExpand(clusterKey, next);
      return next;
    });
  };

  // Build tree structure
  const tree = useMemo((): ToolTreeNode[] => {
    const toolIdSet = new Set(blocks.map(b => b.toolId).filter(Boolean));
    const childMap = new Map<string, ToolTreeNode[]>();
    const roots: ToolTreeNode[] = [];

    for (const block of blocks) {
      const node: ToolTreeNode = { block, children: [] };
      if (block.parentToolId && toolIdSet.has(block.parentToolId)) {
        const siblings = childMap.get(block.parentToolId) || [];
        siblings.push(node);
        childMap.set(block.parentToolId, siblings);
      } else {
        roots.push(node);
      }
    }

    const attachChildren = (node: ToolTreeNode): void => {
      if (node.block.toolId) {
        const children = childMap.get(node.block.toolId);
        if (children) {
          node.children = children;
          children.forEach(attachChildren);
        }
      }
    };
    roots.forEach(attachChildren);
    return roots;
  }, [blocks]);

  const totalCount = blocks.length;
  const errorCount = blocks.filter(b => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return detectErrorInOutput(tc?.output);
  }).length;

  const totalDuration = blocks.reduce((sum, b) => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return sum + (tc?.duration || 0);
  }, 0);

  // Category summary for collapsed view
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of blocks) {
      if (b.parentToolId) continue;
      const name = b.toolName || toolCalls.find(tc => tc.id === b.toolId)?.toolName || '';
      const h = humanizeToolName(name);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [blocks, toolCalls]);

  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  const clusterNamesPreview = useMemo(() => {
    if (!isCluster) return { head: '', extra: 0 };
    const names = blocks.map((b) => {
      const tc = toolCalls.find((t) => t.id === b.toolId);
      const raw = b.toolName || tc?.toolName || 'tool';
      return humanizeToolName(raw).label;
    });
    if (names.length <= 2) return { head: names.join(', '), extra: 0 };
    return { head: names.slice(0, 2).join(', '), extra: names.length - 2 };
  }, [blocks, toolCalls, isCluster]);

  return (
    <div
      data-testid={isCluster ? 'tool-cluster' : undefined}
      data-tool-count={blocks.length}
      style={{ marginBottom: 4 }}
    >
      {/* Header */}
      <button
        data-testid={isCluster ? 'tool-cluster-header' : undefined}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
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
          {totalCount === 1
            ? (() => {
                const singleTool = blocks[0];
                const singleName = singleTool.toolName || toolCalls.find(tc => tc.id === singleTool.toolId)?.toolName || 'Tool';
                const h = humanizeToolName(singleName);
                return allComplete
                  ? errorCount > 0 ? `${h.label} failed` : h.label
                  : `${h.label}...`;
              })()
            : allComplete
              ? errorCount > 0
                ? `${totalCount} tools completed (${totalCount - errorCount} succeeded, ${errorCount} failed)`
                : `${totalCount} tools completed`
              : `Running ${totalCount} tools...`}
        </span>
        {isCluster && clusterNamesPreview.head && (
          <span
            data-testid="tool-cluster-names"
            style={{
              fontSize: 12,
              color: 'var(--cm-fg-2, var(--color-text-muted))',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 380,
            }}
          >
            {clusterNamesPreview.head}
            {clusterNamesPreview.extra > 0 ? ` +${clusterNamesPreview.extra} more` : ''}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--cm-fg-on-accent, var(--color-text-on-primary))',
            background: 'var(--cm-err, var(--color-error))',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {totalDuration > 0 && (
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

      {/* Collapsed: per-tool one-line summary (Claude Code style).
          B3 / mock 06:267-349 — each row is now an openable
          <CollapsedToolRow> with INPUT/RESULT panels.
          Slice B (2026-05-16): cluster-collapsed view (N>=2) renders the
          one-line summary in the header alone — skip the inline row strip so
          the cluster reads as a single compact block, not 2-6 stacked rows. */}
      {!isExpanded && !isCluster && blocks.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {blocks.slice(0, 6).map((block) => {
            const tc = toolCalls.find(t => t.id === block.toolId);
            const rowOpen = openRowIds.has(block.id);
            return (
              <CollapsedToolRow
                key={block.id}
                block={block}
                toolCall={tc}
                rowOpen={rowOpen}
                onToggle={() => {
                  setOpenRowIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(block.id)) next.delete(block.id);
                    else next.add(block.id);
                    return next;
                  });
                }}
              />
            );
          })}
        </div>
      )}

      {/* Expanded: hierarchical step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {tree.map((node, idx) => {
            const toolCall = toolCalls.find(tc => tc.id === node.block.toolId);
            const isRunning = !node.block.isComplete && isStreaming !== false;
            const hasError = node.block.isComplete
              ? detectErrorInOutput(toolCall?.output)
              : (!node.block.isComplete && isStreaming === false);
            const isLast = idx === tree.length - 1;
            const childToolName = node.block.toolName || toolCall?.toolName || 'tool';
            const childStatus: 'running' | 'success' | 'error' = isRunning
              ? 'running'
              : hasError
                ? 'error'
                : 'success';

            const item = (
              <ExpandableToolItem
                key={node.block.id}
                block={node.block}
                toolCall={toolCall}
                isRunning={isRunning}
                hasError={hasError}
                isLastRunning={isRunning && isLast}
                allToolCalls={toolCalls}
                depth={0}
                isHistorical={isHistorical}
                theme={theme === 'light' || theme === 'dark' ? theme : 'dark'}
              >
                {node.children}
              </ExpandableToolItem>
            );

            if (isCluster) {
              // #922+#831 — when a HITL approval is paired with THIS specific
              // child block (by ContentBlock.id), embed the HitlInlineCard
              // INSIDE the per-child tool-card wrapper. Pre-fix the HITL
              // card was appended after the whole cluster wrapper, so a
              // growing cluster pushed the card to the bottom of the message
              // and broke the visual coupling to the gated tool.
              const childHitlEntry = hitlByBlockId?.get(node.block.id);
              return (
                <div
                  key={node.block.id}
                  data-testid="tool-card"
                  data-tool-name={childToolName}
                  data-status={childStatus}
                >
                  {item}
                  {childHitlEntry && (
                    <div
                      data-testid="hitl-approval-strip"
                      data-block-id={node.block.id}
                    >
                      <HitlInlineCard
                        entry={childHitlEntry}
                        onApprove={onApproveHitl}
                        onDeny={onDenyHitl}
                      />
                    </div>
                  )}
                </div>
              );
            }
            return item;
          })}
        </div>
      )}
    </div>
  );
});

TreeToolCallGroup.displayName = 'ToolCallGroup';

