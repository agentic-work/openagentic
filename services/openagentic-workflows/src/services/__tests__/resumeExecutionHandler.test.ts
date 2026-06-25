/**
 * resumeExecutionHandler — TDD for the workflows-svc POST /resume-execution
 * endpoint that lets the api proxy HITL-approval re-entries instead of
 * instantiating WorkflowExecutionEngine in-process (Phase B blocker #16).
 *
 * Contract: takes the saved execution state (variables, nodeResults, the
 * approval result for the gate node) plus the original definition + the
 * resume node id, then drives engine.resumeExecution() and emits the
 * usual NDJSON/SSE event stream.
 *
 * The handler is testable as a pure function: extract the
 * "deserialize state → construct engine → call resumeExecution → format
 * response" path, mock the engine, assert wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the engine module so the handler can be tested without spinning
// up a real run. The shape mirrors what api/workflow-approvals.ts does
// today: new WorkflowExecutionEngine(definition, context).resumeExecution(nodeId, resumeInput).
vi.mock('../WorkflowExecutionEngine.js', () => {
  const resumeExecution = vi.fn();
  const on = vi.fn();
  return {
    WorkflowExecutionEngine: vi.fn().mockImplementation(() => ({
      resumeExecution,
      on,
    })),
    __mockResumeExecution: resumeExecution,
    __mockOn: on,
  };
});

import { resumeExecutionHandler } from '../resumeExecutionHandler.js';
import * as engineMod from '../WorkflowExecutionEngine.js';

const mockResume = (engineMod as any).__mockResumeExecution as ReturnType<typeof vi.fn>;
const mockOn = (engineMod as any).__mockOn as ReturnType<typeof vi.fn>;
const MockEngine = (engineMod as any).WorkflowExecutionEngine as ReturnType<typeof vi.fn>;

describe('resumeExecutionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseDef = {
    nodes: [
      { id: 'trigger', type: 'trigger', data: {} },
      { id: 'approval-1', type: 'human_approval', data: {} },
      { id: 'next', type: 'transform', data: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'approval-1' },
      { id: 'e2', source: 'approval-1', target: 'next' },
    ],
  };

  const baseInput = {
    workflowId: 'wf-1',
    executionId: 'exec-1',
    definition: baseDef,
    fromNodeId: 'approval-1',
    resumeInput: { approved: true, approvedBy: 'alice' },
    state: {
      input: { foo: 'bar' },
      variables: { tmp: 1 },
      nodeResults: { trigger: { ok: true } },
      startTimeMs: 1700000000000,
    },
    userId: 'u-1',
    authToken: 'Bearer token-x',
  };

  it('constructs the engine with the supplied definition and a hydrated context', async () => {
    mockResume.mockResolvedValueOnce({ success: true, output: { done: true } });

    await resumeExecutionHandler(baseInput, () => {});

    expect(MockEngine).toHaveBeenCalledOnce();
    const [defArg, ctxArg] = MockEngine.mock.calls[0];
    expect(defArg).toEqual(baseDef);
    expect(ctxArg.executionId).toBe('exec-1');
    expect(ctxArg.workflowId).toBe('wf-1');
    expect(ctxArg.userId).toBe('u-1');
    expect(ctxArg.authToken).toBe('Bearer token-x');
    expect(ctxArg.input).toEqual({ foo: 'bar' });
    // Maps must be reconstructed from the serialised state
    expect(ctxArg.variables).toBeInstanceOf(Map);
    expect(ctxArg.variables.get('tmp')).toBe(1);
    expect(ctxArg.nodeResults).toBeInstanceOf(Map);
    expect(ctxArg.nodeResults.get('trigger')).toEqual({ ok: true });
    expect(ctxArg.startTime).toBe(1700000000000);
  });

  it('calls engine.resumeExecution(fromNodeId, resumeInput)', async () => {
    mockResume.mockResolvedValueOnce({ success: true, output: 'ok' });
    await resumeExecutionHandler(baseInput, () => {});
    expect(mockResume).toHaveBeenCalledWith('approval-1', { approved: true, approvedBy: 'alice' });
  });

  it('subscribes the supplied onEvent callback to engine events', async () => {
    mockResume.mockResolvedValueOnce({ success: true, output: 'ok' });
    const onEvent = vi.fn();
    await resumeExecutionHandler(baseInput, onEvent);
    // Engine emits via .on('event', cb) in the existing api impl
    expect(mockOn).toHaveBeenCalledWith('event', onEvent);
  });

  it('returns the engine result verbatim on success', async () => {
    mockResume.mockResolvedValueOnce({ success: true, output: { result: 42 } });
    const r = await resumeExecutionHandler(baseInput, () => {});
    expect(r).toEqual({ success: true, output: { result: 42 } });
  });

  it('returns success:false with the engine error on failure', async () => {
    mockResume.mockResolvedValueOnce({ success: false, output: null, error: 'node x failed' });
    const r = await resumeExecutionHandler(baseInput, () => {});
    expect(r.success).toBe(false);
    expect(r.error).toBe('node x failed');
  });

  it('catches engine throws and surfaces them as { success: false, error }', async () => {
    mockResume.mockRejectedValueOnce(new Error('engine blew up'));
    const r = await resumeExecutionHandler(baseInput, () => {});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/engine blew up/);
  });

  it('threads opts through (idToken, userEmail, triggerType, userPermissions, tenantId, userGroups)', async () => {
    mockResume.mockResolvedValueOnce({ success: true, output: 'ok' });
    await resumeExecutionHandler({
      ...baseInput,
      idToken: 'idt',
      userEmail: 'a@b.com',
      triggerType: 'approval-resume',
      userPermissions: ['admin'],
      tenantId: 'tnt-1',
      userGroups: ['team-a'],
    }, () => {});
    const [, ctxArg] = MockEngine.mock.calls[0];
    expect(ctxArg).toMatchObject({
      idToken: 'idt',
      userEmail: 'a@b.com',
      triggerType: 'approval-resume',
      userPermissions: ['admin'],
      tenantId: 'tnt-1',
      userGroups: ['team-a'],
    });
  });
});
