/**
 * buildTree — pure function that converts a flat array of NormalizedStreamEvent[]
 * into a nested TreeNode[] for rendering in UnifiedActivityTree.
 *
 * For all inquiries, please contact:
 *
 * Openagentic LLC
 * hello@openagentic.io
 */

import type { NormalizedStreamEvent } from '../../../../types/AnthropicStreamEvent';

export interface TreeNode {
  id: string;
  type: 'thinking' | 'text' | 'tool' | 'agent' | 'hitl' | 'artifact' | 'error';
  status: 'pending' | 'running' | 'success' | 'error';
  children: TreeNode[];
  data: Record<string, any>;
}

export function buildTree(events: NormalizedStreamEvent[]): TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>(); // id → node
  const agentStack: string[] = []; // stack of agent IDs for nesting

  // Canonical Anthropic Messages SSE event tracking (Slice G.4a):
  // index → { kind, id, thinkingStartTime } so content_block_delta and
  // content_block_stop can locate the node opened by content_block_start.
  const blockIndex = new Map<
    number,
    { kind: 'thinking' | 'text' | 'tool_use'; id: string; thinkingStartTime?: number }
  >();
  let nextSyntheticBlockId = 0;
  const synthBlockId = (kind: string, idx: number) =>
    `${kind}-${idx}-${nextSyntheticBlockId++}`;

  for (const event of events as any[]) {
    switch (event.type) {
      // ---------------------------------------------------------------------
      // Canonical Anthropic Messages SSE wire events (Slice G.4a)
      // ---------------------------------------------------------------------
      case 'message_start':
      case 'message_stop':
      case 'message_delta':
      case 'ping':
        // Envelope events; no tree nodes
        break;

      case 'content_block_start': {
        const block = event.content_block || {};
        const idx: number = event.index;
        if (block.type === 'thinking') {
          const id = synthBlockId('cb-think', idx);
          blockIndex.set(idx, { kind: 'thinking', id, thinkingStartTime: Date.now() });
          const node: TreeNode = {
            id,
            type: 'thinking',
            status: 'running',
            children: [],
            data: { content: '', elapsedMs: 0 },
          };
          nodeMap.set(id, node);
          addToParent(node, agentStack, rootNodes, nodeMap);
        } else if (block.type === 'text') {
          // Text rendering is handled by EnhancedMessageContent; track the
          // index so deltas don't accidentally hit a stale entry but don't
          // create a tree node.
          const id = synthBlockId('cb-text', idx);
          blockIndex.set(idx, { kind: 'text', id });
        } else if (block.type === 'tool_use') {
          const id = block.id || synthBlockId('cb-tool', idx);
          blockIndex.set(idx, { kind: 'tool_use', id });
          const node: TreeNode = {
            id,
            type: 'tool',
            status: 'running',
            children: [],
            data: {
              toolName: block.name || '',
              serverName: '',
              args: '',
              result: null,
              durationMs: 0,
            },
          };
          nodeMap.set(id, node);
          addToParent(node, agentStack, rootNodes, nodeMap);
        }
        break;
      }

      case 'content_block_delta': {
        const idx: number = event.index;
        const info = blockIndex.get(idx);
        if (!info) break;
        const node = nodeMap.get(info.id);
        const delta = event.delta || {};
        if (info.kind === 'thinking' && delta.type === 'thinking_delta') {
          if (node) node.data.content = (node.data.content || '') + (delta.thinking || '');
        } else if (info.kind === 'tool_use' && delta.type === 'input_json_delta') {
          if (node) node.data.args = (node.data.args || '') + (delta.partial_json || '');
        }
        // text_delta, signature_delta, citations_delta — no tree node action
        break;
      }

      case 'content_block_stop': {
        const idx: number = event.index;
        const info = blockIndex.get(idx);
        if (!info) break;
        const node = nodeMap.get(info.id);
        if (node) {
          node.status = 'success';
          if (info.kind === 'thinking' && info.thinkingStartTime) {
            node.data.elapsedMs = Date.now() - info.thinkingStartTime;
          }
        }
        blockIndex.delete(idx);
        break;
      }

      // ---------------------------------------------------------------------
      // Platform envelope events — kept (these are NOT model-stream events;
      // they describe orchestration state the Anthropic Messages API itself
      // doesn't model). The synthetic Normalized* model-stream variants
      // (thinking_*, text_*, tool_*) were ripped in Slice G.4c — buildTree
      // now consumes only the canonical content_block_* events for those.
      // ---------------------------------------------------------------------
      case 'agent_start': {
        const node: TreeNode = {
          id: event.id,
          type: 'agent',
          status: 'running',
          children: [],
          data: {
            name: event.name,
            role: event.role,
            tokensIn: 0,
            tokensOut: 0,
            cost: 0,
            durationMs: 0,
          },
        };
        nodeMap.set(event.id, node);
        // Nested agents: if parentId, add to parent agent
        if (event.parentId && nodeMap.has(event.parentId)) {
          nodeMap.get(event.parentId)!.children.push(node);
        } else {
          addToParent(node, agentStack, rootNodes, nodeMap);
        }
        agentStack.push(event.id);
        break;
      }
      case 'agent_stop': {
        const node = nodeMap.get(event.id);
        if (node) {
          node.status = 'success';
          node.data.durationMs = event.durationMs;
          node.data.tokensIn = event.tokensIn;
          node.data.tokensOut = event.tokensOut;
          node.data.cost = event.cost;
        }
        // Pop from agent stack
        const idx = agentStack.lastIndexOf(event.id);
        if (idx >= 0) agentStack.splice(idx, 1);
        break;
      }
      case 'hitl_request': {
        const node: TreeNode = {
          id: event.id,
          type: 'hitl',
          status: 'pending',
          children: [],
          data: {
            tool: event.tool,
            description: event.description,
            scope: event.scope,
            metadata: event.metadata,
            agentId: event.agentId,
          },
        };
        nodeMap.set(event.id, node);
        addToParent(node, agentStack, rootNodes, nodeMap);
        break;
      }
      case 'hitl_response': {
        const node = nodeMap.get(event.id);
        if (node) node.status = event.approved ? 'success' : 'error';
        break;
      }
      case 'artifact_start': {
        const node: TreeNode = {
          id: event.id,
          type: 'artifact',
          status: 'running',
          children: [],
          data: {
            artifactType: event.artifactType,
            title: event.title,
            content: '',
            sizeBytes: 0,
          },
        };
        nodeMap.set(event.id, node);
        addToParent(node, agentStack, rootNodes, nodeMap);
        break;
      }
      case 'artifact_delta': {
        const node = nodeMap.get(event.id);
        if (node) node.data.content += event.content;
        break;
      }
      case 'artifact_stop': {
        const node = nodeMap.get(event.id);
        if (node) {
          node.status = 'success';
          node.data.sizeBytes = event.sizeBytes;
        }
        break;
      }
      case 'error': {
        const node: TreeNode = {
          id: `err-${rootNodes.length}`,
          type: 'error',
          status: 'error',
          children: [],
          data: { code: event.code, message: event.message, retryable: event.retryable },
        };
        rootNodes.push(node);
        break;
      }
      // stream_start, stream_end, usage — skip for tree building
    }
  }

  return rootNodes;
}

function addToParent(
  node: TreeNode,
  agentStack: string[],
  rootNodes: TreeNode[],
  nodeMap: Map<string, TreeNode>,
) {
  if (agentStack.length > 0) {
    const parentAgent = nodeMap.get(agentStack[agentStack.length - 1]);
    if (parentAgent) {
      parentAgent.children.push(node);
      return;
    }
  }
  rootNodes.push(node);
}
