/**
 * ModelRouter — unit tests covering the full resolve() decision matrix.
 *
 * Uses a plain in-memory ModelRegistry (bypassing Prisma) so each test case
 * declares its own tiny registry state and asserts resolve() output exactly.
 * No network, no DB, no mocking framework beyond vitest's built-ins.
 *
 * Test matrix aligns with docs/core/model-routing-rewrite.md §8.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { ModelRegistry, type PrismaLike } from '../ModelRegistry.js';
import { ModelRouter } from '../ModelRouter.js';
import {
  UnknownModelError, CapabilityMismatchError, UnhealthyProviderError, DefaultNotConfiguredError,
} from '../types.js';

const silentLogger = pino({ level: 'silent' });

interface ProviderFixture {
  name: string;
  provider_type: string;
  status?: 'active' | 'error' | 'paused';
  priority?: number;
  models: any[];
  capabilities?: any;
}

function buildPrisma(
  providers: ProviderFixture[],
  defaults: Record<string, string | null> | null = null,
): PrismaLike {
  return {
    lLMProvider: {
      async findMany() {
        return providers.map((p, i) => ({
          id: `prov-${i}`,
          name: p.name,
          provider_type: p.provider_type,
          enabled: true,
          priority: p.priority ?? i + 1,
          status: p.status ?? 'active',
          provider_config: { models: p.models },
          capabilities: p.capabilities ?? {},
          deleted_at: null,
        }));
      },
    },
    systemConfiguration: {
      async findUnique(args: any) {
        if (args?.where?.key === 'default_models') {
          return defaults ? { value: defaults } : null;
        }
        return null;
      },
    },
  };
}

async function buildRouter(
  providers: ProviderFixture[],
  defaults: Record<string, string | null> | null = null,
): Promise<ModelRouter> {
  const prisma = buildPrisma(providers, defaults);
  const registry = new ModelRegistry(prisma, silentLogger);
  await registry.invalidate(); // force load
  return new ModelRouter({ registry, logger: silentLogger });
}

const chatModel = (id: string, extra: any = {}) => ({
  id,
  aliases: extra.aliases ?? [],
  capabilities: { chat: true, tools: true, streaming: true, ...(extra.capabilities ?? {}) },
  ...extra,
});

describe('ModelRouter.resolve', () => {
  describe('explicit pin', () => {
    it('honors an exact canonical match', async () => {
      const router = await buildRouter([
        { name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'gpt-oss:20b',
      });
      expect(r.modelId).toBe('gpt-oss:20b');
      expect(r.providerName).toBe('ollama');
      expect(r.resolvedBy).toBe('explicit-pin');
    });

    it('honors an explicit alias', async () => {
      const router = await buildRouter([
        {
          name: 'bedrock', provider_type: 'aws-bedrock',
          models: [chatModel('us.anthropic.claude-sonnet-4-6', { aliases: ['claude-sonnet-4-6'] })],
        },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'claude-sonnet-4-6',
      });
      expect(r.modelId).toBe('us.anthropic.claude-sonnet-4-6');
      expect(r.resolvedBy).toBe('explicit-pin');
    });

    it('throws UnknownModelError with suggestions for unregistered model', async () => {
      const router = await buildRouter([
        { name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] },
      ]);
      await expect(router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'gpt-oss-20b',  // typo: dash not colon
      })).rejects.toMatchObject({
        name: 'UnknownModelError',
        http: 400,
        suggestions: ['gpt-oss:20b'],
      });
    });

    it('is case-insensitive for aliases', async () => {
      const router = await buildRouter([
        {
          name: 'aif', provider_type: 'azure-ai-foundry',
          models: [chatModel('gpt-5.2', { aliases: ['GPT-5.2'] })],
        },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'gpt-5.2',
      });
      expect(r.modelId).toBe('gpt-5.2');
    });
  });

  describe('session + tenant default', () => {
    it('falls back to session model when no pin', async () => {
      const router = await buildRouter([
        { name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', sessionModel: 'gpt-oss:20b',
      });
      expect(r.resolvedBy).toBe('session');
      expect(r.modelId).toBe('gpt-oss:20b');
    });

    it('falls back to tenant default when no pin + no session', async () => {
      const router = await buildRouter(
        [{ name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] }],
        { chat: 'gpt-oss:20b' },
      );
      const r = await router.resolve({ userId: 'u1', mode: 'chat' });
      expect(r.resolvedBy).toBe('tenant-default');
      expect(r.modelId).toBe('gpt-oss:20b');
    });

    it('throws DefaultNotConfiguredError when tenant default is unset', async () => {
      const router = await buildRouter(
        [{ name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] }],
        null,
      );
      await expect(router.resolve({ userId: 'u1', mode: 'chat' }))
        .rejects.toMatchObject({ name: 'DefaultNotConfiguredError', http: 503, mode: 'chat' });
    });

    it('pin > session > default ordering', async () => {
      const router = await buildRouter(
        [{
          name: 'multi', provider_type: 'aws-bedrock',
          models: [chatModel('a'), chatModel('b'), chatModel('c')],
        }],
        { chat: 'c' },
      );
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'a', sessionModel: 'b',
      });
      expect(r.modelId).toBe('a');
      expect(r.resolvedBy).toBe('explicit-pin');
    });
  });

  describe('capability + mode gates', () => {
    it('rejects a tool-required request against a non-tool model', async () => {
      const router = await buildRouter([
        {
          name: 'emb', provider_type: 'ollama',
          models: [chatModel('nomic-embed', { capabilities: { chat: false, tools: false, embeddings: true } })],
        },
      ]);
      await expect(router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'nomic-embed', requires: { tools: true },
      })).rejects.toMatchObject({
        name: 'CapabilityMismatchError',
        http: 400,
      });
    });

    it('rejects an embedding model for chat mode', async () => {
      const router = await buildRouter([
        {
          name: 'emb', provider_type: 'ollama',
          models: [chatModel('nomic-embed', {
            capabilities: { chat: false, tools: false, embeddings: true },
            enabledForChat: false,
          })],
        },
      ]);
      await expect(router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'nomic-embed',
      })).rejects.toMatchObject({ name: 'CapabilityMismatchError' });
    });

    it('accepts an embedding model for embedding mode', async () => {
      const router = await buildRouter([
        {
          name: 'emb', provider_type: 'ollama',
          models: [chatModel('nomic-embed', {
            capabilities: { chat: false, tools: false, streaming: false, embeddings: true },
            enabledForChat: false,
          })],
        },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'embedding', requestedModel: 'nomic-embed',
      });
      expect(r.modelId).toBe('nomic-embed');
    });
  });

  describe('provider health', () => {
    it('cascades to declared fallback when primary provider is unhealthy', async () => {
      const router = await buildRouter([
        {
          name: 'bedrock', provider_type: 'aws-bedrock', status: 'error', priority: 1,
          models: [chatModel('sonnet', { fallbackIds: ['gpt-5.2'] })],
        },
        {
          name: 'aif', provider_type: 'azure-ai-foundry', status: 'active', priority: 2,
          models: [chatModel('gpt-5.2')],
        },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'sonnet',
      });
      expect(r.resolvedBy).toBe('fallback');
      expect(r.modelId).toBe('gpt-5.2');
      expect(r.providerName).toBe('aif');
      expect(r.reason).toMatch(/unhealthy/);
    });

    it('throws UnhealthyProviderError when no fallback is declared', async () => {
      const router = await buildRouter([
        {
          name: 'bedrock', provider_type: 'aws-bedrock', status: 'error',
          models: [chatModel('sonnet')],
        },
      ]);
      await expect(router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'sonnet',
      })).rejects.toMatchObject({
        name: 'UnhealthyProviderError',
        http: 503,
        providerName: 'bedrock',
      });
    });

    it('throws UnhealthyProviderError when every fallback is also unhealthy', async () => {
      const router = await buildRouter([
        {
          name: 'p1', provider_type: 'aws-bedrock', status: 'error',
          models: [chatModel('a', { fallbackIds: ['b'] })],
        },
        {
          name: 'p2', provider_type: 'anthropic', status: 'error',
          models: [chatModel('b')],
        },
      ]);
      await expect(router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'a',
      })).rejects.toMatchObject({ name: 'UnhealthyProviderError' });
    });

    it('skips a fallback that doesn\'t satisfy required capabilities', async () => {
      const router = await buildRouter([
        {
          name: 'p1', provider_type: 'aws-bedrock', status: 'error',
          models: [chatModel('a', { fallbackIds: ['no-tools', 'yes-tools'] })],
        },
        {
          name: 'p2', provider_type: 'ollama', status: 'active',
          models: [chatModel('no-tools', { capabilities: { chat: true, tools: false, streaming: true } })],
        },
        {
          name: 'p3', provider_type: 'anthropic', status: 'active',
          models: [chatModel('yes-tools', { capabilities: { chat: true, tools: true, streaming: true } })],
        },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'a', requires: { tools: true },
      });
      expect(r.modelId).toBe('yes-tools');
    });
  });

  describe('priority tiebreaker', () => {
    it('first provider by priority wins when the same id is registered twice', async () => {
      const router = await buildRouter([
        { name: 'p1', provider_type: 'anthropic', priority: 1, models: [chatModel('claude')] },
        { name: 'p2', provider_type: 'aws-bedrock', priority: 2, models: [chatModel('claude')] },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'claude',
      });
      expect(r.providerName).toBe('p1');
    });
  });

  describe('logging + immutability', () => {
    it('emits a structured router.resolve log on every decision', async () => {
      const spy = vi.fn();
      const logger = pino({ level: 'info' }, { write: (msg) => { spy(JSON.parse(msg)); } });
      const prisma = buildPrisma([
        { name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] },
      ]);
      const registry = new ModelRegistry(prisma, pino({ level: 'silent' }));
      await registry.invalidate();
      const router = new ModelRouter({ registry, logger });
      await router.resolve({ userId: 'alice', mode: 'chat', requestedModel: 'gpt-oss:20b' });

      const hit = spy.mock.calls.map((c) => c[0]).find((o) => o.event === 'router.resolve');
      expect(hit).toBeDefined();
      expect(hit.userId).toBe('alice');
      expect(hit.resolvedModelId).toBe('gpt-oss:20b');
      expect(hit.resolvedProvider).toBe('ollama');
      expect(hit.resolvedBy).toBe('explicit-pin');
      expect(typeof hit.durationMs).toBe('number');
    });

    it('returns a frozen output', async () => {
      const router = await buildRouter([
        { name: 'ollama', provider_type: 'ollama', models: [chatModel('gpt-oss:20b')] },
      ]);
      const r = await router.resolve({
        userId: 'u1', mode: 'chat', requestedModel: 'gpt-oss:20b',
      });
      expect(Object.isFrozen(r)).toBe(true);
      expect(() => { (r as any).modelId = 'tampered'; }).toThrow();
    });
  });
});

describe('ModelRouter.list', () => {
  it('returns only models enabled for the mode with availability flagged', async () => {
    const router = await buildRouter([
      { name: 'ollama', provider_type: 'ollama', status: 'active',
        models: [chatModel('gpt-oss:20b')] },
      { name: 'bedrock', provider_type: 'aws-bedrock', status: 'error',
        models: [chatModel('sonnet')] },
    ]);
    const list = await router.list('chat');
    expect(list.map((m) => m.id).sort()).toEqual(['gpt-oss:20b', 'sonnet']);
    expect(list.find((m) => m.id === 'gpt-oss:20b')!.available).toBe(true);
    expect(list.find((m) => m.id === 'sonnet')!.available).toBe(false);
  });

  it('filters by mode — embedding models don\'t appear in chat list unless chat-enabled', async () => {
    const router = await buildRouter([
      { name: 'p', provider_type: 'ollama', models: [
        chatModel('chat-only', { capabilities: { chat: true, tools: true, streaming: true } }),
        chatModel('emb-only', {
          capabilities: { chat: false, tools: false, streaming: false, embeddings: true },
          enabledForChat: false,
        }),
      ] },
    ]);
    const chat = await router.list('chat');
    const emb = await router.list('embedding');
    expect(chat.map((m) => m.id)).toEqual(['chat-only']);
    expect(emb.map((m) => m.id)).toEqual(['emb-only']);
  });
});
