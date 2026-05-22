/**
 * Tests for LLMProviderSeeder — the boot-time seeder that creates EXACTLY
 * ONE provider row (the bootstrap provider) on a fresh deploy.
 *
 * Contract (Registry SoT v1, F2.5 — supersedes task #294):
 *   - NAME empty          → skip entirely, no writes
 *   - NAME set + DB empty → create the one provider row, stamp seeder_managed=true
 *   - NAME set + DB has rows → skip (admin owns the space, don't re-seed)
 *   - NEVER write admin.model_role_assignments (Registry rows) — that's
 *     RegistryBootstrapSeeder's job in F2.5.
 *   - NEVER upsert admin.system_configuration.default_models — DefaultModelsSeeder
 *     was deleted in F2.3; system_configuration is no longer a SoT.
 *   - NEVER seed additional providers from env — AWS_BEDROCK_ENABLED,
 *     VERTEX_AI_ENABLED, etc. are NOT provider seed gates anymore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock calls are hoisted; the factory closure can't reference outer-scope
// consts. We stash the mocks on globalThis so tests can reach them.
vi.mock('../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    systemConfiguration: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    modelRoleAssignment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  };
  (globalThis as any).__prismaMock = mock;
  return { prisma: mock };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// encryptAuthConfig is a pure pass-through for the sake of these tests —
// the real one AES-encrypts sensitive fields, but the seeder doesn't care
// about the result (it just hands off to Prisma).
vi.mock('../llm-providers/CredentialEncryptionService.js', () => ({
  encryptAuthConfig: (x: any) => ({ __encrypted: true, ...x }),
}));

import { seedLLMProviders } from '../LLMProviderSeeder.js';
const prismaMock = (globalThis as any).__prismaMock as {
  lLMProvider: { findMany: any; findUnique: any; create: any; update: any; count: any };
  systemConfiguration: { findUnique: any; upsert: any };
  modelRoleAssignment: { findMany: any; findFirst: any; create: any; update: any };
  user: { findUnique: any };
};

describe('seedLLMProviders (bootstrap provider contract, task #294)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    // Defaults for the mocks: DB empty, nothing exists.
    prismaMock.lLMProvider.findMany.mockResolvedValue([]);
    prismaMock.lLMProvider.findUnique.mockResolvedValue(null);
    prismaMock.lLMProvider.count.mockResolvedValue(0);
    prismaMock.lLMProvider.create.mockImplementation(async (args: any) => ({
      id: 'new-provider-id',
      ...args.data,
    }));
    prismaMock.systemConfiguration.findUnique.mockResolvedValue(null);
    prismaMock.systemConfiguration.upsert.mockImplementation(async (args: any) => ({ value: args.create?.value ?? args.update?.value }));
    prismaMock.modelRoleAssignment.findMany.mockResolvedValue([]);
    prismaMock.modelRoleAssignment.findFirst.mockResolvedValue(null);
    prismaMock.modelRoleAssignment.create.mockImplementation(async (args: any) => ({ id: 'new-assignment-id', ...args.data }));
    prismaMock.modelRoleAssignment.update.mockImplementation(async (args: any) => ({ id: args.where.id, ...args.data }));
    // Default: admin user exists so Registry upsert tests can proceed.
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-user-id', email: 'admin@openagentic.io' });
    process.env.ADMIN_USER_EMAIL = 'admin@openagentic.io';
  });

  afterEach?.(() => {
    process.env = origEnv;
  });

  describe('bootstrap disabled (NAME unset)', () => {
    it('is a no-op when BOOTSTRAP_PROVIDER_NAME is unset', async () => {
      // Even with legacy per-provider env vars set, the seeder should NOT
      // create them. This is the "env no longer curates models" contract.
      process.env.AWS_BEDROCK_ENABLED = 'true';
      process.env.AWS_BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
      process.env.OLLAMA_ENABLED = 'true';
      process.env.OLLAMA_BASE_URL = 'http://10.0.0.142:11434';
      delete process.env.BOOTSTRAP_PROVIDER_NAME;

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
      expect(prismaMock.lLMProvider.update).not.toHaveBeenCalled();
      expect(prismaMock.systemConfiguration.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op when BOOTSTRAP_PROVIDER_NAME is empty string', async () => {
      process.env.BOOTSTRAP_PROVIDER_NAME = '';
      await seedLLMProviders();
      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
    });
  });

  describe('bootstrap enabled + DB empty', () => {
    beforeEach(() => {
      process.env.BOOTSTRAP_PROVIDER_NAME = 'ollama-hal';
      process.env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Ollama (hal)';
      process.env.BOOTSTRAP_PROVIDER_TYPE = 'ollama';
      process.env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({
        type: 'ollama',
        endpoint: 'http://10.0.0.142:11434',
      });
      process.env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
        chat: 'gpt-oss:20b',
        codemode: 'gpt-oss:20b',
        embedding: 'nomic-embed-text',
        embeddingDimension: 768,
      });
      prismaMock.lLMProvider.count.mockResolvedValue(0);
    });

    it('creates the bootstrap provider row when admin.llm_providers is empty', async () => {
      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).toHaveBeenCalledTimes(1);
      const args = prismaMock.lLMProvider.create.mock.calls[0][0];
      expect(args.data.name).toBe('ollama-hal');
      expect(args.data.display_name).toBe('Ollama (hal)');
      expect(args.data.provider_type).toBe('ollama');
      expect(args.data.enabled).toBe(true);
      // seeder_managed stamp on the provider_config so discoverable sync keeps working
      expect((args.data.provider_config as any).seeder_managed).toBe(true);
      // Endpoint + auth type survived encryption mock
      expect((args.data.auth_config as any).endpoint).toBe('http://10.0.0.142:11434');
      expect((args.data.auth_config as any).type).toBe('ollama');
    });

    // Registry SoT v1 (F2.5 C-2) — LLMProviderSeeder no longer touches
    // admin.system_configuration. DefaultModelsSeeder was deleted in F2.3
    // and system_configuration.default_models is no longer a SoT.
    it('does NOT upsert admin.system_configuration.default_models (Registry SoT v1)', async () => {
      await seedLLMProviders();
      expect(prismaMock.systemConfiguration.upsert).not.toHaveBeenCalled();
    });

    it('writes modelConfig with embeddingModel + chatModel so UniversalEmbeddingService + chat have immediate SoT', async () => {
      await seedLLMProviders();

      const args = prismaMock.lLMProvider.create.mock.calls[0][0];
      const mc = args.data.model_config as any;
      expect(mc.embeddingModel).toBe('nomic-embed-text');
      expect(mc.chatModel).toBe('gpt-oss:20b');
      expect(mc.defaultModel).toBe('gpt-oss:20b');
    });

    // Sev-0 fix (2026-05-09) — fresh install with bootstrap provider but no
    // chat-role row blocked every chat session POST because
    // ModelConfigurationService.getDefaultChatModel() throws "No chat model
    // configured." The seeder now ALSO inserts a chat-role row alongside
    // creating the bootstrap provider, so a fresh deploy is immediately
    // operable without depending on RegistryBootstrapSeeder
    // (which can defer when ADMIN_USER_EMAIL is unset).
    it('inserts a chat-role row in admin.model_role_assignments using BOOTSTRAP_PROVIDER_DEFAULTS.chat', async () => {
      await seedLLMProviders();

      // Provider row created
      expect(prismaMock.lLMProvider.create).toHaveBeenCalledTimes(1);

      // chat-role row created — this is the new contract
      const chatCalls = prismaMock.modelRoleAssignment.create.mock.calls.filter(
        (c: any[]) => c[0]?.data?.role === 'chat',
      );
      expect(chatCalls.length).toBe(1);
      const data = chatCalls[0][0].data;
      expect(data.role).toBe('chat');
      expect(data.model).toBe('gpt-oss:20b');
      expect(data.provider).toBe('ollama-hal');
      expect(data.enabled).toBe(true);
    });

    it('skips chat-role insert when admin user FK cannot be resolved (defers to RegistryBootstrapSeeder)', async () => {
      // Provider row STILL gets created — the FK race only blocks the role
      // insert, not the provider insert. Boot continues; next restart with
      // admin user present can complete the registry seed.
      prismaMock.user.findUnique.mockResolvedValue(null);

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.modelRoleAssignment.create).not.toHaveBeenCalled();
    });

    it('does not duplicate chat-role row when one already exists for the (provider, model)', async () => {
      // Prior chat row exists from a previous boot (or RegistryBootstrapSeeder
      // already ran). LLMProviderSeeder must be idempotent — no second row.
      prismaMock.modelRoleAssignment.findFirst = vi.fn().mockResolvedValue({
        id: 'existing-chat-row',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
      });

      await seedLLMProviders();

      const chatCalls = prismaMock.modelRoleAssignment.create.mock.calls.filter(
        (c: any[]) => c[0]?.data?.role === 'chat',
      );
      expect(chatCalls.length).toBe(0);
    });
  });

  describe('bootstrap enabled + DB already has rows', () => {
    beforeEach(() => {
      process.env.BOOTSTRAP_PROVIDER_NAME = 'ollama-hal';
      process.env.BOOTSTRAP_PROVIDER_TYPE = 'ollama';
      process.env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ endpoint: 'http://x:11434' });
      process.env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({ chat: 'gpt-oss:20b', codemode: 'gpt-oss:20b', embedding: 'nomic-embed-text' });
    });

    it('skips creation when admin.llm_providers has any rows', async () => {
      prismaMock.lLMProvider.count.mockResolvedValue(3);

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
    });

    // Registry SoT v1 (F2.5 C-2) — code-role backfill on existing deploys
    // is now handled by CodeRoleBackfillService at boot time. LLMProviderSeeder
    // does NOT write to model_role_assignments at all.
    it('does NOT write any modelRoleAssignment row on the existing-providers branch (CodeRoleBackfillService handles it)', async () => {
      prismaMock.lLMProvider.count.mockResolvedValue(1);
      prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-uid-1', email: 'admin@x' });
      process.env.ADMIN_USER_EMAIL = 'admin@x';

      await seedLLMProviders();

      expect(prismaMock.modelRoleAssignment.create).not.toHaveBeenCalled();
      expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
    });

    it('does NOT create a provider row when at least one provider already exists (admin changes win)', async () => {
      // Rationale: admin may have deleted the default_models row but left
      // providers intact. LLMProviderSeeder must not overwrite admin-managed rows.
      prismaMock.lLMProvider.count.mockResolvedValue(1);

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
      // RegistryBootstrapSeeder (seedRegistryFromHelm) runs as a separate boot
      // step after this one. This test only asserts that the LLMProviderSeeder
      // early-exit path (existing providers → skip) doesn't interfere with the
      // rest of the boot flow.
    });
  });

  // Registry SoT v1 (F2.5 C-2) — narrow seeder contract: ONE provider upsert,
  // no Registry writes, no system_configuration writes.
  describe('narrow contract — provider-row writes only', () => {
    beforeEach(() => {
      process.env.BOOTSTRAP_PROVIDER_NAME = 'ollama-hal';
      process.env.BOOTSTRAP_PROVIDER_TYPE = 'ollama';
      process.env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ endpoint: 'http://x:11434' });
      process.env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
        chat: 'gpt-oss:20b', codemode: 'gpt-oss:20b', embedding: 'nomic-embed-text',
      });
      prismaMock.lLMProvider.count.mockResolvedValue(0);
    });

    it('creates the bootstrap provider row exactly once (lLMProvider.upsert/create)', async () => {
      await seedLLMProviders();
      // The seeder uses .create() (after the count check), not .upsert().
      expect(prismaMock.lLMProvider.create).toHaveBeenCalledTimes(1);
    });

    it('calls modelRoleAssignment.create exactly once for the chat role on the fresh-install path', async () => {
      await seedLLMProviders();
      const chatCalls = prismaMock.modelRoleAssignment.create.mock.calls.filter(
        (c: any[]) => c[0]?.data?.role === 'chat',
      );
      expect(chatCalls.length).toBe(1);
    });

    it('does NOT call modelRoleAssignment.update on the fresh-install path', async () => {
      await seedLLMProviders();
      expect(prismaMock.modelRoleAssignment.update).not.toHaveBeenCalled();
    });

    it('does NOT call systemConfiguration.upsert for default_models on the fresh-install path', async () => {
      await seedLLMProviders();
      expect(prismaMock.systemConfiguration.upsert).not.toHaveBeenCalled();
    });
  });

  describe('no legacy env-driven seed paths exist', () => {
    it('does NOT create a provider for AWS_BEDROCK_ENABLED when bootstrap unset', async () => {
      delete process.env.BOOTSTRAP_PROVIDER_NAME;
      process.env.AWS_BEDROCK_ENABLED = 'true';
      process.env.AWS_BEDROCK_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
    });

    it('does NOT create a provider for VERTEX_AI_ENABLED when bootstrap unset', async () => {
      delete process.env.BOOTSTRAP_PROVIDER_NAME;
      process.env.VERTEX_AI_ENABLED = 'true';
      process.env.VERTEX_AI_PROJECT_ID = 'openagentic-dev';

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
    });

    it('does NOT create a provider for AZURE_OPENAI_ENABLED when bootstrap unset', async () => {
      delete process.env.BOOTSTRAP_PROVIDER_NAME;
      process.env.AZURE_OPENAI_ENABLED = 'true';
      process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';

      await seedLLMProviders();

      expect(prismaMock.lLMProvider.create).not.toHaveBeenCalled();
    });
  });
});
