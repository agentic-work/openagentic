import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ops-templates (2026-05-31) — source-regression pin for the 3 opinionated,
 * ops-specific Flow templates seeded into the platform:
 *
 *   1. incident-triage   — parallel prometheus + loki + kubernetes → correlate
 *                          → LLM(auto) root-cause narrative WITH evidence.
 *   2. cost-anomaly      — parallel aws (cost explorer) + prometheus (usage)
 *                          → analyze → LLM(auto) anomaly + driver + recommendation.
 *   3. failed-deploy-rca — parallel kubernetes (rollout + events) + loki (logs)
 *                          → analyze → LLM(auto) why it failed + suggested fix.
 *
 * Pure fs + vitest — no DB, no network. Cages the platform conventions these
 * templates MUST obey:
 *   - valid graph (trigger → … → webhook_response, edges reference real nodes)
 *   - has an input (trigger) and an output (webhook_response)
 *   - model:"auto" smart-router convention on every llm_completion node
 *   - ZERO hardcoded model id and ZERO hardcoded provider name in node config
 *   - declares required MCPs via meta.tools_used (the field the UI reads to
 *     prompt for missing MCP servers)
 *   - every (toolServer, toolName) on an mcp_tool node is a real registered tool
 *   - parallel fan-out shape (trigger fans out → single object-merge converges)
 *   - merge-key contract (parallel mcp_tool nodes carry one-word snake labels
 *     so the engine's `(label).replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase()`
 *     key is predictable for the downstream correlate/analyze transform).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_DIR = resolve(__dirname, '../../../seed/templates');

const OPS_SLUGS = ['incident-triage', 'cost-anomaly', 'failed-deploy-rca'] as const;

// Smart-router convention: NO hardcoded model id anywhere in node config.
const HARDCODED_MODEL_RE =
  /claude-|gpt-|gpt[_-]?oss|llama|mistral|gemini|:\d+b|\bo\d-|sonnet|haiku|opus|titan|cohere/i;

// NO hardcoded provider name in node config.
const PROVIDER_NAME_RE = /\b(openai|anthropic|bedrock|ollama|google|vertex|cohere)\b/i;

// The live MCP servers + the tools they actually register.
const TOOL_WHITELIST: Record<string, string[]> = {
  openagentic_prometheus: [
    'prometheus_query',
    'prometheus_query_range',
    'prometheus_alerts',
    'prometheus_targets',
    'prometheus_metrics_list',
    'prometheus_metric_info',
    'prometheus_rules',
    'prometheus_health_summary',
  ],
  openagentic_loki: [
    'loki_query',
    'loki_search_errors',
    'loki_tail',
    'loki_labels',
    'loki_label_values',
    'loki_count_logs',
    'loki_log_rate',
    'loki_context',
    'loki_streams',
  ],
  openagentic_kubernetes: [
    'k8s_rollout_status',
    'k8s_rollout_history',
    'k8s_get_deployment',
    'k8s_list_deployments',
    'k8s_get_events',
    'k8s_list_events',
    'k8s_get_pod_logs',
    'k8s_list_pods',
    'k8s_get_pod',
    'k8s_list_services',
    'k8s_cluster_health',
  ],
  openagentic_aws: ['aws_cost_summary', 'aws_cost_by_service', 'aws_identity'],
  openagentic_web: ['web_search', 'web_news_search', 'web_search_and_read'],
};
const ALLOWED_SERVERS = new Set(Object.keys(TOOL_WHITELIST));

interface Node {
  id: string;
  type: string;
  data: Record<string, unknown>;
}
interface Edge {
  id: string;
  source: string;
  target: string;
}
interface Template {
  slug: string;
  name: string;
  category: string;
  template: boolean;
  meta?: { tools_used?: unknown };
  definition: { nodes: Node[]; edges: Edge[] };
}

function loadTemplate(slug: string): Template {
  const path = join(SEED_DIR, `${slug}.json`);
  expect(existsSync(path), `seed/templates/${slug}.json must exist`).toBe(true);
  const raw = readFileSync(path, 'utf-8');
  // Must parse — proves valid JSON.
  return JSON.parse(raw) as Template;
}

