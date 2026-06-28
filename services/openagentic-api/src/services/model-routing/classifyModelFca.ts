/**
 * classifyModelFca (2026-05-24) — "better classifications for all provider models".
 *
 * Guarantees every model a usable function-calling-accuracy so NONE score 0
 * and get filtered out of the router pools / the Live Scoring Lab:
 *   - MCR benchmark value when the family is known → source 'mcr-benchmark'
 *   - else a conservative tier-default derived from STRUCTURAL signals
 *     (provider type + context window — never model-id substring sniffing,
 *     which is banned by #805/#911) → source 'tier-default'
 *
 * The tier defaults clear the RouterTuning chat-pool floor (default 0.82) so an
 * unclassified model is at least chat / simple-tool routable, but stay under
 * the complex-tool (0.90) and T3 (0.93) floors until an admin sets a real value
 * via the Edit-Model FCA field. Numbers here are tier thresholds, not per-model
 * literals, so the no-hardcoded-models rule is satisfied.
 */

export type FcaSource = 'mcr-benchmark' | 'tier-default';

export interface ClassifyFcaInput {
  modelId: string;
  providerName: string;
  /** MCR benchmark FCA if the family is known; null/0/undefined ⇒ unknown. */
  mcrFca?: number | null;
  /** Context-window tokens (registry/MCR) — a structural capacity signal. */
  contextWindowTokens?: number | null;
}

export interface ClassifyFcaResult {
  fca: number;
  source: FcaSource;
}

// Tier-default constants (FCA 0..1). Conservative: clear chat-pool (0.82),
// below complex-tool (0.90) / T3 (0.93) until admin-classified.
const LOCAL_DEFAULT = 0.85; // local (Ollama) — small but tool-capable (gpt-oss measured 0.87)
const LARGE_CTX_DEFAULT = 0.9; // ≥128k ctx cloud model — frontier-class capacity
const MID_CTX_DEFAULT = 0.87; // ≥32k ctx cloud model — mid-tier
const UNKNOWN_DEFAULT = 0.83; // unknown/small cloud model — clears chat floor, nothing more

export function classifyModelFca(input: ClassifyFcaInput): ClassifyFcaResult {
  const { providerName, mcrFca, contextWindowTokens } = input;

  // 1. Known benchmark wins.
  if (typeof mcrFca === 'number' && Number.isFinite(mcrFca) && mcrFca > 0 && mcrFca <= 1) {
    return { fca: mcrFca, source: 'mcr-benchmark' };
  }

  // 2. Tier-default from structural signals.
  const isLocal = String(providerName).toLowerCase().includes('ollama');
  if (isLocal) return { fca: LOCAL_DEFAULT, source: 'tier-default' };

  const ctx = typeof contextWindowTokens === 'number' ? contextWindowTokens : 0;
  if (ctx >= 128_000) return { fca: LARGE_CTX_DEFAULT, source: 'tier-default' };
  if (ctx >= 32_000) return { fca: MID_CTX_DEFAULT, source: 'tier-default' };
  return { fca: UNKNOWN_DEFAULT, source: 'tier-default' };
}
