/**
 * Tests for the LangFlow → OpenAgentic-flows importer.
 *
 * Uses a small-but-realistic LangFlow export: a "RAG over docs" chain made of
 *   ChatInput → PromptTemplate → VectorStoreRetriever → LLMChain → ChatOutput
 * plus one unknown component (a custom tool) to prove the never-drop passthrough.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  importLangflow,
  type LangflowExport,
  type AwFlowTemplate,
} from './index.js';

// The canonical node types the engine ships (subset relevant to this test).
const VALID_AW_TYPES = new Set([
  'trigger',
  'prompt_template',
  'llm_completion',
  'rag_query',
  'condition',
  'mcp_tool',
  'vector_store',
  'text',
  'text_splitter',
  'document_loader',
  'embedding',
  'parse_json',
  'structured_output',
]);

/** A realistic RAG-over-docs LangFlow export. */
function ragOverDocsExport(): LangflowExport {
  return {
    data: {
      nodes: [
        {
          id: 'ChatInput-1',
          type: 'genericNode',
          position: { x: 100, y: 200 },
          data: {
            type: 'ChatInput',
            node: {
              display_name: 'User Question',
              template: {
                input_value: { value: '', type: 'str' },
                input_value_name: { value: 'question', type: 'str' },
              },
            },
          },
        },
        {
          id: 'Prompt-1',
          type: 'genericNode',
          position: { x: 400, y: 200 },
          data: {
            type: 'PromptTemplate',
            node: {
              display_name: 'RAG Prompt',
              template: {
                template: {
                  value:
                    'Answer the {question} using only this context:\n{context}',
                  type: 'prompt',
                },
                _type: 'prompt',
              },
            },
          },
        },
        {
          id: 'Retriever-1',
          type: 'genericNode',
          position: { x: 700, y: 200 },
          data: {
            type: 'VectorStoreRetriever',
            node: {
              display_name: 'Docs Retriever',
              template: {
                collection_name: { value: 'company-docs', type: 'str' },
                k: { value: 4, type: 'int' },
              },
            },
          },
        },
        {
          id: 'LLM-1',
          type: 'genericNode',
          position: { x: 1000, y: 200 },
          data: {
            type: 'ChatOpenAI',
            node: {
              display_name: 'Answer LLM',
              template: {
                model_name: { value: 'gpt-4o-mini', type: 'str' },
                temperature: { value: 0.2, type: 'float' },
                system_message: { value: 'You are a precise assistant.', type: 'str' },
                max_tokens: { value: 800, type: 'int' },
              },
            },
          },
        },
        {
          id: 'Output-1',
          type: 'genericNode',
          position: { x: 1300, y: 200 },
          data: {
            type: 'ChatOutput',
            node: {
              display_name: 'Final Answer',
              template: { input_value: { value: '', type: 'str' } },
            },
          },
        },
        {
          // Deliberately unknown component → must become a text passthrough.
          id: 'Custom-1',
          type: 'genericNode',
          position: { x: 700, y: 450 },
          data: {
            type: 'MyProprietaryReranker',
            node: {
              display_name: 'Secret Reranker',
              template: {
                threshold: { value: 0.5, type: 'float' },
                model: { value: 'rerank-v9000', type: 'str' },
              },
            },
          },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'ChatInput-1', target: 'Prompt-1' },
        { id: 'edge-2', source: 'Prompt-1', target: 'Retriever-1' },
        { id: 'edge-3', source: 'Retriever-1', target: 'LLM-1' },
        { id: 'edge-4', source: 'LLM-1', target: 'Output-1' },
        { id: 'edge-5', source: 'Retriever-1', target: 'Custom-1' },
      ],
    },
  };
}

