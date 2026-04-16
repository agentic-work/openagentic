/**
 * ModelCapabilityGate
 *
 * Shared validation layer that checks whether a selected model can handle
 * the actual requirements of a request. Called from all 4 model selection paths:
 *   1. Chat pipeline (completion-simple.stage.ts)
 *   2. OpenAI-compatible endpoint (openai-compatible.ts)
 *   3. Agent spawning (AgentSpawnManager.ts)
 *   4. Workflow engine (via OpenAI-compatible endpoint)
 *
 * Ollama models CAN handle simple tool calls (single tool, simple args, ~80% accuracy).
 * They CANNOT handle: multi-tool chains, agent delegation, large context, artifacts.
 * This gate upgrades the model only when the request exceeds model capabilities.
 */

import type { Logger } from 'pino';
import { ModelConfigurationService } from './ModelConfigurationService.js';
import type { DiscoveredModel } from './llm-providers/ILLMProvider.js';

export interface GateContext {
  selectedModel: string;
  toolCount: number;              // 0 = pure chat, 1-3 = light, 4+ = heavy
  systemPromptLength: number;     // characters
  hasImages: boolean;
  hasAgentDelegation: boolean;    // delegate_to_agents tool present
  estimatedToolChainDepth: number; // 1 = single call, 3+ = multi-step
  requiredContextWindow?: number; // floor — when an agent needs ≥N tokens of context
                                  // (e.g. cloud_operations requires 1M)
}

export interface GateResult {
  model: string;
  upgraded: boolean;
  reason?: string;
}

/**
 * Get model capabilities from LIVE PROVIDER DISCOVERY (not hardcoded patterns).
 * ProviderManager.discoverAllModelCapabilities() populates this data on init/reload
 * by calling each provider's discoverModels() API.
 */
async function getModelCaps(modelId: string): Promise<{
  tools: boolean;
  vision: boolean;
  thinking: boolean;
  contextWindow: number;
  costTier: string;
} | null> {
  try {
    // Dynamic import to avoid circular dependency
    const { getProviderManager } = await import('./llm-providers/ProviderManager.js');
    const pm = getProviderManager();
    if (!pm) return null;

    const discovered = pm.getDiscoveredCapabilities(modelId);
    if (discovered) {
      return {
        tools: discovered.capabilities.tools,
        vision: discovered.capabilities.vision,
        thinking: discovered.capabilities.thinking,
        contextWindow: discovered.contextWindow || 128000,
        costTier: discovered.costTier || 'mid',
      };
    }
  } catch { /* ProviderManager not ready yet */ }

  return null;
}

/**
 * Find a free/same-tier model that supports a required capability.
 * Prefers models from the same provider before jumping to expensive cloud models.
 * e.g., if gemma3 can't do tools → try qwen3.5 or gpt-oss (both free Ollama) first.
 */
