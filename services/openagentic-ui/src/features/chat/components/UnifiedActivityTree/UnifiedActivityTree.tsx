import React, { useMemo, useState } from 'react';
import type { NormalizedStreamEvent } from '../../../../types/AnthropicStreamEvent';
import { buildTree, type TreeNode as TreeNodeType } from './buildTree';
import { TreeNode } from './TreeNode';
import { TokenPill } from './TokenPill';
import { ToolDetailPanel } from './ToolDetailPanel';
import { ArtifactNode } from './ArtifactNode';
import { HITLPopup } from './HITLPopup';
import { LiveTokenBar } from './LiveTokenBar';
import { colorHashForId, avatarInitial } from './colorHash';

interface UnifiedActivityTreeProps {
  events: NormalizedStreamEvent[];
  isStreaming: boolean;
  theme: 'light' | 'dark';
  onToolClick?: (toolId: string) => void;
  onArtifactAction?: (id: string, action: 'open' | 'copy' | 'canvas') => void;
  onHITLApprove?: (id: string) => void;
  onHITLDeny?: (id: string) => void;
}

export function UnifiedActivityTree({
  events,
  isStreaming,
  theme,
  onToolClick,
  onArtifactAction,
  onHITLApprove,
  onHITLDeny,
}: UnifiedActivityTreeProps) {
  const tree = useMemo(() => buildTree(events), [events]);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // v0.6.7 fix 5 — agent nodes are expanded by default, but each can be
  // collapsed by clicking its avatar. Collapsed state is keyed by agent id.
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());

  // Extract usage data from events
  const usageData = useMemo(() => {
    let tokensIn = 0,
      tokensOut = 0,
      cost = 0,
      contextUsed = 0,
      contextMax = 0;
    let agentCount = 0,
      toolCount = 0;
    for (const e of events) {
      if (e.type === 'usage') {
        tokensIn += e.tokensIn;
        tokensOut += e.tokensOut;
        cost += e.cost;
        contextUsed = e.contextUsed;
        contextMax = e.contextMax;
      }
      if (e.type === 'agent_start') agentCount++;
      // Slice G.3 — tool_start was ripped; canonical content_block_start
      // with content_block.type === 'tool_use' is the new tool entry.
      if (
        e.type === 'content_block_start' &&
        (e as any).content_block?.type === 'tool_use'
      ) {
        toolCount++;
      }
    }
    return { tokensIn, tokensOut, cost, agentCount, toolCount, contextUsed, contextMax };
  }, [events]);

  // Find pending HITL requests
  const pendingHITL = useMemo(() => {
    const requests = new Map<string, any>();
    for (const e of events) {
      if (e.type === 'hitl_request') requests.set(e.id, e);
      if (e.type === 'hitl_response') requests.delete(e.id);
    }
    return Array.from(requests.values());
  }, [events]);

  const toggleTool = (id: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAgent = (id: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (
    node: TreeNodeType,
    index: number,
    siblings: TreeNodeType[],
    depth: number = 0,
  ): React.ReactElement => {
    const isLast = index === siblings.length - 1;
    const statusMap: Record<string, 'success' | 'thinking' | 'running' | 'error' | 'artifact' | 'hitl'> = {
      thinking: node.status === 'running' ? 'thinking' : 'success',
      text: node.status === 'running' ? 'running' : 'success',
      tool: node.status === 'running' ? 'running' : 'success',
      agent: node.status === 'running' ? 'running' : 'success',
      hitl: 'hitl',
      artifact: 'artifact',
      error: 'error',
    };

    return (
      <TreeNode key={node.id} status={statusMap[node.type] || 'running'} isLast={isLast} depth={depth}>
        {node.type === 'thinking' && (
          <div>
            <span
              style={{
                fontSize: 11,
                color: 'var(--cm-warning)',
                fontFamily: 'SF Mono, JetBrains Mono, monospace',
              }}
            >
              Thought {node.data.elapsedMs > 0 ? `for ${(node.data.elapsedMs / 1000).toFixed(1)}s` : ''}
            </span>
            {node.data.content && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--cm-text-muted)',
                  marginTop: 2,
                  maxHeight: 60,
                  overflow: 'hidden',
                  fontStyle: 'italic',
                }}
              >
                {node.data.content.slice(0, 200)}
                {node.data.content.length > 200 ? '...' : ''}
              </div>
            )}
          </div>
        )}

        {node.type === 'tool' && (
          <div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => {
                toggleTool(node.id);
                onToolClick?.(node.id);
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  backgroundColor: 'color-mix(in srgb, var(--cm-accent) 10%, transparent)',
                  color: 'var(--cm-accent)',
                  fontFamily: 'SF Mono, JetBrains Mono, monospace',
                }}
              >
                {node.data.serverName || 'tool'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--cm-text)',
                  fontFamily: 'SF Mono, JetBrains Mono, monospace',
                }}
              >
                {node.data.toolName}
              </span>
              {node.data.durationMs > 0 && (
                <span style={{ fontSize: 10, color: 'var(--cm-text-muted)' }}>
                  {node.data.durationMs}ms
                </span>
              )}
            </div>
            {expandedTools.has(node.id) && (
              <ToolDetailPanel
                toolName={node.data.toolName}
                serverName={node.data.serverName}
                args={node.data.args}
                result={node.data.result}
                durationMs={node.data.durationMs}
              />
            )}
          </div>
        )}

        {node.type === 'agent' && (() => {
          const agentId: string = node.id ?? node.data?.id ?? '';
          const initial = avatarInitial(node.data.name, agentId);
          const color = colorHashForId(agentId, theme);
          const isCollapsed = collapsedAgents.has(agentId);
          // "Turns" == tool invocations + text-generation rounds under
          // this agent. For the tree, we simply count direct children.
          const turnCount = node.children?.length ?? 0;
          const turnLabel = turnCount === 1 ? '1 turn' : `${turnCount} turns`;
          // v0.6.7 Mockup 03 "secure api build" decomposition — render the
          // agent as an EXPANDED sub-agent card: colored-left-border
          // surface, header (avatar + name + role chip + stats), body
          // (nested thinking / tool calls + return_value). The card mirrors
          // the `.subagent` CSS in
          // docs/release-plans/v0.6.7-ux-mockups/03-secure-api-build.html
          // so a "dev agent · 2 sub-agents · 2 passes" flow decomposes
          // into a stack of clearly-separated producer + reviewer panels
          // inside the assistant message body instead of a single flat
          // "X tools completed" summary.
          const tokensIn = node.data.tokensIn ?? 0;
          const tokensOut = node.data.tokensOut ?? 0;
          const totalTok = tokensIn + tokensOut;
          const durationMs = node.data.durationMs ?? 0;
          const cost = node.data.cost ?? 0;
          const tokenLabel =
            totalTok > 0
              ? `${totalTok.toLocaleString()} tok`
              : node.status === 'running'
                ? '…'
                : '';
          const timeLabel =
            durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '';
          const costLabel = cost > 0 ? `$${cost.toFixed(3)}` : '';
          const returnNode = node.children?.find(
            c =>
              c.type === 'text' ||
              c.type === 'error' ||
              (c.data && (c.data.returnValue || c.data.isReturn)),
          );
          const statusOk =
            node.status === 'success' &&
            !(returnNode && returnNode.status === 'error');
          return (
            <div
              data-testid="agent-card"
              data-agent-id={agentId}
              data-collapsed={isCollapsed ? 'true' : 'false'}
              data-status={node.status}
              style={{
                background: 'var(--cm-bg-secondary)',
                border: '1px solid var(--cm-border)',
                borderLeft: `3px solid ${color}`,
                borderRadius: 10,
                margin: '6px 0',
                overflow: 'hidden',
              }}
            >
              {/* sa-head — avatar + name + role + stats */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  background: 'var(--cm-bg-tertiary)',
                  borderBottom: '1px solid var(--cm-border)',
                }}
              >
                <button
                  onClick={() => toggleAgent(agentId)}
                  aria-expanded={!isCollapsed}
                  aria-label={`${node.data.name ?? 'Agent'} — ${
                    isCollapsed ? 'expand' : 'collapse'
                  }`}
                  data-testid="agent-avatar"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    backgroundColor: color,
                    color: 'var(--cm-bg)',
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: 'Inter, sans-serif',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  {initial}
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--cm-text)',
                      fontWeight: 600,
                      lineHeight: 1.2,
                    }}
                  >
                    {node.data.name || 'sub-agent'}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--cm-text-secondary)',
                      lineHeight: 1.2,
                      fontFamily: 'SF Mono, JetBrains Mono, monospace',
                    }}
                  >
                    sub-agent{node.data.role ? ` · ${node.data.role}` : ''}
                  </span>
                </div>
                <div style={{ flex: 1 }} />
                <div
                  data-testid="agent-stats"
                  style={{
                    display: 'flex',
                    gap: 10,
                    fontFamily: 'SF Mono, JetBrains Mono, monospace',
                    fontSize: 11,
                    color: 'var(--cm-text-secondary)',
                  }}
                >
                  <span data-testid="agent-turn-count">{turnLabel}</span>
                  {tokenLabel && <span>{tokenLabel}</span>}
                  {timeLabel && <span>{timeLabel}</span>}
                  {costLabel && <span>{costLabel}</span>}
                </div>
              </div>
              {/* sa-body — nested children (thinking, tools, return_value) */}
              {!isCollapsed && (
                <div
                  style={{
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {node.children.length > 0 ? (
                    node.children.map((child, i) =>
                      renderNode(child, i, node.children, depth + 1),
                    )
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--cm-text-muted)',
                        fontStyle: 'italic',
                      }}
                    >
                      {node.status === 'running' ? 'running…' : 'no steps'}
                    </span>
                  )}
                  {node.status === 'success' && (
                    <div
                      data-testid="agent-return"
                      style={{
                        background: statusOk
                          ? 'color-mix(in srgb, var(--cm-success) 5%, transparent)'
                          : 'color-mix(in srgb, var(--cm-error) 6%, transparent)',
                        border: `1px solid ${
                          statusOk
                            ? 'color-mix(in srgb, var(--cm-success) 20%, transparent)'
                            : 'color-mix(in srgb, var(--cm-error) 25%, transparent)'
                        }`,
                        borderRadius: 8,
                        padding: '8px 10px',
                        fontSize: 12,
                        color: statusOk ? 'var(--cm-success)' : 'var(--cm-error)',
                        fontFamily: 'SF Mono, JetBrains Mono, monospace',
                        marginTop: 4,
                      }}
                    >
                      <strong style={{ color: statusOk ? 'var(--cm-success)' : 'var(--cm-error)' }}>
                        return_value:
                      </strong>{' '}
                      {`{ turns: ${turnCount}${
                        totalTok > 0 ? `, tokens: ${totalTok}` : ''
                      }${durationMs > 0 ? `, time: "${(durationMs / 1000).toFixed(1)}s"` : ''} }`}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {node.type === 'hitl' && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--cm-warning)',
              fontFamily: 'SF Mono, JetBrains Mono, monospace',
            }}
          >
            HITL: {node.data.tool} —{' '}
            {node.status === 'pending'
              ? 'Awaiting approval'
              : node.status === 'success'
                ? 'Approved'
                : 'Denied'}
          </div>
        )}

        {node.type === 'artifact' && (
          <ArtifactNode
            id={node.id}
            artifactType={node.data.artifactType}
            title={node.data.title}
            content={node.data.content}
            sizeBytes={node.data.sizeBytes}
            onAction={onArtifactAction}
          />
        )}

        {node.type === 'error' && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--cm-error)',
              fontFamily: 'SF Mono, JetBrains Mono, monospace',
            }}
          >
            Error: {node.data.message} ({node.data.code})
          </div>
        )}
      </TreeNode>
    );
  };

  // Don't render anything if tree has no meaningful nodes
  if (tree.length === 0 && pendingHITL.length === 0 && !isStreaming) return null;

  return (
    <div style={{ fontFamily: 'SF Mono, JetBrains Mono, monospace', fontSize: 12 }}>
      {tree.map((node, i) => renderNode(node, i, tree))}

      {/* HITL Popups */}
      {pendingHITL.map(req => (
        <HITLPopup
          key={req.id}
          visible={true}
          request={req}
          onApprove={(id: string) => onHITLApprove?.(id)}
          onDeny={(id: string) => onHITLDeny?.(id)}
        />
      ))}

      {/* Live Token Bar */}
      {(isStreaming || usageData.toolCount > 0) && (
        <LiveTokenBar {...usageData} isStreaming={isStreaming} />
      )}
    </div>
  );
}
