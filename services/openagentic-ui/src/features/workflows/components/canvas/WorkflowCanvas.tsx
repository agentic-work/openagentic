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
 * WorkflowCanvas - ReactFlow canvas with dot grid, event handlers, controls
 */

import React, { useCallback, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Connection,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  BackgroundVariant,
  Panel,
  MarkerType,
  OnNodesChange,
  OnEdgesChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import '../../styles/workflow-canvas.css';
import { motion } from 'framer-motion';
import { AlertCircle } from '@/shared/icons';
import { CustomNode } from '../nodes/CustomNode';
import { CustomEdge } from '../edges/CustomEdge';
import { NodeType } from '../../types/workflow.types';

// Register all node types — including 'default' fallback for unknown types
const nodeTypes: Record<string, typeof CustomNode> = {
  trigger: CustomNode, mcp_tool: CustomNode, llm_completion: CustomNode,
  code: CustomNode, condition: CustomNode, loop: CustomNode,
  transform: CustomNode, merge: CustomNode, http_request: CustomNode,
  approval: CustomNode, human_approval: CustomNode, wait: CustomNode,
  agent_spawn: CustomNode, a2a: CustomNode,
  synth: CustomNode, openagentic: CustomNode,
  openagentic_llm: CustomNode, multi_agent: CustomNode,
  text: CustomNode,
  // Agent proxy nodes
  agent_single: CustomNode, agent_pool: CustomNode, agent_supervisor: CustomNode,
  // Fallback for any unrecognized node type stored in DB
  default: CustomNode,
  // Common aliases that might be stored differently
  llm: CustomNode, webhook: CustomNode, api: CustomNode,
  input: CustomNode, output: CustomNode, start: CustomNode, end: CustomNode,
};

const edgeTypes = { default: CustomEdge };

interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: (params: Connection) => void;
  onInit: (instance: any) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void;
  nodeColorFn: (node: Node) => string;
  wrapperRef: React.RefObject<HTMLDivElement>;
}

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onInit,
  onDrop,
  onDragOver,
  onNodeClick,
  onNodeDoubleClick,
  nodeColorFn,
  wrapperRef,
}) => {
  return (
    <div className="flex-1 relative" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        attributionPosition="bottom-right"
        deleteKeyCode="Delete"
        multiSelectionKeyCode="Shift"
        snapToGrid
        snapGrid={[20, 20]}
        style={{ background: 'var(--wf-canvas-bg)' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={2}
          color="var(--wf-canvas-dot)"
        />
        <Controls />
        <MiniMap
          nodeColor={nodeColorFn}
          maskColor="rgba(0, 0, 0, 0.15)"
          style={{ opacity: 0.85 }}
        />

        {/* Empty state */}
        {nodes.length === 0 && (
          <Panel position="top-center">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="wf-glass-panel px-6 py-4 flex items-center gap-3 mt-8"
              style={{ color: '#2196f3' }}
            >
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-medium">
                Drag nodes from the palette to start building
              </span>
            </motion.div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};
