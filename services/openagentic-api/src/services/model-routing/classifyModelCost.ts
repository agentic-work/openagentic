/**
 * classifyModelCost (2026-05-24) — companion to classifyModelFca (#1082).
 *
 * Guarantees every model a usable input/output cost so NONE land null and get
 * filtered out of the routing lab / cost-weighted scoring. Resolution order:
 *   1. registry column (cost_per_*_token_usd, USD/1M, CSP-SDK-populated) → 'registry'
 *   2. ModelCapabilityRegistry benchmark (already USD/1k)                → 'mcr-estimate'
 *   3. local (ollama) provider — free                                   → 'local-free' (0/0)
 *   4. else a conservative per-provider cloud tier default              → 'estimated'
 *
 * The 'estimated' default is realistic mid-tier cloud pricing ($3/1M in,
 * $15/1M out) — deliberately NOT artificially cheap, so an unpriced cloud model
 * is never over-preferred by the cost-weighted router (which would defeat the
 * point of cost-aware routing). Tier values are not model-id literals, so the
 * no-hardcoded-models rule is satisfied. Admin can override via the registry
 * cost columns.
 */

export type CostSource = 'registry' | 'mcr-estimate' | 'local-free' | 'estimated';

export interface ClassifyCostInput {
  providerName: string;
  /** Registry row cost_per_input_token_usd — USD per 1M tokens (CSP-SDK SoT). */
  registryInputPer1M?: number | null;
  /** Registry row cost_per_output_token_usd — USD per 1M tokens. */
  registryOutputPer1M?: number | null;
  /** MCR benchmark input cost — already USD per 1k tokens. */
  mcrInputPer1k?: number | null;
  /** MCR benchmark output cost — already USD per 1k tokens. */
  mcrOutputPer1k?: number | null;
}

export interface ClassifyCostResult {
  inputPer1k: number;
  outputPer1k: number;
  source: CostSource;
}

// Conservative per-provider cloud tier defaults (USD per 1k tokens). Mid-tier
// commercial LLM pricing — high enough that an unpriced model isn't treated as
// nearly free by the cost weight.
const CLOUD_DEFAULT_INPUT_PER_1K = 0.003; // $3/1M
const CLOUD_DEFAULT_OUTPUT_PER_1K = 0.015; // $15/1M

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function classifyModelCost(input: ClassifyCostInput): ClassifyCostResult {
  const { providerName, registryInputPer1M, registryOutputPer1M, mcrInputPer1k, mcrOutputPer1k } = input;
  const isLocal = String(providerName).toLowerCase().includes('ollama');

  // Per-direction resolution: registry column → MCR → local-free → cloud default.
  const resolve = (reg1M: number | null | undefined, mcr1k: number | null | undefined, cloudDefault: number): number => {
    if (isFiniteNum(reg1M)) return reg1M / 1000;
    if (isFiniteNum(mcr1k)) return mcr1k;
    if (isLocal) return 0;
    return cloudDefault;
  };

  const inputPer1k = resolve(registryInputPer1M, mcrInputPer1k, CLOUD_DEFAULT_INPUT_PER_1K);
  const outputPer1k = resolve(registryOutputPer1M, mcrOutputPer1k, CLOUD_DEFAULT_OUTPUT_PER_1K);

  // Source keyed off the input signal (the dominant cost dimension), matching
  // the registry endpoint's prior costSource semantics.
  const source: CostSource = isFiniteNum(registryInputPer1M)
    ? 'registry'
    : isFiniteNum(mcrInputPer1k)
      ? 'mcr-estimate'
      : isLocal
        ? 'local-free'
        : 'estimated';

  return { inputPer1k, outputPer1k, source };
}
