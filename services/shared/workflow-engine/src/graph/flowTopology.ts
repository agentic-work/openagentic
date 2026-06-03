/**
 * flowTopology — the ending/entry CONTRACT validator for OpenAgentic flows.
 *
 * Ported from Flowise's `getStartingNode` / `getEndingNodes` semantic gate
 * (packages/server/src/utils/index.ts): an entry node has in-degree 0 and
 * must be a trigger/input kind; an ending node has out-degree 0 and its
 * `category` must be one of the kinds allowed to TERMINATE a flow
 * (Flowise: Chains | Agents | Engine). OpenAgentic's analogue is below.
 *
 * The bug this catches: a flow that DANGLES on a pure intermediate node — an
 * `mcp_tool` / `http_request` / `transform` / `parse_json` whose output is
 * never consumed and never delivered anywhere. That is almost always an
 * authoring mistake (the model forgot the final "notify"/"answer"/"save"
 * step), and it silently produces a flow that "runs" but delivers nothing.
 *
 * Grounded against the 25 live seed templates (reports/flows-airtight/
 * edge-gate.md): the only entry kind seen is `trigger`; the terminal kinds
 * seen are slack_message, openagentic_llm/llm_completion, save_file, merge,
 * agent_single, jira_issue. The TERMINAL_TYPES + TERMINAL_CATEGORIES sets
 * below are calibrated so every seed passes while a dangling tool/transform
 * is flagged.
 *
 * PURE — no engine state, no Prisma, no network.
 */

import type { ConnNode, ConnEdge } from './connectionValidation.js';

export interface TopologyError {
  code:
    | 'NO_NODES'
    | 'NO_ENTRY'
    | 'INVALID_ENTRY_KIND'
    | 'NO_TERMINAL'
    | 'DANGLING_TERMINAL'
    | 'UNKNOWN_NODE_TYPE';
  message: string;
  nodeId?: string;
}