describe('ops templates (incident-triage, cost-anomaly, failed-deploy-rca)', () => {
  describe.each(OPS_SLUGS)('%s', (slug) => {
    const tpl = loadTemplate(slug);
    const nodes = tpl.definition.nodes;
    const edges = tpl.definition.edges;

    it('1. valid graph — non-empty nodes/edges, edges reference real node ids, webhook reachable from trigger', () => {
      expect(Array.isArray(nodes) && nodes.length > 0).toBe(true);
      expect(Array.isArray(edges) && edges.length > 0).toBe(true);

      const ids = new Set(nodes.map((n) => n.id));
      for (const e of edges) {
        expect(ids.has(e.source), `edge ${e.id} source "${e.source}" must be a real node`).toBe(true);
        expect(ids.has(e.target), `edge ${e.id} target "${e.target}" must be a real node`).toBe(true);
      }

      const triggers = nodes.filter((n) => n.type === 'trigger');
      const webhooks = nodes.filter((n) => n.type === 'webhook_response');
      expect(triggers.length, 'exactly one trigger node').toBe(1);
      expect(webhooks.length, 'at least one webhook_response node').toBeGreaterThanOrEqual(1);

      // BFS from the trigger over the edge list — the webhook MUST be reachable.
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
      }
      const seen = new Set<string>([triggers[0].id]);
      const queue = [triggers[0].id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const nxt of adj.get(cur) ?? []) {
          if (!seen.has(nxt)) {
            seen.add(nxt);
            queue.push(nxt);
          }
        }
      }
      const webhookReachable = webhooks.some((w) => seen.has(w.id));
      expect(webhookReachable, 'webhook_response must be reachable from the trigger').toBe(true);
    });

    it('2. has an input node (trigger) AND an output node (webhook_response)', () => {
      expect(nodes.some((n) => n.type === 'trigger')).toBe(true);
      expect(nodes.some((n) => n.type === 'webhook_response')).toBe(true);
    });

    it('3. auto-model convention — every llm_completion node has data.model === "auto"', () => {
      const llmNodes = nodes.filter((n) => n.type === 'llm_completion');
      expect(llmNodes.length, 'at least one llm_completion node').toBeGreaterThanOrEqual(1);
      for (const n of llmNodes) {
        expect(n.data.model, `llm node "${n.id}" must use model:"auto"`).toBe('auto');
      }
    });

    it('4. NO hardcoded model id anywhere in node config', () => {
      for (const n of nodes) {
        const blob = JSON.stringify(n.data);
        const m = blob.match(HARDCODED_MODEL_RE);
        expect(m, `node "${n.id}" contains a hardcoded model id: ${m?.[0]}`).toBeNull();
      }
    });

    it('5. NO hardcoded provider name in node config + NO data.provider key', () => {
      for (const n of nodes) {
        expect(
          Object.prototype.hasOwnProperty.call(n.data, 'provider'),
          `node "${n.id}" must not carry a data.provider key`,
        ).toBe(false);
        const blob = JSON.stringify(n.data);
        const m = blob.match(PROVIDER_NAME_RE);
        expect(m, `node "${n.id}" names a provider in config: ${m?.[0]}`).toBeNull();
      }
    });

    it('6. required-MCP declaration complete — meta.tools_used covers every mcp_tool toolServer', () => {
      const toolsUsed = tpl.meta?.tools_used;
      expect(Array.isArray(toolsUsed) && (toolsUsed as unknown[]).length > 0).toBe(true);
      const declaredServers = new Set(
        (toolsUsed as string[])
          .filter((t) => t.includes('.'))
          .map((t) => t.split('.')[0]),
      );
      const usedServers = new Set(
        nodes.filter((n) => n.type === 'mcp_tool').map((n) => String(n.data.toolServer)),
      );
      for (const s of usedServers) {
        expect(ALLOWED_SERVERS.has(s), `toolServer "${s}" is not an allowed MCP server`).toBe(true);
        expect(
          declaredServers.has(s),
          `mcp_tool uses "${s}" but meta.tools_used does not declare any ${s}.* tool`,
        ).toBe(true);
      }
    });

    it('7. real tool names — every (toolServer, toolName) is a registered MCP tool', () => {
      const mcpNodes = nodes.filter((n) => n.type === 'mcp_tool');
      expect(mcpNodes.length, 'at least one mcp_tool node').toBeGreaterThanOrEqual(1);
      for (const n of mcpNodes) {
        const server = String(n.data.toolServer);
        const tool = String(n.data.toolName);
        expect(TOOL_WHITELIST[server], `unknown MCP server "${server}"`).toBeDefined();
        expect(
          TOOL_WHITELIST[server].includes(tool),
          `tool "${tool}" is not registered on server "${server}"`,
        ).toBe(true);
      }
    });

    it('8. parallel fan-out present — trigger has ≥2 outgoing edges and exactly one object-merge converges them', () => {
      const trigger = nodes.find((n) => n.type === 'trigger')!;
      const outgoing = edges.filter((e) => e.source === trigger.id);
      expect(outgoing.length, 'trigger must fan out to ≥2 parallel branches').toBeGreaterThanOrEqual(2);

      const mergeNodes = nodes.filter((n) => n.type === 'merge');
      expect(mergeNodes.length, 'exactly one merge node').toBe(1);
      expect(
        mergeNodes[0].data.mergeStrategy,
        'merge node must use mergeStrategy:"object"',
      ).toBe('object');

      // Every parallel branch must converge into the merge node.
      const intoMerge = new Set(
        edges.filter((e) => e.target === mergeNodes[0].id).map((e) => e.source),
      );
      const fanTargets = outgoing.map((e) => e.target);
      for (const t of fanTargets) {
        expect(
          intoMerge.has(t),
          `parallel branch "${t}" must converge into the merge node`,
        ).toBe(true);
      }
      expect(intoMerge.size, 'merge must receive ≥2 inbound branches').toBeGreaterThanOrEqual(2);
    });

    it('9. merge-key contract — every mcp_tool feeding the merge has a one-word snake label', () => {
      const mergeNode = nodes.find((n) => n.type === 'merge')!;
      const feedingMerge = new Set(
        edges.filter((e) => e.target === mergeNode.id).map((e) => e.source),
      );
      const mcpFeeders = nodes.filter(
        (n) => n.type === 'mcp_tool' && feedingMerge.has(n.id),
      );
      expect(mcpFeeders.length, 'mcp_tool nodes must feed the merge').toBeGreaterThanOrEqual(2);
      for (const n of mcpFeeders) {
        const label = String(n.data.label ?? '');
        expect(
          /^[a-z0-9_]+$/.test(label),
          `mcp_tool "${n.id}" label "${label}" must be a one-word snake key (/^[a-z0-9_]+$/)`,
        ).toBe(true);
      }
    });

    it('declares slug/name/category/template:true (gallery fields)', () => {
      expect(tpl.slug).toBe(slug);
      expect(typeof tpl.name).toBe('string');
      expect(typeof tpl.category).toBe('string');
      expect(tpl.template).toBe(true);
    });
  });
});
