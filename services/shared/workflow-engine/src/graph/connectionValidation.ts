/**
 * connectionValidation — the design-time EDGE GATE for OpenAgentic flows.
 *
 * Ported from the two patterns the research distilled
 * (reports/flows-airtight/research-flowise.md + research-langflow.md):
 *
 *   1. Flowise AgentflowV2 `isValidConnectionAgentflowV2`
 *      (packages/agentflow/src/core/validation/connectionValidation.ts) —
 *      topological correctness: NO self-loop + NO cycle (DFS hasPath).
 *   2. Flowise classic `isValidConnection`
 *      (packages/ui/src/utils/genericHelper.js) — TYPE INTERSECTION of the
 *      source emit-types ∩ the target accept-types, plus ARITY (a non-`list`
 *      anchor rejects a 2nd incoming edge; a `list` anchor fans-in).
 *   3. Langflow `types_compatible`
 *      (src/lfx/src/lfx/graph/edge/base.py) — any-overlap string-set match;
 *      an empty/undeclared type list is a free param, not a hard constraint.
 *
 * OpenAgentic-specific calibration (grounded against the 25 live seed
 * templates in routes/workflows.ts SEED_WORKFLOW_TEMPLATES — see
 * reports/flows-airtight/edge-gate.md):
 *
 *   - Edges are almost always node-to-node WITHOUT an explicit
 *     `sourceHandle`/`targetHandle` (134/134 seed edges had no targetHandle).
 *     So ARITY is keyed on the *named* target handle: a 2nd edge into the
 *     SAME explicit non-`list` handle is rejected, but the default (handle-
 *     less) input is treated as fan-in because the engine accumulates all
 *     incoming results there (`getIncomingResults`). This keeps every legit
 *     template valid (many nodes — merge, llm, save_file — legitimately
 *     receive 5+ incoming edges on their default input) while still catching
 *     a genuine double-wire of a typed scalar port.
 *
 *   - TYPE INTERSECTION is LENIENT: typed ports roll out incrementally, so a
 *     port with no declared type (`any`, `''`, or absent) ALWAYS allows the
 *     connection. This tier ONLY rejects when BOTH the source emit-type AND
 *     the target accept-type are declared (non-empty, non-`any`) and share no
 *     overlap. Today most ports declare `any` → this tier is a no-op until the
 *     typed-port rollout populates `emits`/`accepts`, at which point it starts
 *     catching the `.content`-vs-`.output` class of bug (#1221) at design time.
 *
 * This module is PURE — no engine state, no Prisma, no network, no imports
 * beyond a couple of local types. It is the single source of truth for edge
 * validity, consumed by:
 *   - the builder UI (drag-time gate),
 *   - the api flow-SAVE handler (reject invalid graph 400),
 *   - the WorkflowCompiler / engine boot (fail-closed before run).
 */

// ---------------------------------------------------------------------------
// Minimal structural types — intentionally loose so this module can be fed
// the api's WorkflowNode/WorkflowEdge, the engine's, or the persisted JSON
// without an adapter. We only read the fields we need.
// ---------------------------------------------------------------------------

/** A declared port (input or output) on a node. Mirrors NodePort + the
 *  Flowise `list` (fan-in) anchor + Langflow `input_types`/`output_types`. */
export interface ConnPort {
  /** Stable handle name (matches edge.sourceHandle / edge.targetHandle). */
  name: string;
  /**
   * Declared wire type(s). A single string (`'json'`, `'Message'`), a union
   * array (`['Data','JSON']`), or absent. `'any'` / `''` / absent === untyped
   * (lenient-allow). The validator treats a string as a 1-element set.
   */
  type?: string | ReadonlyArray<string>;
  /** Langflow-style explicit accept list on an input (overrides `type`). */
  accepts?: ReadonlyArray<string>;
  /** Flowise/Langflow-style explicit emit list on an output (overrides `type`). */
  emits?: ReadonlyArray<string>;
  /**
   * Flowise `list` anchor — a fan-in port that accepts MANY incoming edges
   * (merge / aggregate / parallel). Default (absent/false) = scalar: rejects
   * a 2nd edge into the SAME named handle.
   */
  list?: boolean;
}