export interface TopologyResult {
  valid: boolean;
  errors: TopologyError[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
}

// ---------------------------------------------------------------------------
// Node-type → category map. Mirrors each node's schema.json `category`. Kept
// inline (rather than importing the registry) so this validator stays pure +
// usable in the builder UI without loading 70 executors. When a node type is
// absent here it is treated as UNKNOWN — the topology gate does NOT reject on
// unknown type (the compiler's VALID_NODE_TYPES allow-list owns that), it just
// falls back to a permissive terminal decision so a new node type can't break
// existing flows.
// ---------------------------------------------------------------------------

const NODE_CATEGORY: ReadonlyMap<string, string> = new Map<string, string>([
  ['a2a', 'ai'],
  ['openagentic_chat', 'ai'],
  ['openagentic_llm', 'ai'],
  ['agent_pool', 'ai'],
  ['agent_single', 'ai'],
  ['agent_spawn', 'ai'],
  ['agent_supervisor', 'ai'],
  ['aggregate', 'ai'],
  ['anomaly_detect', 'data'],
  ['azure_ai', 'ai'],
  ['bedrock', 'ai'],
  ['code', 'action'],
  ['condition', 'control'],
  ['conversation_memory', 'ai'],
  ['csv_processor', 'data'],
  ['data_query', 'data'],
  ['data_source_query', 'data'],
  ['dedup', 'control'],
  ['discord_message', 'integration'],
  ['document_loader', 'data'],
  ['embedding', 'data'],
  ['error_handler', 'control'],
  ['extract_key', 'data'],
  ['file_upload', 'data'],
  ['filter_data', 'data'],
  ['flow_tool', 'control'],
  ['grounding_check', 'ai'],
  ['guardrails', 'ai'],
  ['http_request', 'action'],
  ['human_approval', 'control'],
  ['human_input', 'control'],
  ['jira_issue', 'integration'],
  ['k8s_sandbox_run', 'action'],
  ['knowledge_ingest', 'data'],
  ['knowledge_search', 'data'],
  ['llm_completion', 'ai'],
  ['llm_router', 'ai'],
  ['loop', 'control'],
  ['map_reduce', 'control'],
  ['mcp_tool', 'integration'],
  ['merge', 'control'],
  ['multi_agent', 'ai'],
  ['multi_query', 'ai'],
  ['outlook_email', 'integration'],
  ['pagerduty_incident', 'integration'],
  ['parallel', 'control'],
  ['parse_json', 'data'],
  ['prompt_template', 'ai'],
  ['rag_query', 'data'],
  ['rate_limiter', 'control'],
  ['reasoning', 'ai'],
  ['regex', 'data'],
  ['rerank', 'ai'],
  ['retry_with_backoff', 'control'],
  ['save_file', 'data'],
  ['select_data', 'data'],
  ['send_email', 'integration'],
  ['servicenow_ticket', 'integration'],
  ['slack_message', 'integration'],
  ['splunk_search', 'integration'],
  ['structured_output', 'ai'],
  ['sub_workflow', 'control'],
  ['switch', 'control'],
  ['teams_message', 'integration'],
  ['text', 'annotation'],
  ['text_splitter', 'data'],
  ['transform', 'data'],
  ['trigger', 'trigger'],
  ['user_context', 'data'],
  ['vector_store', 'data'],
  ['vertex', 'ai'],
  ['wait', 'control'],
  ['wait_for', 'control'],
  ['webhook_response', 'action'],
]);

// ---------------------------------------------------------------------------
// ENTRY kinds — a node with in-degree 0 must be one of these. `trigger` is
// the canonical entry; webhook_response is included because event/webhook
// flows can begin at the response anchor in some authoring patterns. Pure
// input-loader kinds (file_upload, document_loader) are accepted as entries
// because a flow may legitimately begin by ingesting a fixed source.
// ---------------------------------------------------------------------------

const ENTRY_TYPES: ReadonlySet<string> = new Set([
  'trigger',
  'webhook_response',
  'file_upload',
  'document_loader',
]);

// ---------------------------------------------------------------------------
// TERMINAL kinds — a node with out-degree 0 must be allowed to terminate.
// Two tiers: an explicit TYPE allow-list (the precise, grounded set) plus a
// CATEGORY fallback for kinds that semantically deliver/produce a final
// result. The forbidden case is a dangling PURE-INTERMEDIATE node: a tool /
// fetch / transform whose output is computed but never consumed or delivered.
// ---------------------------------------------------------------------------

/** Node types that MAY legitimately be the last node in a flow. */
const TERMINAL_TYPES: ReadonlySet<string> = new Set([
  // answer / output (the flow's final spoken result)
  'openagentic_llm',
  'openagentic_chat',
  'llm_completion',
  'reasoning',
  'aggregate',
  'structured_output',
  // agent terminals (the agent IS the deliverable)
  'agent_single',
  'agent_pool',
  'agent_spawn',
  'agent_supervisor',
  'multi_agent',
  'a2a',
  // notify (deliver to an external channel)
  'slack_message',
  'teams_message',
  'send_email',
  'outlook_email',
  'discord_message',
  'pagerduty_incident',
  'servicenow_ticket',
  'jira_issue',
  'webhook_response',
  // save / persist (durable side-effect = a valid endpoint)
  'save_file',
  'knowledge_ingest',
  'vector_store',
  // control terminals that gather/finalize
  'merge',
  'human_approval',
  'human_input',
  // sub-flow delegation can be a terminal (the sub-flow delivers)
  'sub_workflow',
  'flow_tool',
]);

/**
 * Categories that may terminate (fallback for node types not in
 * TERMINAL_TYPES but semantically a deliverable). Notably EXCLUDES:
 *   - 'data'        — a bare transform/parse/filter endpoint is usually a
 *                     forgotten final step (BUT save_file/vector_store/
 *                     knowledge_ingest are whitelisted by TYPE above).
 *   - 'integration' — a bare mcp_tool/http_request/splunk_search endpoint is
 *                     a forgotten "now do something with it" (notify types are
 *                     whitelisted by TYPE above).
 *   - 'action'      — code/http_request/k8s_sandbox_run dangling = forgotten
 *                     delivery (webhook_response whitelisted by TYPE above).
 *   - 'control'     — condition/switch/loop dangling = a branch goes nowhere
 *                     (merge/human_* whitelisted by TYPE above).
 * 'ai' is allowed because an agent/LLM/reasoning node IS a deliverable answer.
 */
const TERMINAL_CATEGORIES: ReadonlySet<string> = new Set(['ai']);

/** True iff a node of this type may legitimately terminate a flow. */
function mayTerminate(nodeType: string | undefined): boolean {
  if (!nodeType) return true; // unknown shape → permissive (don't break flows)
  if (TERMINAL_TYPES.has(nodeType)) return true;
  const cat = NODE_CATEGORY.get(nodeType);
  if (cat === undefined) return true; // unknown TYPE → permissive
  return TERMINAL_CATEGORIES.has(cat);
}

/** True iff a node of this type may legitimately be a flow entry. */
function mayBeEntry(nodeType: string | undefined): boolean {
  if (!nodeType) return true; // unknown shape → permissive
  if (ENTRY_TYPES.has(nodeType)) return true;
  // annotation nodes (sticky notes) are not real entries but also not errors;
  // they carry no edges. Treat unknown-category as permissive.
  return false;
}

/** Resolve a node's `type` whether it sits on the node or under `data`. */
function nodeType(n: ConnNode): string | undefined {
  if (typeof n.type === 'string' && n.type) return n.type;
  const dt = (n.data as { type?: unknown } | undefined)?.type;
  return typeof dt === 'string' && dt ? dt : undefined;
}

// ---------------------------------------------------------------------------
// validateFlowTopology(nodes, edges) — entry + terminal contract.
// ---------------------------------------------------------------------------

/**
 * Validate the entry/ending contract of a flow:
 *
 *   - At least one ENTRY node (in-degree 0) and EVERY entry must be a
 *     trigger/input kind (INVALID_ENTRY_KIND otherwise).
 *   - At least one TERMINAL node (out-degree 0).
 *   - EVERY terminal must be a category that may terminate (output / answer /
 *     agent / notify / save) — NOT a dangling tool/transform/fetch node
 *     (DANGLING_TERMINAL otherwise).
 *
 * Annotation-only nodes (sticky notes, type `text`) are ignored for the
 * entry/terminal contract since they carry no edges and deliver nothing.
 *
 * @returns precise per-node errors; `valid` is true iff `errors` is empty.
 */
export function validateFlowTopology(
  nodes: ReadonlyArray<ConnNode>,
  edges: ReadonlyArray<ConnEdge>,
): TopologyResult {
  const errors: TopologyError[] = [];

  if (!nodes || nodes.length === 0) {
    return {
      valid: false,
      errors: [{ code: 'NO_NODES', message: 'Flow has no nodes.' }],
      entryNodeIds: [],
      terminalNodeIds: [],
    };
  }

  // Ignore annotation nodes (sticky notes) for the contract — they carry no
  // edges and are decorative.
  const realNodes = nodes.filter((n) => nodeType(n) !== 'text');
  const idSet = new Set(realNodes.map((n) => n.id));

  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const n of realNodes) {
    inDeg.set(n.id, 0);
    outDeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      continue;
    }
    // Only count edges between real (non-annotation, known) nodes.
    if (outDeg.has(e.source)) outDeg.set(e.source, outDeg.get(e.source)! + 1);
    if (inDeg.has(e.target)) inDeg.set(e.target, inDeg.get(e.target)! + 1);
  }

  const entryNodeIds: string[] = [];
  const terminalNodeIds: string[] = [];

  for (const n of realNodes) {
    const inD = inDeg.get(n.id) ?? 0;
    const outD = outDeg.get(n.id) ?? 0;
    const t = nodeType(n);

    // ENTRY: in-degree 0.
    if (inD === 0) {
      entryNodeIds.push(n.id);
      if (!mayBeEntry(t)) {
        errors.push({
          code: 'INVALID_ENTRY_KIND',
          nodeId: n.id,
          message:
            `Invalid entry: node "${n.id}" (type "${t ?? 'unknown'}") has no ` +
            `incoming edges so it is a flow entry, but only trigger/input ` +
            `nodes may start a flow. Add a trigger upstream, or wire this ` +
            `node to a trigger.`,
        });
      }
    }

    // TERMINAL: out-degree 0.
    if (outD === 0) {
      terminalNodeIds.push(n.id);
      if (!mayTerminate(t)) {
        const cat = t ? NODE_CATEGORY.get(t) : undefined;
        errors.push({
          code: 'DANGLING_TERMINAL',
          nodeId: n.id,
          message:
            `Dangling terminal: node "${n.id}" (type "${t ?? 'unknown'}"` +
            `${cat ? `, category "${cat}"` : ''}) has no outgoing edges, but a ` +
            `${cat ?? 'tool/transform'} node cannot end a flow — its output ` +
            `is computed but never delivered. End the flow on an output / ` +
            `answer / agent / notify / save node (e.g. an LLM, agent, ` +
            `slack_message, send_email, or save_file), or wire this node ` +
            `onward.`,
        });
      }
    }
  }

  if (entryNodeIds.length === 0 && realNodes.length > 0) {
    errors.push({
      code: 'NO_ENTRY',
      message:
        'Flow has no entry node (every node has an incoming edge — the graph ' +
        'is fully cyclic or has no trigger). Add a trigger node.',
    });
  }

  if (terminalNodeIds.length === 0 && realNodes.length > 0) {
    errors.push({
      code: 'NO_TERMINAL',
      message:
        'Flow has no terminal node (every node has an outgoing edge — the ' +
        'graph never ends). A flow must end on at least one output/answer/' +
        'notify/save node.',
    });
  }

  void idSet; // reserved for future dangling-edge cross-checks

  return {
    valid: errors.length === 0,
    errors,
    entryNodeIds,
    terminalNodeIds,
  };
}
