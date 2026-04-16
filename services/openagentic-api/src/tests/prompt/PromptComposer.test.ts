import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PromptModule, ComposeContext } from '../../services/prompt/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    prompt: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
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

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    promptModule: { findMany: vi.fn() },
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

// Mock ContextManagerService — return a predictable budget
vi.mock('../../services/context/ContextManagerService.js', () => ({
  ContextManagerService: {
    getInstance: vi.fn().mockReturnValue({
      getBudget: vi.fn().mockResolvedValue({
        systemPrompt: 8192,
        tools: 4096,
        history: 16384,
        response: 8192,
        total: 36864,
      }),
    }),
  },
}));

// Mock UniversalEmbeddingService — no real embeddings in unit tests
vi.mock('../../services/UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: {
    getInstance: vi.fn().mockReturnValue({
      generateEmbedding: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModule(overrides: Partial<PromptModule> = {}): PromptModule {
  return {
    id: `uuid-${Math.random()}`,
    name: 'test-module',
    category: 'domain',
    content: 'Some guidance content here.',
    description: 'A test module.',
    priority: 50,
    tokenCost: 50,
    enabled: true,
    injection: {},
    version: 1,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ComposeContext> = {}): ComposeContext {
  return {
    message: 'Help me optimize my cloud costs',
    mode: 'chat',
    model: 'claude-sonnet-4-6',
    availableTools: [],
    userId: 'user-1',
    sessionId: 'session-1',
    sliderPosition: 50,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PromptComposer', () => {
  let composer: any;
  let registry: any;
  let prismaModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import registry module and set up mock DB rows
    const registryMod = await import('../../services/prompt/PromptModuleRegistry.js');
    registry = registryMod.PromptModuleRegistry.createForTest(0); // no cache

    prismaModule = await import('../../utils/prisma.js');

    // Import PromptComposer and patch its registry with our test instance
    const composerMod = await import('../../services/prompt/PromptComposer.js');

    // Use a fresh instance for each test (reset singleton)
    (composerMod.PromptComposer as any).instance = undefined;
    composer = composerMod.PromptComposer.getInstance();
    // Replace registry with test instance
    (composer as any).registry = registry;
  });

  // ── Module selection ────────────────────────────────────────────────────────

  describe('core + mode module selection', () => {
    it('includes core modules with alwaysInject in output', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic AI.',
          description: 'Platform identity', priority: 100, token_cost: 20, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'mode-1', name: 'chat-mode', category: 'mode', content: 'Respond conversationally.',
          description: 'Chat mode behaviour', priority: 80, token_cost: 15, enabled: true,
          injection: { requiresMode: ['chat'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext({ mode: 'chat' }));

      expect(result.modulesUsed).toContain('identity');
      expect(result.modulesUsed).toContain('chat-mode');
    });

    it('excludes mode modules not matching current mode', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'mode-chat', name: 'chat-mode', category: 'mode', content: 'Chat guidance.',
          description: 'Chat', priority: 80, token_cost: 10, enabled: true,
          injection: { requiresMode: ['chat'] }, variants: null, version: 1,
        },
        {
          id: 'mode-code', name: 'code-mode', category: 'mode', content: 'Code guidance.',
          description: 'Code', priority: 80, token_cost: 10, enabled: true,
          injection: { requiresMode: ['code'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext({ mode: 'code' }));

      expect(result.modulesUsed).toContain('code-mode');
      expect(result.modulesUsed).not.toContain('chat-mode');
    });

    it('simple message with no tool context → only core + mode modules (no domain)', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'mode-1', name: 'chat-mode', category: 'mode', content: 'Chat guidance.',
          description: 'Chat', priority: 80, token_cost: 10, enabled: true,
          injection: { requiresMode: ['chat'] }, variants: null, version: 1,
        },
        {
          id: 'dom-1', name: 'azure-ops', category: 'domain', content: 'Azure guidance.',
          description: 'Azure ops', priority: 50, token_cost: 100, enabled: true,
          injection: { requiresTools: ['azure_*'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      // No tools available, generic message → azure-ops should score < 0.1
      const result = await composer.compose(makeContext({
        message: 'Hello, how are you?',
        availableTools: [],
      }));

      expect(result.modulesUsed).toContain('identity');
      expect(result.modulesUsed).toContain('chat-mode');
      expect(result.modulesUsed).not.toContain('azure-ops');
    });
  });

  describe('domain module selection with tools', () => {
    it('includes azure-ops when azure tools available', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'dom-azure', name: 'azure-ops', category: 'domain', content: 'Azure guidance here.',
          description: 'Azure ops domain', priority: 50, token_cost: 100, enabled: true,
          injection: { requiresTools: ['azure_*'] }, variants: null, version: 1,
        },
        {
          id: 'dom-aws', name: 'aws-cost', category: 'domain', content: 'AWS cost guidance.',
          description: 'AWS cost domain', priority: 50, token_cost: 100, enabled: true,
          injection: { requiresTools: ['aws_*'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext({
        availableTools: [
          { name: 'azure_list_vms' },
          { name: 'azure_get_cost' },
        ],
      }));

      expect(result.modulesUsed).toContain('azure-ops');
      expect(result.modulesUsed).not.toContain('aws-cost');
    });
  });

  describe('slider budget control', () => {
    it('slider at <=30 → very limited domain budget (max ~20% of free tokens)', async () => {
      // Each domain module costs 1000 tokens; budget is ~8192 with 10 core reserved
      // 20% of (8192 - 10) ≈ 1636 → fits at most 1 domain module at 1000 tokens each
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        ...['a', 'b', 'c', 'd', 'e'].map((l) => ({
          id: `dom-${l}`, name: `domain-${l}`, category: 'domain',
          content: 'x'.repeat(3500), // ~1000 tokens
          description: 'Domain guidance', priority: 50, token_cost: 1000, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        })),
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext({ sliderPosition: 20 }));
      const domainCount = result.modulesUsed.filter((n: string) => n.startsWith('domain-')).length;

      // 20% of (8192 - 10) = 1636 tokens for domain → at most 1 module at 1000 tokens
      expect(domainCount).toBeLessThanOrEqual(1);
    });

    it('slider at >70 → full domain budget (up to 100% of free tokens)', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        // 3 small domain modules, each 50 tokens — all should fit at 100% budget
        ...['a', 'b', 'c'].map((l) => ({
          id: `dom-${l}`, name: `domain-${l}`, category: 'domain',
          content: 'Short domain guidance.',
          description: 'Domain guidance', priority: 50, token_cost: 50, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        })),
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext({ sliderPosition: 100 }));
      const domainCount = result.modulesUsed.filter((n: string) => n.startsWith('domain-')).length;

      // 100% of (8192 - 10) = 8182 tokens for domain → all 3 at 50 tokens each fit easily
      expect(domainCount).toBe(3);
    });
  });

  describe('capability modules', () => {
    it('includes thinking-guidance when model supports thinking', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'Core.',
          description: 'Core', priority: 100, token_cost: 5, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'cap-1', name: 'thinking-guidance', category: 'capability', content: 'Think step by step.',
          description: 'Thinking capability guidance', priority: 70, token_cost: 20, enabled: true,
          injection: { requiresCapabilities: ['thinking'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      // Claude models have thinking=true
      const result = await composer.compose(makeContext({ model: 'claude-sonnet-4-6' }));

      expect(result.modulesUsed).toContain('thinking-guidance');
      expect(result.capabilitiesDetected).toContain('thinking');
    });

    it('excludes thinking-guidance for non-thinking models', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'Core.',
          description: 'Core', priority: 100, token_cost: 5, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'cap-1', name: 'thinking-guidance', category: 'capability', content: 'Think step by step.',
          description: 'Thinking capability guidance', priority: 70, token_cost: 20, enabled: true,
          injection: { requiresCapabilities: ['thinking'] }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      // Llama model: local family, thinking=false
      const result = await composer.compose(makeContext({ model: 'llama-3.1-70b' }));

      expect(result.modulesUsed).not.toContain('thinking-guidance');
    });
  });

  describe('ComposedPrompt structure', () => {
    it('returns all required fields in ComposedPrompt', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext());

      expect(result).toMatchObject({
        systemPrompt: expect.any(String),
        modulesUsed: expect.any(Array),
        tokenCount: expect.any(Number),
        budgetUsed: expect.any(Number),
        budgetRemaining: expect.any(Number),
        modelFamily: expect.any(String),
        capabilitiesDetected: expect.any(Array),
      });
    });

    it('systemPrompt is a non-empty string', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext());

      expect(result.systemPrompt.length).toBeGreaterThan(0);
    });

    it('tokenCount equals budgetUsed', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic AI.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext());

      expect(result.tokenCount).toBe(result.budgetUsed);
    });

    it('budgetUsed + budgetRemaining equals systemPromptBudget from ContextManagerService', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'Short.',
          description: 'Core', priority: 100, token_cost: 2, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext());

      // ContextManagerService mock returns systemPrompt: 8192
      expect(result.budgetUsed + result.budgetRemaining).toBe(8192);
    });

    it('modelFamily is correct for claude models', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([]);

      const result = await composer.compose(makeContext({ model: 'claude-opus-4-6' }));

      expect(result.modelFamily).toBe('claude');
    });

    it('modelFamily is correct for gemini models', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([]);

      const result = await composer.compose(makeContext({ model: 'gemini-2.5-pro' }));

      expect(result.modelFamily).toBe('gemini');
    });

    it('capabilitiesDetected contains only true capability names', async () => {
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue([]);

      const result = await composer.compose(makeContext({ model: 'claude-sonnet-4-6' }));

      // All detected capabilities should be truthy
      expect(result.capabilitiesDetected.length).toBeGreaterThan(0);
      // Known claude capabilities
      expect(result.capabilitiesDetected).toContain('thinking');
      expect(result.capabilitiesDetected).toContain('tools');
      expect(result.capabilitiesDetected).toContain('vision');
    });
  });

  describe('disabled modules excluded', () => {
    it('disabled core modules are not included', async () => {
      const rows = [
        {
          id: 'core-1', name: 'identity', category: 'core', content: 'You are OpenAgentic.',
          description: 'Core', priority: 100, token_cost: 10, enabled: true,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
        {
          id: 'core-2', name: 'disabled-core', category: 'core', content: 'Disabled.',
          description: 'Disabled core', priority: 90, token_cost: 10, enabled: false,
          injection: { alwaysInject: true }, variants: null, version: 1,
        },
      ];
      (prismaModule.prisma.promptModule.findMany as any).mockResolvedValue(rows);

      const result = await composer.compose(makeContext());

      expect(result.modulesUsed).not.toContain('disabled-core');
    });
  });
});
