/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * buildTree — pure function that converts a flat array of NormalizedStreamEvent[]
 * into a nested TreeNode[] for rendering in UnifiedActivityTree.
 *
 * For all inquiries, please contact:
 *

 * hello@openagentics.io
 */

import type { NormalizedStreamEvent } from '../../../../types/NormalizedStreamTypes';

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

  for (const event of events) {
    switch (event.type) {
      case 'thinking_start': {
        const node: TreeNode = {
          id: event.id,
          type: 'thinking',
          status: 'running',
          children: [],
          data: { content: '', elapsedMs: 0 },
        };
        nodeMap.set(event.id, node);
        addToParent(node, agentStack, rootNodes, nodeMap);
        break;
      }
      case 'thinking_delta': {
        const node = nodeMap.get(event.id);
        if (node) node.data.content = event.accumulated;
        break;
      }
      case 'thinking_stop': {
        const node = nodeMap.get(event.id);
        if (node) {
          node.status = 'success';
          node.data.elapsedMs = event.elapsedMs;
        }
        break;
      }
      // text_start/delta/stop — SKIP. Text rendering is handled by EnhancedMessageContent.
      // Including text nodes here would cause doubled content since the old stream path
      // already feeds message.content for the main text renderer.
      case 'text_start':
      case 'text_delta':
      case 'text_stop':
        break;
      case 'tool_start': {
        const node: TreeNode = {
          id: event.id,
          type: 'tool',
          status: 'running',
          children: [],
          data: {
            toolName: event.toolName,
            serverName: event.serverName,
            args: '',
            result: null,
            durationMs: 0,
          },
        };
        nodeMap.set(event.id, node);
        // If tool has agentId, add to that agent; otherwise add to current agent or root
        const parentId =
          event.agentId ||
          (agentStack.length > 0 ? agentStack[agentStack.length - 1] : undefined);
        if (parentId && nodeMap.has(parentId)) {
          nodeMap.get(parentId)!.children.push(node);
        } else {
          addToParent(node, agentStack, rootNodes, nodeMap);
        }
        break;
      }
      case 'tool_delta': {
        const node = nodeMap.get(event.id);
        if (node) node.data.args += event.argsFragment;
        break;
      }
      case 'tool_stop': {
        const node = nodeMap.get(event.id);
        if (node) {
          node.status = 'success';
          node.data.result = event.result;
          node.data.durationMs = event.durationMs;
        }
        break;
      }
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
      // stream_start, stream_end, usage, redacted_thinking — skip for tree building
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
