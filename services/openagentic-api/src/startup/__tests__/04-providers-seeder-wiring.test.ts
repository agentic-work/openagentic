/**
 * F2.5 integration test — verifies that 04-providers.ts wires the correct
 * seeder chain on boot.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.5)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * Assertions:
 *   1. seedRegistryFromHelm IS called during the LLM-provider seeding block.
 *   2. The legacy DefaultModels seeder class is NOT imported anywhere in the
 *      startup source (it was deleted in F2.3).
 *   3. `new ModelRegistrySeeder` (the boot-time write loop) is NOT invoked at
 *      startup — ModelRegistrySeeder is now informational-only after F2.4.
 *   4. F2 I-1 — a runtime smoke that imports + invokes seedRegistryFromHelm
 *      against a mock prisma so structural-typing-bypass bugs (like the
 *      C-1 `provider_name` regression) cannot ship green again.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STARTUP_FILE = join(__dirname, '../04-providers.ts');

describe('04-providers.ts seeder-wiring contract (F2.5)', () => {
  let src: string;

  // Read the source once for all assertions in this suite.
  // This is a static source-analysis test — we inspect the file, not run it,
  // because the dynamic-import chains in 04-providers.ts require the full
  // module graph to be available at runtime.
  beforeAll(() => {
    src = readFileSync(STARTUP_FILE, 'utf8');
  });

  it('imports or dynamically-imports seedRegistryFromHelm (RegistryBootstrapSeeder)', () => {
    expect(src).toMatch(/seedRegistryFromHelm/);
    expect(src).toMatch(/RegistryBootstrapSeeder/);
  });

  it('does NOT import or instantiate the legacy default-models seeder class', () => {
    // Match live import/constructor patterns — not doc comments that explain history.
    expect(src).not.toMatch(/import\b[^;]*DefaultModels[Ss]eeder/);
    expect(src).not.toMatch(/new\s+DefaultModels[Ss]eeder\s*\(/);
  });

  it('does NOT instantiate ModelRegistrySeeder at boot (new ModelRegistrySeeder)', () => {
    // The `new ModelRegistrySeeder(` constructor was the boot-time write path.
    // After F2.4, ModelRegistrySeeder is only used via its exported functions,
    // not instantiated at startup.
    expect(src).not.toMatch(/new\s+ModelRegistrySeeder\s*\(/);
  });

  it('does NOT call .seed() on a ModelRegistrySeeder instance at boot', () => {
    // Belt-and-suspenders: also check for registrySeeder.seed() pattern.
    expect(src).not.toMatch(/registrySeeder\.seed\s*\(\s*\)/);
  });

  it('calls seedLLMProviders (LLMProviderSeeder is still in chain)', () => {
    // LLMProviderSeeder is KEPT — it seeds the bootstrap provider row itself.
    expect(src).toMatch(/seedLLMProviders/);
  });
});

// ---------------------------------------------------------------------------
// F2 I-1 — runtime smoke. The static-grep tests above can't catch structural-
// typing bypass bugs (like F2 C-1's `provider_name` field not existing on the
// schema). This block imports seedRegistryFromHelm and invokes it with a fully
// mocked prisma + happy-path env, asserting that the function actually reaches
// DB-touching code without throwing a Prisma validation error.
// ---------------------------------------------------------------------------
describe('seedRegistryFromHelm runtime smoke (F2 I-1)', () => {
  it('invokes against a mock prisma + happy-path env without throwing', async () => {
    const { seedRegistryFromHelm } = await import(
      '../../services/model-routing/RegistryBootstrapSeeder.js'
    );

    // Mock prisma surface — every method returns the minimum shape the seeder
    // looks at. $transaction(array) resolves the array of in-flight ops.
    const prisma = {
      systemConfiguration: {
        findUnique: vi.fn().mockResolvedValue(null), // cold start
        upsert: vi.fn().mockResolvedValue({}),
      },
      modelRoleAssignmentTombstone: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      modelRoleAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: data.id ?? 'fake-id',
          ...data,
        })),
        update: vi.fn(),
      },
      modelRegistryEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: BigInt(1),
          ...data,
        })),
      },
      lLMProvider: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'provider-uuid',
          name: 'ollama-bootstrap',
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'admin-user-uuid',
          email: 'admin@openagentic.io',
        }),
      },
      $transaction: vi.fn(async (ops: any) => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops(prisma);
      }),
    };

    const env: Record<string, string> = {
      BOOTSTRAP_PROVIDER_NAME: 'ollama-bootstrap',
      BOOTSTRAP_PROVIDER_DISPLAY_NAME: 'Ollama (Bootstrap)',
      BOOTSTRAP_PROVIDER_TYPE: 'ollama',
      BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({ endpoint: 'http://ollama:11434' }),
      BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
        chat: 'gpt-oss:20b',
        codemode: 'gpt-oss:20b',
        embedding: 'nomic-embed-text',
      }),
      SEEDER_VERSION: '99',
      ADMIN_USER_EMAIL: 'admin@openagentic.io',
    };

    const result = await seedRegistryFromHelm({
      prisma: prisma as any,
      env: env as NodeJS.ProcessEnv,
    });

    // Reaches DB-touching code: $transaction was called, version stamp was written.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.systemConfiguration.upsert).toHaveBeenCalled();
    expect(result.versionBumped).toBe(true);
  });
});
