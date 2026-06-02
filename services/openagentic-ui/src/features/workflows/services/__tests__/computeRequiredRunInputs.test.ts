/**
 * computeRequiredRunInputs — derives the user inputs a flow needs before it
 * can run, from the trigger node's declaration. Powers the pre-run
 * RunInputsModal so a flow that needs e.g. a "question" ASKS for it on Execute
 * instead of running blind and failing on an empty required field.
 *
 * Mirrors the RAG Knowledge-Base Q&A template, whose trigger declares a flat
 * `input_schema: { question: "string", collection: "string" }` and whose
 * downstream nodes bind `{{trigger.question}}`.
 */

import { describe, it, expect } from 'vitest';
import {
  computeRequiredRunInputs,
  hasUnprovidedRequiredInputs,
} from '../computeRequiredRunInputs';

describe('computeRequiredRunInputs', () => {
  it('returns [] when there is no trigger node', () => {
    const nodes = [{ id: 'n1', type: 'llm_completion', data: { prompt: 'hi' } }];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs).toEqual([]);
    expect(hasUnprovidedRequiredInputs(req)).toBe(false);
  });

  it('returns [] when the trigger declares no inputs', () => {
    const nodes = [{ id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } }];
    expect(computeRequiredRunInputs(nodes).inputs).toEqual([]);
  });

  // ---- Form 1: flat input_schema map (the seed-template shape) ----

  it('FLAT MAP: derives one required input per input_schema field (snake_case)', () => {
    // Verbatim shape from seed/templates/rag-knowledge-qa.json
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          triggerType: 'manual',
          label: 'Question',
          input_schema: { question: 'string', collection: 'string' },
        },
      },
      { id: 'search', type: 'knowledge_search', data: { query: '{{trigger.question}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['question', 'collection']);
    expect(req.inputs.every((i) => i.required)).toBe(true);
    // No stored values → required + empty → must ask.
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  it('FLAT MAP: supports camelCase inputSchema too', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: { inputSchema: { namespace: 'string', restart_threshold: 'number' } },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['namespace', 'restart_threshold']);
    expect(req.inputs.find((i) => i.name === 'restart_threshold')!.type).toBe('number');
  });

  it('FLAT MAP: pre-fills defaults from node defaultInputs and they satisfy required', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          input_schema: { namespace: 'string', restart_threshold: 'number' },
          defaultInputs: { namespace: 'openagentic-dev', restart_threshold: 3 },
        },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.defaults).toEqual({ namespace: 'openagentic-dev', restart_threshold: 3 });
    // All required fields have defaults → no need to ask.
    expect(hasUnprovidedRequiredInputs(req)).toBe(false);
  });

  it('FLAT MAP: an empty-string stored value still counts as unprovided', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          input_schema: { question: 'string' },
          inputValues: { question: '   ' },
        },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  // ---- Form 2: JSON-schema input_schema ----

  it('JSON-SCHEMA: required-ness comes from required[], labels/descriptions from properties', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          inputSchema: {
            properties: {
              topic: { type: 'string', title: 'Research Topic', description: 'What to research' },
              depth: { type: 'string', default: 'shallow' },
            },
            required: ['topic'],
          },
        },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    const topic = req.inputs.find((i) => i.name === 'topic')!;
    const depth = req.inputs.find((i) => i.name === 'depth')!;
    expect(topic.required).toBe(true);
    expect(topic.label).toBe('Research Topic');
    expect(topic.description).toBe('What to research');
    expect(depth.required).toBe(false);
    expect(req.defaults.depth).toBe('shallow');
    // topic required + empty → must ask.
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  // ---- Form 3: explicit inputs[] array ----

  it('EXPLICIT inputs[]: uses the declared fields and required flags directly', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          inputs: [
            { name: 'topic', label: 'Topic', required: true, description: 'subject' },
            { name: 'depth', label: 'Depth', required: false, default: 'deep' },
          ],
        },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['topic', 'depth']);
    expect(req.inputs.find((i) => i.name === 'topic')!.required).toBe(true);
    expect(req.inputs.find((i) => i.name === 'depth')!.required).toBe(false);
    expect(req.defaults.depth).toBe('deep');
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  it('EXPLICIT inputs[] wins over input_schema when both present, deduped by name', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'trigger',
        data: {
          inputs: [{ name: 'question', label: 'Your Question', required: true }],
          input_schema: { question: 'string', extra: 'string' },
        },
      },
    ];
    const req = computeRequiredRunInputs(nodes);
    // inputs[] branch taken; input_schema ignored for this trigger.
    expect(req.inputs.map((i) => i.name)).toEqual(['question']);
    expect(req.inputs[0].label).toBe('Your Question');
  });

  it('dedupes fields shared across multiple trigger nodes', () => {
    const nodes = [
      { id: 't1', type: 'trigger', data: { input_schema: { question: 'string' } } },
      { id: 't2', type: 'trigger', data: { input_schema: { question: 'string', extra: 'string' } } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['question', 'extra']);
  });

  it('treats node-data type:"trigger" (no top-level type) as a trigger', () => {
    const nodes = [
      { id: 'n', data: { type: 'trigger', input_schema: { question: 'string' } } },
    ];
    expect(computeRequiredRunInputs(nodes).inputs.map((i) => i.name)).toEqual(['question']);
  });

  it('is defensive against null/undefined node lists and data', () => {
    expect(computeRequiredRunInputs(undefined as any).inputs).toEqual([]);
    expect(computeRequiredRunInputs([null as any]).inputs).toEqual([]);
    expect(computeRequiredRunInputs([{ id: 'x', type: 'trigger' }]).inputs).toEqual([]);
  });

  // ---- BACKSTOP: undeclared {{input}} / {{trigger.X}} / {{input.X}} references ----
  // The airtight rule: even when a template's trigger forgot to declare an
  // input_schema, if ANY node references the run input we MUST still ask for it
  // rather than run blind. This is the exact "RAG Knowledge Pipeline just runs
  // doing god knows what" bug — its trigger declares nothing and its nodes use
  // bare {{input}}, so the old code computed zero inputs and ran into
  // "rag_query requires a non-empty query".

  it('BACKSTOP: bare {{input}} with an undeclared trigger → one required "input", threaded raw', () => {
    // Verbatim shape of the live RAG Knowledge Pipeline (Copy).
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { label: 'User Question', triggerType: 'manual' } },
      { id: 'llm-queries', type: 'openagentic_llm', data: { prompt: 'Question: {{input}}' } },
      { id: 'rag-search', type: 'rag_query', data: { query: '{{steps.llm-queries.output}}', collection: 'docs' } },
      { id: 'llm-answer', type: 'openagentic_llm', data: { prompt: 'Q: {{input}}\nCtx: {{steps.rag-search.output}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['input']);
    expect(req.inputs[0].required).toBe(true);
    // Label comes from the trigger node so the modal asks a human question.
    expect(req.inputs[0].label).toBe('User Question');
    // Bare {{input}} resolves to the whole run input → thread the value RAW.
    expect(req.primaryInput).toBe('input');
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  it('BACKSTOP: {{trigger.X}} referenced but undeclared → required field X, object-threaded', () => {
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { label: 'Start', triggerType: 'manual' } },
      { id: 'azure', type: 'azure_query', data: { subscription: '{{trigger.subscription_id}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['subscription_id']);
    expect(req.inputs[0].required).toBe(true);
    expect(req.primaryInput).toBeUndefined();
    expect(hasUnprovidedRequiredInputs(req)).toBe(true);
  });

  it('BACKSTOP: {{input.region}} referenced but undeclared → required field region', () => {
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'n', type: 'rag_query', data: { query: 'in {{input.region}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['region']);
    expect(req.primaryInput).toBeUndefined();
  });

  it('BACKSTOP: does NOT fire for {{steps.X}}-only flows (no false positives)', () => {
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'a', type: 'http_request', data: { url: 'https://x' } },
      { id: 'b', type: 'openagentic_llm', data: { prompt: 'summarize {{steps.a.output}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs).toEqual([]);
    expect(req.primaryInput).toBeUndefined();
    expect(hasUnprovidedRequiredInputs(req)).toBe(false);
  });

  it('BACKSTOP: dedupes against a declared input_schema (no double-ask)', () => {
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { input_schema: { question: 'string' } } },
      { id: 'n', type: 'rag_query', data: { query: '{{trigger.question}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['question']);
    // Declared form keeps object-threading; not a bare-input primary.
    expect(req.primaryInput).toBeUndefined();
  });

  it('BACKSTOP: mixed bare {{input}} + named {{trigger.X}} → object-threaded named field, no raw primary', () => {
    const nodes = [
      { id: 'trigger-1', type: 'trigger', data: { triggerType: 'manual' } },
      { id: 'n', type: 'rag_query', data: { query: '{{input}} in {{trigger.region}}' } },
    ];
    const req = computeRequiredRunInputs(nodes);
    expect(req.inputs.map((i) => i.name)).toEqual(['region']);
    expect(req.primaryInput).toBeUndefined();
  });
});
