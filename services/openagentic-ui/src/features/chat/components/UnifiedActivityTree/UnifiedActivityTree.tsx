/**
 * UnifiedActivityTree — renders a NormalizedStreamEvent[] as a nested tree.
 *
 * For all inquiries, please contact:
 * * hello@openagentic.io
 */

import React, { useMemo, useState } from 'react';
import type { NormalizedStreamEvent } from '../../../../types/NormalizedStreamTypes';
import { buildTree, type TreeNode as TreeNodeType } from './buildTree';
import { TreeNode } from './TreeNode';
import { TokenPill } from './TokenPill';
import { ToolDetailPanel } from './ToolDetailPanel';
import { ArtifactNode } from './ArtifactNode';
import { HITLPopup } from './HITLPopup';
import { LiveTokenBar } from './LiveTokenBar';

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
      if (e.type === 'tool_start') toolCount++;
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
                color: '#d29922',
                fontFamily: 'SF Mono, JetBrains Mono, monospace',
              }}
            >
              Thought {node.data.elapsedMs > 0 ? `for ${(node.data.elapsedMs / 1000).toFixed(1)}s` : ''}
            </span>
            {node.data.content && (
              <div
                style={{
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.4)',
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
                  backgroundColor: 'rgba(88,166,255,0.1)',
                  color: '#58a6ff',
                  fontFamily: 'SF Mono, JetBrains Mono, monospace',
                }}
              >
                {node.data.serverName || 'tool'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: '#e6edf3',
                  fontFamily: 'SF Mono, JetBrains Mono, monospace',
                }}
              >
                {node.data.toolName}
              </span>
              {node.data.durationMs > 0 && (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
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

        {node.type === 'agent' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  color: '#e6edf3',
                  fontWeight: 600,
                  fontFamily: 'SF Mono, JetBrains Mono, monospace',
                }}
              >
                {node.data.name}
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                {node.data.role}
              </span>
              <TokenPill
                tokensIn={node.data.tokensIn}
                tokensOut={node.data.tokensOut}
                cost={node.data.cost}
                live={node.status === 'running'}
              />
            </div>
            {node.children.map((child, i) => renderNode(child, i, node.children, depth + 1))}
          </div>
        )}

        {node.type === 'hitl' && (
          <div
            style={{
              fontSize: 11,
              color: '#d29922',
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
              color: '#f85149',
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
