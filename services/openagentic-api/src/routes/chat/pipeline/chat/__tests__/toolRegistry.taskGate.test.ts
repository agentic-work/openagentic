/**
 * toolRegistry Task-gate integration test — #843 hard capability gate.
 *
 * Pins the contract: when a small/cheap model is in the selectedModel
 * slot, Task is physically absent from the tool array. When no model
 * (or a capable model) is provided, Task is present.
 *
 * Mocks the modelTaskGate dynamic import so we don't need a live
 * ProviderManager to test the integration.
 */

import { describe, it, expect } from 'vitest';
import { getAllBaseTools } from '../toolRegistry.js';
import { modelSupportsTaskDispatch } from '../../../../../services/modelTaskGate.js';
import type { DiscoveredModel } from '../../../../../services/llm-providers/ILLMProvider.js';

/**
 * Test strategy: exercise the pure pieces independently rather than
 * mocking the dynamic-import inside buildChatToolArray (vitest's
 * vi.resetModules collides with prom-client's singleton metrics
 * registry that's transitively imported via TaskTool).
 *
 *   1. modelSupportsTaskDispatch is the pure capability gate — exhaustive
 *      cases live in services/__tests__/modelTaskGate.test.ts.
 *   2. getAllBaseTools(taskDesc, includeTaskTool) is the array assembler.
 *      We pin: includeTaskTool=false drops Task; includeTaskTool=true
 *      keeps Task; all other T1 primitives are unchanged.
 *   3. The wire-through (buildChatToolArray → shouldExposeTaskToolForModel
 *      → getAllBaseTools) is exercised by the source-regression test +
 *      live Playwright verify in the dev environment.
 */

function caps(overrides: Partial<DiscoveredModel> = {}): DiscoveredModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'test-provider',
    capabilities: {
      chat: true,
      vision: false,
      tools: true,
      thinking: false,
      embeddings: false,
      imageGeneration: false,
      streaming: true,
    },
    contextWindow: 128_000,
    costTier: 'mid',
    ...overrides,
  };
}

describe('getAllBaseTools — Task inclusion gate (#843)', () => {
  it('INCLUDES Task when includeTaskTool=true (default)', () => {
    const tools = getAllBaseTools('test description');
    const names = tools.map((t: any) => t.function?.name);
    expect(names).toContain('Task');
  });

  it('EXCLUDES Task when includeTaskTool=false', () => {
    const tools = getAllBaseTools('test description', false);
    const names = tools.map((t: any) => t.function?.name);
    expect(names).not.toContain('Task');
  });

  it('preserves all OTHER T1 primitives when Task is excluded', () => {
    const tools = getAllBaseTools('test description', false);
    const names = tools.map((t: any) => t.function?.name);
    // Every other T1 primitive still present
    expect(names).toContain('tool_search');
    expect(names).toContain('agent_search');
    expect(names).toContain('agent_send');
    expect(names).toContain('agent_list');
    expect(names).toContain('agent_stop');
    expect(names).toContain('read_large_result');
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(names).toContain('synth');
    expect(names).toContain('pattern_save');
    expect(names).toContain('pattern_recall');
    expect(names).toContain('compose_visual');
    expect(names).toContain('compose_app');
    expect(names).toContain('render_artifact');
    expect(names).toContain('request_clarification');
  });

  it('Task tool count drops by exactly 1 when gated off', () => {
    const withTask = getAllBaseTools('test description', true);
    const withoutTask = getAllBaseTools('test description', false);
    expect(withoutTask.length).toBe(withTask.length - 1);
  });
});

describe('Task gate end-to-end policy — #843 contract', () => {
  it('mini-shape caps → no Task; sonnet-shape caps → Task included', () => {
    // The two key end-to-end shapes — this proves the gate fits the
    // failure mode without needing to wire the full buildChatToolArray.
    const miniCaps = caps({ costTier: 'low', contextWindow: 128_000 });
    const sonnetCaps = caps({ costTier: 'high', contextWindow: 200_000 });

    const miniGate = modelSupportsTaskDispatch(miniCaps);
    const sonnetGate = modelSupportsTaskDispatch(sonnetCaps);

    expect(miniGate).toBe(false);
    expect(sonnetGate).toBe(true);

    const miniTools = getAllBaseTools('desc', miniGate);
    const sonnetTools = getAllBaseTools('desc', sonnetGate);

    expect(miniTools.map((t: any) => t.function?.name)).not.toContain('Task');
    expect(sonnetTools.map((t: any) => t.function?.name)).toContain('Task');
  });

  it('unknown model caps (fail-open) → Task included', () => {
    const gate = modelSupportsTaskDispatch(null);
    expect(gate).toBe(true);
    const tools = getAllBaseTools('desc', gate);
    expect(tools.map((t: any) => t.function?.name)).toContain('Task');
  });
});
