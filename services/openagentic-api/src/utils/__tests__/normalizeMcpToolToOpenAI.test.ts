/**
 * #516 — MCP tools must reach OllamaProvider in OpenAI shape, otherwise
 * `convertToolsToOllama` filters them all out (it requires `.function.name`).
 *
 * MCP Proxy returns native MCP shape: { name, description, inputSchema, server }.
 * Meta tools are hand-authored OpenAI shape: { type: 'function', function: {...} }.
 * The V2 pipeline concats them — without normalization, 270/276 tools vanish.
 *
 * Caught 2026-04-29 via Playwright: "show me my azure subs, rgs, and
 * resources" against live api 086e87a4 — model said "I don't have direct
 * access to your Azure environment" because zero MCP tools were sent.
 */
import { describe, it, expect } from 'vitest';
import { normalizeMcpToolToOpenAI } from '../normalizeMcpToolToOpenAI.js';

describe('normalizeMcpToolToOpenAI', () => {
  it('converts MCP-native shape (name + inputSchema) to OpenAI function shape', () => {
    const mcpTool = {
      server: 'openagentic_azure',
      name: 'azure_list_subscriptions',
      description: 'List all Azure subscriptions the caller has access to.',
      inputSchema: {
        type: 'object',
        properties: { tenantId: { type: 'string' } },
        required: [],
      },
    };

    const result = normalizeMcpToolToOpenAI(mcpTool);

    expect(result).toEqual({
      type: 'function',
      function: {
        name: 'azure_list_subscriptions',
        description: 'List all Azure subscriptions the caller has access to.',
        parameters: {
          type: 'object',
          properties: { tenantId: { type: 'string' } },
          required: [],
        },
      },
    });
  });

  it('passes already-OpenAI-shaped tools through unchanged (idempotent)', () => {
    const openAiTool = {
      type: 'function',
      function: {
        name: 'Task',
        description: 'Dispatch a sub-agent.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    };

    const result = normalizeMcpToolToOpenAI(openAiTool);

    expect(result).toEqual(openAiTool);
  });

  it('accepts snake_case input_schema as fallback', () => {
    const mcpTool = {
      name: 'aws_list_buckets',
      description: 'List S3 buckets.',
      input_schema: { type: 'object', properties: {}, required: [] },
    };

    const result = normalizeMcpToolToOpenAI(mcpTool);

    expect(result?.function?.name).toBe('aws_list_buckets');
    expect(result?.function?.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('supplies an empty object schema when neither inputSchema nor input_schema present', () => {
    const mcpTool = { name: 'no_args_tool', description: 'No args.' };

    const result = normalizeMcpToolToOpenAI(mcpTool);

    expect(result?.function?.parameters).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('returns null for malformed input (no name)', () => {
    expect(normalizeMcpToolToOpenAI({ description: 'orphan' } as any)).toBeNull();
    expect(normalizeMcpToolToOpenAI({} as any)).toBeNull();
    expect(normalizeMcpToolToOpenAI(null as any)).toBeNull();
    expect(normalizeMcpToolToOpenAI(undefined as any)).toBeNull();
  });

  it('uses an empty description string when description missing', () => {
    const mcpTool = { name: 'undocumented_tool', inputSchema: { type: 'object' } };

    const result = normalizeMcpToolToOpenAI(mcpTool);

    expect(result?.function?.description).toBe('');
  });

  it('strips MCP-only fields (server) — they are not part of OpenAI tool shape', () => {
    const mcpTool = {
      server: 'openagentic_azure',
      name: 'azure_list_resource_groups',
      description: 'List RGs.',
      inputSchema: { type: 'object', properties: {} },
    };

    const result = normalizeMcpToolToOpenAI(mcpTool);

    // OpenAI tool shape only has type + function
    expect(Object.keys(result!).sort()).toEqual(['function', 'type']);
    expect((result as any).server).toBeUndefined();
  });
});

describe('normalizeMcpToolToOpenAI — array helper batches', () => {
  it('batch-normalizes a mixed array, drops malformed entries', async () => {
    const { normalizeToolArray } = await import('../normalizeMcpToolToOpenAI.js');
    const input = [
      { name: 'a', inputSchema: { type: 'object' } },
      { type: 'function', function: { name: 'b', parameters: {} } },
      { description: 'orphan' }, // malformed — must be dropped
      null,
      { name: 'c' },
    ];

    const out = normalizeToolArray(input as any);

    expect(out.length).toBe(3);
    expect(out.map((t: any) => t.function.name)).toEqual(['a', 'b', 'c']);
  });
});