describe('importLangflow', () => {
  let result: AwFlowTemplate;

  beforeAll(() => {
    result = importLangflow(ragOverDocsExport());
  });

  it('produces a flow template with nodes[] and edges[]', () => {
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('prepends exactly one trigger node as the entry point', () => {
    const triggers = result.nodes.filter((n) => n.type === 'trigger');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].id).toBe('trigger');
  });

  it('emits only valid OpenAgentic node types', () => {
    for (const n of result.nodes) {
      expect(VALID_AW_TYPES.has(n.type)).toBe(true);
    }
  });

  it('maps each component to the nearest OpenAgentic node type', () => {
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    expect(byId['Prompt-1'].type).toBe('prompt_template');
    expect(byId['Retriever-1'].type).toBe('rag_query');
    expect(byId['LLM-1'].type).toBe('llm_completion');
    expect(byId['ChatInput-1'].type).toBe('text');
    expect(byId['Output-1'].type).toBe('text');
  });

  it('never drops an unmappable node — falls back to a text passthrough with a note', () => {
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    const custom = byId['Custom-1'];
    expect(custom).toBeTruthy();
    expect(custom.type).toBe('text');
    expect(custom.data._importNote).toMatch(/MyProprietaryReranker/);
    // Original config preserved — nothing lost.
    expect(custom.data._langflow.config.threshold).toBe(0.5);
    expect(custom.data._langflow.config.model).toBe('rerank-v9000');
  });

  it('translates known config into the target node data shape', () => {
    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    expect(byId['Prompt-1'].data.template).toContain('{question}');
    expect(byId['Retriever-1'].data.collection).toBe('company-docs');
    expect(byId['Retriever-1'].data.topK).toBe(4);
    expect(byId['LLM-1'].data.systemPrompt).toBe('You are a precise assistant.');
    expect(byId['LLM-1'].data.temperature).toBe(0.2);
    expect(byId['LLM-1'].data.maxTokens).toBe(800);
    // No hardcoded model literal leaks into a first-class field.
    expect(byId['LLM-1'].data.model).toBe('auto');
    // ...but the original is preserved for the author.
    expect(byId['LLM-1'].data._langflow.config.model_name).toBe('gpt-4o-mini');
  });

  it('preserves edge topology (every LangFlow edge survives)', () => {
    // The 5 original edges must all be present, source/target intact.
    const pairs = new Set(result.edges.map((e) => `${e.source}->${e.target}`));
    expect(pairs.has('ChatInput-1->Prompt-1')).toBe(true);
    expect(pairs.has('Prompt-1->Retriever-1')).toBe(true);
    expect(pairs.has('Retriever-1->LLM-1')).toBe(true);
    expect(pairs.has('LLM-1->Output-1')).toBe(true);
    expect(pairs.has('Retriever-1->Custom-1')).toBe(true);
  });

  it('wires the trigger into the graph root', () => {
    // ChatInput-1 has no incoming LangFlow edge → trigger must feed it.
    const triggerEdges = result.edges.filter((e) => e.source === 'trigger');
    expect(triggerEdges.length).toBeGreaterThan(0);
    expect(triggerEdges.some((e) => e.target === 'ChatInput-1')).toBe(true);
  });

  it('every edge endpoint references an existing node', () => {
    const ids = new Set(result.nodes.map((n) => n.id));
    for (const e of result.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('derives trigger.data.input_schema from inputs + prompt variables (run-inputs modal)', () => {
    const trigger = result.nodes.find((n) => n.type === 'trigger')!;
    const schema = trigger.data.input_schema as Record<string, string>;
    expect(schema && typeof schema === 'object').toBe(true);
    // ChatInput named field + the {question} prompt var:
    expect(schema.question).toBe('string');
    // The {context} prompt var is also surfaced as an asked input.
    expect(schema.context).toBe('string');
  });

  it('accepts a bare { nodes, edges } export (no data wrapper)', () => {
    const bare = importLangflow({
      nodes: [
        {
          id: 'P',
          data: {
            type: 'PromptTemplate',
            node: { template: { template: { value: 'Hi {name}' } } },
          },
        },
      ],
      edges: [],
    } as LangflowExport);
    const prompt = bare.nodes.find((n) => n.id === 'P');
    expect(prompt?.type).toBe('prompt_template');
    const trigger = bare.nodes.find((n) => n.type === 'trigger')!;
    expect((trigger.data.input_schema as Record<string, string>).name).toBe('string');
  });

  it('handles an empty export without throwing', () => {
    const empty = importLangflow({ data: { nodes: [], edges: [] } });
    expect(empty.nodes).toHaveLength(1); // just the trigger
    expect(empty.nodes[0].type).toBe('trigger');
    expect(empty.edges).toHaveLength(0);
  });

  it('throws on a non-object export', () => {
    // @ts-expect-error — intentionally invalid input
    expect(() => importLangflow(null)).toThrow();
  });
});
