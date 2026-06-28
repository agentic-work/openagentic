/**
 * Gap #913 — RegistryBootstrapSeeder must produce model_role_assignment rows
 * with the SAME shape the admin UI / Add-Model wizard would have created.
 *
 * Shape contract (verified against `routes/admin/llm-providers.ts` +
 * `services/model-routing/RegistryUpsertService.ts` +
 * `services/model-routing/addModelCapabilities.ts`):
 *
 *   modelRoleAssignment.create({ data: {
 *     id, role, model, provider, provider_id,
 *     priority, enabled, temperature, max_tokens?,
 *     capabilities: NormalizedCapabilities,   // 6 canonical keys
 *     options:     { auto: true, … },
 *     description, created_by, managed_by,
 *     version, bootstrap_version?,
 *   }})
 *
 * Capabilities MUST include all 6 keys:
 *   chat, vision, tools, streaming, embeddings, imageGeneration
 *
 * Before this gap was filed: the seeder hand-built
 * `{ chat, tools, streaming, embeddings }` — only 4 keys, missing `vision`
 * and `imageGeneration`. That divergence means the in-DB row "from helm"
 * looks different from the in-DB row "from admin UI". Two SoTs.
 */
import { describe, it, expect, vi } from 'vitest';
import { seedRegistryFromHelm, type RegistryBootstrapSeederDeps } from '../RegistryBootstrapSeeder.js';
import { normalizeAddModelCapabilities } from '../addModelCapabilities.js';

const BOOTSTRAP_ENV = {
  BOOTSTRAP_PROVIDER_NAME: 'ollama-bootstrap',
  BOOTSTRAP_PROVIDER_DISPLAY_NAME: 'Ollama (Bootstrap)',
  BOOTSTRAP_PROVIDER_TYPE: 'ollama',
  BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({ endpoint: 'http://ollama:11434' }),
  BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
    chat: 'gpt-oss:20b',
    codemode: 'gpt-oss:20b',
    embedding: 'nomic-embed-text',
    embeddingDimension: 768,
  }),
  SEEDER_VERSION: '913',
  ADMIN_USER_EMAIL: 'admin@openagentic.io',
};

function makePrisma() {
  const created: any[] = [];
  const prisma: any = {
    systemConfiguration: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    modelRoleAssignmentTombstone: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    modelRoleAssignment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        created.push(data);
        return { id: data.id ?? `row-${data.role}-${data.model}`, ...data };
      }),
      update: vi.fn(),
    },
    modelRegistryEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: BigInt(1), ...data })),
    },
    lLMProvider: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'provider-uuid-1',
        name: 'ollama-bootstrap',
        enabled: true,
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'admin-user-uuid', email: 'admin@openagentic.io' }),
    },
    $transaction: vi.fn(async (ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops),
  };
  return { prisma, created };
}

function makeDeps(): { deps: RegistryBootstrapSeederDeps; created: any[] } {
  const { prisma, created } = makePrisma();
  return {
    deps: {
      prisma,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      env: { ...BOOTSTRAP_ENV } as NodeJS.ProcessEnv,
    },
    created,
  };
}

describe('Gap #913 — RegistryBootstrapSeeder shape parity with admin UI', () => {
  it('writes capabilities through normalizeAddModelCapabilities (6 canonical keys, not 4)', async () => {
    const { deps, created } = makeDeps();
    await seedRegistryFromHelm(deps);

    expect(created.length).toBeGreaterThan(0);

    // Each row's capabilities must have the SIX canonical keys produced by
    // normalizeAddModelCapabilities. Hand-built `{ chat, tools, streaming, embeddings }`
    // is no longer acceptable — it diverges from the admin-UI write path.
    const REQUIRED_KEYS = ['chat', 'vision', 'tools', 'streaming', 'embeddings', 'imageGeneration'];

    for (const row of created) {
      expect(row.capabilities, `row ${row.role}/${row.model} missing capabilities`).toBeTruthy();
      const caps = row.capabilities;
      for (const key of REQUIRED_KEYS) {
        expect(
          Object.prototype.hasOwnProperty.call(caps, key),
          `row ${row.role}/${row.model}: capabilities missing '${key}' — admin shape requires it`,
        ).toBe(true);
        expect(
          typeof caps[key],
          `row ${row.role}/${row.model}: capabilities.${key} must be boolean (admin shape)`,
        ).toBe('boolean');
      }
    }
  });

  it('chat-role row matches normalizeAddModelCapabilities({chat:true})', async () => {
    const { deps, created } = makeDeps();
    await seedRegistryFromHelm(deps);
    const chatRow = created.find((r: any) => r.role === 'chat');
    expect(chatRow).toBeTruthy();
    const expected = normalizeAddModelCapabilities({ chat: true });
    // Admin path defaults: chat=true → tools=true, streaming=true, vision=false,
    // embeddings=false, imageGeneration=false.
    expect(chatRow!.capabilities.chat).toBe(expected.chat);
    expect(chatRow!.capabilities.tools).toBe(expected.tools);
    expect(chatRow!.capabilities.streaming).toBe(expected.streaming);
    expect(chatRow!.capabilities.embeddings).toBe(expected.embeddings);
    expect(chatRow!.capabilities.vision).toBe(expected.vision);
    expect(chatRow!.capabilities.imageGeneration).toBe(expected.imageGeneration);
  });

  it('embedding-role row matches normalizeAddModelCapabilities({embeddings:true,chat:false})', async () => {
    const { deps, created } = makeDeps();
    await seedRegistryFromHelm(deps);
    const embRow = created.find((r: any) => r.role === 'embedding');
    expect(embRow).toBeTruthy();
    const expected = normalizeAddModelCapabilities({ embeddings: true, chat: false });
    expect(embRow!.capabilities.embeddings).toBe(true);
    expect(embRow!.capabilities.chat).toBe(expected.chat);
    expect(embRow!.capabilities.tools).toBe(expected.tools);
    expect(embRow!.capabilities.streaming).toBe(expected.streaming);
    expect(embRow!.capabilities.vision).toBe(expected.vision);
    expect(embRow!.capabilities.imageGeneration).toBe(expected.imageGeneration);
  });

  it('options block includes auto:true (matching admin-write convention)', async () => {
    const { deps, created } = makeDeps();
    await seedRegistryFromHelm(deps);
    for (const row of created) {
      expect(row.options, `row ${row.role}/${row.model} missing options`).toBeTruthy();
      expect(row.options.auto, `row ${row.role}/${row.model}: options.auto must be true`).toBe(true);
    }
  });

  it('writes provider_id FK + created_by (matching admin NotNull contract)', async () => {
    const { deps, created } = makeDeps();
    await seedRegistryFromHelm(deps);
    for (const row of created) {
      expect(row.provider_id, `row ${row.role}/${row.model} missing provider_id FK`).toBeTruthy();
      expect(row.created_by, `row ${row.role}/${row.model} missing created_by FK`).toBeTruthy();
    }
  });
});
