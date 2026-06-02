/**
 * registry.test.ts — TDD for the schema-driven node plugin registry.
 *
 * RED → GREEN: this file is written before registry.ts exists.
 *
 * The registry is a Map<nodeType, NodePlugin> populated at module load.
 * It is the single source of truth for migrated nodes; the compiler reads
 * it for VALID_NODE_TYPES + per-field validation, and the engine reads it
 * for dispatch. Unmigrated node types fall through to the legacy switch.
 */

import { describe, it, expect } from 'vitest';
import { registry, getRegisteredTypes, runWithAssertions, generateAiPromptFragment } from './registry.js';
import { OutputAssertionError } from './types.js';
import type { NodeExecutionContext } from './types.js';

// --- Test doubles -----------------------------------------------------------

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'test-exec-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    ...overrides,
  };
}

// --- Registry shape ---------------------------------------------------------

describe('registry', () => {
  it('is a Map keyed by node type', () => {
    expect(registry).toBeInstanceOf(Map);
  });

  it('registers the three pilot nodes (text, http_request, llm_completion)', () => {
    expect(registry.has('text')).toBe(true);
    expect(registry.has('http_request')).toBe(true);
    expect(registry.has('llm_completion')).toBe(true);
  });

  // Task #46 — code + openagentic node types are now schema-driven. This
  // test is retained as a positive coverage assertion: every
  // previously-unmigrated type is now in the registry.
  it('registers ALL node types — schema coverage reaches 100% (Task #46)', () => {
    expect(registry.has('code')).toBe(true);
    expect(registry.has('openagentic')).toBe(true);
  });

  it('returns a NodePlugin { schema, execute } pair for each migrated type', () => {
    const text = registry.get('text');
    expect(text).toBeDefined();
    expect(text!.schema).toBeDefined();
    expect(text!.schema.type).toBe('text');
    expect(typeof text!.execute).toBe('function');

    const http = registry.get('http_request');
    expect(http!.schema.type).toBe('http_request');
    expect(typeof http!.execute).toBe('function');

    const llm = registry.get('llm_completion');
    expect(llm!.schema.type).toBe('llm_completion');
    expect(typeof llm!.execute).toBe('function');
  });

  it('exposes getRegisteredTypes() returning all migrated node types', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('text');
    expect(types).toContain('http_request');
    expect(types).toContain('llm_completion');
    // After Task #46 the registry covers 100% of node types. The previously
    // unmigrated types (code, openagentic) are now schema-driven.
    expect(types).toContain('code');
    expect(types).toContain('openagentic');
  });

  it('every schema has the required top-level fields', () => {
    for (const [type, plugin] of registry.entries()) {
      expect(plugin.schema.type, `${type} schema.type`).toBe(type);
      expect(plugin.schema.label, `${type} schema.label`).toBeTypeOf('string');
      expect(plugin.schema.category, `${type} schema.category`).toBeTypeOf('string');
      expect(plugin.schema.description, `${type} schema.description`).toBeTypeOf('string');
      expect(plugin.schema.ai, `${type} schema.ai`).toBeDefined();
      expect(plugin.schema.ai!.shortDescription, `${type} ai.shortDescription`).toBeTypeOf('string');
      expect(plugin.schema.ai!.whenToUse, `${type} ai.whenToUse`).toBeTypeOf('string');
    }
  });

  // openagentic_llm and openagentic_chat are the same plugin behind two type
  // names. The legacy switch routed both to executeOpenAgenticLLMNode. The
  // alias is what makes the refusal-detection assertion (added to the chat
  // schema in 0771afb2) propagate to all 7 pre-built templates that still
  // reference type='openagentic_llm' on their canvas nodes.
  describe('openagentic_llm alias', () => {
    it('openagentic_llm is registered', () => {
      expect(registry.has('openagentic_llm')).toBe(true);
    });

    it('openagentic_llm shares the openagentic_chat executor', () => {
      const llm = registry.get('openagentic_llm');
      const chat = registry.get('openagentic_chat');
      expect(llm).toBeDefined();
      expect(chat).toBeDefined();
      expect(llm!.execute).toBe(chat!.execute);
    });

    it('openagentic_llm carries the refusal-detection outputAssertions', () => {
      const llm = registry.get('openagentic_llm');
      const assertions = llm!.schema.outputAssertions ?? [];
      const names = assertions.map((a) => a.name);
      expect(names).toContain('non_empty_content');
      expect(names).toContain('agent_substantive_output');
    });

    it('openagentic_llm schema.type matches its registry key', () => {
      const llm = registry.get('openagentic_llm');
      expect(llm!.schema.type).toBe('openagentic_llm');
    });
  });
});

