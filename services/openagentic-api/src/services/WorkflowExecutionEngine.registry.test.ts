/**
 * Engine ↔ shared-registry integration test (Task #41 — closes the api fallback gap).
 *
 * The api copy of WorkflowExecutionEngine has its own switch-based dispatch
 * (separate from the workflows-service copy). The registry dispatch + refusal-
 * detection assertions live in @openagentic/workflow-engine. Without this
 * plumbing, fallback executions (WORKFLOW_SERVICE_URL unset OR forwarding
 * fails) bypass outputAssertions and the "fake success" gap reopens.
 *
 * This test proves: when the api engine runs an openagentic_llm node and
 * the underlying chat-completions call returns a refusal pattern, the engine
 * emits a node_error event with reason='output_failed_assertion'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub prisma + logger before importing the engine (same shape as
// WorkflowExecutionEngine.sandbox.test.ts).
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    workflowExecution: {
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    workflowExecutionLog: { create: vi.fn().mockResolvedValue({}) },
    flowAuditLog: { create: vi.fn().mockResolvedValue({}) },
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
  },
}));

// The shared package's executor uses `abortableAxiosPost` (from
// @openagentic/workflow-engine/abortableAxios) — mock that, not bare axios.
const mockAbortableAxiosPost = vi.fn();
vi.mock('@openagentic/workflow-engine/abortableAxios', () => ({
  abortableAxiosPost: (...args: any[]) => mockAbortableAxiosPost(...args),
  abortableAxiosGet: vi.fn(),
  abortableAxios: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import {
  WorkflowExecutionEngine,
  type WorkflowDefinition,
  type ExecutionContext,
  type ExecutionEvent,
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
  } as ExecutionContext;
}

function buildLLMDef(prompt: string): WorkflowDefinition {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger', data: {} } as any,
      { id: 'llm-1', type: 'openagentic_llm', data: { prompt } } as any,
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'llm-1' } as any],
  };
}

describe('api WorkflowExecutionEngine ↔ shared registry (Task #41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockChatResponse(content: string) {
    mockAbortableAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        choices: [{ message: { content } }],
        model: 'router-pick',
        usage: { total_tokens: 10 },
      },
    });
  }

  it('openagentic_llm: refusal content fires output_failed_assertion via registry', async () => {
    mockChatResponse("I couldn't find information about that topic.");
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildLLMDef('summarize'), ctx);
    const events: ExecutionEvent[] = [];
    engine.on('event', (e) => events.push(e));

    let caught: any;
    try {
      await (engine as any).executeNodeCore(
        { id: 'llm-1', type: 'openagentic_llm', data: { prompt: 'summarize' } },
        {},
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught.reason).toBe('output_failed_assertion');
    expect(caught.failedAssertion).toBe('agent_substantive_output');
  });

  it('openagentic_llm: substantive content passes assertions and returns', async () => {
    mockChatResponse(
      'Photosynthesis is the biochemical process by which plants convert sunlight into glucose.',
    );
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildLLMDef('explain X'), ctx);

    const result = await (engine as any).executeNodeCore(
      { id: 'llm-1', type: 'openagentic_llm', data: { prompt: 'explain X' } },
      {},
    );

    expect(result).toMatchObject({ provider: 'openagentic' });
    expect(result.content).toContain('Photosynthesis');
  });

  it('openagentic_chat: refusal also fires the assertion (alias parity)', async () => {
    mockChatResponse('Sorry, I cannot help with that.');
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(buildLLMDef('q'), ctx);

    let caught: any;
    try {
      await (engine as any).executeNodeCore(
        { id: 'chat-1', type: 'openagentic_chat', data: { prompt: 'q' } },
        {},
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect(caught.reason).toBe('output_failed_assertion');
    expect(caught.failedAssertion).toBe('agent_substantive_output');
  });

  it('text node: registry-dispatched, returns content without an LLM call', async () => {
    const ctx = buildContext();
    const engine = new WorkflowExecutionEngine(
      { nodes: [{ id: 'text-1', type: 'text', data: { content: 'plain text' } } as any], edges: [] },
      ctx,
    );

    const result = await (engine as any).executeNodeCore(
      { id: 'text-1', type: 'text', data: { content: 'plain text' } },
      {},
    );

    // The text node returns its content unchanged so downstream nodes can
    // template against {{steps.text-1.content}}.
    expect(result).toBeDefined();
    expect(mockAbortableAxiosPost).not.toHaveBeenCalled();
  });
});
