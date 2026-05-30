/**
 * classifyModelFca — every provider model gets a non-zero FCA classification.
 *
 * "Better classifications for all provider models" (user direction 2026-05-24):
 * the MCR benchmark table only covers known model families; anything else
 * (nemotron, a brand-new Bedrock/Vertex model) scored FCA=0 and was filtered
 * out of every router pool. This classifier guarantees a usable FCA for ANY
 * model:
 *   - MCR benchmark when the family is known  → source 'mcr-benchmark'
 *   - else a conservative tier-default by provider-type + context window,
 *     never 0/null                            → source 'tier-default'
 * Admin can always override via the Edit-Model FCA field.
 *
 * Tier defaults are structural (provider type + context window) — NO model-id
 * substring sniffing (banned by #805/#911). They clear the chat-pool floor
 * (0.82) so unknown models are at least chat/simple-tool routable, but stay
 * below the complex-tool (0.90) / T3 (0.93) floors until an admin classifies
 * them.
 */
import { describe, test, expect } from 'vitest';
import { classifyModelFca } from '../classifyModelFca.js';

describe('classifyModelFca', () => {
  test('uses the MCR benchmark value when known (source mcr-benchmark)', () => {
    const r = classifyModelFca({ modelId: 'gpt-oss:20b', providerName: 'node-ollama', mcrFca: 0.87 });
    expect(r.fca).toBe(0.87);
    expect(r.source).toBe('mcr-benchmark');
  });

  test('local (ollama) unknown model → 0.85 tier-default', () => {
    const r = classifyModelFca({ modelId: 'some-new-local-model', providerName: 'node-ollama', mcrFca: null });
    expect(r.fca).toBe(0.85);
    expect(r.source).toBe('tier-default');
  });

  test('cloud model with large context window (>=128k) → 0.90 tier-default', () => {
    const r = classifyModelFca({ modelId: 'nvidia.nemotron-nano-12b-v2', providerName: 'bedrock-dev', mcrFca: null, contextWindowTokens: 128000 });
    expect(r.fca).toBe(0.90);
    expect(r.source).toBe('tier-default');
  });

  test('cloud model with mid context window (>=32k) → 0.87 tier-default', () => {
    const r = classifyModelFca({ modelId: 'some-mid-model', providerName: 'bedrock-dev', mcrFca: null, contextWindowTokens: 32000 });
    expect(r.fca).toBe(0.87);
    expect(r.source).toBe('tier-default');
  });

  test('cloud model with unknown/small context → 0.83 conservative default (still clears chat floor 0.82)', () => {
    const r = classifyModelFca({ modelId: 'mystery', providerName: 'bedrock-dev', mcrFca: null });
    expect(r.fca).toBe(0.83);
    expect(r.source).toBe('tier-default');
    expect(r.fca).toBeGreaterThan(0.82); // clears RouterTuning fcaChatPoolFloor default
  });

  test('a 0 or out-of-range MCR value is treated as unknown → tier-default (never 0)', () => {
    const r = classifyModelFca({ modelId: 'x', providerName: 'bedrock-dev', mcrFca: 0 });
    expect(r.source).toBe('tier-default');
    expect(r.fca).toBeGreaterThan(0);
  });
});