/** A node as the validator needs it — id + type + optional declared ports. */
export interface ConnNode {
  id: string;
  type?: string;
  ports?: {
    inputs?: ReadonlyArray<ConnPort>;
    outputs?: ReadonlyArray<ConnPort>;
  };
  /** Some persisted nodes carry ports under `data` — checked as a fallback. */
  data?: {
    ports?: {
      inputs?: ReadonlyArray<ConnPort>;
      outputs?: ReadonlyArray<ConnPort>;
    };
    [k: string]: unknown;
  };
}

/** An existing edge in the graph. Only the wiring fields are read. */
export interface ConnEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /**
   * Explicit back-edge / loop marker (Flowise `allows_loop`, Langflow
   * `Output.allows_loop`). When true, this edge is EXEMPT from the cycle
   * check — it is an intentional iteration/retry back-edge. Read off the edge
   * or `edge.data.loop`. (Most seed back-edges aren't flagged and instead
   * rely on the control-gate heuristic — see `pathHasControlGate`.)
   */
  loop?: boolean;
  data?: { loop?: boolean; isLoopBack?: boolean; [k: string]: unknown };
}

/** A connection request: the candidate new edge being validated. */
export interface ConnectionRequest {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Mark this candidate as an intentional loop back-edge (cycle-exempt). */
  loop?: boolean;
}

/** Validation verdict with a precise, user-facing reason on rejection. */
export interface ConnectionVerdict {
  valid: boolean;
  /** Present iff `valid === false`. A precise, actionable reason string. */
  reason?: string;
  /** Stable machine code for the rejection tier (for tests / UI i18n). */
  code?:
    | 'SELF_LOOP'
    | 'CYCLE'
    | 'ARITY'
    | 'TYPE_MISMATCH'
    | 'UNKNOWN_SOURCE'
    | 'UNKNOWN_TARGET';
}

// ---------------------------------------------------------------------------
// Fan-in node categories — nodes whose DEFAULT (handle-less) input is a
// merge/aggregate point and therefore legitimately accepts many incoming
// edges. Grounded against the seed templates: merge nodes receive up to 5
// incoming edges, aggregate/parallel/loop/map_reduce/agent_supervisor /
// multi_agent likewise gather multiple upstreams. A scalar node still gets
// fan-in on its DEFAULT input (the engine accumulates via getIncomingResults)
// — the arity rule below only constrains explicitly-named scalar handles, so
// this set is informational + drives `isFanInPort` for the default handle.
// ---------------------------------------------------------------------------

const FAN_IN_NODE_TYPES: ReadonlySet<string> = new Set([
  'merge',
  'aggregate',
  'parallel',
  'map_reduce',
  'loop',
  'agent_supervisor',
  'multi_agent',
  'agent_pool',
]);

// ---------------------------------------------------------------------------
// CONTROL-GATE node types — a cycle that passes through one of these is a
// BOUNDED iteration/retry (a `loop` node iterating, a `condition`/`switch`
// branching back on a retry, a `human_approval`/`human_input` re-prompting),
// NOT an infinite data loop. The cycle check exempts a back-edge whose closed
// cycle contains at least one gate. A cycle with NO gate is a genuine
// infinite loop and is rejected. Grounded against the two looping seed
// templates (PagerDuty Auto-Triage retry-on-reject through a `condition` +
// `human_approval`; Deep Research iterate-on-gaps through a `loop` node).
// ---------------------------------------------------------------------------

