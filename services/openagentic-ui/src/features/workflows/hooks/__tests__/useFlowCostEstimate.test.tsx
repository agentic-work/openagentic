/**
 * useFlowCostEstimate — TDD-driven from scratch (post-revert 2026-04-26).
 *
 * Iron-law discipline: each test is added one at a time, watched fail
 * (RED) before any production code change is made to satisfy it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({ Authorization: 'Bearer test' }) }),
}));

const RATES_GPT4 = [
  { providerType: 'azure-ai-foundry-prod', model: 'gpt-4', modelVariant: null, inputCostPer1m: 30, outputCostPer1m: 60, cachedInputCostPer1m: null },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: [], fetchedAt: new Date().toISOString() }),
    }),
  );
});

function stubRates(rates: typeof RATES_GPT4) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates, fetchedAt: new Date().toISOString() }),
    }),
  );
}

import { useFlowCostEstimate } from '../useFlowCostEstimate';

describe('useFlowCostEstimate — TDD discipline', () => {
  it('RED 1: empty nodes array → totalUsd is 0 and perNode is empty', async () => {
    const { result } = renderHook(() => useFlowCostEstimate([], []));
    await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
    expect(result.current.totalUsd).toBe(0);
    expect(result.current.perNode).toEqual([]);
  });

  it('RED 2: llm_completion with gpt-4 rate (30/60 per-1M) and maxTokens=4000 → 0.18 USD', async () => {
    // Worst-case: half maxTokens prompt + half completion.
    // 2000 * 30 + 2000 * 60 = 60000 + 120000 = 180000 / 1_000_000 = 0.18
    stubRates(RATES_GPT4);
    const nodes = [
      { id: 'llm-1', type: 'llm_completion', data: { label: 'Sum', model: 'gpt-4', maxTokens: 4000 } },
    ];
    const { result } = renderHook(() => useFlowCostEstimate(nodes, []));
    await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
    expect(result.current.perNode).toHaveLength(1);
    expect(result.current.totalUsd).toBeCloseTo(0.18, 5);
  });

  it('RED 3: multi_agent with 3 agents multiplies the per-call cost', async () => {
    // gpt-4 rate, maxTokens=1000 → per-call: (500*30 + 500*60)/1M = 0.045
    // 3 agents → 0.045 * 3 = 0.135
    stubRates(RATES_GPT4);
    const nodes = [
      {
        id: 'm-1',
        type: 'multi_agent',
        data: {
          label: 'Pool',
          model: 'gpt-4',
          maxTokens: 1000,
          agents: [{ role: 'a' }, { role: 'b' }, { role: 'c' }],
        },
      },
    ];
    const { result } = renderHook(() => useFlowCostEstimate(nodes, []));
    await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
    expect(result.current.perNode).toHaveLength(1);
    expect(result.current.perNode[0]).toMatchObject({ agentCount: 3 });
    expect(result.current.totalUsd).toBeCloseTo(0.135, 5);
  });

  it('RED 4: hasFallbackRates=false when all nodes have matching rates', async () => {
    stubRates(RATES_GPT4);
    const nodes = [
      { id: 'l', type: 'llm_completion', data: { model: 'gpt-4', maxTokens: 1000 } },
    ];
    const { result } = renderHook(() => useFlowCostEstimate(nodes, []));
    await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
    expect(result.current.hasFallbackRates).toBe(false);
  });

  it('RED 5: hasFallbackRates=true when an LLM node has no matching rate row', async () => {
    stubRates(RATES_GPT4); // only gpt-4 in the rate table
    const nodes = [
      // claude-3-opus is NOT in the rate table → fallback
      { id: 'l', type: 'llm_completion', data: { model: 'claude-3-opus', maxTokens: 1000 } },
    ];
    const { result } = renderHook(() => useFlowCostEstimate(nodes, []));
    await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
    expect(result.current.hasFallbackRates).toBe(true);
  });

  // Regression caught by live Playwright walk on Deep Research Team template
  // (2026-04-26): the deployed flow uses `openagentic_llm` and `agent_pool`
  // node types but COST_RELEVANT_TYPES only had llm_completion + multi_agent,
  // so totalUsd was always 0 and the badge never rendered. Iron-law TDD —
  // this test is what failed against the live pod, then fixed in the impl.
  describe('RED 6: live-template-coverage regression', () => {
    const liveTypes = [
      'openagentic_llm',
      'openagentic_chat',
      'bedrock',
      'vertex',
      'azure_ai',
      'reasoning',
      'agent_spawn',
      'a2a',
      'agent_single',
      'agent_pool',
      'agent_supervisor',
    ];

    for (const t of liveTypes) {
      it(`treats ${t} as cost-relevant (with fallback rate when no rate row)`, async () => {
        stubRates([]); // no rate rows — should still produce non-zero via fallback
        const nodes = [
          { id: 'n', type: t, data: { label: t, maxTokens: 1000 } },
        ];
        const { result } = renderHook(() => useFlowCostEstimate(nodes, []));
        await waitFor(() => expect(result.current.ratesLoaded).toBe(true));
        expect(result.current.perNode).toHaveLength(1);
        expect(result.current.totalUsd).toBeGreaterThan(0);
        expect(result.current.hasFallbackRates).toBe(true);
      });
    }
  });
});
