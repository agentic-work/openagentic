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
import { WorkflowCanvas } from './canvas/WorkflowCanvas';
import { WorkflowToolbar } from './toolbar/WorkflowToolbar';
import { NodePropertiesPanel } from './NodePropertiesPanel';
import { ExecutionResultsPanel, ExecutionData, NodeExecution, TabId } from './ExecutionResultsPanel';
import { useWorkflowResources } from '../hooks/useWorkflowResources';
import { useBackendNodes } from '../hooks/useBackendNodes';
import { useAgentNodes } from '../hooks/useAgentNodes';
import { AIFlowBuilder } from './AIFlowBuilder';
import type { CanvasContext, ExecutionContext, WorkflowPatch } from '../hooks/useAIFlowChat';
import { ShareDialog } from './ShareDialog';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';

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

  // Undo/redo support (Ctrl+Z / Ctrl+Shift+Z)
  const { takeSnapshot } = useUndoRedo(nodes, edges, setNodes, setEdges);

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

  // Keyboard shortcut: X toggles X-Ray mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'x' || e.key === 'X') {
        // Don't toggle if user is typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        setXrayMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
          textColor: '#8b949e',
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

  // --- Execution ---
  const clearExecutionStates = useCallback(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, executionState: undefined, executionOutput: undefined, executionTimeMs: undefined, executionError: undefined, executionOrder: undefined },
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
      setNodes(nds => nds.map(n => n.id === nodeId
        ? { ...n, data: { ...n.data, executionState: 'failed', executionError: error } }
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
          ? { ...n, status: 'failed' as const, error }
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
    }
  }, [setNodes, setEdges, nodes]);

  const handleExecute = useCallback(async () => {
    if (nodes.length === 0) return;
    if (!onExecute && !workflowId) return;

    // Run validation before execution — only block on hard compilation errors,
    // not warnings (unreachable nodes, missing optional fields)
    const valResult = await handleValidate();
    const hardErrors = valResult.issues?.filter((i: any) =>
      i.severity === 'error' && !['UNREACHABLE_NODE', 'INVALID_NODE_REF', 'NON_UPSTREAM_REF'].includes(i.code)
    ) || [];
    if (hardErrors.length > 0) {
      console.warn('[WorkflowContainer] Validation blocked:', hardErrors.length, 'hard errors', hardErrors);
      // Don't block execution for templates — backend compiler is authoritative
      // Client-side validators may flag false positives on template nodes
      if (!workflowId) {
        setShowExecutionPanel(true);
        return;
      }
      console.warn('[WorkflowContainer] Bypassing client validation for saved workflow, backend compile was valid');
    }

    setIsExecuting(true);
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
        console.log('[WorkflowContainer] Direct async execute v6:', workflowId);
        await apiService.executeWorkflow(workflowId, {}, (event) => {
          console.log('[WorkflowContainer] SSE:', event.type, event.data?.nodeId);
          handleExecutionEvent({ type: event.type, ...event.data });
        });
      } else {
        // Fallback to parent-provided executor
        await onExecute(definition, handleExecutionEvent);
      }
      console.log('[WorkflowContainer] Execution completed');
    } catch (err) {
      console.error('[WorkflowContainer] Execution FAILED:', err);
    } finally {
      setIsExecuting(false);
    }
  }, [onExecute, workflowId, apiService, getWorkflowDefinition, nodes.length, edges.length, clearExecutionStates, handleExecutionEvent]);

  const handleExecutionNodeSelect = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) { setSelectedNode(node); }
  }, [nodes]);

  const nodeColorFn = useCallback((node: Node) => {
    const config = activeNodeConfigs[node.type as NodeType];
    return config?.color || '#607d8b';
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
              onInit={(instance: any) => {
                setReactFlowInstance(instance);
                if (nodes.length > 0) {
                  setTimeout(() => instance.fitView({ padding: 0.15 }), 200);
                }
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
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
      </div>
    </div>
  );
};

export const WorkflowsContainer: React.FC<WorkflowsContainerProps> = (props) => (
  <ReactFlowProvider>
    <WorkflowCanvasInner {...props} />
  </ReactFlowProvider>
);