async function findFreeAlternative(requirement: 'tools' | 'vision' | 'chat'): Promise<string | null> {
  try {
    const { getProviderManager } = await import('./llm-providers/ProviderManager.js');
    const pm = getProviderManager();
    if (!pm) return null;

    // Scan all discovered models for a free one that has the required capability
    const candidates = ['qwen3.5:latest', 'gpt-oss:latest', 'gemma3:latest',
      'qwen3.5', 'gpt-oss', 'gemma3',
      'llama3.3:latest', 'llama3.1:latest', 'mistral:latest', 'deepseek:latest'];

    for (const candidate of candidates) {
      const caps = pm.getDiscoveredCapabilities(candidate);
      if (!caps) continue;
      if (caps.capabilities.embeddings) continue; // Skip embedding models
      if (caps.costTier === 'free' && caps.capabilities[requirement]) {
        return caps.id;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Validate that the selected model can handle the request requirements.
 * Uses LIVE provider discovery data — no hardcoded model patterns.
 *
 * Upgrade priority: free alternative (same tier) → balanced → premium
 * This prevents always jumping to expensive cloud models when a free Ollama model would work.
 */
export async function gateModelSelection(
  ctx: GateContext,
  logger?: Logger,
): Promise<GateResult> {
  const caps = await getModelCaps(ctx.selectedModel);
  const config = await ModelConfigurationService.getConfig();
  const tiers = config?.sliderConfig?.tiers;

  const balanced = tiers?.balanced?.modelId;
  const premium = tiers?.premium?.modelId;
  const defaultModel = config?.defaultModel?.modelId;

  // If we couldn't discover capabilities, pass through — don't block requests
  if (!caps) {
    return { model: ctx.selectedModel, upgraded: false };
  }

  // Helper: pick the best available upgrade — but NEVER return an embedding model or the same broken model
  const upgradeModel = (preference: 'balanced' | 'premium'): string | null => {
    const candidates = preference === 'premium'
      ? [premium, balanced, defaultModel]
      : [balanced, premium, defaultModel];
    for (const c of candidates) {
      if (c && c !== ctx.selectedModel) return c;
    }
    return null; // No viable upgrade available
  };

  // Helper: find any viable model when the selected one can't work
  const findViableModel = async (requirement: 'tools' | 'vision' | 'chat'): Promise<string | null> => {
    // 1. Try free alternatives first (other Ollama models)
    const freeAlt = await findFreeAlternative(requirement);
    if (freeAlt) return freeAlt;
    // 2. Try configured tier models
    const tierModel = upgradeModel('balanced') || upgradeModel('premium');
    if (tierModel) return tierModel;
    return null;
  };

  // Rule 0: Embedding model selected for chat → MUST upgrade
  try {
    const { getProviderManager } = await import('./llm-providers/ProviderManager.js');
    const pm = getProviderManager();
    const disc = pm?.getDiscoveredCapabilities(ctx.selectedModel);
    if (disc && disc.capabilities.embeddings && !disc.capabilities.chat) {
      const viable = await findViableModel('chat');
      if (!viable) {
        throw new Error(`No chat-capable models available. "${ctx.selectedModel}" is an embedding model. Add a chat model via Admin > LLM Providers.`);
      }
      return { model: viable, upgraded: true, reason: `${ctx.selectedModel} is an embedding model → using ${viable}` };
    }
  } catch (err: any) {
    if (err.message?.includes('No chat-capable')) throw err;
  }

  // Rule 1: No tool support + tools requested → find alternative
  if (ctx.toolCount > 0 && !caps.tools) {
    const viable = await findViableModel('tools');
    if (!viable) {
      throw new Error(`No tool-capable models available. "${ctx.selectedModel}" does not support tool calling, and no alternative models are configured. Add a tool-capable model (e.g., qwen3.5, Claude, GPT-4o) via Admin > LLM Providers.`);
    }
    logger?.info({
      originalModel: ctx.selectedModel,
      upgradedModel: viable,
      toolCount: ctx.toolCount,
    }, '🛡️ [CapabilityGate] Upgraded: model lacks tool support');
    return { model: viable, upgraded: true, reason: `${ctx.selectedModel} lacks tools → ${viable}` };
  }

  // Rule 2: Agent delegation requires premium ONLY when the user message
  // actually plausibly needs delegation (estimated chain depth >= 3 OR explicit
  // delegation keywords). Previously this rule fired whenever delegate_to_agents
  // was merely *available* in the tool list, which over-upgraded every simple
  // turn (e.g. "thanks") to the premium Bedrock model in any chat session that
  // had ever invoked agent delegation. The structural presence of the tool is
  // NOT a signal that *this* message needs it — that's the LLM's job to decide.
  if (ctx.hasAgentDelegation && caps.costTier === 'free' && ctx.estimatedToolChainDepth >= 3) {
    const upgraded = upgradeModel('premium');
    if (upgraded) {
      logger?.info({
        originalModel: ctx.selectedModel,
        upgradedModel: upgraded,
        chainDepth: ctx.estimatedToolChainDepth,
      }, '🛡️ [CapabilityGate] Upgraded: agent delegation likely (deep chain) needs premium');
      return { model: upgraded, upgraded: true, reason: `Agent delegation likely (chain depth ${ctx.estimatedToolChainDepth}) requires premium model` };
    }
  }

  // Rule 3: Free/low-tier model + many tools + multi-step chain → upgrade
  if ((caps.costTier === 'free' || caps.costTier === 'low') && ctx.toolCount > 5 && ctx.estimatedToolChainDepth >= 3) {
    const upgraded = upgradeModel('premium');
    if (upgraded) {
      logger?.info({
        originalModel: ctx.selectedModel,
        upgradedModel: upgraded,
        toolCount: ctx.toolCount,
        chainDepth: ctx.estimatedToolChainDepth,
        costTier: caps.costTier,
      }, '🛡️ [CapabilityGate] Upgraded: multi-step chain with free-tier model');
      return { model: upgraded, upgraded: true, reason: `${ctx.toolCount} tools, depth ${ctx.estimatedToolChainDepth} with ${caps.costTier}-tier model` };
    }
  }

  // Rule 4: System prompt too large for model context window
  const maxSystemChars = caps.contextWindow;
  if (ctx.systemPromptLength > 0 && ctx.systemPromptLength > maxSystemChars) {
    const upgraded = upgradeModel('premium');
    if (upgraded) {
      logger?.info({
        originalModel: ctx.selectedModel,
        upgradedModel: upgraded,
        systemPromptLength: ctx.systemPromptLength,
        contextWindow: caps.contextWindow,
      }, '🛡️ [CapabilityGate] Upgraded: system prompt exceeds context budget');
      return { model: upgraded, upgraded: true, reason: `System prompt ${ctx.systemPromptLength} chars exceeds ${caps.contextWindow} token context` };
    }
  }

  // Rule 5: Vision required but model lacks it
  if (ctx.hasImages && !caps.vision) {
    const visionModel = config?.services?.vision?.modelId;
    if (visionModel) {
      logger?.info({
        originalModel: ctx.selectedModel,
        upgradedModel: visionModel,
      }, '🛡️ [CapabilityGate] Upgraded: vision required');
      return { model: visionModel, upgraded: true, reason: 'Image content requires vision-capable model' };
    }
  }

  // Rule 6: requiredContextWindow floor (cloud_operations and other long-horizon agents
  // need 1M-class context). Look for any discovered model that meets the floor and is
  // not the currently-selected one. Priority: prefer the highest-tier 1M model the user
  // has configured. Fail loudly (throw) if no model meets the requirement — never silently
  // downgrade an agent that explicitly asked for 1M context.
  if (ctx.requiredContextWindow && caps.contextWindow < ctx.requiredContextWindow) {
    let bestCandidate: string | null = null;
    let bestContext = 0;
    let bestTier = 0; // premium=3, balanced=2, economical=1, free=0

    try {
      const { getProviderManager } = await import('./llm-providers/ProviderManager.js');
      const pm = getProviderManager();
      if (pm) {
        const tierRank: Record<string, number> = { premium: 3, balanced: 2, mid: 2, low: 1, economical: 1, free: 0 };
        // Walk all discovered models, find ones whose contextWindow >= floor
        const allModels = pm.getAllDiscoveredCapabilities() as DiscoveredModel[] | undefined;
        if (allModels && Array.isArray(allModels)) {
          for (const m of allModels) {
            if (!m.capabilities?.chat) continue;
            if (m.capabilities?.embeddings) continue;
            const cw = m.contextWindow || 0;
            if (cw < ctx.requiredContextWindow) continue;
            if (m.id === ctx.selectedModel) continue;
            const rank = tierRank[m.costTier || 'mid'] || 0;
            // Prefer higher tier first, then larger context window as tiebreaker
            if (rank > bestTier || (rank === bestTier && cw > bestContext)) {
              bestCandidate = m.id;
              bestContext = cw;
              bestTier = rank;
            }
          }
        }
      }
    } catch { /* fall through to throw below */ }

    if (!bestCandidate) {
      throw new Error(
        `No model with context window ≥ ${ctx.requiredContextWindow.toLocaleString()} tokens is configured. ` +
        `The current model "${ctx.selectedModel}" has only ${caps.contextWindow.toLocaleString()} tokens. ` +
        `cloud_operations and other long-horizon agents require a 1M-class model — add Claude Opus/Sonnet 1M, ` +
        `Gemini 2.5 Pro, or GPT-4.1 long-context via Admin > LLM Providers.`
      );
    }

    logger?.info({
      originalModel: ctx.selectedModel,
      originalContext: caps.contextWindow,
      upgradedModel: bestCandidate,
      upgradedContext: bestContext,
      requiredContext: ctx.requiredContextWindow,
    }, '🛡️ [CapabilityGate] Upgraded: required context window floor (Rule 6)');

    return {
      model: bestCandidate,
      upgraded: true,
      reason: `Required context window ≥ ${ctx.requiredContextWindow.toLocaleString()} → ${bestCandidate} (${bestContext.toLocaleString()} tokens)`,
    };
  }

  // Model passes all checks — keep it
  return { model: ctx.selectedModel, upgraded: false };
}

/**
 * Estimate tool chain depth from message content.
 * Used as input to the capability gate.
 *
 * Returns:
 *   1 = single tool call likely (list, show, get, check)
 *   2 = two-step chain (search + summarize, fetch + analyze)
 *   3+ = multi-step/multi-domain (compare across, step-by-step, delegate)
 */
export function estimateToolChainDepth(message: string): number {
  const lower = message.toLowerCase();

  // Agent delegation patterns: only count as deep when there are multiple
  // structural signals (multiple agents, hierarchical orchestration, parallel
  // dispatch, multi-cloud). A single explicit "delegate to one agent" doesn't
  // need a premium model — gpt-oss handles single delegate_to_agents calls fine.
  const hasDelegateKeyword = /\b(delegate|spawn|orchestrat)/i.test(lower);
  if (hasDelegateKeyword) {
    const hasMultipleAgents =
      /\b(\d+\s*(?:agents?|sub-?agents?))/i.test(lower) ||
      /\b(parallel|hierarchical|supervisor|multi-?agent|team)\b/i.test(lower) ||
      /\b(each|every)\s+agent\b/i.test(lower);
    return hasMultipleAgents ? 4 : 2; // depth 2 won't trigger Rule 2 upgrade
  }

  // Multi-domain / comparison patterns → 3+ tools
  if (/\b(compare|across|both|versus|vs\.?|multi-?\w+)\b/i.test(lower)) {
    return 3;
  }

  // Sequential chain patterns → 3+ steps
  if (/\b(and then|after that|step by step|first.*then|pipeline|chain)\b/i.test(lower)) {
    return 3;
  }

  // Two-step patterns (action + analysis)
  if (/\b(search.*(?:summar|analyz)|fetch.*(?:analyz|process)|find.*(?:explain|compar))/i.test(lower)) {
    return 2;
  }

  // Multiple explicit actions
  const actionCount = (lower.match(/\b(list|show|get|check|query|search|fetch|find|create|delete|update|run|execute|deploy)\b/gi) || []).length;
  if (actionCount >= 3) return 3;
  if (actionCount >= 2) return 2;

  // Default: single tool call
  return 1;
}
