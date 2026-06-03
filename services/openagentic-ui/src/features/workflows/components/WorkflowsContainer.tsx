/**
 * WorkflowsContainer - Slim orchestrator
 * Composes: WorkflowToolbar, NodePalette, WorkflowCanvas, NodePropertiesPanel, ExecutionPanel
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  Node,
  Edge,
  Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  MarkerType,
} from 'reactflow';
import dagre from 'dagre';

import { WorkflowDefinition, NodeType } from '../types/workflow.types';
import { nodeTypeConfigs } from '../utils/nodeConfigs';
import { validateWorkflow, validateNode, type WorkflowValidationResult } from '../utils/workflowValidator';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { useFlowCostEstimate } from '../hooks/useFlowCostEstimate';
import { WorkflowCanvas } from './canvas/WorkflowCanvas';
import { WorkflowToolbar } from './toolbar/WorkflowToolbar';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { ExecutionResultsPanel, ExecutionData, NodeExecution, TabId } from './ExecutionResultsPanel';
import { RunInputsModal, type RunInputDef } from './RunInputsModal';
import { NeedsInputForm, type NeedsInputRequest } from './NeedsInputForm';
import { MissingSecretsWizard, type MissingSecretEntry } from './MissingSecretsWizard';
import { scanMissingSecrets } from '../services/scanMissingSecrets';
import { listKnownSecretNames, createSecrets } from '../services/workflowSecretsApi';
import { loadViewport, saveViewport, type CanvasViewport } from '../services/canvasViewportStorage';
import { MultiAgentSwarmPopover, type SubagentCardData, type SubagentStatus } from './MultiAgentSwarmPopover';
import { useWorkflowResources } from '../hooks/useWorkflowResources';
import { useBackendNodes } from '../hooks/useBackendNodes';
import { useAgentNodes } from '../hooks/useAgentNodes';
import { AIFlowBuilder } from './AIFlowBuilder';
import type { CanvasContext, ExecutionContext, WorkflowPatch } from '../hooks/useAIFlowChat';
import { ShareDialog } from './ShareDialog';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { VersionDiffView } from './VersionDiffView';
import { PreflightValidationPopover, type IncompleteNodeEntry } from './PreflightValidationPopover';
import { NodeContextMenu } from './NodeContextMenu';
import { buildNodeContextMenuItems } from './buildNodeContextMenuItems';

// Auto-layout using dagre (top-to-bottom)
const NODE_WIDTH = 260;
const NODE_HEIGHT = 80;

function applyDagreLayout(nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB'): Node[] {
  if (nodes.length === 0) return nodes;
  try {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80, edgesep: 30 });
    nodes.forEach(node => {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });
    edges.forEach(edge => {
      if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
        g.setEdge(edge.source, edge.target);
      }
    });
    dagre.layout(g);
    return nodes.map(node => {
      const nodeWithPosition = g.node(node.id);
      if (!nodeWithPosition || typeof nodeWithPosition.x !== 'number') {
        // Fallback: grid layout if dagre failed for this node
        const idx = nodes.indexOf(node);
        return { ...node, position: { x: (idx % 3) * (NODE_WIDTH + 40), y: Math.floor(idx / 3) * (NODE_HEIGHT + 60) } };
      }
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - NODE_WIDTH / 2,
          y: nodeWithPosition.y - NODE_HEIGHT / 2,
        },
      };
    });
  } catch (err) {
    console.error('[WorkflowCanvas] Dagre layout failed, using grid fallback:', err);
    return nodes.map((node, idx) => ({
      ...node,
      position: node.position?.x != null ? node.position : {
        x: (idx % 3) * (NODE_WIDTH + 40),
        y: Math.floor(idx / 3) * (NODE_HEIGHT + 60),
      },
    }));
  }
}

/** Ensure all nodes have valid position data, applying layout if needed */
function ensureNodePositions(nodes: Node[], edges: Edge[]): Node[] {
  const needsLayout = nodes.some(n => !n.position || typeof n.position.x !== 'number' || isNaN(n.position.x));
  if (needsLayout && nodes.length > 0) {
    return applyDagreLayout(nodes, edges);
  }
  return nodes;
}

interface ExecutionEvent {
  type: string;
  executionId?: string;
  nodeId?: string;
  nodeType?: string;
  data?: any;
  output?: any;
  outputEnvelope?: any;
  error?: string;
  /** Reason for node_error events (e.g. 'output_failed_assertion') */
  reason?: string;
  /** Human-readable assertion error message for output_failed_assertion errors */
  errorMessage?: string;
  executionTimeMs?: number;
  timestamp?: string;
}

interface WorkflowsContainerProps {
  workflowId?: string;
  workflowName?: string;
  workflowDescription?: string;
  initialWorkflow?: WorkflowDefinition;
  initialExecutionId?: string;
  onSave?: (workflow: WorkflowDefinition) => Promise<void>;
  onExecute?: (workflow: WorkflowDefinition, onProgress?: (event: ExecutionEvent) => void) => Promise<void>;
  onBack?: () => void;
  onShare?: () => void;
  onTestNode?: (nodeId: string, nodeDef: { type: string; data: Record<string, any> }) => Promise<void>;
  theme?: 'light' | 'dark';
}

