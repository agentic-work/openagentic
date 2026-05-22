/**
 * TaskTool — TDD for the sub-agent dispatch tool.
 *
 * Mirrors the canonical AgentTool from
 * `/home/trent/anthropic/src/tools/AgentTool/AgentTool.tsx`. The model
 * picks one specialized sub-agent from a description-driven catalog;
 * each sub-agent runs in its own ReAct loop with a filtered tool list
 * and its own system prompt.
 *
 * Wraps the existing `SubagentOrchestrator` — it does NOT replace it.
 * The orchestrator's `runSubagentReActLoop` is the per-agent execution
 * primitive; this tool is the surface the model sees.
 *
 * REPLACES: today's `delegate_to_agents` JSON-enum dispatch + the
 * regex-based delegationGating.ts. The model picks the agent role from
 * a tool description (Anthropic's tool-writing rubric), not an enum the
 * server then post-filters.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TASK_TOOL,
  isTaskTool,
  executeTask,
  buildTaskToolDescription,
  type TaskInput,
  type TaskDeps,
  type SubagentSpec,
} from '../TaskTool.js';

const MOCK_AGENTS = [
  { agent_type: 'cloud_operations', display_name: 'Cloud Operations', description: 'Long-horizon multi-step infra work across Azure/AWS/GCP.' },
  { agent_type: 'artifact_creation', display_name: 'Artifact Creation', description: 'Creates dashboards, charts, visualizations, presentations.' },
  { agent_type: 'code_execution', display_name: 'Code Execution', description: 'Writes and runs scripts, tests, debugging.' },
  { agent_type: 'reasoning', display_name: 'Reasoning', description: 'Deep analysis, research, multi-step reasoning.' },
];

function makeDeps(over: Partial<TaskDeps> = {}): TaskDeps {
  return {
    listSubagentTypes: vi.fn().mockResolvedValue(MOCK_AGENTS),
    runSubagent: vi.fn().mockResolvedValue({
      ok: true,
      output: 'sub-agent finished',
      turns: 3,
      tokens: 1024,
      durationMs: 1500,
      toolsUsed: ['azure_list_subscriptions'],
    }),
    ...over,
  };
}

function makeCtx(emit = vi.fn()) {
  return {
    emit,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

describe('TASK_TOOL — schema shape (Anthropic AgentTool parity)', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(TASK_TOOL.type).toBe('function');
    expect(TASK_TOOL.function.name).toBe('Task');
    expect(typeof TASK_TOOL.function.description).toBe('string');
    expect(TASK_TOOL.function.parameters.type).toBe('object');
  });

  it('description is at least 200 chars and follows the encyclopedia-article rubric', () => {
    expect(TASK_TOOL.function.description.length).toBeGreaterThanOrEqual(200);
    const desc = TASK_TOOL.function.description.toLowerCase();
    expect(desc).toMatch(/use when|when to use/);
    expect(desc).toMatch(/do not use|don't use|when not to use/);
  });

  it('input schema requires description + prompt + multi_step_justification (#844); subagent_type/model/run_in_background optional', () => {
    const params = TASK_TOOL.function.parameters as any;
    // #844 (2026-05-14) — multi_step_justification is now REQUIRED.
    // Capability-agnostic gate against trivial single-tool Task dispatches.
    expect(params.required).toEqual(['description', 'prompt', 'multi_step_justification']);
    expect(params.properties.description).toBeDefined();
    expect(params.properties.prompt).toBeDefined();
    expect(params.properties.multi_step_justification).toBeDefined();
    expect(params.properties.multi_step_justification.required).toEqual([
      'tool_count_estimate',
      'requires_dedicated_context',
      'why',
      'single_tool_alternative',
    ]);
    expect(params.properties.subagent_type).toBeDefined();
    expect(params.properties.model).toBeDefined();
    expect(params.properties.run_in_background).toBeDefined();
  });

  it('model is a free-form string (NO Anthropic-family enum bias — registry-driven)', () => {
    // Memory rule: model-agnostic platform — never bias schema toward
    // a specific provider family. Anthropic's AgentTool uses sonnet|opus|haiku
    // because that's their universe; OpenAgentic serves any registry-
    // configured model, so the model field is a free-form string with NO
    // enum. See TaskTool.ts:42-50 for the live capture (2026-05-01) that
    // proved the bias trained the LLM to dispatch `model: "sonnet"` against
    // AIF-only clusters that don't serve sonnet, causing turn timeouts.
    const params = TASK_TOOL.function.parameters as any;
    expect(params.properties.model.type).toBe('string');
    expect(params.properties.model.enum).toBeUndefined();
  });

  it('subagent_type does not have a hardcoded enum (registry-driven)', () => {
    const params = TASK_TOOL.function.parameters as any;
    // Mirror Claude Code: subagent_type is a string description, not an
    // enum — agents come from a markdown registry. Description tells
    // the model which to pick. NO regex / enum gate.
    expect(params.properties.subagent_type.enum).toBeUndefined();
    expect(params.properties.subagent_type.type).toBe('string');
  });
});

describe('buildTaskToolDescription — generates description from agent registry', () => {
  it('lists every agent_type with its display_name + description', async () => {
    const desc = await buildTaskToolDescription(MOCK_AGENTS);
    for (const a of MOCK_AGENTS) {
      expect(desc).toContain(a.agent_type);
      expect(desc).toContain(a.display_name);
    }
  });

  it('includes when-to-use vs when-not-to-use guidance', async () => {
    const desc = await buildTaskToolDescription(MOCK_AGENTS);
    expect(desc.toLowerCase()).toMatch(/use when|when to use/);
    expect(desc.toLowerCase()).toMatch(/do not use|don't use/);
  });

  it('handles an empty registry gracefully', async () => {
    const desc = await buildTaskToolDescription([]);
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });
});

describe('isTaskTool — name match', () => {
  it('matches the canonical name', () => {
    expect(isTaskTool('Task')).toBe(true);
  });

  it('matches common case-variants (Anthropic and OpenAI emit slightly different casings)', () => {
    expect(isTaskTool('task')).toBe(true);
    expect(isTaskTool('TASK')).toBe(true);
    expect(isTaskTool('subagent')).toBe(true);
    expect(isTaskTool('agent_task')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(isTaskTool('bash')).toBe(false);
    expect(isTaskTool('delegate_to_agents')).toBe(false);
    expect(isTaskTool('render_artifact')).toBe(false);
    expect(isTaskTool('')).toBe(false);
  });
});

// #844 (2026-05-14) — every happy-path executeTask call now requires a
// valid multi_step_justification. Schema-required field.
const VALID_JUST = {
  tool_count_estimate: 5,
  requires_dedicated_context: true,
  why: 'Audit spans multiple subscriptions and resource groups with cost rollup',
  single_tool_alternative: null,
};

describe('executeTask — dispatches to runSubagent, returns structured result', () => {
  it('runs the requested subagent_type and returns its output', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const input: TaskInput = {
      description: 'inventory + cost',
      prompt: 'Pull Azure cost data for the last 6 months and group by RG.',
      subagent_type: 'cloud_operations',
      multi_step_justification: VALID_JUST,
    };

    const result = await executeTask(ctx, input, deps);

    expect(result.ok).toBe(true);
    expect(result.output).toBe('sub-agent finished');
    expect(deps.runSubagent).toHaveBeenCalledTimes(1);
    const spec = (deps.runSubagent as any).mock.calls[0][0] as SubagentSpec;
    expect(spec.role).toBe('cloud_operations');
    expect(spec.prompt).toBe(input.prompt);
    expect(spec.parentSessionId).toBe('sess-test');
    expect(spec.parentUserId).toBe('user-test');
  });

  it('uses default subagent_type when omitted (Claude Code parity: general-purpose)', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    await executeTask(ctx, {
      description: 'do a thing',
      prompt: 'figure it out',
      multi_step_justification: VALID_JUST,
    }, deps);
    const spec = (deps.runSubagent as any).mock.calls[0][0] as SubagentSpec;
    expect(spec.role).toBe('general-purpose');
  });

  it('passes model override through to the subagent runner', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    await executeTask(ctx, {
      description: 'analyze',
      prompt: 'hard reasoning task',
      subagent_type: 'reasoning',
      model: 'opus',
      multi_step_justification: VALID_JUST,
    }, deps);
    const spec = (deps.runSubagent as any).mock.calls[0][0] as SubagentSpec;
    expect(spec.model).toBe('opus');
  });

  it('emits sub_agent_started + sub_agent_completed NDJSON frames', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const deps = makeDeps();
    await executeTask(ctx, {
      description: 'analyze',
      prompt: 'do it',
      subagent_type: 'reasoning',
      multi_step_justification: VALID_JUST,
    }, deps);

    const types = emit.mock.calls.map(c => c[0]);
    expect(types).toContain('sub_agent_started');
    expect(types).toContain('sub_agent_completed');
  });

  it('returns a structured tool error when prompt is missing', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const result = await executeTask(ctx, {
      description: 'incomplete',
      prompt: '',
    } as any, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/prompt/i);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('returns a structured tool error when description is missing', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const result = await executeTask(ctx, {
      description: '',
      prompt: 'do it',
    } as any, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/description/i);
    expect(deps.runSubagent).not.toHaveBeenCalled();
  });

  it('propagates runSubagent failures as structured tool errors (no throw)', async () => {
    const deps = makeDeps({
      runSubagent: vi.fn().mockResolvedValue({
        ok: false,
        error: 'sub-agent timed out',
        turns: 2,
        tokens: 512,
        durationMs: 30_000,
        toolsUsed: [],
      }),
    });
    const ctx = makeCtx();
    const result = await executeTask(ctx, {
      description: 'long task',
      prompt: 'do it',
      subagent_type: 'cloud_operations',
      multi_step_justification: VALID_JUST,
    }, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it('does NOT regex-filter the prompt or apply intent classification', async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    // The same architecture-grep test that bans regex routing also bans
    // any text-classification logic in this tool. The contract: whatever
    // the model passes as `prompt` reaches the sub-agent verbatim.
    const prompt = 'show me cloud resources and give me a sankey cost diagram for the last 6 months';
    await executeTask(ctx, {
      description: 'cloud + sankey',
      prompt,
      subagent_type: 'cloud_operations',
      multi_step_justification: VALID_JUST,
    }, deps);
    const spec = (deps.runSubagent as any).mock.calls[0][0] as SubagentSpec;
    expect(spec.prompt).toBe(prompt);
  });
});
