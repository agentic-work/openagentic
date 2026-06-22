/**
 * dispatchChatToolCall — pattern_save + pattern_recall wire-in (TDD).
 *
 * Spec: user direction 2026-05-11. Both new T1 tools route through the
 * dispatcher BEFORE the MCP fall-through (i.e. permission-gate doesn't
 * fire, they're meta-tools).
 *
 * Asserts:
 *   1. pattern_save → executePatternSave (correct name match)
 *   2. pattern_recall → executePatternRecall (correct name match)
 *   3. Neither tool falls through to executeMcpTool or the approval gate.
 *   4. Result shape is the chat-loop envelope `{ ok, output, error? }`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Closure-based spy pattern — works in both vitest (with hoisted vi.mock)
// and bun's vitest shim (which lacks vi.hoisted). The const is referenced
// lazily from inside the mock arrow function so the ReferenceError-before-
// initialization doesn't trigger under vitest's hoist.
const executePatternSaveSpy = vi.fn();
const executePatternRecallSpy = vi.fn();

vi.mock('../../../../../services/PatternSaveTool.js', () => ({
  PATTERN_SAVE_TOOL: {
    type: 'function',
    function: { name: 'pattern_save', description: '', parameters: { type: 'object', properties: {} } },
  },
  executePatternSave: (...args: any[]) => executePatternSaveSpy(...args),
}));
vi.mock('../../../../../services/PatternRecallTool.js', () => ({
  PATTERN_RECALL_TOOL: {
    type: 'function',
    function: { name: 'pattern_recall', description: '', parameters: { type: 'object', properties: {} } },
  },
  executePatternRecall: (...args: any[]) => executePatternRecallSpy(...args),
}));

import { dispatchChatToolCall } from '../dispatchChatToolCall.js';

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
    user: { id: 'user-test' },
    ...overrides,
  } as any;
}

function makeDeps(): any {
  return {
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    executeMcpTool: vi.fn(),
    listSubagentTypes: vi.fn(),
    runSubagent: vi.fn(),
    approvalGate: { evaluate: vi.fn() }, // would fire if fall-through happened
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  executePatternSaveSpy.mockResolvedValue({
    ok: true,
    output: 'Saved pattern pat-1 (success, 3 tools).',
    pattern_id: 'pat-1',
    indexed_at: 1700000000000,
  });
  executePatternRecallSpy.mockResolvedValue({
    ok: true,
    patterns: [],
    output: "pattern_recall('x'): no past patterns matched.",
  });
});

describe('dispatchChatToolCall — pattern_save', () => {
  it('routes call.name=="pattern_save" to executePatternSave', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const result = await dispatchChatToolCall(
      ctx,
      {
        name: 'pattern_save',
        input: {
          user_prompt: 'audit k8s for cost',
          tool_sequence_summary: 'list, cost, sankey',
          tool_sequence_names: ['k8s_list_clusters', 'k8s_get_cost', 'compose_visual'],
          business_goal_tags: ['cost-optimization'],
          outcome: 'success',
        },
      },
      deps,
    );
    expect(executePatternSaveSpy).toHaveBeenCalledTimes(1);
    expect(deps.executeMcpTool).not.toHaveBeenCalled();
    expect(deps.approvalGate.evaluate).not.toHaveBeenCalled();
    expect((result as any).ok).toBe(true);
  });

  it('does NOT route other tool names to executePatternSave', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    deps.executeMcpTool.mockResolvedValue({ ok: true, output: 'mcp ok' });
    deps.approvalGate.evaluate.mockResolvedValue({ approved: true, reason: 'allow' });
    await dispatchChatToolCall(ctx, { name: 'some_mcp_tool', input: {} }, deps);
    expect(executePatternSaveSpy).not.toHaveBeenCalled();
  });
});

describe('dispatchChatToolCall — pattern_recall', () => {
  it('routes call.name=="pattern_recall" to executePatternRecall', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const result = await dispatchChatToolCall(
      ctx,
      {
        name: 'pattern_recall',
        input: { query: 'audit my k8s' },
      },
      deps,
    );
    expect(executePatternRecallSpy).toHaveBeenCalledTimes(1);
    expect(deps.executeMcpTool).not.toHaveBeenCalled();
    expect(deps.approvalGate.evaluate).not.toHaveBeenCalled();
    expect((result as any).ok).toBe(true);
  });

  it('does NOT route pattern_save to executePatternRecall', async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await dispatchChatToolCall(
      ctx,
      {
        name: 'pattern_save',
        input: {
          user_prompt: 'x',
          tool_sequence_summary: 'y',
          tool_sequence_names: ['t'],
          business_goal_tags: ['inventory'],
          outcome: 'success',
        },
      },
      deps,
    );
    expect(executePatternRecallSpy).not.toHaveBeenCalled();
  });
});
