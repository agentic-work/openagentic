/**
 * Bedrock Converse-API tool-format converter — regression spec for the
 * Smart Router null-name bug (2026-04-23):
 *
 *   `Error during AI response generation: 10 validation errors detected:
 *    Value null at 'toolConfig.tools.1.member.toolSpec.name' failed to
 *    satisfy constraint: Member must not be null`
 *
 * Root cause: tools are injected into the chat pipeline in mixed formats.
 * Anthropic-native tools are flat ({name, description, input_schema});
 * system-injected tools like `BROWSER_SANDBOX_EXEC_TOOL` and MCP-sourced
 * function tools are OpenAI-format ({type:'function', function:{...}}).
 * The AWSBedrockProvider's Converse path read `tool.name` directly and
 * produced `toolSpec.name: null` for the OpenAI-format entries.
 *
 * The Messages API path (line ~1633) already handled both formats via
 * `tool.function?.name || tool.name`. This spec pins the same behavior
 * for the Converse path, centralized in one helper.
 */

import { describe, it, expect } from 'vitest';
import { toConverseToolConfig } from '../bedrockToolConverter.js';

describe('toConverseToolConfig (Bedrock Converse tool marshaller)', () => {
  it('accepts Anthropic-native flat format', () => {
    const cfg = toConverseToolConfig([
      {
        name: 'get_weather',
        description: 'Look up weather by city',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
    expect(cfg.tools).toHaveLength(1);
    expect(cfg.tools[0].toolSpec.name).toBe('get_weather');
    expect(cfg.tools[0].toolSpec.description).toBe('Look up weather by city');
    expect(cfg.tools[0].toolSpec.inputSchema.json).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
    });
  });

  it('accepts OpenAI-style {type:function, function:{...}} format', () => {
    const cfg = toConverseToolConfig([
      {
        type: 'function',
        function: {
          name: 'browser_sandbox_exec',
          description: 'Run Python/JS in the browser',
          parameters: {
            type: 'object',
            required: ['code', 'language'],
            properties: { code: { type: 'string' }, language: { enum: ['python', 'js'] } },
          },
        },
      },
    ]);
    expect(cfg.tools).toHaveLength(1);
    expect(cfg.tools[0].toolSpec.name).toBe('browser_sandbox_exec');
    expect(cfg.tools[0].toolSpec.description).toBe('Run Python/JS in the browser');
    expect(cfg.tools[0].toolSpec.inputSchema.json.required).toEqual(['code', 'language']);
  });

  it('handles mixed arrays (Anthropic + OpenAI interleaved)', () => {
    const cfg = toConverseToolConfig([
      { name: 'tool_zero', description: 'd0', input_schema: {} },
      {
        type: 'function',
        function: { name: 'tool_one', description: 'd1', parameters: { type: 'object' } },
      },
      { name: 'tool_two', description: 'd2', input_schema: {} },
    ]);
    expect(cfg.tools.map((t: any) => t.toolSpec.name)).toEqual([
      'tool_zero',
      'tool_one',
      'tool_two',
    ]);
    for (const t of cfg.tools) {
      expect(t.toolSpec.name).toBeTruthy();
    }
  });

  it('drops tools with no resolvable name (regression: null-name crash)', () => {
    const cfg = toConverseToolConfig([
      { name: 'valid', description: '', input_schema: {} },
      { type: 'function', function: { description: 'no name', parameters: {} } }, // name missing
      { description: 'no name either' }, // name missing
    ]);
    expect(cfg.tools).toHaveLength(1);
    expect(cfg.tools[0].toolSpec.name).toBe('valid');
  });

  it('returns an empty-tools config for empty or nullish input', () => {
    expect(toConverseToolConfig(undefined).tools).toEqual([]);
    expect(toConverseToolConfig(null as unknown as any[]).tools).toEqual([]);
    expect(toConverseToolConfig([]).tools).toEqual([]);
  });

  it('supplies default empty-object inputSchema when none provided', () => {
    const cfg = toConverseToolConfig([{ name: 'x', description: '' }]);
    expect(cfg.tools[0].toolSpec.inputSchema.json).toEqual({});
  });
});
