/**
 * Shared runtime / wire-format types for the workflow engine.
 *
 * Mirrors the canonical definitions in
 * services/openagentic-api/src/services/WorkflowExecutionEngine.ts so api
 * consumers can import from `@openagentic/workflow-engine` instead of
 * reaching into the api package. Phase B prep — the in-process engine
 * keeps its own copies until the api migrates fully to the shared package.
 *
 * If you change a shape here, change it there too.
 */

export interface WorkflowNode {
  id: string;
  type: string;
  // `any` retained for parity with the canonical api WorkflowNode shape —
  // consumers (WorkflowCompiler, WorkflowMarketplaceService) index .data
  // with `.trim()` / `.startsWith()` etc. without type narrowing. Tighten
  // once those call sites land their own runtime guards.
  data: Record<string, any>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type ExecutionEventType =
  | 'execution_start'
  | 'node_start'
  | 'node_complete'
  | 'node_error'
  | 'node_stream'
  | 'node_retry'
  | 'node_fallback'
  | 'execution_complete'
  | 'execution_error'
  | 'approval_required'
  | 'approval_received'
  | 'execution_paused'
  | 'execution_resumed';

export interface ExecutionEvent {
  type: ExecutionEventType;
  executionId: string;
  nodeId?: string;
  nodeType?: string;
  data?: any;
  timestamp: string;
}
