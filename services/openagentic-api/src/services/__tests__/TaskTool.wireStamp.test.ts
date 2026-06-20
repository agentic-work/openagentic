/**
 * A2 — Task tool wire stamps parent_tool_use_id on sub_agent_* emits.
 *
 * the design notes
 *       §2.2.2.
 *
 * Task can fan out multiple sub-agents from one tool call. Each
 * sub_agent_started / sub_agent_completed frame must carry the PARENT
 * tool_use_id so the UI can bind the sub-agent card under the correct
 * Task card (the Task call's tool_use_id, NOT a per-sub-agent id).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  executeTask,
  type TaskInput,
  type TaskDeps,
} from '../TaskTool.js';

const MOCK_AGENTS = [
  {
    agent_type: 'general-purpose',
    display_name: 'General',
    description: 'general',
  },
];

function makeDeps(over: Partial<TaskDeps> = {}): TaskDeps {
  return {
    listSubagentTypes: vi.fn().mockResolvedValue(MOCK_AGENTS),
    runSubagent: vi.fn().mockResolvedValue({
      ok: true,
      output: 'done',
      turns: 1,
      tokens: 100,
      durationMs: 50,
      toolsUsed: [],
    }),
    ...over,
  } as TaskDeps;
}

function makeCtx(toolUseId?: string) {
  const emits: Array<{ event: string; payload: any }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) =>
        emits.push({ event, payload: payload as any }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 'sess-test',
      userId: 'user-test',
      ...(toolUseId ? { toolUseId } : {}),
    } as any,
  };
}

describe('Task — A2 wire-stamp parent_tool_use_id', () => {
  it('stamps parent_tool_use_id on sub_agent_started', async () => {
    const { ctx, emits } = makeCtx('toolu_task1');
    await executeTask(
      ctx,
      {
        description: 'do a thing',
        prompt: 'investigate something',
        multi_step_justification: {
          tool_count_estimate: 5,
          requires_dedicated_context: true,
          why: 'Multi-step investigation requires dedicated context',
          single_tool_alternative: null,
        },
      } as TaskInput,
      makeDeps(),
    );
    const started = emits.find((e) => e.event === 'sub_agent_started');
    expect(started).toBeDefined();
    expect(started!.payload.parent_tool_use_id).toBe('toolu_task1');
  });

  it('stamps parent_tool_use_id on sub_agent_completed (success path)', async () => {
    const { ctx, emits } = makeCtx('toolu_task2');
    await executeTask(
      ctx,
      {
        description: 'thing',
        prompt: 'go do the thing across multiple subscriptions',
        multi_step_justification: {
          tool_count_estimate: 5,
          requires_dedicated_context: true,
          why: 'Multi-step investigation requires dedicated context',
          single_tool_alternative: null,
        },
      } as TaskInput,
      makeDeps(),
    );
    const completed = emits.find((e) => e.event === 'sub_agent_completed');
    expect(completed).toBeDefined();
    expect(completed!.payload.parent_tool_use_id).toBe('toolu_task2');
  });

  it('stamps parent_tool_use_id on sub_agent_completed (error path)', async () => {
    const { ctx, emits } = makeCtx('toolu_task3');
    await executeTask(
      ctx,
      {
        description: 'thing',
        prompt: 'go do the thing across multiple subscriptions',
        multi_step_justification: {
          tool_count_estimate: 5,
          requires_dedicated_context: true,
          why: 'Multi-step investigation requires dedicated context',
          single_tool_alternative: null,
        },
      } as TaskInput,
      makeDeps({
        runSubagent: vi.fn().mockRejectedValue(new Error('kaboom')),
      }),
    );
    const completed = emits.find((e) => e.event === 'sub_agent_completed');
    expect(completed).toBeDefined();
    expect(completed!.payload.parent_tool_use_id).toBe('toolu_task3');
    expect(completed!.payload.ok).toBe(false);
  });
});