const WorkflowCanvasInner: React.FC<WorkflowsContainerProps> = ({
  workflowId,
  workflowName: initialWorkflowName = 'Untitled Workflow',
  workflowDescription,
  initialWorkflow,
  initialExecutionId,
  onSave,
  onExecute,
  onBack,
  onShare,
  onTestNode,
}) => {
  const { getAuthHeaders } = useAuth();
  const apiService = useMemo(() => new WorkflowApiService(getAuthHeaders), [getAuthHeaders]);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    ensureNodePositions(initialWorkflow?.nodes || [], initialWorkflow?.edges || [])
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialWorkflow?.edges || []);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Auto-fit-on-load (#76): when the canvas instance mounts BEFORE the nodes
  // load (async fetch), we miss the fit window inside onInit. Trigger one
  // fitView the first time nodes appear, but only if the user has no
  // saved viewport for this workflow yet.
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    if (didAutoFitRef.current) return;
    if (!reactFlowInstance) return;
    if (nodes.length === 0) return;
    if (workflowId && loadViewport(workflowId)) {
      didAutoFitRef.current = true;
      return;
    }
    didAutoFitRef.current = true;
    setTimeout(() => reactFlowInstance.fitView?.({ padding: 0.15 }), 200);
  }, [reactFlowInstance, nodes.length, workflowId]);

  // Reset the auto-fit guard when navigating between workflows so the next
  // one auto-fits on first load.
  useEffect(() => {
    didAutoFitRef.current = false;
  }, [workflowId]);

  // Undo/redo support (Ctrl+Z / Ctrl+Shift+Z)
  const { takeSnapshot } = useUndoRedo(nodes, edges, setNodes, setEdges);

  // Pre-run cost estimate. Hook fetches /api/workflows/cost-rates once and
  // walks the nodes; toolbar renders only when the resulting totalUsd > 0.
  const costEstimate = useFlowCostEstimate(nodes, edges);

  // Wrap onNodesChange/onEdgesChange to snapshot before destructive changes
  const wrappedOnNodesChange = useCallback((changes: any[]) => {
    if (changes.some((c: any) => c.type === 'remove')) takeSnapshot();
    onNodesChange(changes);
  }, [onNodesChange, takeSnapshot]);
  const wrappedOnEdgesChange = useCallback((changes: any[]) => {
    if (changes.some((c: any) => c.type === 'remove')) takeSnapshot();
    onEdgesChange(changes);
  }, [onEdgesChange, takeSnapshot]);

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState(initialWorkflowName);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(false);
  const [showAIBuilder, setShowAIBuilder] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Execution lifecycle state for Pause/Resume/Cancel
  const [executionLifecycleState, setExecutionLifecycleState] = useState<
    'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  >('idle');
  // Track the active execution ID for pause/cancel/resume
  const activeExecutionIdRef = useRef<string | null>(null);

  // Version history panel state
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [workflowVersions, setWorkflowVersions] = useState<any[]>([]);
  const [comparingVersion, setComparingVersion] = useState<any | null>(null);

  // Pre-flight validation popover (Task #43) — shown when Run is clicked on
  // a flow with hard validation errors. User chooses Cancel (close) or
  // Run-Anyway (explicit override).
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightIncomplete, setPreflightIncomplete] = useState<IncompleteNodeEntry[]>([]);
  // Set to true when the user explicitly clicks "Run anyway" — handleExecute
  // checks this flag to skip the popover on the immediate retry call.
  const overrideValidationRef = useRef(false);

  // Required-trigger-inputs gate: when triggers declare data.inputs
  // (e.g. Multi-Agent Research Team's `topic`), block the run and pop a
  // modal collecting them. Pre-filled values from saved node.data.inputValues
  // skip the modal entirely.
  const [runInputsOpen, setRunInputsOpen] = useState(false);
  const [pendingRunInputs, setPendingRunInputs] = useState<RunInputDef[]>([]);
  const [pendingRunDefaults, setPendingRunDefaults] = useState<Record<string, any>>({});
  const collectedRunInputsRef = useRef<Record<string, any> | null>(null);

  // Missing-secrets gate (#73): when a flow references {{secret:NAME}} for
  // a secret that hasn't been created yet, pop a wizard between the trigger-
  // inputs gate and the validate/execute call. The ref short-circuits the
  // gate on the immediate re-fire after the user clicks "Save & Run".
  const [missingSecretsOpen, setMissingSecretsOpen] = useState(false);
  const [pendingMissingSecrets, setPendingMissingSecrets] = useState<MissingSecretEntry[]>([]);
  const missingSecretsResolvedRef = useRef<boolean>(false);

  // Multi-agent swarm popover state — keyed by node id. Each entry is the
  // ordered list of agent cards built up from `subagent.start` /
  // `subagent.complete` events emitted by the engine while a multi_agent /
  // agent_pool / agent_supervisor node runs. Cleared when the run ends.
  const [swarmAgents, setSwarmAgents] = useState<Record<string, SubagentCardData[]>>({});

  // human_input HITL: the active `needs_input` request the engine is paused
  // on (one at a time). Populated when a `needs_input` frame arrives, cleared
  // after the user submits values (the engine then resumes emitting frames).
  const [needsInput, setNeedsInput] = useState<NeedsInputRequest | null>(null);

  // Execution state
  const [showExecutionPanel, setShowExecutionPanel] = useState(false);
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null);
  const [activeExecTab, setActiveExecTab] = useState<TabId | undefined>(undefined);
  const executionStartTime = useRef<number>(0);
  const executionOrderRef = useRef(0);

  // Execution panel resize state
  const [execPanelWidth, setExecPanelWidth] = useState(440);
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = execPanelWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX; // dragging left = wider
      setExecPanelWidth(Math.max(280, Math.min(800, startWidth + delta)));
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [execPanelWidth]);

  const handleExecPanelClose = useCallback(() => {
    setShowExecutionPanel(false);
    setShowAIBuilder(false);
  }, []);

  // Load execution detail from API and populate executionData + node visual states
  const loadExecutionDetail = useCallback(async (executionId: string) => {
    if (!workflowId) return;
    try {
      const detail = await apiService.getExecutionDetail(workflowId, executionId);
      const { execution, nodeSummary } = detail;

      // Build nodeExecutions from nodeSummary
      const nodeExecutions: NodeExecution[] = Object.entries(nodeSummary || {}).map(([nodeId, summary]: [string, any]) => {
        // Try to find the node label from the current canvas nodes
        const canvasNode = nodes.find(n => n.id === nodeId);
        return {
          nodeId,
          nodeLabel: canvasNode?.data?.label || nodeId,
          nodeType: canvasNode?.type || summary?.nodeType || 'unknown',
          status: summary?.status === 'completed' ? 'completed' : summary?.status === 'failed' ? 'failed' : summary?.status || 'completed',
          duration: summary?.duration ?? undefined,
          input: summary?.input ?? undefined,
          output: summary?.output ?? undefined,
          error: summary?.error ?? undefined,
        };
      });

      // Set execution data
      const execData: ExecutionData = {
        executionId: execution.id,
        status: execution.status === 'completed' ? 'completed'
          : execution.status === 'failed' ? 'failed'
          : execution.status === 'completed_with_errors' ? 'completed_with_errors'
          : 'completed',
        startedAt: execution.started_at || execution.created_at || new Date().toISOString(),
        completedAt: execution.completed_at,
        totalDuration: execution.execution_time_ms,
        nodeExecutions,
        cost: execution.cost,
      };

      setExecutionData(execData);
      setShowExecutionPanel(true);
      setActiveExecTab('timeline');

      // Update node visual states on the canvas to reflect execution results
      setNodes(nds => nds.map((n, idx) => {
        const summary = nodeSummary?.[n.id];
        if (summary) {
          return {
            ...n,
            data: {
              ...n.data,
              executionState: summary.status === 'failed' ? 'failed' : 'completed',
              executionOutput: summary.output,
              executionError: summary.error,
              executionTimeMs: summary.duration,
              executionOrder: idx + 1,
            },
          };
        }
        return n;
      }));

      console.log(`[WorkflowContainer] Loaded execution ${executionId}: ${nodeExecutions.length} nodes`);
    } catch (err) {
      console.error('[WorkflowContainer] Failed to load execution detail:', err);
    }
  }, [workflowId, apiService, nodes, setNodes]);

  // Auto-load execution detail if initialExecutionId is provided
  const initialExecLoadedRef = useRef(false);
  useEffect(() => {
    if (initialExecutionId && workflowId && !initialExecLoadedRef.current) {
      initialExecLoadedRef.current = true;
      console.log('[WorkflowContainer] Auto-loading execution:', initialExecutionId);
      loadExecutionDetail(initialExecutionId);
    }
  }, [initialExecutionId, workflowId, loadExecutionDetail]);

  // X-Ray mode (D3)
  const [xrayMode, setXrayMode] = useState(false);

  // Validation state
  const [validationResult, setValidationResult] = useState<WorkflowValidationResult | null>(null);

  // Listen for openShareDialog events (from TeamSection sidebar)
  useEffect(() => {
    const handler = () => setShowShareDialog(true);
    window.addEventListener('openShareDialog', handler);
    return () => window.removeEventListener('openShareDialog', handler);
  }, []);

  // Listen for fixNodeWithAI events (from failed node hover tooltip)
  useEffect(() => {
    const handleFixNode = (e: CustomEvent) => {
      const { nodeLabel, nodeType, error, config } = e.detail;
      // Open the AI Builder tab in the side panel
      setShowAIBuilder(true);
      setActiveExecTab('assistant');
      // Compose a diagnostic prompt and dispatch to AI builder
      const prompt = `Node "${nodeLabel}" (${nodeType}) failed with error:\n\`\`\`\n${error}\n\`\`\`\n\nNode configuration:\n\`\`\`json\n${config}\n\`\`\`\n\nDiagnose the root cause and output a \`\`\`patch block to fix this node. Then explain what was wrong and how to prevent it.`;
      window.dispatchEvent(new CustomEvent('aiBuilderSendMessage', { detail: { message: prompt } }));
    };
    window.addEventListener('fixNodeWithAI', handleFixNode as any);
    return () => window.removeEventListener('fixNodeWithAI', handleFixNode as any);
  }, []);

  // Clipboard for copy/paste of selected nodes + their connecting edges.
  // Stored in a ref so the keyboard handler can read the current value
  // without re-binding on every state change.
  const clipboardRef = useRef<{ nodes: any[]; edges: any[] } | null>(null);

  // Keyboard shortcuts: X (X-Ray), Ctrl+C (copy selection), Ctrl+V (paste),
  // Ctrl+D (duplicate selection). Selection itself is reactflow-native
  // (Shift+drag = box-select, Shift+click = add to selection).
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };

    const copySelection = () => {
      const selectedNodes = nodes.filter(n => (n as any).selected);
      if (selectedNodes.length === 0) return;
      const selectedIds = new Set(selectedNodes.map(n => n.id));
      // Only copy edges that connect two selected nodes — partial dangles
      // would create orphans on paste.
      const selectedEdges = edges.filter(
        e => selectedIds.has(e.source) && selectedIds.has(e.target),
      );
      clipboardRef.current = { nodes: selectedNodes, edges: selectedEdges };
    };

    const pasteSelection = () => {
      const clip = clipboardRef.current;
      if (!clip || clip.nodes.length === 0) return;
      takeSnapshot();
      // Generate new ids and remap edge endpoints. Offset positions by 40px
      // so the paste lands visibly distinct from the source.
      const idMap = new Map<string, string>();
      const stamp = Date.now();
      const newNodes = clip.nodes.map((n, i) => {
        const newId = `${n.type || 'node'}-${stamp}-${i}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          position: { x: (n.position?.x ?? 0) + 40, y: (n.position?.y ?? 0) + 40 },
          selected: true,
        };
      });
      const newEdges = clip.edges.map((e, i) => ({
        ...e,
        id: `e-${stamp}-${i}`,
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        selected: false,
      }));
      // Deselect the source nodes so the paste is the only selected set.
      setNodes(nds => nds.map(n => ({ ...n, selected: false })).concat(newNodes));
      setEdges(eds => eds.concat(newEdges));
    };

    const duplicateSelection = () => {
      const selectedNodes = nodes.filter(n => (n as any).selected);
      if (selectedNodes.length === 0) return;
      const selectedIds = new Set(selectedNodes.map(n => n.id));
      const selectedEdges = edges.filter(
        e => selectedIds.has(e.source) && selectedIds.has(e.target),
      );
      // Duplicate is copy+paste in one shot; doesn't touch the clipboard.
      const prevClip = clipboardRef.current;
      clipboardRef.current = { nodes: selectedNodes, edges: selectedEdges };
      pasteSelection();
      clipboardRef.current = prevClip;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      // Ctrl/Cmd-prefixed shortcuts
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'c') {
          copySelection();
          return;
        }
        if (k === 'v') {
          e.preventDefault();
          pasteSelection();
          return;
        }
        if (k === 'd') {
          e.preventDefault();
          duplicateSelection();
          return;
        }
        return;
      }
      // Bare-key shortcuts
      if (e.key === 'x' || e.key === 'X') {
        setXrayMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, setNodes, setEdges, takeSnapshot]);

  // Build canvas context for AI Builder
  const canvasContext: CanvasContext | null = useMemo(() => {
    if (nodes.length === 0) return null;
    return {
      flowName: workflowName,
      flowDescription: workflowDescription,
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type || 'default',
        label: n.data?.label || n.id,
        config: n.data ? Object.fromEntries(
          Object.entries(n.data).filter(([k]) => k !== 'label' && k !== 'executionOrder' && k !== 'xrayMode' && k !== 'lastOutput')
        ) : undefined,
      })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
    };
  }, [nodes, edges, workflowName, workflowDescription]);

  // Build execution context for AI Builder
  const executionContext: ExecutionContext | null = useMemo(() => {
    if (!executionData) return null;
    const nodeResults: Record<string, { status: string; error?: string; durationMs?: number }> = {};
    if (executionData.nodeExecutions) {
      for (const ne of executionData.nodeExecutions) {
        nodeResults[ne.nodeId] = {
          status: ne.status,
          error: ne.error || undefined,
          durationMs: ne.duration,
        };
      }
    }
    return {
      status: executionData.status,
      executionTimeMs: executionData.totalDuration,
      nodeResults,
    };
  }, [executionData]);

  // Handle AI Builder patches — apply partial updates to specific nodes
  const handleWorkflowPatch = useCallback((patches: WorkflowPatch[]) => {
    setNodes(prev => prev.map(node => {
      const patch = patches.find(p => p.nodeId === node.id);
      if (!patch) return node;
      const newData = { ...node.data };
      for (const [key, value] of Object.entries(patch.updates)) {
        // Support dotted paths like "data.prompt"
        const parts = key.replace(/^data\./, '').split('.');
        if (parts.length === 1) {
          newData[parts[0]] = value;
        } else {
          let target = newData;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!target[parts[i]]) target[parts[i]] = {};
            target = target[parts[i]];
          }
          target[parts[parts.length - 1]] = value;
        }
      }
      return { ...node, data: newData };
    }));
  }, [setNodes]);

  // Propagate xrayMode and onTestNode to all nodes
  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, xrayMode, onTestNode },
    })));
  }, [xrayMode, onTestNode, setNodes]);

  const { availableModels, availableTools } = useWorkflowResources();
  const { nodeConfigs: backendNodeConfigs } = useBackendNodes();
  const { agentNodeConfigs } = useAgentNodes();
  // Merge agent definitions (from api /api/agents SOT registry) into the
  // node palette as draggable canvas nodes. Agents live under category='agents'
  // in the palette and drop onto the canvas as agent_spawn nodes, same
  // drag-and-drop UX as any other node type (trigger, tool, code, etc).
  // Previously they were only accessible via a side-panel drawer.
  const activeNodeConfigs = React.useMemo(() => {
    const base = Object.keys(backendNodeConfigs).length > 0 ? backendNodeConfigs : nodeTypeConfigs;
    return { ...base, ...agentNodeConfigs };
  }, [backendNodeConfigs, agentNodeConfigs]);

  // --- Workflow definition ---
  // Sanitize nodes/edges before serialization to prevent "cyclic object value" errors.
  // ReactFlow adds internal properties (positionAbsolute, dragging, width, height, measured)
  // and execution state may contain non-serializable objects.
  const getWorkflowDefinition = useCallback((): WorkflowDefinition => ({
    nodes: nodes.map(({ positionAbsolute, dragging, width, height, resizing, selected, measured, ...node }: any) => ({
      ...node,
      data: (() => {
        if (!node.data) return node.data;
        const { executionState, executionOutput, executionTimeMs, executionError, validationErrors, ...cleanData } = node.data;
        return cleanData;
      })(),
    })),
    edges: edges.map(({ selected, ...edge }: any) => edge),
    viewport: reactFlowInstance?.getViewport(),
  }), [nodes, edges, reactFlowInstance]);

  // --- Edge handlers ---
  const onConnect = useCallback((params: Connection) => {
    takeSnapshot();
    const newEdge: Edge = {
      id: `edge-${params.source}-${params.target}-${Date.now()}`,
      source: params.source!,
      target: params.target!,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      type: 'default',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
    };
    setEdges(eds => addEdge(newEdge, eds));
  }, [setEdges]);

  // --- Drop handler ---
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!reactFlowWrapper.current || !reactFlowInstance) return;
    takeSnapshot();

    // Support both node palette (application/reactflow) and agent palette (application/openagentic-node)
    const data = e.dataTransfer.getData('application/reactflow') || e.dataTransfer.getData('application/openagentic-node');
    if (!data) return;

    try {
      const config = JSON.parse(data);
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      const nodeType = config.type || 'agent_single';
      const nodeData = config.defaultData
        ? { ...config.defaultData, label: config.label, icon: config.icon, color: config.color }
        : { ...config.data, label: config.data?.label || config.label || nodeType };

      setNodes(nds => nds.concat({
        id: `${nodeType}-${Date.now()}`,
        type: nodeType,
        position,
        data: nodeData,
      }));
    } catch (err) {
      console.error('Failed to parse node data:', err);
    }
  }, [reactFlowInstance, setNodes]);

  // --- Node click ---
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    // If execution panel is open, don't open properties — let Output tab show node data
    if (!showExecutionPanel) {
      setShowPropertiesPanel(true);
    }
  }, [showExecutionPanel]);

  // Double-click always opens properties panel (even when execution panel is visible)
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setShowPropertiesPanel(true);
  }, []);

  const handleNodeUpdate = useCallback((nodeId: string, data: any) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
  }, [setNodes]);

  const handleNodeDelete = useCallback((nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    setShowPropertiesPanel(false);
  }, [setNodes, setEdges]);

  // Right-click context menu state — position is in viewport pixels
  // (NodeContextMenu uses position: fixed); targetNode is the node
  // whose metadata feeds buildNodeContextMenuItems().
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    node: Node | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      setCtxMenu({ open: true, x: e.clientX, y: e.clientY, node });
    },
    [],
  );
  const closeCtxMenu = useCallback(() => {
    setCtxMenu((s) => ({ ...s, open: false, node: null }));
  }, []);

  const handleNodeDuplicate = useCallback(
    (nodeId: string) => {
      const src = nodes.find((n) => n.id === nodeId);
      if (!src) return;
      takeSnapshot();
      const stamp = Date.now();
      const newId = `${src.type || 'node'}-${stamp}`;
      const cloned: Node = {
        ...src,
        id: newId,
        position: {
          x: (src.position?.x ?? 0) + 40,
          y: (src.position?.y ?? 0) + 40,
        },
        selected: true,
      };
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), cloned]);
    },
    [nodes, setNodes, takeSnapshot],
  );

  const handleNodeToggleDisabled = useCallback(
    (nodeId: string) => {
      takeSnapshot();
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, disabled: !(n.data as any)?.disabled } }
            : n,
        ),
      );
    },
    [setNodes, takeSnapshot],
  );

  const handleNodeConfigure = useCallback((node: Node) => {
    setSelectedNode(node);
    setShowPropertiesPanel(true);
  }, []);

  // --- AI Builder ---
  const handleWorkflowGenerated = useCallback((definition: WorkflowDefinition) => {
    // Auto-add a Text Note legend if the generated workflow doesn't have one
    const hasTextNote = definition.nodes.some((n: any) => n.type === 'text');
    if (!hasTextNote && definition.nodes.length > 0) {
      const triggerNode = definition.nodes.find((n: any) => n.type === 'trigger');
      const noteX = (triggerNode?.position?.x ?? 0) - 220;
      const noteY = (triggerNode?.position?.y ?? 0) - 20;
      const nodeTypes = [...new Set(definition.nodes.map((n: any) => n.type).filter((t: any) => t !== 'trigger' && t !== 'text'))];
      const noteText = [
        `Nodes: ${definition.nodes.length}`,
        `Types: ${nodeTypes.join(', ')}`,
        `Generated by AI Builder`,
      ].join('\n');
      definition.nodes.push({
        id: `text-legend-${Date.now()}`,
        type: 'text',
        position: { x: noteX, y: noteY },
        data: {
          label: workflowName || 'Workflow',
          text: noteText,
          fontSize: 12,
          textColor: 'var(--color-fg-muted)',
          bgColor: 'transparent',
        },
      } as any);
    }

    // Apply dagre auto-layout for clean top-to-bottom arrangement
    const layoutedNodes = applyDagreLayout(definition.nodes as Node[], definition.edges as Edge[], 'TB');
    setNodes(layoutedNodes as any);
    setEdges(definition.edges as any);
    if (reactFlowInstance) {
      setTimeout(() => reactFlowInstance.fitView({ padding: 0.15 }), 150);
    }
    // Auto-save after AI generation if we have a workflow ID and save handler
    if (workflowId && onSave) {
      setTimeout(async () => {
        setSaveStatus('saving');
        try {
          await onSave({ ...definition, viewport: reactFlowInstance?.getViewport() });
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        } catch {
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 3000);
        }
      }, 200);
    }
  }, [setNodes, setEdges, reactFlowInstance, workflowId, onSave, workflowName]);

  // --- Validate (live animated, node-by-node) ---
  const [isValidating, setIsValidating] = useState(false);
  const handleValidate = useCallback(async () => {
    const nodeData = nodes.map(n => ({
      id: n.id,
      type: n.type || 'trigger',
      data: n.data || {},
    }));
    const edgeData = edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));

    setIsValidating(true);
    // Clear previous validation
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, validationErrors: undefined, validationState: undefined },
    })));

    // Sort nodes by execution order (trigger first, then by edges)
    const sortedNodes = [...nodeData];
    const triggerIdx = sortedNodes.findIndex(n => n.type === 'trigger');
    if (triggerIdx > 0) {
      const [t] = sortedNodes.splice(triggerIdx, 1);
      sortedNodes.unshift(t);
    }

    const allResults = new Map<string, ReturnType<typeof validateNode>>();
    let firstErrorNodeId: string | null = null;

    // Validate each node sequentially with visual sweep
    for (const node of sortedNodes) {
      // Mark node as "validating" (shows scanning animation)
      setNodes(nds => nds.map(n =>
        n.id === node.id
          ? { ...n, data: { ...n.data, validationState: 'checking' } }
          : n
      ));

      // Small delay so user can see the sweep
      await new Promise(r => setTimeout(r, 120));

      const result = validateNode(node.id, node.type, node.data, edgeData, nodeData);
      allResults.set(node.id, result);
      const errors = result.issues.filter(i => i.severity === 'error');

      // Mark node as valid or invalid
      setNodes(nds => nds.map(n =>
        n.id === node.id
          ? {
            ...n,
            data: {
              ...n.data,
              validationState: errors.length > 0 ? 'invalid' : 'valid',
              validationErrors: errors.length > 0 ? errors : undefined,
            },
          }
          : n
      ));

      // If this node has errors and it's the first one, select it to open properties panel
      if (errors.length > 0 && !firstErrorNodeId) {
        firstErrorNodeId = node.id;
        const errorNode = nodes.find(n => n.id === node.id);
        if (errorNode) {
          setSelectedNode(errorNode);
        }
      }
    }

    // Build full result (client-side)
    const fullResult = validateWorkflow(nodeData, edgeData);

    // Call backend compiler for deeper validation (cycles, reachability, syntax)
    try {
      const headers = getAuthHeaders();
      const compileRes = await fetch('/api/workflows/compile', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definition: {
            nodes: nodes.map(n => ({ id: n.id, type: n.type || 'trigger', data: n.data || {}, position: n.position })),
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: (e as any).sourceHandle, label: (e as any).label })),
          },
        }),
      });
      const compileData = await compileRes.json().catch(() => ({}));
      if (compileData.valid === false) {
        const backendErrors = compileData.errors || [];
        for (const err of backendErrors) {
          const nodeId = err.nodeId || '';
          if (!fullResult.issues.some((i: any) => i.code === err.code && i.nodeId === nodeId)) {
            fullResult.issues.push({
              code: err.code || 'BACKEND_ERROR',
              message: err.message || 'Backend validation failed',
              nodeId,
              severity: 'error' as const,
              category: 'config' as const,
            });
            fullResult.valid = false;
            fullResult.summary.errorCount++;
            // Mark the node as invalid in the visual sweep
            if (nodeId) {
              const nodeResult = fullResult.nodeResults.get(nodeId);
              if (nodeResult) {
                nodeResult.valid = false;
                nodeResult.issues.push({
                  code: err.code || 'BACKEND_ERROR',
                  message: err.message || 'Backend validation failed',
                  nodeId,
                  severity: 'error',
                  category: 'config',
                });
              }
              // Update the node's visual state to show error
              setNodes(nds => nds.map(n =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, validationState: 'invalid', validationErrors: [{ message: err.message || 'Backend validation failed', field: err.field }] } }
                  : n
              ));
            }
          }
        }
      }
    } catch {
      // Backend unreachable -- client-side validation only
    }

    setValidationResult(fullResult);
    setIsValidating(false);

    // Clear the validationState after 3s (keep error badges)
    setTimeout(() => {
      setNodes(nds => nds.map(n => {
        const { validationState, ...rest } = n.data;
        return { ...n, data: rest };
      }));
    }, 3000);

    return fullResult;
  }, [nodes, edges, setNodes, getAuthHeaders]);

  // Clear validation when nodes/edges change
  useEffect(() => {
    if (validationResult) {
      setValidationResult(null);
      // Clear validation badges from nodes
      setNodes(nds => nds.map(n => {
        if (n.data?.validationErrors) {
          const { validationErrors, ...rest } = n.data;
          return { ...n, data: rest };
        }
        return n;
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

  // --- Save ---
  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      await onSave({ ...getWorkflowDefinition(), name: workflowName });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, getWorkflowDefinition, workflowName]);

  const handleSaveWithChangelog = useCallback(async (changelog: string) => {
    // For now, just call handleSave — the changelog is stored on the server side
    // by passing it as part of the workflow update payload
    if (!onSave) return;
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      await onSave({ ...getWorkflowDefinition(), name: workflowName });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      console.log('[WorkflowContainer] Saved with changelog:', changelog);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, getWorkflowDefinition, workflowName]);

  // --- Version History ---
  const handleShowHistory = useCallback(async () => {
    setShowHistoryPanel(true);
    if (workflowId) {
      try {
        const versions = await apiService.getVersions(workflowId);
        setWorkflowVersions(versions);
      } catch (err) {
        console.error('[WorkflowContainer] Failed to load versions:', err);
      }
    }
  }, [workflowId, apiService]);

  const handleRestoreVersion = useCallback(async (version: any) => {
    if (!workflowId) return;
    try {
      await apiService.restoreVersion(workflowId, version.id);
      setShowHistoryPanel(false);
      // QA-2026-05-05 (#19): refetch the workflow row so the canvas
      // reflects the restored definition. Prior code logged success
      // but left the canvas on the pre-restore graph, making restore
      // look broken from the UI side.
      const wf = await apiService.getWorkflow(workflowId);
      const def: any = (wf as any).definition || {};
      setNodes(def.nodes || []);
      setEdges(def.edges || []);
      // Refresh the History panel's version list so the new
      // auto-snapshot version (added by the restore endpoint) shows
      // up next time the user opens History.
      try {
        const versions = await apiService.getVersions(workflowId);
        setWorkflowVersions(versions);
      } catch {}
    } catch (err) {
      console.error('[WorkflowContainer] Failed to restore version:', err);
    }
  }, [workflowId, apiService, setNodes, setEdges]);

  const handleCompareVersion = useCallback((version: any) => {
    setComparingVersion(version);
    setShowHistoryPanel(false);
  }, []);

  // --- Execution ---
  const clearExecutionStates = useCallback(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, executionState: undefined, executionOutput: undefined, executionTimeMs: undefined, executionError: undefined, executionOrder: undefined, parallelTools: undefined, streamingText: undefined },
    })));
    setEdges(eds => eds.map(e => ({
      ...e,
      animated: false,
      data: { ...e.data, executionState: undefined },
    })));
    setExecutionData(null);
    executionOrderRef.current = 0;
  }, [setNodes, setEdges]);

  const handleExecutionEvent = useCallback((event: ExecutionEvent) => {
    const { type, nodeId } = event;

    if (type === 'execution_start') {
      executionStartTime.current = Date.now();
      executionOrderRef.current = 0;
      setExecutionData({
        executionId: event.executionId || `exec-${Date.now()}`,
        status: 'running',
        startedAt: new Date().toISOString(),
        nodeExecutions: [],
      });
      setShowExecutionPanel(true);
      // Reset swarm cards + any stale HITL prompt from a prior run.
      setSwarmAgents({});
      setNeedsInput(null);
      return;
    }

    // human_input HITL: the engine paused on a `human_input` node and is
    // asking the user to fill a typed form. Surface the request inline (the
    // NeedsInputForm renders at the same surface as approval prompts). The
    // engine sends the request either as a top-level `needs_input` frame or
    // nested under an `execution_paused` envelope with `reason:'needs_input'`.
    {
      const ev = event as any;
      const payload =
        type === 'needs_input'
          ? ev
          : type === 'execution_paused' && (ev.reason === 'needs_input' || ev.dataRequest || ev.requestId)
            ? (ev.dataRequest || ev)
            : null;
      if (payload && (payload.requestId || payload.request_id) && Array.isArray(payload.fields)) {
        setNeedsInput({
          requestId: payload.requestId || payload.request_id,
          nodeId: payload.nodeId || payload.node_id || nodeId || '',
          title: payload.title || 'Input required',
          description: payload.description,
          fields: payload.fields,
          channel: payload.channel,
          expiresAt: payload.expiresAt || payload.expires_at,
          allowDefaults:
            payload.allowDefaults === true ||
            payload.timeoutAction === 'use_defaults' ||
            payload.timeout_action === 'use_defaults',
        });
        return;
      }
    }

    // Subagent telemetry from multi_agent / agent_pool / agent_supervisor.
    // Engine emits `node_progress` events with eventType=subagent.start|complete|update.
    // Build a card per slot under the node id; flip to status from payload on complete.
    if (type === 'node_progress' && nodeId) {
      const ev = event as any;
      const sub = ev.eventType as string | undefined;
      const payload = (ev.payload || {}) as any;
      if (sub === 'subagent.start' || sub === 'subagent.complete' || sub === 'subagent.update') {
        setSwarmAgents(prev => {
          const cur = prev[nodeId] ? [...prev[nodeId]] : [];
          const slot = typeof payload.slot === 'number' ? payload.slot : cur.length;
          while (cur.length <= slot) {
            cur.push({ slot: cur.length, role: 'agent', displayName: `Agent ${cur.length + 1}`, status: 'queued' });
          }
          const existing: SubagentCardData = cur[slot] || { slot, role: 'agent', displayName: `Agent ${slot + 1}`, status: 'queued' };
          let nextStatus: SubagentStatus = existing.status;
          if (sub === 'subagent.start') nextStatus = 'running';
          else if (sub === 'subagent.complete') nextStatus = (payload.status as SubagentStatus) || 'completed';
          cur[slot] = {
            ...existing,
            slot,
            role: payload.role || existing.role,
            displayName: payload.displayName || existing.displayName,
            agentId: payload.agentId || existing.agentId,
            status: nextStatus,
            outputPreview: payload.outputPreview ?? existing.outputPreview,
            error: payload.error ?? existing.error,
            tokensUsed: payload.tokensUsed ?? existing.tokensUsed,
            toolCalls: payload.toolCalls ?? existing.toolCalls,
          };
          return { ...prev, [nodeId]: cur };
        });
      }
      return;
    }

    if (type === 'execution_complete' || type === 'execution_error') {
      // Stop all edge animations when execution finishes
      setEdges(eds => eds.map(e => ({
        ...e,
        animated: false,
        data: { ...e.data, executionState: e.data?.executionState === 'running' ? 'completed' : e.data?.executionState },
      })));
      setExecutionData(prev => {
        if (!prev) return null;
        // Check if any nodes failed — show amber status instead of green
        const hasFailedNodes = prev.nodeExecutions?.some(
          (ne: any) => ne.status === 'failed' || ne.status === 'error'
        );
        const finalStatus = type === 'execution_error' ? 'failed'
          : hasFailedNodes ? 'completed_with_errors'
          : 'completed';
        return {
          ...prev,
          status: finalStatus,
          completedAt: new Date().toISOString(),
          totalDuration: Date.now() - executionStartTime.current,
        };
      });
      return;
    }

    if (type === 'node_start' && nodeId) {
      executionOrderRef.current += 1;
      const order = executionOrderRef.current;
      setNodes(nds => nds.map(n => n.id === nodeId
        ? { ...n, data: { ...n.data, executionState: 'running', executionOutput: undefined, executionError: undefined, executionOrder: order } }
        : n
      ));
      // Animate incoming edges as 'running' (data flowing into this node)
      setEdges(eds => eds.map(e => e.target === nodeId
        ? { ...e, animated: true, data: { ...e.data, executionState: 'running' } }
        : e
      ));
      setExecutionData(prev => {
        if (!prev) return prev;
        const nodeLabel = nodes.find(n => n.id === nodeId)?.data?.label || nodeId;
        return {
          ...prev,
          nodeExecutions: [...prev.nodeExecutions.filter(n => n.nodeId !== nodeId), {
            nodeId, nodeLabel, nodeType: event.nodeType || 'unknown',
            status: 'running', startTime: Date.now() - executionStartTime.current,
          }],
        };
      });
    } else if (type === 'node_complete' && nodeId) {
      const output = event.output || event.data?.output;
      const duration = event.executionTimeMs || event.data?.executionTimeMs;
      const outputEnvelope = event.data?.outputEnvelope || event.outputEnvelope;
      setNodes(nds => nds.map(n => n.id === nodeId
        ? { ...n, data: { ...n.data, executionState: 'completed', executionOutput: output, executionTimeMs: duration } }
        : n
      ));
      // Mark incoming edges as completed, outgoing edges as running (data flowing to next nodes)
      setEdges(eds => eds.map(e => {
        if (e.target === nodeId) return { ...e, animated: false, data: { ...e.data, executionState: 'completed' } };
        if (e.source === nodeId) return { ...e, animated: true, data: { ...e.data, executionState: 'running' } };
        return e;
      }));
      setExecutionData(prev => prev ? {
        ...prev,
        nodeExecutions: prev.nodeExecutions.map(n => n.nodeId === nodeId
          ? { ...n, status: 'completed' as const, duration, output, outputEnvelope, input: event.data?.input }
          : n
        ),
      } : null);
    } else if (type === 'node_error' && nodeId) {
      const error = event.error || event.data?.error;
      const reason = event.reason || event.data?.reason;
      const errorMessage = event.errorMessage || event.data?.errorMessage;
      const isAssertionFail = reason === 'output_failed_assertion';
      // Assertion failures get a distinct canvas state (orange) vs hard errors (red)
      const execState = isAssertionFail ? 'assertion_failed' : 'failed';
      setNodes(nds => nds.map(n => n.id === nodeId
        ? {
            ...n,
            data: {
              ...n.data,
              executionState: execState,
              executionError: error,
              ...(isAssertionFail ? { assertionFailed: true, assertionErrorMessage: errorMessage || error } : {}),
            },
          }
        : n
      ));
      // Mark incoming edges as failed
      setEdges(eds => eds.map(e => e.target === nodeId
        ? { ...e, animated: false, data: { ...e.data, executionState: 'failed' } }
        : e
      ));
      setExecutionData(prev => prev ? {
        ...prev,
        nodeExecutions: prev.nodeExecutions.map(n => n.nodeId === nodeId
          ? {
              ...n,
              status: 'failed' as const,
              error,
              ...(isAssertionFail ? { assertionFailed: true, assertionErrorMessage: errorMessage || error } : {}),
            }
          : n
        ),
      } : null);
    } else if (type === 'node_fallback' && nodeId) {
      const fallbackOutput = event.data?.fallbackResult;
      const fallbackError = event.data?.error;
      setNodes(nds => nds.map(n => n.id === nodeId
        ? { ...n, data: { ...n.data, executionState: fallbackError ? 'failed' : 'completed', executionOutput: fallbackOutput, executionError: fallbackError } }
        : n
      ));
    } else if (type === 'node_stream' && nodeId) {
      // Phase E₂.2: interleaved LLM delta inside an LLM node. The inner
      // `event` payload is a canonical AnthropicStreamEvent; we accumulate
      // text deltas onto the node so the timeline card fills in live
      // before `node_complete` fires.
      const inner = (event.data?.event ?? (event as any).event) as { type?: string; delta?: any; content?: string; name?: string; id?: string; toolCallId?: string; arguments?: unknown; result?: unknown; error?: string } | undefined;
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') {
        const chunk = inner.delta.text as string;
        setNodes(nds => nds.map(n => n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                streamingText: (n.data?.streamingText || '') + chunk,
              },
            }
          : n
        ));
      } else if (inner?.type === 'stream' && typeof inner.content === 'string') {
        const chunk = inner.content;
        setNodes(nds => nds.map(n => n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                streamingText: (n.data?.streamingText || '') + chunk,
              },
            }
          : n
        ));
      } else if (inner?.type === 'tool_executing' && inner.name) {
        // Task #131 (Phase F₂) — mirror the chat parallel fan-out pattern
        // inside flows. When an LLM flow-node emits N `tool_executing`
        // events in a single completion (backend dispatches them via
        // executeToolCalls' parallel helper), accumulate them on the node
        // under `parallelTools[]` so the CustomNode can render a tiny
        // fan-out grid. The array is keyed by toolCallId so completion
        // updates (`tool_result` / `tool_error` below) can patch
        // individual tools in place without reordering.
        const toolCallId = inner.toolCallId || `${inner.name}-${Date.now()}`;
        setNodes(nds => nds.map(n => n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                parallelTools: [
                  ...((n.data?.parallelTools || []).filter((t: any) => t.toolCallId !== toolCallId)),
                  {
                    toolCallId,
                    name: inner.name,
                    arguments: inner.arguments,
                    status: 'running',
                    startTime: Date.now(),
                  },
                ],
              },
            }
          : n
        ));
      } else if ((inner?.type === 'tool_result' || inner?.type === 'tool_error') && inner.name) {
        // Complete or fail the matching sub-tool. Keep emit order stable
        // so CustomNode can render cards in their spawn slot but show
        // terminal state (check/X) as each resolves independently.
        const isError = inner.type === 'tool_error';
        const toolCallId = inner.toolCallId;
        setNodes(nds => nds.map(n => n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                parallelTools: (n.data?.parallelTools || []).map((t: any) => {
                  const matches = toolCallId
                    ? t.toolCallId === toolCallId
                    : (t.name === inner.name && t.status === 'running');
                  if (!matches) return t;
                  return {
                    ...t,
                    status: isError ? 'error' : 'success',
                    result: isError ? undefined : inner.result,
                    error: isError ? inner.error : undefined,
                    duration: t.startTime ? Date.now() - t.startTime : undefined,
                  };
                }),
              },
            }
          : n
        ));
      }
    }
  }, [setNodes, setEdges, nodes]);

  // --- Pause / Resume / Cancel / Retry-Node ---
  const handlePause = useCallback(async () => {
    const execId = activeExecutionIdRef.current;
    if (!execId) return;
    try {
      await apiService.pauseExecution(execId);
      setExecutionLifecycleState('paused');
    } catch (err) {
      console.error('[WorkflowContainer] Failed to pause execution:', err);
    }
  }, [apiService]);

  const handleResume = useCallback(async () => {
    const execId = activeExecutionIdRef.current;
    if (!execId) return;
    try {
      await apiService.resumeExecution(execId);
      setExecutionLifecycleState('running');
    } catch (err) {
      console.error('[WorkflowContainer] Failed to resume execution:', err);
    }
  }, [apiService]);

  const handleCancel = useCallback(async () => {
    const execId = activeExecutionIdRef.current;
    if (!execId) return;
    try {
      await apiService.cancelExecution(execId);
      setExecutionLifecycleState('cancelled');
      setIsExecuting(false);
      // Update execution data to show cancelled status
      setExecutionData(prev => prev ? { ...prev, status: 'cancelled' as any } : null);
    } catch (err) {
      console.error('[WorkflowContainer] Failed to cancel execution:', err);
    }
  }, [apiService]);

  // HITL needs-input submit — completes the OSS-only needs-input gate. The
  // engine pauses on a needs_input frame; the user fills NeedsInputForm; we POST
  // the collected values back so the engine resumes (and the #1262 resume-merge
  // writes them into the paused node's result so {{steps.X.output.values.Y}}
  // resolves).
  const handleNeedsInputSubmit = useCallback(
    async (values: Record<string, any>) => {
      const req = needsInput;
      const execId = activeExecutionIdRef.current || executionData?.executionId;
      if (!req || !execId) {
        throw new Error('No active workflow execution to submit input to.');
      }
      await apiService.submitDataRequest(execId, req.requestId, values);
      setNeedsInput(null);
    },
    [needsInput, apiService, executionData],
  );

  const handleRetryNode = useCallback(async (nodeId: string) => {
    if (!workflowId || !executionData?.executionId) return;
    try {
      const { newExecutionId } = await apiService.retryNode(workflowId, executionData.executionId, nodeId);
      console.log('[WorkflowContainer] Retry-node started:', newExecutionId);
      // Load the new execution detail
      await loadExecutionDetail(newExecutionId);
    } catch (err) {
      console.error('[WorkflowContainer] Failed to retry node:', err);
    }
  }, [workflowId, executionData, apiService, loadExecutionDetail]);

  const handleExecute = useCallback(async () => {
    if (nodes.length === 0) return;
    if (!onExecute && !workflowId) return;

    // Required-trigger-inputs gate: scan trigger nodes for declared inputs,
    // pop a modal for any required field still empty, and stash the
    // collected values for this run. The check is skipped on the immediate
    // re-invocation right after the user clicks "Run flow" in the modal
    // (collectedRunInputsRef holds the values for that retry).
    if (!collectedRunInputsRef.current) {
      const triggerInputDefs: RunInputDef[] = [];
      const defaults: Record<string, any> = {};
      for (const n of nodes) {
        if (n.type !== 'trigger') continue;
        const inputs = (n.data as any)?.inputs;
        if (!Array.isArray(inputs)) continue;
        const stored = (n.data as any)?.inputValues || {};
        for (const i of inputs) {
          if (!i?.name) continue;
          triggerInputDefs.push({
            name: i.name,
            label: i.label || i.name,
            type: i.type,
            required: !!i.required,
            placeholder: i.placeholder,
            description: i.description,
            default: i.default,
          });
          if (stored[i.name] !== undefined) defaults[i.name] = stored[i.name];
        }
      }
      const isEmpty = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      const anyRequiredMissing = triggerInputDefs.some(
        (i) => i.required && isEmpty(defaults[i.name]),
      );
      if (anyRequiredMissing && triggerInputDefs.length > 0) {
        setPendingRunInputs(triggerInputDefs);
        setPendingRunDefaults(defaults);
        setRunInputsOpen(true);
        return; // Wait for the user to fill the modal.
      }
      // No required missing — use any pre-filled defaults as the input.
      collectedRunInputsRef.current = defaults;
    }

    // Missing-secrets gate (#73): scan node configs for {{secret:NAME}}
    // references the user hasn't created yet, and pop the wizard so they
    // can enter values once + reuse on every future run. Skipped on the
    // immediate re-fire after the wizard submits.
    if (!missingSecretsResolvedRef.current) {
      try {
        const known = await listKnownSecretNames(workflowId);
        const missing = scanMissingSecrets(nodes, known);
        if (missing.length > 0) {
          setPendingMissingSecrets(missing);
          setMissingSecretsOpen(true);
          return; // Wait for the user to fill the wizard.
        }
      } catch (err) {
        console.warn('[WorkflowContainer] Missing-secrets scan failed; proceeding to validate anyway', err);
        // Fall through — the existing pre-flight validator will surface
        // SECRET_NOT_FOUND issues and the user can fix them via Admin.
      }
      missingSecretsResolvedRef.current = true;
    }

    // Run validation before execution — only block on hard compilation errors,
    // not warnings (unreachable nodes, missing optional fields)
    const valResult = await handleValidate();
    const hardErrors = valResult.issues?.filter((i: any) =>
      i.severity === 'error' && !['UNREACHABLE_NODE', 'INVALID_NODE_REF', 'NON_UPSTREAM_REF'].includes(i.code)
    ) || [];
    if (hardErrors.length > 0 && !overrideValidationRef.current) {
      console.warn('[WorkflowContainer] Pre-flight blocked:', hardErrors.length, 'hard errors');
      // Group by nodeId for the popover. Each entry surfaces every issue the
      // validator flagged on that node so the user fixes them in one pass
      // rather than the old "first-error-then-fail" loop.
      const byNode = new Map<string, IncompleteNodeEntry>();
      for (const issue of hardErrors) {
        if (!issue.nodeId) continue;
        const node = nodes.find((n: any) => n.id === issue.nodeId);
        if (!byNode.has(issue.nodeId)) {
          byNode.set(issue.nodeId, {
            nodeId: issue.nodeId,
            nodeLabel: node?.data?.label || issue.nodeId,
            nodeType: node?.type || 'unknown',
            issues: [],
          });
        }
        byNode.get(issue.nodeId)!.issues.push(issue);
      }
      setPreflightIncomplete(Array.from(byNode.values()));
      setPreflightOpen(true);
      return; // Wait for the user to choose Cancel or Run-Anyway.
    }
    overrideValidationRef.current = false;

    setIsExecuting(true);
    setExecutionLifecycleState('running');
    setShowExecutionPanel(true);  // Show panel immediately on execute
    clearExecutionStates();

    // Immediate visual feedback: pre-populate execution data before SSE connects
    // This eliminates the perceived lag between clicking Execute and seeing the first node
    setExecutionData({
      executionId: `pending-${Date.now()}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodeExecutions: nodes.map(n => ({
        nodeId: n.id,
        nodeLabel: n.data?.label || n.id,
        nodeType: n.data?.type || n.type || 'unknown',
        status: 'pending' as const,
      })),
    });
    // Set first node to "running" appearance immediately
    const startNodes = nodes.filter(n =>
      !edges.some(e => e.target === n.id) || n.data?.type === 'trigger' || n.type === 'trigger'
    );
    if (startNodes.length > 0) {
      setNodes(nds => nds.map(n =>
        startNodes.some(s => s.id === n.id)
          ? { ...n, data: { ...n.data, executionState: 'running' } }
          : n
      ));
    }
    const definition = getWorkflowDefinition();
    console.log('[WorkflowContainer] Executing workflow, nodes:', nodes.length, 'edges:', edges.length, 'workflowId:', workflowId);
    try {
      // Execute directly via API with SSE streaming — bypasses parent dialog indirection [v6]
      if (workflowId && apiService) {
        const collectedInput = collectedRunInputsRef.current || {};
        console.log('[WorkflowContainer] Direct async execute v6:', workflowId, 'input:', collectedInput);
        await apiService.executeWorkflow(workflowId, collectedInput, (event) => {
          console.log('[WorkflowContainer] SSE:', event.type, event.data?.nodeId);
          // Track the execution ID for pause/cancel/resume
          if (event.data?.executionId) {
            activeExecutionIdRef.current = event.data.executionId;
          }
          handleExecutionEvent({ type: event.type, ...event.data });
        });
      } else {
        // Fallback to parent-provided executor
        await onExecute(definition, handleExecutionEvent);
      }
      console.log('[WorkflowContainer] Execution completed');
      setExecutionLifecycleState('completed');
    } catch (err) {
      console.error('[WorkflowContainer] Execution FAILED:', err);
      setExecutionLifecycleState('failed');
    } finally {
      setIsExecuting(false);
      activeExecutionIdRef.current = null;
      // Clear the per-run inputs cache — next Run starts fresh and re-checks the gate.
      collectedRunInputsRef.current = null;
      missingSecretsResolvedRef.current = false;
    }
  }, [onExecute, workflowId, apiService, getWorkflowDefinition, nodes.length, edges.length, clearExecutionStates, handleExecutionEvent]);

  const handleExecutionNodeSelect = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) { setSelectedNode(node); }
  }, [nodes]);

  const nodeColorFn = useCallback((node: Node) => {
    const config = activeNodeConfigs[node.type as NodeType];
    return config?.color || 'var(--color-fg-subtle)';
  }, [activeNodeConfigs]);

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'var(--wf-canvas-bg)' }}>
      <WorkflowToolbar
        workflowName={workflowName}
        onNameChange={setWorkflowName}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        showPalette={false}
        onTogglePalette={() => {}}
        isSaving={isSaving}
        isExecuting={isExecuting}
        isValidating={isValidating}
        saveStatus={saveStatus}
        canExecute={nodes.length > 0}
        costEstimate={costEstimate}
        onSave={handleSave}
        onExecute={handleExecute}
        onValidate={handleValidate}
        validationResult={validationResult}
        onBack={onBack}
        onShare={workflowId ? () => setShowShareDialog(true) : onShare}
        onToggleAIBuilder={() => setShowAIBuilder(!showAIBuilder)}
        showAIBuilder={showAIBuilder}
        onAutoLayout={() => {
          const layoutedNodes = applyDagreLayout(nodes, edges, 'TB');
          setNodes(layoutedNodes);
          if (reactFlowInstance) {
            setTimeout(() => reactFlowInstance.fitView({ padding: 0.15 }), 100);
          }
        }}
        onShowHistory={workflowId ? handleShowHistory : undefined}
        onSaveWithChangelog={onSave ? handleSaveWithChangelog : undefined}
        executionState={executionLifecycleState}
        onPause={workflowId ? handlePause : undefined}
        onResume={workflowId ? handleResume : undefined}
        onCancel={workflowId ? handleCancel : undefined}
        getFlowJson={() => {
          if (nodes.length === 0 && edges.length === 0) return null;
          return JSON.stringify(
            { name: workflowName, nodes, edges },
            null,
            2,
          );
        }}
        onImportFlowJson={(text) => {
          if (!text) {
            // FlowExportImportButton already validated parse-ability, so a
            // null here means the file wasn't JSON. Surface a soft error.
            // eslint-disable-next-line no-alert
            alert('Imported file is not valid JSON.');
            return;
          }
          try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
              // eslint-disable-next-line no-alert
              alert('Import failed: file must have `nodes` and `edges` arrays.');
              return;
            }
            takeSnapshot();
            setNodes(parsed.nodes);
            setEdges(parsed.edges);
            if (typeof parsed.name === 'string' && parsed.name.trim()) {
              setWorkflowName(parsed.name);
            }
          } catch (err: any) {
            // eslint-disable-next-line no-alert
            alert(`Import failed: ${err?.message || 'unknown error'}`);
          }
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas + overlays */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden relative">
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={wrappedOnNodesChange}
              onEdgesChange={wrappedOnEdgesChange}
              onConnect={onConnect}
              defaultViewport={workflowId ? (loadViewport(workflowId) || undefined) : undefined}
              onInit={(instance: any) => {
                setReactFlowInstance(instance);
                // Auto-fit on open ONLY when no saved viewport exists for this
                // workflow (#76). When the user has dragged/zoomed before, we
                // restore that camera state instead of stomping it with fitView.
                const saved = workflowId ? loadViewport(workflowId) : null;
                if (!saved && nodes.length > 0) {
                  setTimeout(() => instance.fitView({ padding: 0.15 }), 200);
                }
              }}
              onMoveEnd={(_e, viewport) => {
                if (workflowId && viewport) {
                  saveViewport(workflowId, viewport as CanvasViewport);
                }
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeContextMenu={onNodeContextMenu}
              nodeColorFn={nodeColorFn}
              wrapperRef={reactFlowWrapper as React.RefObject<HTMLDivElement>}
            />

            {showPropertiesPanel && selectedNode && (
              <NodePropertiesPanel
                node={selectedNode}
                onClose={() => { setShowPropertiesPanel(false); setSelectedNode(null); }}
                onUpdate={handleNodeUpdate}
                onDelete={handleNodeDelete}
                availableModels={availableModels}
                availableTools={availableTools}
              />
            )}

            {/* AIFlowBuilder now embedded in ExecutionResultsPanel AI tab */}
          </div>
        </div>

        {/* Right panel: Execution Results + AI Assistant */}
        {(showExecutionPanel || showAIBuilder) && (
          <>
            {/* Resize handle */}
            <div
              className={`wf-exec-panel-resize-handle ${isDragging.current ? 'dragging' : ''}`}
              onMouseDown={handleResizeStart}
            />
            <ExecutionResultsPanel
              executionData={executionData}
              isExecuting={isExecuting}
              selectedNodeId={selectedNode?.id || null}
              nodes={nodes}
              workflowId={workflowId || null}
              workflowName={workflowName}
              canvasContext={canvasContext}
              executionContext={executionContext}
              rawDefinition={{ nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })), edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })) }}
              onNodeSelect={handleExecutionNodeSelect}
              onLoadExecution={(execId) => {
                loadExecutionDetail(execId);
              }}
              onRerun={onExecute ? handleExecute : undefined}
              onWorkflowGenerated={handleWorkflowGenerated}
              onWorkflowPatch={handleWorkflowPatch}
              defaultTab={activeExecTab || (showAIBuilder && !showExecutionPanel ? 'assistant' : undefined)}
              onClose={handleExecPanelClose}
              style={{ width: execPanelWidth }}
            />
          </>
        )}

        {/* Share Dialog */}
        {workflowId && (
          <ShareDialog
            isOpen={showShareDialog}
            onClose={() => setShowShareDialog(false)}
            workflowId={workflowId}
            workflowName={workflowName}
            currentVisibility="private"
            onVisibilityChange={async () => {}}
          />
        )}

        {/* Pre-flight validation popover (Task #43) — appears when Run is
         * clicked on a flow that has hard validation errors. Lists every
         * incomplete node in one go with click-to-jump. The user must
         * either fix the issues (Cancel button selects no action and
         * leaves them on the canvas with the red field outlines + side-
         * panel error text the validator already populated) or explicitly
         * opt in to Run-Anyway (sets the override ref and re-fires
         * handleExecute, which will skip this gate on the retry). */}
        <PreflightValidationPopover
          isOpen={preflightOpen}
          incomplete={preflightIncomplete}
          onJumpToNode={(nodeId) => {
            const node = nodes.find((n: any) => n.id === nodeId);
            if (node) setSelectedNode(node);
            setPreflightOpen(false);
          }}
          onCancel={() => setPreflightOpen(false)}
          onRunAnyway={() => {
            overrideValidationRef.current = true;
            setPreflightOpen(false);
            // Re-fire handleExecute on next tick — the override ref short-
            // circuits the validation gate.
            setTimeout(() => handleExecute(), 0);
          }}
        />

        {/* Right-click context menu for canvas nodes — items built by
         * the pure factory in buildNodeContextMenuItems. Clicking outside
         * closes via NodeContextMenu's internal Escape listener; we close
         * explicitly when an item fires onSelect. */}
        {ctxMenu.open && ctxMenu.node && (
          <NodeContextMenu
            isOpen
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={closeCtxMenu}
            items={buildNodeContextMenuItems(ctxMenu.node, {
              onConfigure: handleNodeConfigure,
              onDuplicate: handleNodeDuplicate,
              onToggleDisabled: handleNodeToggleDisabled,
              onDelete: handleNodeDelete,
            })}
          />
        )}

        {/* Required-trigger-inputs modal (Slice E). Appears when Run is
         * clicked on a flow with declared trigger.data.inputs that have
         * required:true and no stored value. Submitting fires Run with
         * the collected values; cancelling closes the modal. */}
        <RunInputsModal
          isOpen={runInputsOpen}
          inputs={pendingRunInputs}
          defaultValues={pendingRunDefaults}
          onCancel={() => {
            setRunInputsOpen(false);
            setPendingRunInputs([]);
            setPendingRunDefaults({});
            collectedRunInputsRef.current = null;
          }}
          onSubmit={(values) => {
            collectedRunInputsRef.current = values;
            setRunInputsOpen(false);
            setPendingRunInputs([]);
            setPendingRunDefaults({});
            // Re-fire handleExecute on next tick — collectedRunInputsRef
            // is now populated so the gate short-circuits.
            setTimeout(() => handleExecute(), 0);
          }}
        />

        {/* Missing-secrets wizard (#73). Pops when scanMissingSecrets finds
         * {{secret:NAME}} references the user hasn't created. Submitting
         * POSTs each value to /admin/workflow-secrets (workflow-scoped if
         * we have a workflowId, otherwise global), then re-fires the run. */}
        <MissingSecretsWizard
          isOpen={missingSecretsOpen}
          missing={pendingMissingSecrets}
          onCancel={() => {
            setMissingSecretsOpen(false);
            setPendingMissingSecrets([]);
            missingSecretsResolvedRef.current = false;
          }}
          onSubmit={async (values) => {
            try {
              await createSecrets(values, workflowId || undefined);
              missingSecretsResolvedRef.current = true;
              setMissingSecretsOpen(false);
              setPendingMissingSecrets([]);
              // Re-fire on next tick — gate short-circuits.
              setTimeout(() => handleExecute(), 0);
            } catch (err: any) {
              console.error('[WorkflowContainer] Failed to save secrets:', err);
              alert(`Could not save secret: ${err?.message || 'unknown error'}`);
            }
          }}
        />

        {/* HITL needs-input gate — render the form when the engine pauses on a
         * needs_input frame so the user can supply the required run inputs and
         * resume the flow. */}
        {needsInput && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'color-mix(in srgb, var(--cm-bg, var(--color-bg-primary)) 60%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 16,
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}>
              <NeedsInputForm
                request={needsInput}
                onSubmit={handleNeedsInputSubmit}
              />
            </div>
          </div>
        )}

        {/* Multi-agent swarm popovers — one per running multi_agent /
         * agent_pool / agent_supervisor node. Built up from `subagent.start`
         * / `subagent.complete` events the engine emits via emitNodeProgress.
         * Stacked vertically at right-of-canvas while multiple swarms run. */}
        {Object.entries(swarmAgents).map(([nodeId, agents], idx) => {
          if (!agents || agents.length === 0) return null;
          const node = nodes.find(n => n.id === nodeId);
          const pattern = (node?.data as any)?.pattern;
          return (
            <div
              key={`swarm-${nodeId}`}
              style={{
                position: 'absolute',
                right: 16,
                top: 88 + idx * 24,
                zIndex: 25,
                pointerEvents: 'auto',
              }}
            >
              <MultiAgentSwarmPopover
                isOpen={true}
                nodeId={nodeId}
                agents={agents}
                pattern={pattern}
                onClose={() => setSwarmAgents(prev => {
                  const next = { ...prev };
                  delete next[nodeId];
                  return next;
                })}
              />
            </div>
          );
        })}

        {/* Version History Panel */}
        {showHistoryPanel && (
          <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: 340,
            zIndex: 40,
            boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
          }}>
            <VersionHistoryPanel
              versions={workflowVersions}
              currentVersion={workflowVersions.find(v => v.isActive) || null}
              onClose={() => setShowHistoryPanel(false)}
              onCompare={handleCompareVersion}
              onRestore={handleRestoreVersion}
            />
          </div>
        )}

        {/* Version Diff View */}
        {comparingVersion && (
          <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: 440,
            zIndex: 40,
            boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
          }}>
            <VersionDiffView
              currentVersion={{
                version: workflowVersions.find(v => v.isActive)?.version || 1,
                definition: { nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })), edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })) },
                createdAt: new Date().toISOString(),
              }}
              compareVersion={{
                version: comparingVersion.version,
                definition: comparingVersion.definition || { nodes: [], edges: [] },
                createdAt: comparingVersion.createdAt || new Date().toISOString(),
              }}
              onClose={() => setComparingVersion(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const WorkflowsContainer: React.FC<WorkflowsContainerProps> = (props) => (
  <ReactFlowProvider>
    <WorkflowCanvasInner {...props} />
  </ReactFlowProvider>
);
