/**
 * Seed-template schema guards (#306, #307).
 *
 * These tests enforce that every built-in workflow template registered in
 * `SEED_WORKFLOW_TEMPLATES` (services/openagentic-api/src/routes/workflows.ts)
 * references only:
 *
 *  - MCP tool names that actually exist on the deployed MCP server.
 *    Allowlist is derived from each server's python source-of-truth (the
 *    @mcp.tool-decorated async defs in services/mcps/openagentic-*-mcp/).
 *  - RAG node parameters that match the live vector-search endpoint schema
 *    (services/openagentic-api/src/routes/v1/vector.ts:134-154):
 *      body.collection ∈ { 'code', 'docs', 'memories' }
 *      body.minScore   (NOT `scoreThreshold`)
 *      body.filter     (NOT `filters`)
 *
 * The regression these guard against was caught by Agent F's v0.6.6 flows
 * validation run (`docs/releases/0.6.6-evidence/flows-validation/matrix.md`):
 *  - #307 Platform Health Deep Dive: `mcp-nodes` used `k8s_get_nodes` which
 *    the `openagentic_kubernetes` MCP does not expose (real name: `k8s_list_nodes`).
 *  - #306 RAG Knowledge Pipeline: `rag-search` passed the executor's default
 *    `collection: "default"` through to `POST /api/v1/vector/search`, which
 *    the endpoint schema rejects with HTTP 400.
 */
import { describe, it, expect } from 'vitest';
import { SEED_WORKFLOW_TEMPLATES } from '../workflows.js';

// -----------------------------------------------------------------------------
// MCP tool allowlists.
//
// These lists are derived by inspecting each MCP server's source-of-truth —
// every async def decorated with @mcp.tool(...). If a template references a
// tool name that is not in the matching server's allowlist here, that
// template is broken (the tool will return "Unknown tool" at runtime).
//
// Kept intentionally small and hand-curated — the intent is to catch drift
// between template seeds and MCP registrations, not to exhaustively mirror
// every tool.
// -----------------------------------------------------------------------------

// From services/mcps/oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py
const OpenAgentic_KUBERNETES_TOOLS = new Set<string>([
  'k8s_list_namespaces',
  'k8s_get_namespace',
  'k8s_create_namespace',
  'k8s_delete_namespace',
  'k8s_list_pods',
  'k8s_get_pod',
  'k8s_get_pod_logs',
  'k8s_delete_pod',
  'k8s_list_deployments',
  'k8s_get_deployment',
  'k8s_scale_deployment',
  'k8s_restart_deployment',
  'k8s_list_services',
  'k8s_get_service',
  'k8s_list_configmaps',
  'k8s_get_configmap',
  'k8s_list_secrets',
  'k8s_list_nodes',
  'k8s_get_events',
  'k8s_cluster_health',
  'k8s_apply_yaml',
  'k8s_patch_resource',
  'k8s_rollout_status',
  'k8s_rollout_history',
  'k8s_rollout_undo',
  'k8s_list_contexts',
  'k8s_get_current_context',
  'k8s_list_api_resources',
  'k8s_explain_resource',
  'k8s_cordon_node',
  'k8s_uncordon_node',
  'k8s_drain_node',
  'k8s_cleanup_pods',
]);

// From services/mcps/oap-prometheus-mcp/src/prometheus_mcp_server/server.py
const OpenAgentic_PROMETHEUS_TOOLS = new Set<string>([
  'prometheus_query',
  'prometheus_query_range',
  'prometheus_alerts',
  'prometheus_targets',
  'prometheus_metrics_list',
  'prometheus_metric_info',
  'prometheus_rules',
  'prometheus_health_summary',
]);

// From services/mcps/oap-loki-mcp/src/loki_mcp_server/server.py
const OpenAgentic_LOKI_TOOLS = new Set<string>([
  'loki_query',
  'loki_search_errors',
  'loki_tail',
  'loki_labels',
  'loki_label_values',
  'loki_count_logs',
  'loki_log_rate',
]);

const MCP_TOOL_ALLOWLISTS: Record<string, Set<string>> = {
  openagentic_kubernetes: OpenAgentic_KUBERNETES_TOOLS,
  openagentic_prometheus: OpenAgentic_PROMETHEUS_TOOLS,
  openagentic_loki: OpenAgentic_LOKI_TOOLS,
};

// -----------------------------------------------------------------------------
// Vector-search endpoint schema (services/openagentic-api/src/routes/v1/vector.ts)
// -----------------------------------------------------------------------------

