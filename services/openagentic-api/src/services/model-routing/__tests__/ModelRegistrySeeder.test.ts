/**
 * ModelRegistrySeeder tests — informational-only path (F2.4).
 *
 * After F2.4 the seeder exposes two public functions:
 *   - discoverFromProvider() — fetch a single provider's catalog (no DB writes)
 *   - discoverAllProviderModels() — fetch all enabled providers' catalogs
 *
 * The legacy ModelRegistrySeeder.seed() boot-time write loop was removed.
 * These tests cover only the discovery-list path.
 */
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import type { DiscoveredModel } from '../../llm-providers/ILLMProvider.js';
import {
  discoverFromProvider,
  discoverAllProviderModels,
  type ModelRegistrySeederPrismaLike,
  type ModelRegistryProviderFactory,
} from '../ModelRegistrySeeder.js';

const silentLogger = pino({ level: 'silent' });

function makePrisma(initialRows: any[] = []) {
  const store = new Map<string, any>();
  for (const row of initialRows) {
    const withDefaults = {
      deleted_at: null,
      enabled: true,
      priority: 1,
      provider_config: {},
      model_config: {},
      capabilities: {},
      ...row,
    };
    store.set(withDefaults.name, withDefaults);
  }

  const findMany = vi.fn(async ({ where }: any = {}) => {
    let rows = [...store.values()];
    if (where?.enabled !== undefined) rows = rows.filter((r) => r.enabled === where.enabled);
    if (where?.deleted_at === null) rows = rows.filter((r) => r.deleted_at === null);
    return rows;
  });

  const prisma: ModelRegistrySeederPrismaLike = {
    lLMProvider: { findMany },
  };
  return { prisma, store, findMany };
}

function makeFactory(
  map: Record<string, DiscoveredModel[] | Error | undefined>,
): { factory: ModelRegistryProviderFactory; discoverSpies: Record<string, ReturnType<typeof vi.fn>> } {
  const discoverSpies: Record<string, ReturnType<typeof vi.fn>> = {};
  const factory: ModelRegistryProviderFactory = {
    getProvider: (name: string) => {
      const entry = map[name];
      if (entry === undefined) return null;
      const spy = vi.fn(async () => {
        if (entry instanceof Error) throw entry;
        return entry;
      });
      discoverSpies[name] = spy;
      return { discoverModels: spy } as any;
    },
  };
  return { factory, discoverSpies };
}

function capsDefault(overrides: Partial<DiscoveredModel['capabilities']> = {}): DiscoveredModel['capabilities'] {
  return {
    chat: true,
    tools: true,
    streaming: true,
    vision: false,
    thinking: false,
    embeddings: false,
    imageGeneration: false,
    ...overrides,
  };
}

function mkDiscovered(id: string, capOverrides: Partial<DiscoveredModel['capabilities']> = {}): DiscoveredModel {
  return {
    id,
    name: id,
    provider: 'test',
    capabilities: capsDefault(capOverrides),
  };
}

// ---------------------------------------------------------------------------
// discoverFromProvider
// ---------------------------------------------------------------------------

describe('discoverFromProvider', () => {
  it('calls discoverModels() and returns normalized list', async () => {
    const discoverModels = vi.fn(async () => [mkDiscovered('gpt-oss:20b')]);
    const result = await discoverFromProvider({ discoverModels } as any);
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('gpt-oss:20b');
    expect(discoverModels).toHaveBeenCalledTimes(1);
  });

  it('falls back to listModels() when discoverModels is absent', async () => {
    const listModels = vi.fn(async () => [
      { id: 'gpt-oss:20b', name: 'gpt-oss:20b', provider: 'ollama' },
    ]);
    const result = await discoverFromProvider({ listModels } as any);
    expect(listModels).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result![0].id).toBe('gpt-oss:20b');
  });

  it('returns null (not throws) when discoverModels throws', async () => {
    const discoverModels = vi.fn(async () => { throw new Error('boom'); });
    const result = await discoverFromProvider({ discoverModels } as any);
    expect(result).toBeNull();
  });

  it('returns empty array when neither discoverModels nor listModels is available', async () => {
    const result = await discoverFromProvider({} as any);
    expect(result).toEqual([]);
  });

  it('normalizes capabilities from discovery result', async () => {
    const discoverModels = vi.fn(async () => [
      mkDiscovered('sonnet', { vision: true, thinking: true }),
    ]);
    const result = await discoverFromProvider({ discoverModels } as any);
    expect(result![0].capabilities.vision).toBe(true);
    expect(result![0].capabilities.thinking).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverAllProviderModels — informational, no DB writes
// ---------------------------------------------------------------------------

describe('discoverAllProviderModels', () => {
  it('returns empty array when no enabled providers exist', async () => {
    const { prisma } = makePrisma([]);
    const { factory } = makeFactory({});
    const result = await discoverAllProviderModels(prisma, factory);
    expect(result).toEqual([]);
  });

  it('returns discovered models for each enabled provider — no DB writes', async () => {
    const { prisma, findMany } = makePrisma([
      { id: 'ollama-id', name: 'ollama', provider_type: 'ollama' },
    ]);
    const { factory, discoverSpies } = makeFactory({
      ollama: [mkDiscovered('gpt-oss:20b'), mkDiscovered('nomic-embed-text', { chat: false, embeddings: true })],
    });

    const result = await discoverAllProviderModels(prisma, factory, silentLogger as any);

    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('ollama');
    expect(result[0].models).toHaveLength(2);
    expect(result[0].models.map((m) => m.id)).toEqual(['gpt-oss:20b', 'nomic-embed-text']);
    // findMany is read-only — no update calls
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(discoverSpies.ollama).toHaveBeenCalledTimes(1);
  });

  it('skips disabled providers (deleted_at filter)', async () => {
    const { prisma } = makePrisma([
      { id: 'off-id', name: 'openai', enabled: false },
    ]);
    const { factory, discoverSpies } = makeFactory({
      openai: [mkDiscovered('gpt-4o')],
    });

    const result = await discoverAllProviderModels(prisma, factory);

    expect(result).toEqual([]);
    expect(discoverSpies.openai).toBeUndefined();
  });

  it('skips provider when factory returns null — no error thrown', async () => {
    const { prisma } = makePrisma([
      { id: 'unknown-id', name: 'some-unknown-provider', provider_type: 'unknown' },
    ]);
    const { factory } = makeFactory({}); // factory doesn't know this provider

    const result = await discoverAllProviderModels(prisma, factory);

    expect(result).toEqual([]);
  });

  it('skips a provider that throws — continues to next provider without error', async () => {
    const { prisma } = makePrisma([
      { id: 'broken-id', name: 'aws-bedrock', priority: 1 },
      { id: 'good-id', name: 'ollama', priority: 2 },
    ]);
    const { factory } = makeFactory({
      'aws-bedrock': new Error('connection refused'),
      ollama: [mkDiscovered('gpt-oss:20b')],
    });

    const result = await discoverAllProviderModels(prisma, factory, silentLogger as any);

    // aws-bedrock threw — skipped. ollama succeeded.
    expect(result).toHaveLength(1);
    expect(result[0].providerName).toBe('ollama');
    expect(result[0].models).toHaveLength(1);
  });
});
