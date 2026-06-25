import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * rag-knowledge-qa (2026-06-02) — source-regression pin for the grounded,
 * cited RAG Q&A Flow template ported from the upstream templates gallery.
 *
 * Why a dedicated pin (beyond templates-only-working's allow-list): this
 * template's value is the multi_query → knowledge_search → rerank →
 * grounding_check → guardrails quality chain, and its step-references cross
 * a real executor-envelope seam that upstream got wrong for the OSS
 * executors. Some OSS node executors wrap their output as { result, meta }
 * (embedding / knowledge_search / guardrails) while others return a FLAT
 * object (multi_query / rerank / grounding_check). A template that reads
 * {{steps.search.resultCount}} (flat) against the wrapped knowledge_search
 * executor renders empty — a silent data-loss the cluster gate would not
 * catch until a human opened the artifact. This test cages:
 *
 *   1. every node type is registered in the OSS workflow-engine registry,
 *   2. the graph is valid (trigger → … → webhook_response reachable),
 *   3. NO mcp_tool node — this flow runs entirely on the core data layer
 *      (Milvus + Smart-Router LLM), so it ships working on a bare install
 *      with no external MCP credentials,
 *   4. the wrapped-executor reads use the `.result.` envelope and the flat
 *      executor reads do NOT,
 *   5. category is not 'enterprise' and there is no hardcoded model id.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const SEED = resolve(
  __dirname,
  '../../../seed/templates/rag-knowledge-qa.json',
);
const REGISTRY = join(
  REPO_ROOT,
  'services/shared/workflow-engine/src/nodes/registry.ts',
);

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

const tpl = JSON.parse(readFileSync(SEED, 'utf-8')) as {
  slug: string;
  category: string;
  template: boolean;
  definition: { nodes: Node[]; edges: Edge[] };
};
const nodes = tpl.definition.nodes;
const edges = tpl.definition.edges;
const registrySrc = readFileSync(REGISTRY, 'utf-8');
// The full bodyTemplate + prompts, concatenated, for step-ref assertions.
const blob = JSON.stringify(tpl);

describe('rag-knowledge-qa template (grounded RAG Q&A)', () => {
  it('slug/category/template fields are gallery-correct (and NOT enterprise)', () => {
    expect(tpl.slug).toBe('rag-knowledge-qa');
    expect(tpl.template).toBe(true);
    expect(tpl.category).not.toBe('enterprise');
    expect(tpl.category).toBe('rag');
  });

  it('every node type is registered in the OSS workflow-engine registry', () => {
    const used = Array.from(new Set(nodes.map((n) => n.type)));
    for (const t of used) {
      // The registry registers each type by importing ./<type>/schema.json
      // whose `type` field equals the node-type string. A missing executor
      // would mean no such import/register line.
      expect(
        registrySrc.includes(`./${t}/schema.json`),
        `node type "${t}" is not imported+registered in registry.ts`,
      ).toBe(true);
    }
  });

  it('valid graph — trigger → … → webhook_response reachable over real edges', () => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source), `edge ${e.id} source missing`).toBe(true);
      expect(ids.has(e.target), `edge ${e.id} target missing`).toBe(true);
    }
    const trigger = nodes.find((n) => n.type === 'trigger');
    const webhook = nodes.find((n) => n.type === 'webhook_response');
    expect(trigger, 'has a trigger node').toBeTruthy();
    expect(webhook, 'has a webhook_response node').toBeTruthy();

    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }
    const seen = new Set<string>([trigger!.id]);
    const q = [trigger!.id];
    while (q.length) {
      const cur = q.shift()!;
      for (const nx of adj.get(cur) ?? []) {
        if (!seen.has(nx)) {
          seen.add(nx);
          q.push(nx);
        }
      }
    }
    expect(seen.has(webhook!.id), 'webhook reachable from trigger').toBe(true);
  });

  it('runs on the core data layer only — NO mcp_tool nodes (no external MCP creds needed)', () => {
    expect(nodes.some((n) => n.type === 'mcp_tool')).toBe(false);
    // The quality chain must be present.
    for (const required of [
      'multi_query',
      'knowledge_search',
      'rerank',
      'grounding_check',
      'guardrails',
    ]) {
      expect(
        nodes.some((n) => n.type === required),
        `quality node "${required}" present`,
      ).toBe(true);
    }
  });

  it('wrapped-executor reads use the .result. envelope (knowledge_search)', () => {
    // knowledge_search returns { result: { resultCount, results } } in OSS,
    // so any reference to its output MUST go through `.result.`.
    expect(blob).toContain('steps.search.result.resultCount');
    expect(blob).not.toContain('steps.search.resultCount');
    // rerank consumes knowledge_search output → chunksPath into the wrapper.
    const rerank = nodes.find((n) => n.type === 'rerank')!;
    expect(rerank.data.chunksPath).toBe('result.results');
  });

  it('flat-executor reads do NOT use a .result. envelope (multi_query / rerank / grounding_check)', () => {
    // These executors return FLAT objects in OSS.
    expect(blob).toContain('steps.expand.count');
    expect(blob).not.toContain('steps.expand.result.');
    expect(blob).toContain('steps.rerank.chunks');
    expect(blob).toContain('steps.rerank.outputCount');
    expect(blob).not.toContain('steps.rerank.result.');
    expect(blob).toContain('steps.ground.violationSummary');
    expect(blob).not.toContain('steps.ground.result.');
  });

  it('llm_completion uses model:"auto" and there is NO hardcoded model id', () => {
    const HARDCODED_MODEL_RE =
      /claude-|gpt-|gpt[_-]?oss|llama|mistral|gemini|:\d+b|\bo\d-|sonnet|haiku|opus|titan|cohere/i;
    const llm = nodes.filter((n) => n.type === 'llm_completion');
    expect(llm.length).toBeGreaterThanOrEqual(1);
    for (const n of llm) {
      expect(n.data.model, `llm "${n.id}" model:"auto"`).toBe('auto');
    }
    for (const n of nodes) {
      const m = JSON.stringify(n.data).match(HARDCODED_MODEL_RE);
      expect(m, `node "${n.id}" has hardcoded model: ${m?.[0]}`).toBeNull();
    }
  });
});