const LOOP_GATE_NODE_TYPES: ReadonlySet<string> = new Set([
  'loop',
  'map_reduce',
  'condition',
  'switch',
  'human_approval',
  'human_input',
  'wait_for',
  'retry_with_backoff',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a map id → node from an array (the `nodeMap` callers pass in). */
export function buildNodeMap(
  nodes: ReadonlyArray<ConnNode>,
): Map<string, ConnNode> {
  const m = new Map<string, ConnNode>();
  for (const n of nodes) {
    if (n && typeof n.id === 'string') m.set(n.id, n);
  }
  return m;
}

/** Resolve the inputs/outputs port arrays whether they live on the node or
 *  under `node.data` (persisted graphs use both shapes). */
function getPorts(node: ConnNode | undefined): {
  inputs: ReadonlyArray<ConnPort>;
  outputs: ReadonlyArray<ConnPort>;
} {
  const top = node?.ports;
  const nested = node?.data?.ports;
  return {
    inputs: top?.inputs ?? nested?.inputs ?? [],
    outputs: top?.outputs ?? nested?.outputs ?? [],
  };
}

/** Normalize a port's declared type(s) into a set of declared type-name
 *  strings, dropping the untyped sentinels (`any`, empty). Returns an empty
 *  set for an untyped port (→ lenient-allow). */
function declaredTypeSet(
  port: ConnPort | undefined,
  side: 'emits' | 'accepts',
): Set<string> {
  if (!port) return new Set();
  const explicit = side === 'emits' ? port.emits : port.accepts;
  const raw: ReadonlyArray<string> | undefined =
    explicit && explicit.length > 0
      ? explicit
      : Array.isArray(port.type)
        ? port.type
        : typeof port.type === 'string'
          ? [port.type]
          : undefined;
  const out = new Set<string>();
  if (!raw) return out;
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    // Untyped sentinel — treat as undeclared (lenient).
    if (trimmed.toLowerCase() === 'any') continue;
    out.add(trimmed);
  }
  return out;
}

/** Find a named output port on a node (the source side of an edge). */
function findOutputPort(
  node: ConnNode | undefined,
  handle?: string | null,
): ConnPort | undefined {
  const { outputs } = getPorts(node);
  if (handle) {
    const byName = outputs.find((p) => p.name === handle);
    if (byName) return byName;
  }
  // No explicit handle (or not found) → the node's single/primary output.
  return outputs[0];
}

/** Find a named input port on a node (the target side of an edge). */
function findInputPort(
  node: ConnNode | undefined,
  handle?: string | null,
): ConnPort | undefined {
  const { inputs } = getPorts(node);
  if (handle) {
    const byName = inputs.find((p) => p.name === handle);
    if (byName) return byName;
  }
  return inputs[0];
}

/** Is the target input port a fan-in (list) port for arity purposes? */
function isFanInTarget(
  targetNode: ConnNode | undefined,
  targetHandle: string | null | undefined,
  inputPort: ConnPort | undefined,
): boolean {
  // An explicitly-declared `list` input port is always fan-in.
  if (inputPort?.list === true) return true;
  // The DEFAULT (handle-less) input is fan-in: the engine accumulates ALL
  // handle-less incoming results there (getIncomingResults). Only an
  // EXPLICITLY-named scalar handle is arity-constrained.
  if (!targetHandle) return true;
  // A named handle on a fan-in node type is fan-in.
  if (targetNode?.type && FAN_IN_NODE_TYPES.has(targetNode.type)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Cycle detection — DFS hasPath(target → source) over existing edges.
// Adapted verbatim from Flowise AgentflowV2: if a path already exists from
// the candidate edge's TARGET back to its SOURCE, then adding source→target
// closes a cycle.
// ---------------------------------------------------------------------------

/** Returns true iff a directed path exists from `from` to `to` over `edges`. */
export function hasPath(
  from: string,
  to: string,
  edges: ReadonlyArray<ConnEdge>,
): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      continue;
    }
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }
  const visited = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const next = adj.get(cur);
    if (next) {
      for (const n of next) {
        if (!visited.has(n)) stack.push(n);
      }
    }
  }
  return false;
}

/**
 * Collect every node id reachable from `from` that lies on SOME path to `to`
 * (inclusive of both). These are exactly the nodes that would sit on the cycle
 * the candidate back-edge `to → from` closes. Used to decide whether the cycle
 * passes through a control-gate (bounded iteration) or is an infinite loop.
 */