const VECTOR_COLLECTIONS = new Set<string>(['code', 'docs', 'memories']);
const VECTOR_PARAM_NAMES = new Set<string>([
  'query',
  'collection',
  'topK',
  'minScore',
  'filter',
  // label/icon/color/etc are UI-only fields that live alongside in node.data
  // so we don't enforce disallowing them here. The forbidden names below do
  // get explicitly rejected.
]);
const FORBIDDEN_RAG_PARAM_NAMES = new Set<string>([
  'scoreThreshold',
  'filters',
]);

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('SEED_WORKFLOW_TEMPLATES schema guards (#306, #307)', () => {
  it('has at least one template registered', () => {
    expect(SEED_WORKFLOW_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('every template has a non-empty name, definition, and nodes array', () => {
    for (const tpl of SEED_WORKFLOW_TEMPLATES) {
      expect(tpl.name, `template missing name`).toBeTruthy();
      expect(tpl.definition, `template ${tpl.name} missing definition`).toBeTruthy();
      expect(
        Array.isArray(tpl.definition.nodes),
        `template ${tpl.name} definition.nodes must be array`,
      ).toBe(true);
      expect(
        tpl.definition.nodes.length,
        `template ${tpl.name} must have at least one node`,
      ).toBeGreaterThan(0);
    }
  });

  describe('MCP tool node guards (#307)', () => {
    it('every mcp_tool node references a known MCP server + tool combination', () => {
      const offenders: string[] = [];
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        for (const node of tpl.definition.nodes) {
          if (node.type !== 'mcp_tool') continue;
          const toolServer = node.data?.toolServer as string | undefined;
          const toolName = node.data?.toolName as string | undefined;
          if (!toolServer) {
            offenders.push(`${tpl.name}:${node.id} missing toolServer`);
            continue;
          }
          if (!toolName) {
            offenders.push(`${tpl.name}:${node.id} missing toolName`);
            continue;
          }
          const allow = MCP_TOOL_ALLOWLISTS[toolServer];
          if (!allow) {
            offenders.push(
              `${tpl.name}:${node.id} references unknown MCP server "${toolServer}" ` +
                `(no allowlist entry — add one to seed-templates.test.ts if this is a new MCP)`,
            );
            continue;
          }
          if (!allow.has(toolName)) {
            offenders.push(
              `${tpl.name}:${node.id} references tool "${toolName}" on server "${toolServer}" ` +
                `which is not in the allowlist. Did you mean one of: ${[...allow].slice(0, 6).join(', ')}?`,
            );
          }
        }
      }
      expect(offenders, `MCP tool node drift:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });

    it('Platform Health Deep Dive node-resources step uses k8s_list_nodes (regression #307)', () => {
      const tpl = SEED_WORKFLOW_TEMPLATES.find((t) => t.name === 'Platform Health Deep Dive');
      expect(tpl, 'Platform Health Deep Dive template must exist').toBeTruthy();
      const node = tpl!.definition.nodes.find((n: any) => n.id === 'mcp-nodes');
      expect(node, 'mcp-nodes node must exist').toBeTruthy();
      expect(node!.data.toolName).toBe('k8s_list_nodes');
      expect(node!.data.toolServer).toBe('openagentic_kubernetes');
    });
  });

  describe('RAG query node guards (#306)', () => {
    it('every rag_query node uses a valid collection and param names match the vector-search schema', () => {
      const offenders: string[] = [];
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        for (const node of tpl.definition.nodes) {
          if (node.type !== 'rag_query') continue;
          const data = node.data || {};

          // Collection enum: if set, must be one of code/docs/memories.
          // We also REQUIRE the seed template to set it explicitly, because
          // the executor's default is 'default' which the vector-search API
          // rejects (HTTP 400 — Agent F's #306 finding).
          const collection = data.collection as string | undefined;
          if (!collection) {
            offenders.push(
              `${tpl.name}:${node.id} rag_query node missing explicit "collection" — ` +
                `executor default is "default" which fails /api/v1/vector/search validation`,
            );
          } else if (!VECTOR_COLLECTIONS.has(collection)) {
            offenders.push(
              `${tpl.name}:${node.id} rag_query node uses collection="${collection}" ` +
                `which is not in the vector-search enum {${[...VECTOR_COLLECTIONS].join(',')}}`,
            );
          }

          // Forbid the legacy param names that used to sneak through the
          // executor and fail the endpoint schema (or get silently dropped).
          for (const bad of FORBIDDEN_RAG_PARAM_NAMES) {
            if (bad in data) {
              const canonical = bad === 'scoreThreshold' ? 'minScore' : 'filter';
              offenders.push(
                `${tpl.name}:${node.id} rag_query node has forbidden "${bad}" — ` +
                  `the vector-search endpoint calls this "${canonical}"`,
              );
            }
          }
        }
      }
      expect(offenders, `RAG schema drift:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });

    it('RAG Knowledge Pipeline rag-search node targets collection=docs with minScore+filter (regression #306)', () => {
      const tpl = SEED_WORKFLOW_TEMPLATES.find((t) => t.name === 'RAG Knowledge Pipeline');
      expect(tpl, 'RAG Knowledge Pipeline template must exist').toBeTruthy();
      const node = tpl!.definition.nodes.find((n: any) => n.id === 'rag-search');
      expect(node, 'rag-search node must exist').toBeTruthy();
      expect(node!.type).toBe('rag_query');
      expect(node!.data.collection).toBe('docs');
      // minScore present + numeric + within (0..1]; scoreThreshold absent.
      expect(typeof node!.data.minScore).toBe('number');
      expect(node!.data.minScore).toBeGreaterThan(0);
      expect(node!.data.minScore).toBeLessThanOrEqual(1);
      expect('scoreThreshold' in node!.data).toBe(false);
      // filter present + object; filters absent.
      expect(typeof node!.data.filter).toBe('object');
      expect(node!.data.filter).not.toBeNull();
      expect('filters' in node!.data).toBe(false);
      // Any filter keys that ARE present must be recognized by the endpoint schema.
      const ALLOWED_FILTER_KEYS = new Set(['file_extensions', 'paths']);
      for (const k of Object.keys(node!.data.filter)) {
        expect(ALLOWED_FILTER_KEYS.has(k), `filter key "${k}" not in vector-search schema`).toBe(true);
      }
    });
  });

  describe('general template hygiene', () => {
    it('every node.data param in rag_query nodes is either vector-schema or non-conflicting UI metadata', () => {
      // UI metadata fields that are allowed alongside the vector-search params.
      const UI_META = new Set([
        'label',
        'icon',
        'color',
        'description',
        'modelOverride',
      ]);
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        for (const node of tpl.definition.nodes) {
          if (node.type !== 'rag_query') continue;
          const keys = Object.keys(node.data || {});
          for (const k of keys) {
            // Fast path: allowed schema or allowed UI metadata.
            if (VECTOR_PARAM_NAMES.has(k) || UI_META.has(k)) continue;
            // The forbidden names are asserted elsewhere; skip here so the
            // message-per-node stays readable.
            if (FORBIDDEN_RAG_PARAM_NAMES.has(k)) continue;
            throw new Error(
              `${tpl.name}:${node.id} rag_query node has unrecognized key "${k}"`,
            );
          }
        }
      }
    });

    it('every mcp_tool node has a non-empty label, icon, and color for the flow UI', () => {
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        for (const node of tpl.definition.nodes) {
          if (node.type !== 'mcp_tool') continue;
          expect(node.data?.label, `${tpl.name}:${node.id} missing label`).toBeTruthy();
          expect(node.data?.icon, `${tpl.name}:${node.id} missing icon`).toBeTruthy();
          expect(node.data?.color, `${tpl.name}:${node.id} missing color`).toBeTruthy();
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Structural validation (#74 templates harness)
    // ─────────────────────────────────────────────────────────────────────
    it('every template has at least one trigger node', () => {
      const offenders = SEED_WORKFLOW_TEMPLATES
        .filter((tpl) => !tpl.definition.nodes.some((n) => n.type === 'trigger'))
        .map((tpl) => tpl.name);
      expect(offenders, `templates missing a trigger:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });

    it('every edge points to nodes that actually exist (no dangling source/target)', () => {
      const offenders: string[] = [];
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        const nodeIds = new Set(tpl.definition.nodes.map((n) => n.id));
        for (const edge of tpl.definition.edges) {
          if (!nodeIds.has(edge.source))
            offenders.push(`${tpl.name}: edge source "${edge.source}" missing`);
          if (!nodeIds.has(edge.target))
            offenders.push(`${tpl.name}: edge target "${edge.target}" missing`);
        }
      }
      expect(offenders, `dangling edges:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });

    it('every non-trigger node is reachable from at least one inbound edge (no orphans)', () => {
      const offenders: string[] = [];
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        const inbound = new Set(tpl.definition.edges.map((e) => e.target));
        for (const node of tpl.definition.nodes) {
          if (node.type === 'trigger') continue;
          if (!inbound.has(node.id))
            offenders.push(`${tpl.name}:${node.id} (${node.type}) — no inbound edge`);
        }
      }
      expect(offenders, `orphan nodes:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });

    it('every {{trigger.input.X}} reference has a matching declared trigger.data.inputs[X]', () => {
      const offenders: string[] = [];
      const triggerInputRefRe = /\{\{trigger\.input\.([A-Za-z0-9_]+)\}\}/g;
      for (const tpl of SEED_WORKFLOW_TEMPLATES) {
        const declared = new Set<string>();
        for (const node of tpl.definition.nodes) {
          if (node.type !== 'trigger') continue;
          const inputs = (node.data as any)?.inputs;
          if (Array.isArray(inputs)) {
            for (const i of inputs) if (i?.name) declared.add(String(i.name));
          }
        }
        const blob = JSON.stringify(tpl.definition);
        const seen = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = triggerInputRefRe.exec(blob)) !== null) {
          const name = m[1];
          if (seen.has(name)) continue;
          seen.add(name);
          if (!declared.has(name)) {
            offenders.push(`${tpl.name}: references trigger.input.${name} but trigger has no inputs[${name}]`);
          }
        }
      }
      expect(offenders, `undeclared trigger.input refs:\n  - ${offenders.join('\n  - ')}`).toEqual([]);
    });
  });
});
