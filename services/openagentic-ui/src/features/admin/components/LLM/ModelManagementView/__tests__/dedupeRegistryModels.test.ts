/**
 * Tests for dedupeRegistryModels — fixes user-reported regression
 * "two ollama gpt-oss:20b showing up in model registry with one ollama host".
 *
 * The registry stores one row per (role, model, provider). When the same
 * (model, provider) is registered for both 'chat' and 'code' roles, the
 * naive 1:1 mapping shows two visually-identical rows. This helper collapses
 * them into one row with a merged role set.
 */
import { describe, it, expect } from 'vitest';
import { dedupeRegistryModels } from '../dedupeRegistryModels';
import type { ModelInfo } from '../constants';

const mk = (over: Partial<ModelInfo>): ModelInfo => ({
  id: 'row-1',
  name: 'gpt-oss:20b',
  provider: 'Ollama (hal)',
  providerId: 'p-ollama-hal',
  providerType: 'ollama',
  providerName: 'ollama-hal',
  capabilities: {
    chat: true,
    embeddings: false,
    tools: true,
    vision: false,
    thinking: false,
    imageGeneration: false,
    streaming: true,
  },
  enabled: true,
  tier: 'balanced',
  config: {
    enabled: true,
    roles: ['chat'],
    capabilities: { chat: true, tools: true, streaming: true },
  },
  ...over,
});

describe('dedupeRegistryModels', () => {
  it('collapses two rows for same (provider, model) into one row with merged roles', () => {
    const out = dedupeRegistryModels([
      mk({ id: 'row-chat', config: { enabled: true, roles: ['chat'] } }),
      mk({ id: 'row-code', config: { enabled: true, roles: ['code'] } }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('row-chat'); // first wins as primary
    expect(out[0].config?.roles).toEqual(['chat', 'code']);
    expect(out[0].__secondaryRegistryIds).toEqual(['row-code']);
  });

  it('keeps distinct (provider, model) tuples separate', () => {
    const out = dedupeRegistryModels([
      mk({ id: 'a', name: 'gpt-oss:20b', providerName: 'ollama-hal' }),
      mk({ id: 'b', name: 'gpt-oss:20b', providerName: 'ollama-gpu-node' }),
      mk({ id: 'c', name: 'qwen3.6:latest', providerName: 'ollama-hal' }),
    ]);

    expect(out).toHaveLength(3);
    expect(out.map(m => m.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('OR-merges enabled when any source row is enabled', () => {
    const out = dedupeRegistryModels([
      mk({ id: 'row-1', enabled: false, config: { enabled: false, roles: ['chat'] } }),
      mk({ id: 'row-2', enabled: true, config: { enabled: true, roles: ['code'] } }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].enabled).toBe(true);
    expect(out[0].config?.enabled).toBe(true);
  });

  it('OR-merges capabilities across rows', () => {
    const out = dedupeRegistryModels([
      mk({
        id: 'a',
        capabilities: { chat: true, embeddings: false, tools: false, vision: false, streaming: true },
        config: { roles: ['chat'], capabilities: { chat: true, streaming: true } },
      }),
      mk({
        id: 'b',
        capabilities: { chat: true, embeddings: false, tools: true, vision: false, streaming: true },
        config: { roles: ['code'], capabilities: { chat: true, tools: true, streaming: true } },
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].capabilities.tools).toBe(true);
    expect(out[0].config?.capabilities?.tools).toBe(true);
  });

  it('preserves input order (first-seen wins for ordering)', () => {
    const out = dedupeRegistryModels([
      mk({ id: 'z', name: 'z-model', providerName: 'p-z' }),
      mk({ id: 'a', name: 'gpt-oss:20b', providerName: 'ollama-hal', config: { roles: ['chat'] } }),
      mk({ id: 'b', name: 'gpt-oss:20b', providerName: 'ollama-hal', config: { roles: ['code'] } }),
      mk({ id: 'm', name: 'm-model', providerName: 'p-m' }),
    ]);

    expect(out.map(m => m.name)).toEqual(['z-model', 'gpt-oss:20b', 'm-model']);
    expect(out[1].config?.roles).toEqual(['chat', 'code']);
  });

  it('handles single-row input idempotently', () => {
    const single = mk({ id: 'only', config: { roles: ['chat'] } });
    const out = dedupeRegistryModels([single]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('only');
    expect(out[0].config?.roles).toEqual(['chat']);
    expect(out[0].__secondaryRegistryIds).toEqual([]);
  });

  it('handles empty input', () => {
    expect(dedupeRegistryModels([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [
      mk({ id: 'row-chat', config: { roles: ['chat'] } }),
      mk({ id: 'row-code', config: { roles: ['code'] } }),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    dedupeRegistryModels(input);
    expect(input).toEqual(snapshot);
  });
});