function nodesOnPaths(
  from: string,
  to: string,
  edges: ReadonlyArray<ConnEdge>,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      continue;
    }
    const list = adj.get(e.source);
    if (list) list.push(e.target);
    else adj.set(e.source, [e.target]);
  }
  // memoized "can reach `to`" from each node
  const canReach = new Map<string, boolean>();
  const onStack = new Set<string>();
  function reaches(node: string): boolean {
    if (node === to) return true;
    const memo = canReach.get(node);
    if (memo !== undefined) return memo;
    if (onStack.has(node)) return false; // avoid infinite recursion on existing cycles
    onStack.add(node);
    let ok = false;
    for (const nx of adj.get(node) ?? []) {
      if (reaches(nx)) {
        ok = true;
        break;
      }
    }
    onStack.delete(node);
    canReach.set(node, ok);
    return ok;
  }
  // BFS from `from`, keeping only nodes that can still reach `to`.
  const onPath = new Set<string>();
  const queue = [from];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (cur === to || reaches(cur)) onPath.add(cur);
    for (const nx of adj.get(cur) ?? []) {
      if (!seen.has(nx)) queue.push(nx);
    }
  }
  onPath.add(from);
  onPath.add(to);
  return onPath;
}

/**
 * True iff the cycle that the back-edge `source → target` would close passes
 * through at least one control-gate node (loop / condition / switch /
 * human_approval / …) — i.e. it is a BOUNDED iteration/retry, not an infinite
 * data loop. Requires a node map to resolve node types; without one, returns
 * false (no gate provable → treat as a hard cycle).
 */
