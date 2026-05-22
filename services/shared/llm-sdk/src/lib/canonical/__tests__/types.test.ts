/**
 * Canonical request type — shape that future adapters (Phase 0.3) take as
 * input and translate to per-provider wire bodies.
 *
 * These tests are compile-time-shape checks: the values must satisfy the
 * declared types. If types drift, vitest fails at parse time, not at test
 * execution time — that's the intentional bottleneck. Each `expect()` is
 * a runtime smoke that the value is at least the shape we declared.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_REQUEST_VERSION,
  type CanonicalRequest,
  type CanonicalMessage,
  type CanonicalTool,
  type CanonicalToolChoice,
  type CanonicalRequestContentBlock,
} from '../types.js';

describe('types module export — runtime smoke', () => {
  it('exports a version string so the shape is referenceable at runtime', () => {
    expect(typeof CANONICAL_REQUEST_VERSION).toBe('string');
    expect(CANONICAL_REQUEST_VERSION).toMatch(/^\d+\./);
  });
});

describe('CanonicalRequest — shape contract', () => {
  it('accepts a minimal request: system + one user text message', () => {
    const req: CanonicalRequest = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ],
      system: 'you are a helpful assistant',
      tools: [],
      tool_choice: { type: 'auto' },
      max_tokens: 1024,
    };
    expect(req.messages).toHaveLength(1);
    expect(req.system).toBe('you are a helpful assistant');
    expect(req.tool_choice.type).toBe('auto');
  });

  it('supports a null system field for system-less requests', () => {
    const req: CanonicalRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      system: null,
      tools: [],
      tool_choice: { type: 'auto' },
      max_tokens: 256,
    };
    expect(req.system).toBeNull();
  });

  it('accepts tools[] with input_schema as a JSON-schema object', () => {
    const tool: CanonicalTool = {
      name: 'get_weather',
      description: 'fetch current weather for a location',
      input_schema: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    };
    const req: CanonicalRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'weather?' }] }],
      system: null,
      tools: [tool],
      tool_choice: { type: 'auto' },
      max_tokens: 512,
    };
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0]!.name).toBe('get_weather');
  });

  it('accepts a forced tool_choice', () => {
    const tc: CanonicalToolChoice = { type: 'tool', name: 'get_weather' };
    expect(tc.type).toBe('tool');
    if (tc.type === 'tool') {
      expect(tc.name).toBe('get_weather');
    }
  });

  it('accepts an assistant message with mixed content blocks', () => {
    const msg: CanonicalMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'I need to call the weather tool' },
        {
          type: 'tool_use',
          id: 'toolu_abc123',
          name: 'get_weather',
          input: { location: 'Boston' },
        },
      ],
    };
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]!.type).toBe('thinking');
    expect(msg.content[1]!.type).toBe('tool_use');
  });

  it('accepts a user message with a tool_result block', () => {
    const block: CanonicalRequestContentBlock = {
      type: 'tool_result',
      tool_use_id: 'toolu_abc123',
      content: '{"temp_c": 22}',
    };
    const msg: CanonicalMessage = {
      role: 'user',
      content: [block],
    };
    expect(msg.content[0]!.type).toBe('tool_result');
  });

  it('accepts an optional thinking config block', () => {
    const req: CanonicalRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'think' }] }],
      system: null,
      tools: [],
      tool_choice: { type: 'auto' },
      max_tokens: 4096,
      thinking: { type: 'enabled', budget_tokens: 2048 },
    };
    expect(req.thinking?.type).toBe('enabled');
    expect(req.thinking?.budget_tokens).toBe(2048);
  });

  it('accepts optional stop_sequences and cache_control_marker_indices', () => {
    const req: CanonicalRequest = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
        { role: 'user', content: [{ type: 'text', text: 'three' }] },
      ],
      system: 'sys',
      tools: [],
      tool_choice: { type: 'auto' },
      max_tokens: 100,
      stop_sequences: ['STOP', 'END'],
      cache_control_marker_indices: [0, 2],
    };
    expect(req.stop_sequences).toEqual(['STOP', 'END']);
    expect(req.cache_control_marker_indices).toEqual([0, 2]);
  });

  it('accepts tool_choice: { type: "any" } and { type: "none" }', () => {
    const any: CanonicalToolChoice = { type: 'any' };
    const none: CanonicalToolChoice = { type: 'none' };
    expect(any.type).toBe('any');
    expect(none.type).toBe('none');
  });
});
