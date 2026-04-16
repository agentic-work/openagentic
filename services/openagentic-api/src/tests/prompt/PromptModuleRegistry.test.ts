import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptModule } from '../../services/prompt/types.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    promptModule: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    promptModuleHistory: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(true),
    del: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    prompt: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// ── Test data ────────────────────────────────────────────────────────────────

const makeDbRow = (overrides: Partial<any> = {}) => ({
  id: 'uuid-1',
  name: 'identity',
  category: 'core',
  content: 'You are OpenAgentic.',
  description: 'Platform identity',
  priority: 100,
  token_cost: 6,
  enabled: true,
  injection: { alwaysInject: true },
  variants: { claude: '<module>...</module>', local: 'You are OpenAgentic.' },
  version: 1,
  ...overrides,
});

const makeModule = (overrides: Partial<PromptModule> = {}): PromptModule => ({
  id: 'uuid-1',
  name: 'identity',
  category: 'core',
  content: 'You are OpenAgentic.',
  description: 'Platform identity',
  priority: 100,
  tokenCost: 6,
  enabled: true,
  injection: { alwaysInject: true },
  variants: { claude: '<module>...</module>', local: 'You are OpenAgentic.' },
  version: 1,
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PromptModuleRegistry', () => {
  // Import after mocks are set up
  let registry: any;
  let prismaModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get fresh instance with cleared mocks
    const mod = await import('../../services/prompt/PromptModuleRegistry.js');
    const prismaUtil = await import('../../utils/prisma.js');
    prismaModule = prismaUtil;
    // Use factory to get a fresh instance (bypasses singleton for testing)
    registry = mod.PromptModuleRegistry.createForTest(0); // TTL=0 → no mem-cache
  });

  describe('getAll()', () => {
    it('returns modules mapped from DB rows', async () => {
      const rows = [
        makeDbRow({ id: 'uuid-1', name: 'identity', category: 'core' }),
        makeDbRow({ id: 'uuid-2', name: 'safety', category: 'core' }),
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await registry.getAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('uuid-1');
      expect(result[0].tokenCost).toBe(rows[0].token_cost);
      expect(result[1].name).toBe('safety');
    });

    it('maps snake_case DB fields to camelCase interface', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([makeDbRow()]);

      const [mod] = await registry.getAll();

      expect(mod).toHaveProperty('tokenCost');
      expect(mod).not.toHaveProperty('token_cost');
    });
  });

  describe('getEnabled()', () => {
    it('excludes disabled modules', async () => {
      const rows = [
        makeDbRow({ id: 'uuid-1', name: 'identity', enabled: true }),
        makeDbRow({ id: 'uuid-2', name: 'disabled-mod', enabled: false }),
        makeDbRow({ id: 'uuid-3', name: 'safety', enabled: true }),
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await registry.getEnabled();

      expect(result).toHaveLength(2);
      expect(result.every((m: PromptModule) => m.enabled)).toBe(true);
      expect(result.find((m: PromptModule) => m.name === 'disabled-mod')).toBeUndefined();
    });

    it('returns empty array when all disabled', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([
        makeDbRow({ enabled: false }),
      ]);

      const result = await registry.getEnabled();
      expect(result).toHaveLength(0);
    });
  });

  describe('getByCategory()', () => {
    it('filters modules by category', async () => {
      const rows = [
        makeDbRow({ id: 'uuid-1', name: 'identity', category: 'core' }),
        makeDbRow({ id: 'uuid-2', name: 'azure-ops', category: 'domain' }),
        makeDbRow({ id: 'uuid-3', name: 'safety', category: 'core' }),
        makeDbRow({ id: 'uuid-4', name: 'chat-mode', category: 'mode' }),
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const coreModules = await registry.getByCategory('core');
      const domainModules = await registry.getByCategory('domain');
      const modeModules = await registry.getByCategory('mode');
      const capModules = await registry.getByCategory('capability');

      expect(coreModules).toHaveLength(2);
      expect(domainModules).toHaveLength(1);
      expect(modeModules).toHaveLength(1);
      expect(capModules).toHaveLength(0);
    });
  });

  describe('getById()', () => {
    it('returns the matching module by id', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([
        makeDbRow({ id: 'target-id', name: 'identity' }),
        makeDbRow({ id: 'other-id', name: 'safety' }),
      ]);

      const result = await registry.getById('target-id');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('target-id');
    });

    it('returns null for unknown id', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([makeDbRow()]);

      const result = await registry.getById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('invalidateCache()', () => {
    it('clears in-memory cache so next call re-fetches from DB', async () => {
      // Use registry with normal TTL so mem-cache is active
      const cachedRegistry = (await import('../../services/prompt/PromptModuleRegistry.js'))
        .PromptModuleRegistry.createForTest(60000);

      const rows = [makeDbRow()];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      // First call — populates cache
      await cachedRegistry.getAll();
      expect(prismaModule.prisma.promptModule.findMany).toHaveBeenCalledTimes(1);

      // Second call — should use cache (no additional DB call)
      await cachedRegistry.getAll();
      expect(prismaModule.prisma.promptModule.findMany).toHaveBeenCalledTimes(1);

      // Invalidate
      cachedRegistry.invalidateCache();

      // Third call — should hit DB again
      await cachedRegistry.getAll();
      expect(prismaModule.prisma.promptModule.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
