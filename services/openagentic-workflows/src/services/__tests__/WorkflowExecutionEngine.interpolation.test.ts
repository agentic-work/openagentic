/**
 * WorkflowExecutionEngine.interpolateTemplate — exhaustive coverage of
 * the template-replacement engine that resolves {{...}} expressions
 * inside node configs at runtime.
 *
 * Path classes:
 *   - {{now}} / {{today}} / {{today_minus_1}} / {{fifteen_minutes_ago}}
 *   - {{generated_temp_password}}
 *   - {{steps.<nodeId>.<path>}}  + label fallback + 'output' alias
 *   - {{env.VAR}}
 *   - {{trigger.<path>}} / {{input.<path>}} / {{item.<path>}}
 *   - default-value pipe: {{path || "fallback"}}
 *
 * Drives the private method directly, with the same mock-prisma /
 * mock-logger pattern used by .sandbox.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', () => ({
  prisma: { workflowExecution: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() } },
}));
vi.mock('../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
} from '../WorkflowExecutionEngine.js';

function makeCtx(input: any = {}): ExecutionContext {
  return {
    executionId: 'e-1',
    workflowId: 'w-1',
    userId: 'u-1',
    triggerType: 'manual',
    input,
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

const minimalDef: WorkflowDefinition = {
  nodes: [{ id: 't', type: 'trigger', data: {} }],
  edges: [],
};

function makeEngine(input: any = {}): WorkflowExecutionEngine {
  return new WorkflowExecutionEngine(minimalDef, makeCtx(input));
}

const interp = (engine: WorkflowExecutionEngine, tpl: string, ctx: any = {}) =>
  (engine as any).interpolateTemplate(tpl, ctx) as string;

describe('WorkflowExecutionEngine.interpolateTemplate', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('temporal variables', () => {
    it('{{now}} resolves to a valid ISO 8601 timestamp', () => {
      const r = interp(makeEngine(), '{{now}}');
      expect(r).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('{{today}} resolves to a midnight-anchored date string', () => {
      const r = interp(makeEngine(), '{{today}}');
      expect(r).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000$/);
    });

    it('{{today_minus_1}} resolves to yesterday at midnight', () => {
      const r = interp(makeEngine(), '{{today_minus_1}}');
      expect(r).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000$/);
      // Must be strictly before today
      const yesterday = new Date(r.slice(0, 10));
      const today = new Date(new Date().toISOString().slice(0, 10));
      expect(yesterday.getTime()).toBeLessThan(today.getTime());
    });

    it('{{fifteen_minutes_ago}} is roughly 15 minutes before now', () => {
      const r = interp(makeEngine(), '{{fifteen_minutes_ago}}');
      const ago = new Date(r).getTime();
      const expected = Date.now() - 15 * 60 * 1000;
      expect(Math.abs(ago - expected)).toBeLessThan(2000);
    });

    it('{{generated_temp_password}} produces a 16-char string', () => {
      const r = interp(makeEngine(), '{{generated_temp_password}}');
      expect(r).toHaveLength(16);
    });

    it('embeds temporal var inline with surrounding text', () => {
      const r = interp(makeEngine(), 'Run started at {{now}}.');
      expect(r).toMatch(/^Run started at \d{4}-\d{2}-\d{2}.+\.$/);
    });
  });

  describe('default-value pipe', () => {
    it('falls back to "fallback" when the path is missing', () => {
      const r = interp(makeEngine({}), '{{trigger.body.topic || "fallback"}}');
      expect(r).toBe('fallback');
    });

    it('uses the resolved value when the path exists, ignoring the fallback', () => {
      const r = interp(makeEngine({ topic: 'climate' }), '{{trigger.topic || "default"}}', { topic: 'climate' });
      // The engine resolves trigger.* against context.input
      expect(r).toBe('climate');
    });

    it('strips surrounding quotes from the fallback', () => {
      // single quotes also work
      const r = interp(makeEngine({}), "{{missing.path || 'singled'}}");
      expect(r).toBe('singled');
    });
  });

  describe('input + item path resolution', () => {
    it('{{input.field}} pulls from the second arg (per-call context)', () => {
      const r = interp(makeEngine(), '{{input.name}}', { name: 'Alice' });
      expect(r).toBe('Alice');
    });

    it('{{item.field}} pulls the per-loop-iteration item from context', () => {
      const r = interp(makeEngine(), '{{item.value}}', { item: { value: 42 } });
      expect(r).toBe('42');
    });
  });

  describe('steps.<nodeId>.<path> resolution', () => {
    it('returns empty string when the referenced node has not executed', () => {
      const engine = makeEngine();
      const r = interp(engine, '{{steps.nope.foo}}');
      expect(r).toBe('');
    });

    it('resolves a recorded node result', () => {
      const engine = makeEngine();
      (engine as any).context.nodeResults.set('llm-1', { content: 'hello world' });
      const r = interp(engine, '{{steps.llm-1.content}}');
      expect(r).toBe('hello world');
    });

    it("'output' alias means the whole node result when there's no 'output' field", () => {
      const engine = makeEngine();
      // Code-style result: the value IS the output (no wrapper).
      (engine as any).context.nodeResults.set('code-1', 42);
      const r = interp(engine, '{{steps.code-1.output}}');
      expect(r).toBe('42');
    });

    it('serializes object values as JSON', () => {
      const engine = makeEngine();
      (engine as any).context.nodeResults.set('mcp-1', { tool: 'k8s_list_pods', count: 3 });
      const r = interp(engine, '{{steps.mcp-1.output}}');
      expect(JSON.parse(r)).toEqual({ tool: 'k8s_list_pods', count: 3 });
    });
  });

  describe('env.VAR — pod env exfil is BLOCKED (P0b sev-0 fix)', () => {
    /**
     * Before this fix, {{env.X}} resolved to process.env[X] for any X.
     * Anyone able to author a workflow could write {{env.WORKFLOW_SECRET_KEY}}
     * (or AWS_SECRET_ACCESS_KEY, JWT_SECRET, DATABASE_URL, etc.) into a
     * field and the engine would interpolate the pod's process env into
     * the rendered output / LLM call / HTTP body. Audit AUDIT-2026-05-03
     * sev-0. Fix: ANY {{env.X}} resolves to '' regardless of process.env.
     * Secrets MUST go through {{secret:NAME}} which is ACL-checked.
     */
    const ORIGINAL = process.env.WF_TEST_VAR;
    const ORIGINAL_SECRET = process.env.WORKFLOW_SECRET_KEY;
    afterAll(() => {
      if (ORIGINAL === undefined) delete process.env.WF_TEST_VAR;
      else process.env.WF_TEST_VAR = ORIGINAL;
      if (ORIGINAL_SECRET === undefined) delete process.env.WORKFLOW_SECRET_KEY;
      else process.env.WORKFLOW_SECRET_KEY = ORIGINAL_SECRET;
    });

    it('does NOT leak process.env value via {{env.WF_TEST_VAR}}', () => {
      process.env.WF_TEST_VAR = 'testing-1-2-3';
      const r = interp(makeEngine(), '{{env.WF_TEST_VAR}}');
      expect(r).toBe('');
      expect(r).not.toContain('testing');
    });

    it('does NOT leak WORKFLOW_SECRET_KEY (the secret-store master key)', () => {
      process.env.WORKFLOW_SECRET_KEY = 'super-sensitive-master-key-do-not-leak';
      const r = interp(makeEngine(), '{{env.WORKFLOW_SECRET_KEY}}');
      expect(r).toBe('');
      expect(r).not.toContain('super-sensitive');
    });

    it('does NOT leak common cloud-creds env names', () => {
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret-leak-test';
      process.env.AZURE_CLIENT_SECRET = 'azure-secret-leak-test';
      try {
        expect(interp(makeEngine(), '{{env.AWS_SECRET_ACCESS_KEY}}')).toBe('');
        expect(interp(makeEngine(), '{{env.AZURE_CLIENT_SECRET}}')).toBe('');
      } finally {
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.AZURE_CLIENT_SECRET;
      }
    });

    it('returns empty string for any unset env var (no leaked template)', () => {
      delete process.env.WF_TEST_DEFINITELY_UNSET;
      const r = interp(makeEngine(), '{{env.WF_TEST_DEFINITELY_UNSET}}');
      expect(r).toBe('');
    });

    it('still honors explicit context.variables seeding under env.* (defensive allow-list)', () => {
      // If a future feature pre-seeds context.variables.set('env.X', value),
      // the resolver should return that value. This is the supported escape
      // hatch for engine-controlled variables — process.env is always blocked.
      const engine = makeEngine();
      (engine as any).context.variables.set('env.MY_ALLOWED_VAR', 'hello-from-context');
      const r = interp(engine, '{{env.MY_ALLOWED_VAR}}');
      expect(r).toBe('hello-from-context');
    });
  });

  describe('edge cases', () => {
    it('returns the empty input verbatim', () => {
      expect(interp(makeEngine(), '')).toBe('');
    });

    it('passes through plain text with no {{...}} expressions', () => {
      const text = 'No templates here, just words.';
      expect(interp(makeEngine(), text)).toBe(text);
    });

    it('handles multiple expressions in one string', () => {
      const r = interp(
        makeEngine(),
        '{{input.a}} and {{input.b}}',
        { a: 'first', b: 'second' },
      );
      expect(r).toBe('first and second');
    });
  });
});

// Hoisted afterAll so the env-var cleanup block above resolves
import { afterAll } from 'vitest';
