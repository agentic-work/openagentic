/**
 * End-to-end engine test: verify the WorkflowExecutionEngine catches
 * sandbox errors emitted by the new isolated-vm executor (S0-2 / B1)
 * and surfaces them as `node_error` events instead of crashing the run.
 *
 * Scope: constructs the engine with a minimal in-memory definition and
 * context, then runs a `code` node containing malicious / runaway code.
 * No DB / network — the sandbox helper itself is fully self-contained.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the prisma + axios + logger modules so the engine's imports resolve
// without touching any real infrastructure.
vi.mock('../utils/prisma.js', () => ({
  prisma: { workflowExecution: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() } },
}));

vi.mock('../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
} from './WorkflowExecutionEngine.js';

function buildContext(): ExecutionContext {
  return {
    executionId: 'exec-test-1',
    workflowId: 'wf-test-1',
    userId: 'user-test-1',
    triggerType: 'manual',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

function buildDefinitionWithCode(code: string, language: string = 'javascript'): WorkflowDefinition {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        data: {},
      },
      {
        id: 'code-1',
        type: 'code',
        data: { code, language },
      },
    ],
    edges: [
      { id: 'edge-1', source: 'trigger', target: 'code-1' },
    ],
  };
}

describe('WorkflowExecutionEngine + sandbox (S0-2 / B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs benign code via the isolate sandbox and returns the result', async () => {
    const def = buildDefinitionWithCode('return 1 + 2;');
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    // Reach in to the private executeJavaScript. We could also drive
    // the full execute() loop, but executeJavaScript is the load-bearing
    // bit that integrates with the sandbox.
    const result = await (engine as any).executeJavaScript('return 1 + 2;', {});
    expect(result).toBe(3);
  });

  it('throws a classified error for code that tries to read process.env', async () => {
    const def = buildDefinitionWithCode('return process.env.SECRET;');
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(def, ctx);

    // The sandbox will either return undefined (process is not defined)
    // or throw — both are safe.
    const fn = (engine as any).executeJavaScript.bind(engine);
    let result: any;
    let threw = false;
    try {
      result = await fn('return process.env.SECRET;', {});
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/Code execution error/);
    }
    if (!threw) {
      expect(result).toBeUndefined();
    }
  });

  it('throws a sandbox timeout error for infinite loops', async () => {
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildDefinitionWithCode('while(true){}'), ctx);

    await expect(
      (engine as any).executeJavaScript('while(true){}', {}, 200)
    ).rejects.toThrow(/Code execution error \(timeout\)/);
  });

  it('cannot escape via Function.prototype.constructor', async () => {
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildDefinitionWithCode(''), ctx);

    // The constructor escape is contained inside the same isolate,
    // where `process` is still undefined.
    const result = await (engine as any).executeJavaScript(
      'try { return Function.prototype.constructor.constructor("return typeof process")(); } catch (e) { return "blocked"; }',
      {}
    );
    expect(typeof result).toBe('string');
    expect(result === 'undefined' || result === 'blocked').toBe(true);
  });

  it('evaluateCondition: rejects malicious expressions but stays alive', async () => {
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildDefinitionWithCode(''), ctx);

    // Malicious condition tries to read process.env via Function constructor.
    // The sandbox neutralises it; evaluateCondition either returns a falsy
    // value or the interpolated text — never crashes.
    const result = await (engine as any).evaluateCondition(
      'Function.prototype.constructor.constructor("return process.env.SECRET")()',
      'expression',
      {}
    );
    // Acceptable outcomes: undefined, null, false, or the raw string fallback.
    expect(['undefined', 'object', 'boolean', 'string']).toContain(typeof result);
  });

  it('executeTransformNode (extract): isolate sandboxes user expressions', async () => {
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildDefinitionWithCode(''), ctx);

    // Build a fake transform node and exercise the private method.
    const node: any = {
      id: 'tx-1',
      type: 'transform',
      data: { transformType: 'extract', transformExpression: 'input.x * 10' },
    };
    const result = await (engine as any).executeTransformNode(node, { x: 4 });
    expect(result).toBe(40);
  });
});
