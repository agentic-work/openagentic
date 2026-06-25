/**
 * TaskTool × multi_step_justification integration — #844 (2026-05-14).
 *
 * Proves executeTask rejects unjustified Task dispatches BEFORE calling
 * deps.runSubagent. Capability-agnostic gate.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeTask, type TaskDeps, type TaskInput } from '../TaskTool.js';

function makeDeps(over: Partial<TaskDeps> = {}): TaskDeps {
  return {
    listSubagentTypes: vi.fn().mockResolvedValue([
      {
        agent_type: 'cloud_operations',
        display_name: 'Cloud Operations',
        description: 'Long-horizon multi-step infra work across Azure/AWS/GCP.',
      },
    ]),
    runSubagent: vi.fn().mockResolvedValue({
      ok: true,
      output: 'sub-agent completed',
      turns: 3,
      tokens: 1024,
      durationMs: 1500,
      toolsUsed: ['azure_list_subscriptions'],
    }),
    ...over,
  };
}

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

const validJust = {
  tool_count_estimate: 5,
  requires_dedicated_context: true,
  why: 'Audit spans 12 tenants and requires reconciliation against the baseline policy',
  single_tool_alternative: null,
};

describe('executeTask — #844 multi_step_justification gate', () => {
  it('REJECTS dispatch when multi_step_justification is missing — does NOT call runSubagent', async () => {
    const deps = makeDeps();
    const input: TaskInput = {
      description: 'list azure subs',
      prompt: 'show me my Azure subscriptions',
      subagent_type: 'cloud_operations',
      // No multi_step_justification
    };
    const result = await executeTask(makeCtx(), input, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/multi_step_justification/);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('REJECTS when tool_count_estimate is 1 (single-tool query) — runSubagent never invoked', async () => {
    const deps = makeDeps();
    const input: TaskInput = {
      description: 'list azure subs',
      prompt: 'show me my Azure subscriptions',
      subagent_type: 'cloud_operations',
      multi_step_justification: { ...validJust, tool_count_estimate: 1 },
    };
    const result = await executeTask(makeCtx(), input, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/tool_count_estimate=1/);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('REJECTS when model admits single_tool_alternative — error names the tool', async () => {
    const deps = makeDeps();
    const input: TaskInput = {
      description: 'list azure subs',
      prompt: 'show me my Azure subscriptions',
      subagent_type: 'cloud_operations',
      multi_step_justification: {
        ...validJust,
        single_tool_alternative: 'azure_list_subscriptions',
      },
    };
    const result = await executeTask(makeCtx(), input, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/azure_list_subscriptions/);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('REJECTS when requires_dedicated_context=false — runSubagent never invoked', async () => {
    const deps = makeDeps();
    const input: TaskInput = {
      description: 'list azure subs',
      prompt: 'show me my Azure subscriptions',
      subagent_type: 'cloud_operations',
      multi_step_justification: { ...validJust, requires_dedicated_context: false },
    };
    const result = await executeTask(makeCtx(), input, deps);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/requires_dedicated_context=false/);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('ACCEPTS dispatch with a genuine multi-step justification — calls runSubagent', async () => {
    const deps = makeDeps();
    const input: TaskInput = {
      description: 'multi-tenant audit',
      prompt: 'Audit all 12 tenants for drift against baseline policy',
      subagent_type: 'cloud_operations',
      multi_step_justification: validJust,
    };
    const result = await executeTask(makeCtx(), input, deps);

    expect(result.ok).toBe(true);
    expect(deps.runSubagent).toHaveBeenCalledTimes(1);
  });

  it('logs rejection at info level with structured fields (#844 audit seam)', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const input: TaskInput = {
      description: 'list azure subs',
      prompt: 'show me my Azure subscriptions',
      subagent_type: 'cloud_operations',
      multi_step_justification: {
        ...validJust,
        single_tool_alternative: 'azure_list_subscriptions',
      },
    };
    await executeTask(ctx, input, deps);

    expect(ctx.logger.info).toHaveBeenCalled();
    const calls = (ctx.logger.info as any).mock.calls as any[];
    const rejectCall = calls.find((c) => /REJECTED.*#844/.test(c[1] ?? ''));
    expect(rejectCall).toBeDefined();
    expect(rejectCall[0]).toMatchObject({
      directToolHint: 'azure_list_subscriptions',
      description: 'list azure subs',
    });
  });
});
