import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import {
  validatePutBody, getDefaults, putDefaults, loadRegisteredIds,
  type AdminPrismaLike,
} from '../defaultModelsAdmin.js';
const silentLogger = pino({ level: 'silent' });

function makePrisma(opts: {
  initialDefaults?: any;
  providers?: Array<{ name: string; enabled?: boolean; models: any[] }>;
} = {}) {
  const store = new Map<string, any>();
  if (opts.initialDefaults !== undefined) {
    store.set('default_models', opts.initialDefaults);
  }
  const providers = opts.providers ?? [];

  const prisma: AdminPrismaLike = {
    systemConfiguration: {
      findUnique: vi.fn(async ({ where }: any) => {
        const v = store.get(where.key);
        return v !== undefined ? { value: v } : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        if (store.has(where.key)) store.set(where.key, update.value);
        else store.set(where.key, create.value);
        return { value: store.get(where.key) };
      }),
    },
    lLMProvider: {
      findMany: vi.fn(async () => providers.map((p) => ({
        name: p.name,
        enabled: p.enabled !== false,
        provider_config: { models: p.models },
      }))),
    },
  };
  return { prisma, store };
}

describe('validatePutBody', () => {
  it('accepts a partial body with chat only', () => {
    expect(validatePutBody({ chat: 'gpt-oss:20b' })).toBeNull();
  });
  it('accepts null for a mode (clearing the default)', () => {
    expect(validatePutBody({ vision: null })).toBeNull();
  });
  it('accepts an empty body (no-op PUT)', () => {
    expect(validatePutBody({})).toBeNull();
  });
  it('rejects non-object bodies', () => {
    expect(validatePutBody('oops' as any)?.code).toBe(400);
    expect(validatePutBody(null as any)?.code).toBe(400);
  });
  it('rejects empty-string model ids', () => {
    const e = validatePutBody({ chat: '' });
    expect(e?.code).toBe(400);
    expect(e?.error).toBe('INVALID_MODEL_ID');
  });
  it('rejects non-string model ids', () => {
    const e = validatePutBody({ chat: 42 as any });
    expect(e?.code).toBe(400);
  });
  it('rejects ids > 200 chars', () => {
    const e = validatePutBody({ chat: 'x'.repeat(201) });
    expect(e?.code).toBe(400);
  });
});

describe('getDefaults', () => {
  it('returns all-null when no row exists', async () => {
    const { prisma } = makePrisma();
    expect(await getDefaults(prisma)).toEqual({
      chat: null, code: null, embedding: null, vision: null, imageGen: null,
    });
  });
  it('returns stored values when row exists', async () => {
    const { prisma } = makePrisma({
      initialDefaults: { chat: 'gpt-oss:20b', code: 'c', embedding: 'e', vision: 'v', imageGen: 'i' },
    });
    const d = await getDefaults(prisma);
    expect(d.chat).toBe('gpt-oss:20b');
    expect(d.imageGen).toBe('i');
  });
  it('normalizes non-string values to null', async () => {
    const { prisma } = makePrisma({
      initialDefaults: { chat: 'gpt-oss:20b', code: 42, embedding: true, vision: {} },
    });
    const d = await getDefaults(prisma);
    expect(d.chat).toBe('gpt-oss:20b');
    expect(d.code).toBeNull();
    expect(d.embedding).toBeNull();
    expect(d.vision).toBeNull();
  });
});

