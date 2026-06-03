/**
 * @openagentic/workflow-engine/graph — the design-time EDGE GATE.
 *
 * Pure graph-validation primitives for OpenAgentic flows. Consumed by the
 * builder UI (drag-time), the api flow-SAVE handler (reject invalid 400), and
 * the WorkflowCompiler / engine boot (fail-closed before run).
 */

export {
  isValidConnection,
  hasPath,
  buildNodeMap,
  type ConnPort,
  type ConnNode,
  type ConnEdge,
  type ConnectionRequest,
  type ConnectionVerdict,
} from './connectionValidation.js';

export {
  validateFlowTopology,
  type TopologyError,
  type TopologyResult,
} from './flowTopology.js';

// validateFlow — the SINGLE contract-aware flow validator (P0-3). The SoT
// `validate()` the builder UI, api flow-SAVE, api flow-EXECUTE, and the flows
// authoring agent all call. Subsumes validateGraph (CHECK 2) and adds CHECK 1
// (schema-derived required config), CHECK 3 (contract-aware {{ref}} resolution),
// and CHECK 4 (trigger-derived required inputs).
export {
  validateFlow,
  type FlowGraph,
  type FlowNode,
  type FlowEdge,
  type FlowNodeSchemaShape,
  type FlowSettingShape,
  type FlowOutputPortShape,
  type ValidateFlowContext,
  type ValidateFlowResult,
  type ValidateFlowSummary,
  type NodeIssue,
  type NodeIssueGroup,
  type IssueSeverity,
  type RequiredValueHint,
  type UnresolvedRef,
  type RequiredInput,
  type RequiredSecret,
  type EdgeIssue,
  type TopologyIssue,
} from './validateFlow.js';

import {
  isValidConnection,
  buildNodeMap,
  type ConnNode,
  type ConnEdge,
} from './connectionValidation.js';
import {
  validateFlowTopology,
  type TopologyError,
} from './flowTopology.js';

/** A single combined-graph validation problem. */
export interface GraphValidationError {
  kind: 'edge' | 'topology';
  code: string;
  message: string;
  edgeId?: string;
  nodeId?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationError[];
}

/**
 * validateGraph — run BOTH gates over a whole persisted graph at once.
 *
 * Edge gate: re-validates every edge against the graph formed by the edges
 * that come BEFORE it (so a duplicate scalar wire or a cycle-closing edge is
 * caught at the offending edge). Topology gate: entry/terminal contract.
 *
 * This is the function the api flow-SAVE handler and the compiler call. It is
 * LENIENT by construction (untyped ports allow, default-input fan-in allows),
 * so it must not reject any legitimately-valid existing template.
 */
export function validateGraph(
  nodes: ReadonlyArray<ConnNode>,
  edges: ReadonlyArray<ConnEdge>,
): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const nodeMap = buildNodeMap(nodes);

  // Edge gate — incrementally, so each edge is checked against the ones
  // already accepted before it.
  const accepted: ConnEdge[] = [];
  for (const e of edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      errors.push({
        kind: 'edge',
        code: 'MALFORMED_EDGE',
        message: `Edge ${e?.id ?? '(no id)'} is missing a source or target.`,
        edgeId: e?.id,
      });
      continue;
    }
    const verdict = isValidConnection(
      {
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      },
      e.target,
      accepted,
      nodeMap,
    );
    if (!verdict.valid) {
      errors.push({
        kind: 'edge',
        code: verdict.code ?? 'INVALID_EDGE',
        message: `${verdict.reason ?? 'Invalid edge.'}${e.id ? ` (edge ${e.id})` : ''}`,
        edgeId: e.id,
      });
    }
    accepted.push(e);
  }

  // Topology gate.
  const topo = validateFlowTopology(nodes, edges);
  for (const te of topo.errors as TopologyError[]) {
    errors.push({
      kind: 'topology',
      code: te.code,
      message: te.message,
      nodeId: te.nodeId,
    });
  }

  return { valid: errors.length === 0, errors };
}
