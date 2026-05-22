/**
 * deriveFlowToolSchema — pure helper that projects a saved Workflow row into
 * the agent-tool-catalog shape used by V1.1 flow_tool integration.
 *
 * Contract:
 *  - name: workflow.settings.tool_meta.name (sanitized) OR slugify(workflow.name)
 *  - description: workflow.settings.tool_meta.description OR workflow.description OR fallback
 *  - input_schema: workflow.settings.tool_meta.input_schema OR trigger.data.inputSchema
 *                  OR a permissive default ({type:object, additionalProperties:true})
 *
 * Tool name is snake_case, [a-z0-9_]{1,64}, leading-letter — matches the
 * OpenAI/Anthropic tool-name regex so it can be injected directly into a
 * provider tools[] array.
 */

import { describe, it, expect } from 'vitest';
import { deriveFlowToolSchema } from './flowToolSchema.js';

describe('deriveFlowToolSchema', () => {
  it('falls back to slugified workflow name when tool_meta is missing', () => {
    const wf = {
      id: 'wf-1',
      name: 'Analyze Production Logs',
      description: 'Pulls last 24h of Loki logs and produces a summary.',
      definition: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
        ],
        edges: [],
      },
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.name).toBe('analyze_production_logs');
    expect(schema.description).toBe('Pulls last 24h of Loki logs and produces a summary.');
    expect(schema.input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
    expect(schema.flowId).toBe('wf-1');
  });

  it('honors explicit tool_meta overrides for name + description + input_schema', () => {
    const wf = {
      id: 'wf-2',
      name: 'whatever',
      description: '',
      definition: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }], edges: [] },
      settings: {
        tool_meta: {
          name: 'fetch_loki',
          description: 'Pull Loki logs for a namespace.',
          input_schema: {
            type: 'object',
            properties: {
              namespace: { type: 'string' },
              window: { type: 'string', description: 'Time window, e.g. 1h' },
            },
            required: ['namespace'],
          },
        },
      },
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.name).toBe('fetch_loki');
    expect(schema.description).toBe('Pull Loki logs for a namespace.');
    expect(schema.input_schema.properties.namespace.type).toBe('string');
    expect(schema.input_schema.required).toEqual(['namespace']);
  });

  it('derives input_schema from trigger.data.inputSchema when tool_meta absent', () => {
    const wf = {
      id: 'wf-3',
      name: 'Restart Pod',
      description: 'Restart a pod by name.',
      definition: {
        nodes: [
          {
            id: 'trigger',
            type: 'trigger',
            data: {
              triggerType: 'manual',
              inputSchema: {
                type: 'object',
                properties: { podName: { type: 'string' } },
                required: ['podName'],
              },
            },
          },
        ],
        edges: [],
      },
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.input_schema.properties.podName.type).toBe('string');
    expect(schema.input_schema.required).toEqual(['podName']);
  });

  it('sanitizes weird workflow names into snake_case under 64 chars', () => {
    const wf = {
      id: 'wf-4',
      name: '  My (Strange!!!) Flow — with em-dash & symbols ',
      description: '',
      definition: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }], edges: [] },
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(schema.name).toBe('my_strange_flow_with_em_dash_symbols');
  });

  it('falls back to a stable default description when both meta and workflow.description are empty', () => {
    const wf = {
      id: 'wf-5',
      name: 'Untitled Flow',
      description: '',
      definition: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }], edges: [] },
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.description).toMatch(/saved flow/i);
  });

  it('handles missing definition / missing trigger gracefully', () => {
    const wf = {
      id: 'wf-6',
      name: 'broken-flow',
      description: 'No trigger here',
      definition: null,
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.name).toBe('broken_flow');
    expect(schema.input_schema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
  });

  it('prefixes invalid leading characters (digits) with f_', () => {
    const wf = {
      id: 'wf-7',
      name: '24h cost report',
      description: 'x',
      definition: { nodes: [], edges: [] },
      settings: {},
    };

    const schema = deriveFlowToolSchema(wf);

    expect(schema.name).toMatch(/^[a-z]/);
    expect(schema.name).toBe('f_24h_cost_report');
  });
});