describe('loadRegisteredIds', () => {
  it('returns canonical ids from all enabled providers', async () => {
    const { prisma } = makePrisma({
      providers: [
        { name: 'bedrock', models: [{ id: 'us.anthropic.claude-sonnet-4-6' }, { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }] },
        { name: 'ollama',  models: [{ id: 'gpt-oss:20b' }] },
      ],
    });
    const ids = await loadRegisteredIds(prisma);
    expect(ids.has('us.anthropic.claude-sonnet-4-6')).toBe(true);
    expect(ids.has('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true);
    expect(ids.has('gpt-oss:20b')).toBe(true);
  });
  it('includes aliases', async () => {
    const { prisma } = makePrisma({
      providers: [
        { name: 'bedrock', models: [{ id: 'us.anthropic.claude-sonnet-4-6', aliases: ['claude-sonnet-4-6', 'sonnet'] }] },
      ],
    });
    const ids = await loadRegisteredIds(prisma);
    expect(ids.has('claude-sonnet-4-6')).toBe(true);
    expect(ids.has('sonnet')).toBe(true);
  });
});

describe('putDefaults', () => {
  describe('happy path', () => {
    it('upserts and reports changed modes', async () => {
      const { prisma } = makePrisma({
        providers: [{ name: 'ollama', models: [{ id: 'gpt-oss:20b' }] }],
      });
      const r = await putDefaults(prisma, silentLogger, { chat: 'gpt-oss:20b' });
      if (!('ok' in r) || !r.ok) throw new Error('expected success');
      expect(r.changed).toEqual(['chat']);
      expect(r.defaults.chat).toBe('gpt-oss:20b');
      expect(prisma.systemConfiguration.upsert).toHaveBeenCalledTimes(1);
    });

    it('preserves untouched modes when PUT is partial', async () => {
      const { prisma } = makePrisma({
        initialDefaults: { chat: 'old-chat', code: 'old-code', embedding: null, vision: null, imageGen: null },
        providers: [
          { name: 'ollama', models: [{ id: 'gpt-oss:20b' }] },
          { name: 'bedrock', models: [{ id: 'us.anthropic.claude-sonnet-4-6' }, { id: 'old-chat' }, { id: 'old-code' }] },
        ],
      });
      const r = await putDefaults(prisma, silentLogger, { chat: 'gpt-oss:20b' });
      if (!('ok' in r) || !r.ok) throw new Error('expected success');
      expect(r.defaults.chat).toBe('gpt-oss:20b');
      expect(r.defaults.code).toBe('old-code');
      expect(r.changed).toEqual(['chat']);
    });

    it('allows clearing a default with null', async () => {
      const { prisma } = makePrisma({
        initialDefaults: { chat: 'gpt-oss:20b' },
      });
      const r = await putDefaults(prisma, silentLogger, { chat: null });
      if (!('ok' in r) || !r.ok) throw new Error('expected success');
      expect(r.defaults.chat).toBeNull();
      expect(r.changed).toEqual(['chat']);
    });

    it('is idempotent when body matches current state', async () => {
      const { prisma } = makePrisma({
        initialDefaults: { chat: 'gpt-oss:20b', code: null, embedding: null, vision: null, imageGen: null },
        providers: [{ name: 'ollama', models: [{ id: 'gpt-oss:20b' }] }],
      });
      const r = await putDefaults(prisma, silentLogger, { chat: 'gpt-oss:20b' });
      if (!('ok' in r) || !r.ok) throw new Error('expected success');
      expect(r.changed).toEqual([]);
      expect(prisma.systemConfiguration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('returns 400 for empty-string model id', async () => {
      const { prisma } = makePrisma();
      const r = await putDefaults(prisma, silentLogger, { chat: '' });
      expect((r as any).code).toBe(400);
      expect((r as any).error).toBe('INVALID_MODEL_ID');
    });
  });

  describe('registry enforcement', () => {
    it('rejects a PUT pointing at an unregistered model with 422', async () => {
      const { prisma } = makePrisma({
        providers: [{ name: 'ollama', models: [{ id: 'gpt-oss:20b' }] }],
      });
      const r = await putDefaults(prisma, silentLogger, { chat: 'us.anthropic.claude-sonnet-4-6' });
      expect((r as any).code).toBe(422);
      expect((r as any).error).toBe('UNREGISTERED_MODEL');
      expect(prisma.systemConfiguration.upsert).not.toHaveBeenCalled();
    });

    it('allowUnregistered: true bypasses the check (force flag)', async () => {
      const { prisma } = makePrisma({
        providers: [{ name: 'ollama', models: [{ id: 'gpt-oss:20b' }] }],
      });
      const r = await putDefaults(
        prisma, silentLogger,
        { chat: 'us.anthropic.claude-sonnet-4-6' },
        { allowUnregistered: true },
      );
      expect((r as any).ok).toBe(true);
    });

    it('accepts an alias that matches a registered model', async () => {
      const { prisma } = makePrisma({
        providers: [{
          name: 'bedrock',
          models: [{ id: 'us.anthropic.claude-sonnet-4-6', aliases: ['claude-sonnet-4-6'] }],
        }],
      });
      const r = await putDefaults(prisma, silentLogger, { chat: 'claude-sonnet-4-6' });
      expect((r as any).ok).toBe(true);
    });

    it('does NOT enforce registry when clearing a default (null value)', async () => {
      const { prisma } = makePrisma({
        initialDefaults: { chat: 'gpt-oss:20b' },
        providers: [{ name: 'ollama', models: [] }], // empty registry
      });
      const r = await putDefaults(prisma, silentLogger, { chat: null });
      expect((r as any).ok).toBe(true);
      expect((r as any).defaults.chat).toBeNull();
    });
  });
});

// ============================================================================
// T-A: Stage-specific tests — code category + ModelConfigurationService
// ============================================================================

describe('T-A: code category in getDefaults', () => {
  it('GET returns default_models including code (null when unset)', async () => {
    const { prisma } = makePrisma({
      initialDefaults: { chat: 'gpt-oss:20b', embedding: null, vision: null, imageGen: null },
    });
    const d = await getDefaults(prisma);
    expect('code' in d).toBe(true);
    expect(d.code).toBeNull();
  });

  it('GET returns code when set in default_models JSON', async () => {
    const { prisma } = makePrisma({
      initialDefaults: { chat: 'gpt-oss:20b', code: 'my-code-model', embedding: null, vision: null, imageGen: null },
    });
    const d = await getDefaults(prisma);
    expect(d.code).toBe('my-code-model');
  });
});

describe('T-A: PUT code category with registry validation', () => {
  it('PUT { code: valid-registry-model } succeeds', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'ollama', models: [{ id: 'my-code-model' }] }],
    });
    const r = await putDefaults(prisma, silentLogger, { code: 'my-code-model' });
    expect((r as any).ok).toBe(true);
    expect((r as any).defaults.code).toBe('my-code-model');
    expect((r as any).changed).toContain('code');
  });

  it('PUT { code: not-in-registry } returns 422 UNREGISTERED_MODEL', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'ollama', models: [{ id: 'gpt-oss:20b' }] }],
    });
    const r = await putDefaults(prisma, silentLogger, { code: 'not-in-registry' });
    expect((r as any).ok).toBe(false);
    expect((r as any).code).toBe(422);
    expect((r as any).error).toBe('UNREGISTERED_MODEL');
    expect(prisma.systemConfiguration.upsert).not.toHaveBeenCalled();
  });

  it('PUT { code: null } clears the code default without registry check', async () => {
    const { prisma } = makePrisma({
      initialDefaults: { chat: 'gpt-oss:20b', code: 'some-model', embedding: null, vision: null, imageGen: null },
      providers: [], // empty registry — no check needed for null
    });
    const r = await putDefaults(prisma, silentLogger, { code: null });
    expect((r as any).ok).toBe(true);
    expect((r as any).defaults.code).toBeNull();
  });

  it('PUT { chat: disabled-registry-model } (enabled=false) returns 422 — disabled models not in loadRegisteredIds', async () => {
    // loadRegisteredIds queries enabled=true providers; if provider is disabled, its models won't appear
    const { prisma } = makePrisma({
      providers: [
        // No providers with the disabled model
        { name: 'ollama', models: [{ id: 'gpt-oss:20b' }] },
      ],
    });
    // 'disabled-registry-model' is not in any enabled provider's models
    const r = await putDefaults(prisma, silentLogger, { chat: 'disabled-registry-model' });
    expect((r as any).code).toBe(422);
    expect((r as any).error).toBe('UNREGISTERED_MODEL');
  });
});

describe('T-A: ModelConfigurationService.getDefaultCodeModel', () => {
  it('returns default_models.code when set', async () => {
    // Dynamic import to avoid caching issues with prisma mock
    const { ModelConfigurationService } = await import('../../ModelConfigurationService.js');
    const prismaModule = await import('../../../utils/prisma.js');
    const spy = vi.spyOn(prismaModule.prisma.systemConfiguration, 'findUnique' as any)
      .mockResolvedValue({ value: { chat: 'gpt-oss:20b', code: 'my-code-model' } } as any);

    const result = await ModelConfigurationService.getDefaultCodeModel();
    expect(result).toBe('my-code-model');

    spy.mockRestore();
  });

  it('falls through to chat default when default_models.code is null', async () => {
    const { ModelConfigurationService } = await import('../../ModelConfigurationService.js');
    const prismaModule = await import('../../../utils/prisma.js');
    const spy = vi.spyOn(prismaModule.prisma.systemConfiguration, 'findUnique' as any)
      .mockResolvedValue({ value: { chat: 'gpt-oss:20b', code: null } } as any);

    const result = await ModelConfigurationService.getDefaultCodeModel();
    expect(result).toBe('gpt-oss:20b');

    spy.mockRestore();
  });
});
