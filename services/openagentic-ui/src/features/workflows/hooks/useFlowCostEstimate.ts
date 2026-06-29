/**
 * useFlowCostEstimate — TDD-driven, written one test at a time.
 *
 * Iron-law discipline: this implementation contains ONLY the minimum code
 * needed to satisfy tests that have already been written and watched fail.
 * Do not add behavior here without writing a failing test first.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers/AuthContext';

interface CostRate {
  providerType: string;
  model: string;
  modelVariant: string | null;
  inputCostPer1m: number;
  outputCostPer1m: number;
  cachedInputCostPer1m: number | null;
}

export interface NodeCostEstimate {
  nodeId: string;
  estimatedUsd: number;
  agentCount: number;
  usedFallbackRate: boolean;
}

// Types that bill us per LLM token. The agent_* family hits the openagentic-proxy
// which in turn hits an LLM, so they count too. mcp_tool / http_request /
// merge / transform / trigger don't bill, so they're excluded.
const COST_RELEVANT_TYPES = new Set([
  'llm_completion',
  'openagentic_chat',
  'openagentic_llm',
  'bedrock',
  'vertex',
  'azure_ai',
  'reasoning',
  'multi_agent',
  'agent_spawn',
  'a2a',
  'agent_single',
  'agent_pool',
  'agent_supervisor',
]);
const FALLBACK_RATES = { input: 0.15, output: 0.6 } as const;

function agentCountForNode(node: any): number {
  if (node?.type === 'multi_agent') {
    const arr = node.data?.agents;
    return Array.isArray(arr) ? Math.max(1, arr.length) : 1;
  }
  return 1;
}

export interface FlowCostEstimate {
  totalUsd: number;
  perNode: NodeCostEstimate[];
  ratesLoaded: boolean;
  hasFallbackRates: boolean;
  hasUnknownIterations: boolean;
}

export function useFlowCostEstimate(
  nodes: ReadonlyArray<any> | undefined,
  _edges: ReadonlyArray<any> | undefined,
): FlowCostEstimate {
  const { getAuthHeaders } = useAuth();
  const [rates, setRates] = useState<CostRate[]>([]);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workflows/cost-rates', {
          headers: getAuthHeaders(),
        });
        const data = await res.json();
        if (!cancelled) {
          setRates(Array.isArray(data?.rates) ? data.rates : []);
          setRatesLoaded(true);
        }
      } catch {
        if (!cancelled) setRatesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  return useMemo<FlowCostEstimate>(() => {
    if (!nodes || nodes.length === 0) {
      return {
        totalUsd: 0,
        perNode: [],
        ratesLoaded,
        hasFallbackRates: false,
        hasUnknownIterations: false,
      };
    }
    const perNode: NodeCostEstimate[] = [];
    for (const node of nodes) {
      if (!COST_RELEVANT_TYPES.has(node?.type)) continue;
      const modelName: string = node.data?.model ?? '';
      const rate = rates.find((r) => modelName.toLowerCase().includes(r.model.toLowerCase()));
      const usedFallbackRate = !rate;
      const inputRate = rate ? rate.inputCostPer1m : FALLBACK_RATES.input;
      const outputRate = rate ? rate.outputCostPer1m : FALLBACK_RATES.output;
      const maxTokens = Number(node.data?.maxTokens) || 0;
      const agentCount = agentCountForNode(node);
      const perCallUsd =
        ((maxTokens / 2) * inputRate + (maxTokens / 2) * outputRate) / 1_000_000;
      perNode.push({
        nodeId: node.id,
        estimatedUsd: perCallUsd * agentCount,
        agentCount,
        usedFallbackRate,
      });
    }
    const totalUsd = perNode.reduce((s, n) => s + n.estimatedUsd, 0);
    return {
      totalUsd,
      perNode,
      ratesLoaded,
      hasFallbackRates: perNode.some((n) => n.usedFallbackRate),
      hasUnknownIterations: false,
    };
  }, [nodes, rates, ratesLoaded]);
}
