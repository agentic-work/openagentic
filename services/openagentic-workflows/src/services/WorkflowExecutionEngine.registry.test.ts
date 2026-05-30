/**
 * WorkflowExecutionEngine + node-plugin registry integration test.
 *
 * Verifies that:
 *   1. Migrated nodes (text, http_request, llm_completion) dispatch through
 *      the registry path — proving the new wiring works end-to-end.
 *   2. Legacy nodes (code) still dispatch through the switch — proving the
 *      fallback path is intact for the other 50+ unmigrated types.
 *   3. outputAssertions emit a `node_error` event with
 *      reason='output_failed_assertion' when violated, addressing the
 *      "fake success" UX gap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/prisma.js', () => ({
  prisma: {
    workflowExecution: {
      update: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null), // skip storeNodeExecution write path
    },
    workflow: { update: vi.fn() },
    workflowNodeLog: { create: vi.fn() },
  },
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
    server: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  },
}));

import axios from 'axios';
import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
} from './WorkflowExecutionEngine.js';

function buildContext(): ExecutionContext {
  return {
    executionId: 'exec-reg-1',
    workflowId: 'wf-reg-1',
    userId: 'user-reg-1',
    triggerType: 'manual',
    input: {},
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now(),
    sharedContext: new Map(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('engine ↔ registry integration', () => {
  it('text node — registry dispatch returns input unchanged', async () => {
    const def: WorkflowDefinition = {
      nodes: [{ id: 't1', type: 'text', data: { text: 'note' } }],
      edges: [],
    };
    const engine = new WorkflowExecutionEngine(def, buildContext());
    // Drive private executeNodeCore directly — clearer than running the full DAG.
    const out = await (engine as any).executeNodeCore({ id: 't1', type: 'text', data: {} }, { upstream: 1 });
    expect(out).toEqual({ upstream: 1, __sharedContext: {} });
    // (executeNodeCore augments object inputs with __sharedContext on entry)
  });

  it('http_request node — registry dispatch + outputAssertion: HTTP 500 emits node_error with output_failed_assertion', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 500,
      statusText: 'Internal Server Error',
      data: 'boom',
      headers: {},
    } as any);

    const def: WorkflowDefinition = {
      nodes: [{ id: 'h1', type: 'http_request', data: {} }],
      edges: [],
    };
    const engine = new WorkflowExecutionEngine(def, buildContext());

    const errorEvents: any[] = [];
    engine.on('event', e => {
      if (e.type === 'node_error') errorEvents.push(e);
    });

    let threw = false;
    try {
      await (engine as any).executeNodeCore(
        { id: 'h1', type: 'http_request', data: { url: 'https://api.example.com/fail', method: 'GET' } },
        null,
      );
    } catch (e: any) {
      threw = true;
      expect(e.name).toBe('OutputAssertionError');
    }
    expect(threw).toBe(true);

    // The engine emitted node_error with the expected reason BEFORE rethrowing.
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].reason).toBe('output_failed_assertion');
    expect(errorEvents[0].failedAssertion).toBe('status_2xx');
    expect(errorEvents[0].nodeType).toBe('http_request');
  });

  // Task #46 — code is now schema-driven; the engine wires the
  // runIsolatedCode hook to runSandboxed. This test now exercises the
  // registry path end-to-end (executor → ctx.runIsolatedCode → V8 isolate →
  // unwrap value).
  it('code node — registry dispatch executes inside the V8 sandbox via runIsolatedCode hook', async () => {
    const def: WorkflowDefinition = {
      nodes: [{ id: 'c1', type: 'code', data: { code: 'return 6 * 7;', language: 'javascript' } }],
      edges: [],
    };
    const engine = new WorkflowExecutionEngine(def, buildContext());
    const out = await (engine as any).executeNodeCore(
      { id: 'c1', type: 'code', data: { code: 'return 6 * 7;', language: 'javascript' } },
      {},
    );
    expect(out).toBe(42);
  });

  it('llm_completion node — registry dispatch returns content/model/usage', async () => {
    // Tier B: executor now streams via fetch + the SDK canonical
    // normalizer. The helper recognizes application/json responses as
    // a backwards-compat fallback path, so a JSON-shaped mock still
    // works without rewriting the stream plumbing in every test.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content: 'real answer' }, finish_reason: 'stop' }],
          model: 'route-x',
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const def: WorkflowDefinition = {
      nodes: [{ id: 'l1', type: 'llm_completion', data: { prompt: 'hi' } }],
      edges: [],
    };
    const engine = new WorkflowExecutionEngine(def, buildContext());
    const out: any = await (engine as any).executeNodeCore(
      { id: 'l1', type: 'llm_completion', data: { prompt: 'hi' } },
      null,
    );
    expect(out.content).toBe('real answer');
    expect(out.model).toBe('route-x');
    expect(out.usage.total_tokens).toBe(3);
  });
});