// --- runWithAssertions: post-execute output validation ---------------------

describe('runWithAssertions', () => {
  it('returns the executor result when all assertions pass', async () => {
    const plugin = {
      schema: {
        type: 'fake_ok',
        category: 'action' as const,
        label: 'Fake OK',
        description: 'd',
        ai: { shortDescription: 's', whenToUse: 'w' },
        outputAssertions: [
          { name: 'has_data', expression: 'result.data !== undefined', errorMessage: 'no data' },
        ],
      },
      execute: async () => ({ data: 42 }),
    };
    const node = { id: 'n1', type: 'fake_ok', data: {} };
    const out = await runWithAssertions(plugin, node, null, makeCtx());
    expect(out).toEqual({ data: 42 });
  });

  it('throws OutputAssertionError when an assertion expression evaluates falsy', async () => {
    const plugin = {
      schema: {
        type: 'fake_fail',
        category: 'action' as const,
        label: 'Fake fail',
        description: 'd',
        ai: { shortDescription: 's', whenToUse: 'w' },
        outputAssertions: [
          {
            name: 'status_2xx',
            expression: 'result.status >= 200 && result.status < 300',
            errorMessage: 'HTTP request returned non-2xx status',
          },
        ],
      },
      execute: async () => ({ status: 500 }),
    };
    const node = { id: 'n1', type: 'fake_fail', data: {} };
    await expect(runWithAssertions(plugin, node, null, makeCtx())).rejects.toBeInstanceOf(
      OutputAssertionError,
    );
    try {
      await runWithAssertions(plugin, node, null, makeCtx());
    } catch (err) {
      expect((err as OutputAssertionError).reason).toBe('output_failed_assertion');
      expect((err as OutputAssertionError).failedAssertion).toBe('status_2xx');
      expect((err as OutputAssertionError).message).toBe('HTTP request returned non-2xx status');
      expect((err as OutputAssertionError).nodeOutput).toEqual({ status: 500 });
    }
  });

  it('does not throw when there are no assertions', async () => {
    const plugin = {
      schema: {
        type: 'no_asserts',
        category: 'annotation' as const,
        label: 'No asserts',
        description: 'd',
        ai: { shortDescription: 's', whenToUse: 'w' },
      },
      execute: async () => ({ ok: true }),
    };
    const node = { id: 'n1', type: 'no_asserts', data: {} };
    const out = await runWithAssertions(plugin, node, null, makeCtx());
    expect(out).toEqual({ ok: true });
  });

  it('only the FIRST failing assertion is reported', async () => {
    const plugin = {
      schema: {
        type: 'two_asserts',
        category: 'action' as const,
        label: 'Two',
        description: 'd',
        ai: { shortDescription: 's', whenToUse: 'w' },
        outputAssertions: [
          { name: 'first', expression: 'result.a === 1', errorMessage: 'a must be 1' },
          { name: 'second', expression: 'result.b === 2', errorMessage: 'b must be 2' },
        ],
      },
      execute: async () => ({ a: 0, b: 0 }),
    };
    const node = { id: 'n1', type: 'two_asserts', data: {} };
    try {
      await runWithAssertions(plugin, node, null, makeCtx());
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as OutputAssertionError).failedAssertion).toBe('first');
      expect((err as OutputAssertionError).message).toBe('a must be 1');
    }
  });

  it('generateAiPromptFragment includes every migrated node with its ai block', () => {
    const frag = generateAiPromptFragment();
    expect(frag).toContain('**text**');
    expect(frag).toContain('**http_request**');
    expect(frag).toContain('**llm_completion**');
    // Schema metadata flows in
    expect(frag).toContain('HTTP/HTTPS request to an external API.');
    expect(frag).toContain('LLM chat-completion call');
    // Required fields marked with *
    expect(frag).toMatch(/url\*/); // url is required for http_request
    expect(frag).toMatch(/prompt\*/); // prompt is required for llm_completion
  });

  it('passes through executor errors unchanged (does not double-wrap)', async () => {
    const plugin = {
      schema: {
        type: 'thrower',
        category: 'action' as const,
        label: 'Thrower',
        description: 'd',
        ai: { shortDescription: 's', whenToUse: 'w' },
        outputAssertions: [
          { name: 'always', expression: 'true', errorMessage: 'never' },
        ],
      },
      execute: async () => {
        throw new Error('boom');
      },
    };
    const node = { id: 'n1', type: 'thrower', data: {} };
    await expect(runWithAssertions(plugin, node, null, makeCtx())).rejects.toThrow('boom');
  });
});