function cycleHasControlGate(
  source: string,
  target: string,
  edges: ReadonlyArray<ConnEdge>,
  map: Map<string, ConnNode> | undefined,
): boolean {
  if (!map) return false;
  // The cycle is: target → … → source (existing path) → target (candidate).
  const cycleNodes = nodesOnPaths(target, source, edges);
  for (const id of cycleNodes) {
    const node = map.get(id);
    const t =
      (typeof node?.type === 'string' && node.type) ||
      (typeof (node?.data as { type?: unknown } | undefined)?.type === 'string'
        ? ((node!.data as { type?: string }).type as string)
        : undefined);
    if (t && LOOP_GATE_NODE_TYPES.has(t)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// THE EDGE GATE — isValidConnection(source, target, existingEdges, nodeMap)
// ---------------------------------------------------------------------------

/**
 * Validate a candidate connection against the 4 invariants, in the order a
 * bad wire most-commonly fails (structure first, then type):
 *
 *   (c) NO SELF-LOOP   — source === target
 *   (d) NO CYCLE       — DFS hasPath(target → source) over existingEdges
 *   (b) ARITY          — a 2nd edge into the same scalar (non-list) named
 *                        handle is rejected; list / default-handle fan-in OK
 *   (a) TYPE INTERSECT — source emits[] ∩ target accepts[] ≠ ∅, LENIENT:
 *                        only rejects when BOTH sides declare a (non-any) type
 *
 * @param source        candidate edge source — node id (string) OR a
 *                      ConnectionRequest object carrying handles.
 * @param target        candidate edge target node id (when `source` is a
 *                      string). Ignored when `source` is a ConnectionRequest.
 * @param existingEdges the edges already in the graph (NOT including the
 *                      candidate). Used for cycle + arity.
 * @param nodeMap       id → ConnNode, for port-type + fan-in resolution.
 *                      Optional: when absent, type+fan-in default to lenient.
 */
export function isValidConnection(
  source: string | ConnectionRequest,
  target: string,
  existingEdges: ReadonlyArray<ConnEdge> = [],
  nodeMap?: Map<string, ConnNode> | ReadonlyArray<ConnNode>,
): ConnectionVerdict {
  // Normalize the call signature (string-pair OR ConnectionRequest).
  const req: ConnectionRequest =
    typeof source === 'string'
      ? { source, target }
      : source;

  const srcId = req.source;
  const tgtId = req.target;
  const srcHandle = req.sourceHandle ?? null;
  const tgtHandle = req.targetHandle ?? null;

  // Resolve the node map (accept either a prebuilt Map or a raw node array).
  let map: Map<string, ConnNode> | undefined;
  if (Array.isArray(nodeMap)) {
    map = buildNodeMap(nodeMap);
  } else {
    map = nodeMap as Map<string, ConnNode> | undefined;
  }

  // --- (c) NO SELF-LOOP --------------------------------------------------
  if (srcId === tgtId) {
    return {
      valid: false,
      code: 'SELF_LOOP',
      reason: `Self-loop rejected: node "${srcId}" cannot connect to itself.`,
    };
  }

  // --- (d) NO CYCLE ------------------------------------------------------
  // If a path already runs from target back to source, source→target closes
  // a cycle. Flows must be acyclic UNLESS the back-edge is an intentional,
  // BOUNDED iteration: either (1) explicitly loop-flagged, or (2) the closed
  // cycle passes through a control-gate node (loop / condition / switch /
  // human_approval) that terminates the iteration. An ungated cycle is an
  // infinite loop and is rejected.
  const explicitLoop =
    req.loop === true ||
    existingEdges.some(
      (e) =>
        e.source === srcId &&
        e.target === tgtId &&
        (e.loop === true || e.data?.loop === true || e.data?.isLoopBack === true),
    );
  if (!explicitLoop && hasPath(tgtId, srcId, existingEdges)) {
    if (!cycleHasControlGate(srcId, tgtId, existingEdges, map)) {
      return {
        valid: false,
        code: 'CYCLE',
        reason:
          `Cycle rejected: connecting "${srcId}" → "${tgtId}" would create an ` +
          `unbounded loop — a path already runs from "${tgtId}" back to ` +
          `"${srcId}" and the cycle has no control gate (loop / condition / ` +
          `switch / human_approval) to terminate it. Flows must be acyclic ` +
          `unless the iteration is gated — add a loop or condition node, or ` +
          `mark the edge as a loop back-edge.`,
      };
    }
  }

  const srcNode = map?.get(srcId);
  const tgtNode = map?.get(tgtId);

  // --- (b) ARITY ---------------------------------------------------------
  // A scalar (non-list) named target handle accepts exactly one incoming
  // edge. The default (handle-less) input + any `list` port fan-in.
  const inputPort = findInputPort(tgtNode, tgtHandle);
  const fanIn = isFanInTarget(tgtNode, tgtHandle, inputPort);
  if (!fanIn) {
    // Count existing edges already landing on this exact (target, handle).
    const collides = existingEdges.some(
      (e) =>
        e.target === tgtId &&
        (e.targetHandle ?? null) === tgtHandle &&
        // ignore a duplicate of the very edge being validated (idempotent)
        !(e.source === srcId && (e.sourceHandle ?? null) === srcHandle),
    );
    if (collides) {
      const portLabel = tgtHandle ? `input "${tgtHandle}"` : 'default input';
      return {
        valid: false,
        code: 'ARITY',
        reason:
          `Arity rejected: the scalar ${portLabel} on node "${tgtId}" already ` +
          `has an incoming edge and accepts only one. Use a merge/aggregate ` +
          `(list) node to combine multiple sources.`,
      };
    }
  }

  // --- (a) TYPE INTERSECTION (LENIENT) -----------------------------------
  // Only reject when BOTH the source output AND the target input declare a
  // concrete (non-any) type and they share no overlap. Untyped ports always
  // allow — typed ports roll out incrementally.
  const outPort = findOutputPort(srcNode, srcHandle);
  const emits = declaredTypeSet(outPort, 'emits');
  const accepts = declaredTypeSet(inputPort, 'accepts');

  if (emits.size > 0 && accepts.size > 0) {
    let overlap = false;
    for (const t of emits) {
      if (accepts.has(t)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      const portLabel = tgtHandle ? `"${tgtHandle}"` : 'default input';
      const srcLabel = srcHandle ? `"${srcHandle}"` : 'output';
      return {
        valid: false,
        code: 'TYPE_MISMATCH',
        reason:
          `Type mismatch: node "${srcId}" ${srcLabel} emits ` +
          `[${[...emits].join(', ')}] but node "${tgtId}" input ${portLabel} ` +
          `accepts [${[...accepts].join(', ')}] — no matching type.`,
      };
    }
  }

  return { valid: true };
}
