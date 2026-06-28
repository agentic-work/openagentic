/**
 * classifyModelCost — every provider model gets a usable input/output cost so
 * NONE land null and get filtered out of the routing lab / cost-scoring.
 *
 * Companion to classifyModelFca (#1082 follows #1081). Resolution order:
 *   1. registry column (cost_per_*_token_usd, USD/1M, CSP-SDK-populated) → 'registry'
 *   2. ModelCapabilityRegistry benchmark (USD/1k)                        → 'mcr-estimate'
 *   3. local (ollama) provider — free                                   → 'local-free' (0)
 *   4. else a conservative per-provider cloud tier default              → 'estimated'
 *
 * The 'estimated' default is realistic mid-tier cloud pricing ($3/1M in,
 * $15/1M out) — NOT artificially cheap — so an unpriced cloud model is never
 * over-preferred by the cost-weighted router. Tier values are not model-id
 * literals, so the no-hardcoded-models rule is satisfied.
 */
import { describe, test, expect } from 'vitest';
import { classifyModelCost } from '../classifyModelCost.js';

describe('classifyModelCost', () => {
  test('registry column wins (USD/1M → /1k) — source registry', () => {
    const r = classifyModelCost({ providerName: 'bedrock-dev', registryInputPer1M: 3, registryOutputPer1M: 15 });
    expect(r.inputPer1k).toBe(0.003);
    expect(r.outputPer1k).toBe(0.015);
    expect(r.source).toBe('registry');
  });

  test('no registry, MCR benchmark present (already /1k) — source mcr-estimate', () => {
    const r = classifyModelCost({ providerName: 'bedrock-dev', mcrInputPer1k: 0.0011, mcrOutputPer1k: 0.0055 });
    expect(r.inputPer1k).toBe(0.0011);
    expect(r.outputPer1k).toBe(0.0055);
    expect(r.source).toBe('mcr-estimate');
  });

  test('local (ollama) unpriced model → free (0/0), source local-free', () => {
    const r = classifyModelCost({ providerName: 'node-ollama' });
    expect(r.inputPer1k).toBe(0);
    expect(r.outputPer1k).toBe(0);
    expect(r.source).toBe('local-free');
  });

  test('unpriced cloud model → conservative estimated default (never null)', () => {
    const r = classifyModelCost({ providerName: 'bedrock-dev' });
    expect(r.inputPer1k).toBe(0.003);
    expect(r.outputPer1k).toBe(0.015);
    expect(r.source).toBe('estimated');
    expect(r.inputPer1k).toBeGreaterThan(0); // never free for cloud
  });

  test('registry input present but output missing → output falls through to MCR then estimate', () => {
    const withMcr = classifyModelCost({ providerName: 'bedrock-dev', registryInputPer1M: 2, mcrOutputPer1k: 0.009 });
    expect(withMcr.inputPer1k).toBe(0.002);
    expect(withMcr.outputPer1k).toBe(0.009); // MCR output when registry output absent
    expect(withMcr.source).toBe('registry'); // source keyed off the input signal

    const noMcr = classifyModelCost({ providerName: 'bedrock-dev', registryInputPer1M: 2 });
    expect(noMcr.outputPer1k).toBe(0.015); // estimated cloud output default
  });

  test('estimated default is NOT artificially cheap (>= a realistic mid-tier floor)', () => {
    const r = classifyModelCost({ providerName: 'vertex-prod' });
    expect(r.inputPer1k).toBeGreaterThanOrEqual(0.002);
    expect(r.source).toBe('estimated');
  });
});
