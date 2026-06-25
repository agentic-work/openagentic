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
  code: CustomNode, condition: CustomNode, switch: CustomNode, loop: CustomNode,
  transform: CustomNode, merge: CustomNode, parallel: CustomNode,
  http_request: CustomNode, webhook_response: CustomNode,
  approval: CustomNode, human_approval: CustomNode, wait: CustomNode,
  agent_spawn: CustomNode, a2a: CustomNode,
  synth: CustomNode,
  openagentic_llm: CustomNode, multi_agent: CustomNode,
  text: CustomNode, reasoning: CustomNode, structured_output: CustomNode,
  rag_query: CustomNode, data_source_query: CustomNode, file_upload: CustomNode,
  text_splitter: CustomNode, embedding: CustomNode, vector_store: CustomNode,
  document_loader: CustomNode, sub_workflow: CustomNode, error_handler: CustomNode,
  user_context: CustomNode, guardrails: CustomNode,
  slack_message: CustomNode, teams_message: CustomNode, discord_message: CustomNode,
  send_email: CustomNode, outlook_email: CustomNode,
  pagerduty_incident: CustomNode, servicenow_ticket: CustomNode, jira_issue: CustomNode,
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
  /** Right-click handler for canvas nodes — fires the platform's
   *  context menu. The wrapper preventDefaults the native menu so
   *  the floating NodeContextMenu can take over. */
  onNodeContextMenu?: (event: React.MouseEvent, node: Node) => void;
  nodeColorFn: (node: Node) => string;
  wrapperRef: React.RefObject<HTMLDivElement>;
  /**
   * If provided, ReactFlow opens at this zoom/pan instead of running its
   * own fitView. We persist the user's last viewport per workflow id so
   * the camera state survives reload.
   */
  defaultViewport?: { x: number; y: number; zoom: number };
  /** Fired when the user finishes a pan/zoom interaction. */
  onMoveEnd?: (event: any, viewport: { x: number; y: number; zoom: number }) => void;
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
  onNodeContextMenu,
  nodeColorFn,
  wrapperRef,
  defaultViewport,
  onMoveEnd,
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
        onNodeContextMenu={(e, n) => {
          // Suppress the browser's native context menu so the floating
          // NodeContextMenu can render in its place.
          e.preventDefault();
          onNodeContextMenu?.(e, n);
        }}
        onMoveEnd={onMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={defaultViewport}
        fitView={!defaultViewport}
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
              style={{ color: 'var(--color-info)' }}
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
