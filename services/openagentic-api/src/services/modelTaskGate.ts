/**
 * modelTaskGate — hard capability gate for the Task sub-agent dispatcher.
 *
 * Why this exists (#843, 2026-05-14):
 *   Small/cheap models ignore the TaskTool description's "DO NOT USE for
 *   show me X / list X" rule and dispatch sub-agents for trivial one-tool
 *   queries. Description-only gating doesn't hold for small models — they
 *   pattern-match the AVAILABLE list and dispatch without reading the
 *   rule body.
 *
 *   This module moves the gate to the right layer: the platform decides
 *   whether `Task` is in the model's tool array. When the gate says no,
 *   the model physically cannot pick Task. No description can override a
 *   missing tool.
 *
 * Threshold (structural, NOT a model-name match):
 *   - capabilities.tools === true (the model can call tools at all)
 *   - contextWindow >= 64000 (enough headroom to drive a sub-agent loop)
 *   - costTier NOT in {'free', 'low'} (small/budget tiers confabulate at
 *     multi-step coordination; sub-agent dispatch is exactly that shape)
 *
 *   When caps are unknown (provider discovery hasn't populated yet, or
 *   the model id isn't normalized), default to ALLOW so existing flows
 *   don't break on cold-start.
 *
 * NO hardcoded model IDs in this module. The gate reads structural
 * capability + costTier — both are live-discovered per provider.
 */

import type { DiscoveredModel } from './llm-providers/ILLMProvider.js';

/** Models below this context window cannot drive a useful Task loop. */
export const TASK_GATE_MIN_CONTEXT = 64_000;

/** Cost tiers that confabulate at multi-step coordination. */
export const TASK_GATE_BLOCKED_COST_TIERS: ReadonlySet<string> = new Set([
  'free',
  'low',
]);

/**
 * Pure capability check — does this model qualify to see the `Task` tool?
 *
 * @param caps Live-discovered capabilities (from ProviderManager). When
 *             null/undefined, returns `true` (fail-open on unknown).
 */
export function modelSupportsTaskDispatch(
  caps: DiscoveredModel | null | undefined,
): boolean {
  if (!caps) return true;
  if (caps.capabilities?.tools !== true) return false;
  const ctx = caps.contextWindow ?? 0;
  if (ctx > 0 && ctx < TASK_GATE_MIN_CONTEXT) return false;
  const tier = caps.costTier;
  if (tier && TASK_GATE_BLOCKED_COST_TIERS.has(tier)) return false;
  return true;
}

/**
 * Look up capabilities for `modelId` from the live ProviderManager and
 * decide if the gate passes. Dynamic-imports ProviderManager to avoid
 * a static cycle (toolRegistry → modelTaskGate → ProviderManager
 * → SmartModelRouter → toolRegistry). Fail-open when:
 *   - modelId is empty/undefined
 *   - ProviderManager not initialized yet (boot order race)
 *   - caps lookup returns null (model not in discovery cache)
 */
export async function shouldExposeTaskToolForModel(
  modelId: string | null | undefined,
): Promise<boolean> {
  if (!modelId || typeof modelId !== 'string' || modelId.trim().length === 0) {
    return true;
  }
  let caps: DiscoveredModel | null = null;
  try {
    const { getProviderManager } = await import('./llm-providers/ProviderManager.js');
    const pm = getProviderManager();
    if (pm) {
      caps = pm.getDiscoveredCapabilities(modelId);
    }
  } catch {
    // Provider manager not ready — fail open.
    return true;
  }
  return modelSupportsTaskDispatch(caps);
}
