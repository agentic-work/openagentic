/**
 * Phase F.4 — client-side cost estimation for the running cost pill.
 *
 * The server emits authoritative usage + cost at the end of a turn, but
 * users want a live "so far" indicator while the response is still
 * streaming. We approximate here without waiting for the final usage
 * event:
 *   - token estimate: ceil(chars / 4), the industry-standard GPT-style
 *     4 chars/token heuristic; close enough for a pill
 *   - pricing: a small hardcoded table keyed by model-id prefix; covers
 *     the platform's routable families and falls back to a conservative
 *     mid-range default for unknown models (marked approximate)
 *
 * The resulting number is always displayed as "~$X" so users know it's
 * an estimate. Authoritative cost comes through usage events at end of
 * turn and should replace the estimate in the same pill.
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** Display name for tooltip */
  label: string;
}

/**
 * Prefix-matched pricing table. Ordered longest-prefix-first in the
 * match routine so e.g. `claude-opus-4-7` wins over `claude`.
 *
 * Sources: public rate cards at the time of writing (2026-04). Update
 * together with the seeder's model registry when new models land.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75, label: 'Claude Opus 4.7' },
  'claude-opus-4-6': { inputPer1M: 15, outputPer1M: 75, label: 'Claude Opus 4.6' },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, label: 'Claude Sonnet 4.6' },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, label: 'Claude Sonnet 4.5' },
  'claude-haiku-4-5': { inputPer1M: 0.25, outputPer1M: 1.25, label: 'Claude Haiku 4.5' },
  'claude-haiku': { inputPer1M: 0.25, outputPer1M: 1.25, label: 'Claude Haiku' },
  'claude-sonnet': { inputPer1M: 3, outputPer1M: 15, label: 'Claude Sonnet' },
  'claude-opus': { inputPer1M: 15, outputPer1M: 75, label: 'Claude Opus' },
  // OpenAI / AIF
  'gpt-5': { inputPer1M: 2.5, outputPer1M: 10, label: 'GPT-5' },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'GPT-4o mini' },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, label: 'GPT-4o' },
  'gpt-4': { inputPer1M: 10, outputPer1M: 30, label: 'GPT-4' },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4, label: 'o3-mini' },
  'o3': { inputPer1M: 2, outputPer1M: 8, label: 'o3' },
  'o1-mini': { inputPer1M: 1.1, outputPer1M: 4.4, label: 'o1-mini' },
  'o1': { inputPer1M: 15, outputPer1M: 60, label: 'o1' },
  // Vertex / Gemini
  'gemini-3-pro': { inputPer1M: 1.25, outputPer1M: 5, label: 'Gemini 3 Pro' },
  'gemini-3-flash': { inputPer1M: 0.075, outputPer1M: 0.3, label: 'Gemini 3 Flash' },
  'gemini-2': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Gemini 2' },
  'gemini': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Gemini' },
  // Bedrock (non-Claude)
  'llama-3': { inputPer1M: 0.65, outputPer1M: 0.65, label: 'Llama 3' },
  'nova-pro': { inputPer1M: 0.8, outputPer1M: 3.2, label: 'Nova Pro' },
  'nova-lite': { inputPer1M: 0.06, outputPer1M: 0.24, label: 'Nova Lite' },
  // Local / Ollama (free at inference, keep near-zero for the pill)
  'gpt-oss': { inputPer1M: 0, outputPer1M: 0, label: 'gpt-oss (local)' },
  'qwen': { inputPer1M: 0, outputPer1M: 0, label: 'Qwen (local)' },
  'deepseek': { inputPer1M: 0, outputPer1M: 0, label: 'DeepSeek (local)' },
  'ollama': { inputPer1M: 0, outputPer1M: 0, label: 'Ollama (local)' },
};

/** Fallback used when no prefix matches; mid-range so we don't radically
 *  under-/over-state. Pill marks any match as approximate anyway. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = {
  inputPer1M: 1,
  outputPer1M: 3,
  label: 'Unknown model',
};

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function findModelPricing(modelId: string | null | undefined): {
  pricing: ModelPricing;
  known: boolean;
} {
  if (!modelId) return { pricing: UNKNOWN_MODEL_PRICING, known: false };
  const normalized = modelId.toLowerCase();
  // Longest-prefix-first so "claude-opus-4-7" beats "claude-opus" beats "claude".
  const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.includes(key)) {
      return { pricing: MODEL_PRICING[key], known: true };
    }
  }
  return { pricing: UNKNOWN_MODEL_PRICING, known: false };
}

export interface CostEstimate {
  /** USD estimate, always non-negative */
  usd: number;
  /** Token counts used in the calculation */
  inputTokens: number;
  outputTokens: number;
  /** True when we have a specific pricing entry; false means fallback */
  known: boolean;
  /** Model label for display */
  label: string;
}

export function estimateCost(opts: {
  model?: string | null;
  inputText?: string;
  outputText?: string;
  inputTokens?: number;
  outputTokens?: number;
}): CostEstimate {
  const inputTokens =
    opts.inputTokens ?? (opts.inputText ? estimateTokens(opts.inputText) : 0);
  const outputTokens =
    opts.outputTokens ?? (opts.outputText ? estimateTokens(opts.outputText) : 0);
  const { pricing, known } = findModelPricing(opts.model);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  const usd = Math.max(0, inputCost + outputCost);
  return { usd, inputTokens, outputTokens, known, label: pricing.label };
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `<$0.01`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}
