/**
 * F2.1 — RED unit tests for RegistryBootstrapSeeder.
 *
 * the design notes
 * the design notes
 *
 * The new RegistryBootstrapSeeder replaces the BULLDOZER pattern in
 * LLMProviderSeeder: it gates on SEEDER_VERSION, skips tombstoned rows,
 * and preserves admin-managed rows. All tests run with vi.fn() mocked
 * Prisma — no real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedRegistryFromHelm, type RegistryBootstrapSeederDeps } from '../RegistryBootstrapSeeder.js';

// ---------------------------------------------------------------------------
// Shared test env — a valid bootstrap provider configuration.
// Uses field names from BootstrapProviderSeed / parseBootstrapProviderEnv.
// ---------------------------------------------------------------------------
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
  SEEDER_VERSION: '75',
  ADMIN_USER_EMAIL: 'admin@openagentic.io',
};

// ---------------------------------------------------------------------------
// Prisma mock builder
// ---------------------------------------------------------------------------
type MockFindUnique = ReturnType<typeof vi.fn>;
type MockUpsert = ReturnType<typeof vi.fn>;
type MockCreate = ReturnType<typeof vi.fn>;
type MockFindFirst = ReturnType<typeof vi.fn>;
type MockUpdate = ReturnType<typeof vi.fn>;

interface PrismaMock {
  systemConfiguration: {
    findUnique: MockFindUnique;
    upsert: MockUpsert;
  };
  modelRoleAssignmentTombstone: {
    findUnique: MockFindUnique;
  };
  modelRoleAssignment: {
    findUnique: MockFindUnique;
    create: MockCreate;
    update: MockUpdate;
  };
  modelRegistryEvent: {
    findFirst: MockFindFirst;
    create: MockCreate;
  };
  lLMProvider: {
    findUnique: MockFindUnique;
  };
  user: {
    findUnique: MockFindUnique;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function makePrisma(overrides: Partial<PrismaMock> = {}): PrismaMock {
  return {
    systemConfiguration: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ key: 'registry_seeder_version', value: { version: 75 } }),
      ...overrides.systemConfiguration,
    },
    modelRoleAssignmentTombstone: {
      findUnique: vi.fn().mockResolvedValue(null), // no tombstones by default
      ...overrides.modelRoleAssignmentTombstone,
    },
    modelRoleAssignment: {
      findUnique: vi.fn().mockResolvedValue(null), // no existing rows by default
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: data.id ?? `row-${data.role}-${data.model}`,
        ...data,
      })),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        ...data,
      })),
      ...overrides.modelRoleAssignment,
    },
    modelRegistryEvent: {
      findFirst: vi.fn().mockResolvedValue(null), // no previous events by default
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: BigInt(1),
        ...data,
      })),
      ...overrides.modelRegistryEvent,
    },
    lLMProvider: {
      findUnique: vi.fn().mockResolvedValue({ id: 'provider-uuid-1', name: 'ollama-bootstrap', enabled: true }),
      ...overrides.lLMProvider,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'admin-user-uuid', email: 'admin@openagentic.io' }),
      ...overrides.user,
    },
    // F2 I-3: row-write + audit-event must run in a single $transaction([...]).
    // Default impl awaits the array of in-flight prisma ops (each is already
    // a Promise from the .create()/.update() above) and returns their resolved
    // results — same shape Prisma returns for the array form.
    $transaction: overrides.$transaction ?? vi.fn(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      // Callback form fallback (not used by the seeder, but keeps the mock
      // tolerant of either invocation pattern).
      return ops(makePrismaProxy());
    }),
  };
}

// Tiny no-op proxy for the callback-form $transaction fallback. Not used by
// the seeder code itself but keeps the type narrow.
function makePrismaProxy(): any {
  return new Proxy({}, { get: () => () => Promise.resolve({}) });
}

function makeDeps(
  envOverrides: Record<string, string> = {},
  prismaOverrides: Partial<PrismaMock> = {},
): RegistryBootstrapSeederDeps {
  return {
    prisma: makePrisma(prismaOverrides),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    env: { ...BOOTSTRAP_ENV, ...envOverrides } as NodeJS.ProcessEnv,
  };
}

// ---------------------------------------------------------------------------
// SEEDER_VERSION gate
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — SEEDER_VERSION gate', () => {

  it('cold start: no registry_seeder_version row → applies all bootstrap rows + sets last-applied = SEEDER_VERSION', async () => {
    const deps = makeDeps();
    // systemConfiguration.findUnique returns null → cold start
    (deps.prisma as PrismaMock).systemConfiguration.findUnique.mockResolvedValue(null);

    const result = await seedRegistryFromHelm(deps);

    expect(result.versionBumped).toBe(true);
    // 3 bootstrap roles: chat, code, embedding
    expect(result.applied).toBeGreaterThanOrEqual(3);
    expect(result.skipped).toBe(0);

    // Must have stamped the new version
    const { upsert } = (deps.prisma as PrismaMock).systemConfiguration;
    expect(upsert).toHaveBeenCalledTimes(1);
    const upsertCall = upsert.mock.calls[0][0];
    expect(upsertCall.where.key).toBe('registry_seeder_version');
    expect(upsertCall.create.value).toEqual({ version: 75 });
  });

  it('warm restart: last_applied === SEEDER_VERSION → skips entirely, no Registry mutations, no audit events', async () => {
    const deps = makeDeps();
    // Row already at version 75
    (deps.prisma as PrismaMock).systemConfiguration.findUnique.mockResolvedValue({
      key: 'registry_seeder_version',
      value: { version: 75 },
    });

    const result = await seedRegistryFromHelm(deps);

    expect(result.versionBumped).toBe(false);
    expect(result.applied).toBe(0);

    // No registry mutations
    const { create: mraCreate, update: mraUpdate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    expect(mraCreate).not.toHaveBeenCalled();
    expect(mraUpdate).not.toHaveBeenCalled();

    // No audit events
    const { create: eventCreate } = (deps.prisma as PrismaMock).modelRegistryEvent;
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('version bump: last_applied < SEEDER_VERSION → refreshes bootstrap rows + leaves admin rows untouched', async () => {
    // existing bootstrap row (managed_by='bootstrap') at old version 74
    const existingBootstrapRow = {
      id: 'row-chat-gpt-oss:20b',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      provider_name: 'ollama-bootstrap',
      managed_by: 'bootstrap',
      bootstrap_version: 74,
      priority: 10,
      enabled: true,
    };
    // existing admin row for code role — admin-managed
    const existingAdminRow = {
      id: 'row-code-gpt-oss:20b',
      role: 'code',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      provider_name: 'ollama-bootstrap',
      managed_by: 'admin',
      bootstrap_version: null,
      priority: 999,
      enabled: true,
    };

    const deps = makeDeps(
      {},
      {
        systemConfiguration: {
          findUnique: vi.fn().mockResolvedValue({
            key: 'registry_seeder_version',
            value: { version: 74 }, // old version
          }),
          upsert: vi.fn().mockResolvedValue({ key: 'registry_seeder_version', value: { version: 75 } }),
        },
        modelRoleAssignment: {
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            const { role, model, provider } = where.role_model_provider ?? {};
            if (role === 'chat' && model === 'gpt-oss:20b') return existingBootstrapRow;
            if (role === 'code' && model === 'gpt-oss:20b') return existingAdminRow;
            return null;
          }),
          create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `row-new-${data.role}`, ...data })),
          update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
        },
      },
    );

    const result = await seedRegistryFromHelm(deps);

    expect(result.versionBumped).toBe(true);
    // The admin-owned row must be skipped
    const { update: mraUpdate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const updateCalls: any[] = mraUpdate.mock.calls;
    // No update should touch the admin row id
    const adminRowUpdated = updateCalls.some(([args]) => args.where.id === 'row-code-gpt-oss:20b');
    expect(adminRowUpdated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tombstone honor
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — tombstone honor', () => {

  it('tombstoned (provider_name, model, role) → seeder skips that bootstrap row entirely (no insert, no update, no audit)', async () => {
    // Only the embedding role is tombstoned
    const tombstoneKey = { provider_name: 'ollama-bootstrap', model: 'nomic-embed-text', role: 'embedding' };
    const deps = makeDeps(
      {},
      {
        modelRoleAssignmentTombstone: {
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            const k = where.provider_name_model_role;
            if (
              k.provider_name === tombstoneKey.provider_name &&
              k.model === tombstoneKey.model &&
              k.role === tombstoneKey.role
            ) {
              return { ...tombstoneKey, deleted_at: new Date() };
            }
            return null;
          }),
        },
      },
    );

    const result = await seedRegistryFromHelm(deps);

    // embedding tombstoned → only chat+code applied (if both non-tombstoned)
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // The tombstoned row must not have been created
    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const createCalls: any[] = mraCreate.mock.calls;
    const embeddingCreated = createCalls.some(([args]) =>
      args.data.role === 'embedding' && args.data.model === 'nomic-embed-text',
    );
    expect(embeddingCreated).toBe(false);

    // No audit event for the tombstoned row
    const { create: eventCreate } = (deps.prisma as PrismaMock).modelRegistryEvent;
    const eventCalls: any[] = eventCreate.mock.calls;
    const tombstoneEventFired = eventCalls.some(([args]) =>
      args.data.action === 'BOOTSTRAP_SEED' &&
      args.data.after_state?.role === 'embedding' &&
      args.data.after_state?.model === 'nomic-embed-text',
    );
    expect(tombstoneEventFired).toBe(false);
  });

  it('seeder does NOT delete tombstone rows after running', async () => {
    // Tombstone all 3 roles
    const deps = makeDeps(
      {},
      {
        modelRoleAssignmentTombstone: {
          findUnique: vi.fn().mockResolvedValue({ provider_name: 'ollama-bootstrap', model: 'x', role: 'x' }),
        },
      },
    );
    // No delete method should be called on tombstone table
    (deps.prisma as any).modelRoleAssignmentTombstone.delete = vi.fn();

    await seedRegistryFromHelm(deps);

    expect((deps.prisma as any).modelRoleAssignmentTombstone.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// managed_by conditional update
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — managed_by conditional update', () => {

  it('existing admin-managed row (managed_by="admin", priority=999) → seeder leaves it untouched', async () => {
    const adminRow = {
      id: 'admin-row-chat',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      provider_name: 'ollama-bootstrap',
      managed_by: 'admin',
      bootstrap_version: null,
      priority: 999,
      enabled: true,
    };

    const deps = makeDeps(
      {},
      {
        systemConfiguration: {
          findUnique: vi.fn().mockResolvedValue(null), // cold start
          upsert: vi.fn().mockResolvedValue({}),
        },
        modelRoleAssignment: {
          findUnique: vi.fn().mockResolvedValue(adminRow),
          create: vi.fn(),
          update: vi.fn(),
        },
      },
    );

    const result = await seedRegistryFromHelm(deps);

    // admin row must not be updated
    const { update: mraUpdate, create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const chatUpdated = (mraUpdate.mock.calls as any[]).some(([args]) => args.where.id === 'admin-row-chat');
    expect(chatUpdated).toBe(false);

    // The row should be counted as skipped
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    // No audit BOOTSTRAP_SEED event for that row
    const { create: eventCreate } = (deps.prisma as PrismaMock).modelRegistryEvent;
    const chatSeedEvent = (eventCreate.mock.calls as any[]).some(([args]) =>
      args.data.action === 'BOOTSTRAP_SEED' && args.data.row_id === 'admin-row-chat',
    );
    expect(chatSeedEvent).toBe(false);
  });

  it('existing bootstrap-managed row (managed_by="bootstrap") → seeder updates bootstrap_version to new SEEDER_VERSION', async () => {
    const bootstrapRow = {
      id: 'bootstrap-row-chat',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-bootstrap',
      provider_name: 'ollama-bootstrap',
      managed_by: 'bootstrap',
      bootstrap_version: 10,
      priority: 10,
      enabled: true,
    };

    const deps = makeDeps(
      {},
      {
        systemConfiguration: {
          findUnique: vi.fn().mockResolvedValue(null), // cold start — version 0 → 75
          upsert: vi.fn().mockResolvedValue({}),
        },
        modelRoleAssignment: {
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            const k = where.role_model_provider;
            if (k?.role === 'chat' && k?.model === 'gpt-oss:20b') return bootstrapRow;
            return null;
          }),
          create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `row-new-${data.role}`, ...data })),
          update: vi.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
        },
      },
    );

    await seedRegistryFromHelm(deps);

    const { update: mraUpdate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const chatUpdate = (mraUpdate.mock.calls as any[]).find(([args]) => args.where.id === 'bootstrap-row-chat');
    expect(chatUpdate).toBeDefined();
    expect(chatUpdate[0].data.bootstrap_version).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — audit log', () => {

  it('emits BOOTSTRAP_SEED event for each created/updated bootstrap row, with prev_hash chained', async () => {
    // No existing rows — all 3 roles will be inserted
    const deps = makeDeps();

    // Simulate a pre-existing event so we can verify hash chaining
    const existingEventHash = 'abc123prevhash';
    (deps.prisma as PrismaMock).modelRegistryEvent.findFirst.mockResolvedValue({
      id: BigInt(99),
      hash: existingEventHash,
    });

    await seedRegistryFromHelm(deps);

    const { create: eventCreate } = (deps.prisma as PrismaMock).modelRegistryEvent;
    const eventCalls: any[] = eventCreate.mock.calls;

    // At least 3 events (chat, code, embedding) — or fewer if chat=code
    expect(eventCalls.length).toBeGreaterThanOrEqual(1);

    // All events must be BOOTSTRAP_SEED
    for (const [args] of eventCalls) {
      expect(args.data.action).toBe('BOOTSTRAP_SEED');
    }

    // First event must chain to the existing event hash
    const firstEventArgs = eventCalls[0][0];
    expect(firstEventArgs.data.prev_hash).toBe(existingEventHash);

    // Subsequent events must chain to the prior event's hash
    for (let i = 1; i < eventCalls.length; i++) {
      const prevHash = eventCalls[i - 1][0].data.hash;
      const thisEvent = eventCalls[i][0];
      expect(thisEvent.data.prev_hash).toBe(prevHash);
    }
  });

  it('emits exactly one BOOTSTRAP_SEED event per affected row (no duplicates on re-run with same SEEDER_VERSION)', async () => {
    // First run — cold start
    const deps = makeDeps();
    await seedRegistryFromHelm(deps);

    const firstRunEvents = (deps.prisma as PrismaMock).modelRegistryEvent.create.mock.calls.length;

    // Second run with same SEEDER_VERSION — warm restart (version already bumped)
    // Simulate the seeder version was now written
    (deps.prisma as PrismaMock).systemConfiguration.findUnique.mockResolvedValue({
      key: 'registry_seeder_version',
      value: { version: 75 },
    });
    (deps.prisma as PrismaMock).modelRegistryEvent.create.mockClear();

    await seedRegistryFromHelm(deps);

    // Second run must emit 0 events (warm restart gate)
    const secondRunEvents = (deps.prisma as PrismaMock).modelRegistryEvent.create.mock.calls.length;
    expect(secondRunEvents).toBe(0);

    // First run emitted at least 1 event per affected row
    expect(firstRunEvents).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// No bootstrap configured
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — no bootstrap configured', () => {

  it('returns {applied:0, skipped:0, versionBumped} when BOOTSTRAP_PROVIDER_NAME is unset', async () => {
    const deps = makeDeps({ BOOTSTRAP_PROVIDER_NAME: '' });

    const result = await seedRegistryFromHelm(deps);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
    // Should still bump the version marker (or at minimum not crash)
    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    expect(mraCreate).not.toHaveBeenCalled();
  });

  it('skips registry rows + returns versionBumped=false when ADMIN_USER_EMAIL is unset (created_by FK can\'t be resolved)', async () => {
    // model_role_assignments.created_by is non-nullable FK to users(id).
    // No admin user → INSERT would fail. Don't bump version — retry next restart.
    const deps = makeDeps({ ADMIN_USER_EMAIL: '' });

    const result = await seedRegistryFromHelm(deps);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.versionBumped).toBe(false);
    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    expect(mraCreate).not.toHaveBeenCalled();
  });

  it('skips registry rows + returns versionBumped=false when admin user row not found in DB', async () => {
    const deps = makeDeps({}, {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    });

    const result = await seedRegistryFromHelm(deps);

    expect(result.versionBumped).toBe(false);
    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    expect(mraCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Image-gen role seeding (sev0 gap): generate_image dead on fresh install
// because no imageGen role row + no default_models.imageGen is ever written.
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — imageGen role + default_models.imageGen', () => {
  // A bootstrap env that ALSO ships an imageGen default model id (operator sets
  // this in helm values; NOT a literal in business logic). The Bedrock provider
  // implements generateImage(); the seeded role row is what feeds
  // ProviderManager.modelToProviderMap so the registry short-circuit resolves.
  const IMG_ENV = {
    BOOTSTRAP_PROVIDER_NAME: 'bedrock-bootstrap',
    BOOTSTRAP_PROVIDER_DISPLAY_NAME: 'AWS Bedrock (Bootstrap)',
    BOOTSTRAP_PROVIDER_TYPE: 'aws-bedrock',
    BOOTSTRAP_PROVIDER_CONFIG: JSON.stringify({ region: 'us-east-1' }),
    BOOTSTRAP_PROVIDER_DEFAULTS: JSON.stringify({
      chat: 'gpt-oss:20b',
      codemode: 'gpt-oss:20b',
      embedding: 'nomic-embed-text',
      embeddingDimension: 768,
      imageGen: 'amazon.nova-canvas-v1:0',
    }),
    SEEDER_VERSION: '75',
    ADMIN_USER_EMAIL: 'admin@openagentic.io',
  };

  it('cold start with imageGen default → creates an imageGen role row with imageGeneration capability', async () => {
    const deps = makeDeps();
    (deps as any).env = { ...IMG_ENV };
    // Bedrock provider, so the bootstrap provider row exists.
    (deps.prisma as PrismaMock).lLMProvider.findUnique.mockResolvedValue({
      id: 'provider-uuid-bedrock', name: 'bedrock-bootstrap', enabled: true,
    });

    const result = await seedRegistryFromHelm(deps);

    expect(result.versionBumped).toBe(true);

    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const createCalls: any[] = mraCreate.mock.calls;
    const imageRow = createCalls
      .map(([args]) => args.data)
      .find((d) => d.role === 'imageGen' && d.model === 'amazon.nova-canvas-v1:0');

    expect(imageRow).toBeDefined();
    expect(imageRow.capabilities.imageGeneration).toBe(true);
    expect(imageRow.provider).toBe('bedrock-bootstrap');
  });

  it('cold start with imageGen default → writes default_models.imageGen so getDefaults().imageGen resolves', async () => {
    const deps = makeDeps();
    (deps as any).env = { ...IMG_ENV };
    (deps.prisma as PrismaMock).lLMProvider.findUnique.mockResolvedValue({
      id: 'provider-uuid-bedrock', name: 'bedrock-bootstrap', enabled: true,
    });

    await seedRegistryFromHelm(deps);

    const { upsert } = (deps.prisma as PrismaMock).systemConfiguration;
    const defaultModelsUpsert = (upsert.mock.calls as any[]).find(
      ([args]) => args.where.key === 'default_models',
    );

    expect(defaultModelsUpsert).toBeDefined();
    const written = defaultModelsUpsert[0].create?.value ?? defaultModelsUpsert[0].update?.value;
    expect(written.imageGen).toBe('amazon.nova-canvas-v1:0');
  });

  it('no imageGen default → does NOT create an imageGen role row (behaviour-neutral for non-image deployments)', async () => {
    const deps = makeDeps(); // BOOTSTRAP_ENV has no imageGen

    await seedRegistryFromHelm(deps);

    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const imageCreated = (mraCreate.mock.calls as any[]).some(
      ([args]) => args.data.role === 'imageGen',
    );
    expect(imageCreated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F2 C-1 regression — `provider_name` field MUST NOT appear in create payload
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — F2 C-1 regression (provider_name field absent)', () => {
  it('create payload for new rows MUST NOT include a `provider_name` key (column does not exist on ModelRoleAssignment)', async () => {
    // Cold-start: 3 fresh rows are inserted. Each create payload must use
    // `provider` (the actual schema column), not the phantom `provider_name`.
    const deps = makeDeps();

    await seedRegistryFromHelm(deps);

    const { create: mraCreate } = (deps.prisma as PrismaMock).modelRoleAssignment;
    const createCalls: any[] = mraCreate.mock.calls;
    expect(createCalls.length).toBeGreaterThan(0);

    for (const [args] of createCalls) {
      // The phantom field — Prisma will throw PrismaClientValidationError if it slips back in.
      expect(args.data).not.toHaveProperty('provider_name');
      // The real schema column — must be present.
      expect(args.data.provider).toBe('ollama-bootstrap');
    }
  });
});

// ---------------------------------------------------------------------------
// F2 I-3 regression — row-write + audit-event must run in a single $transaction
// ---------------------------------------------------------------------------
describe('RegistryBootstrapSeeder — F2 I-3 transactional write+audit', () => {
  it('passes BOTH the row-write op and the audit-event op into a single prisma.$transaction call per role', async () => {
    const deps = makeDeps();
    await seedRegistryFromHelm(deps);

    const { $transaction } = deps.prisma as PrismaMock;
    // Three roles seeded (chat, code, embedding) → exactly one $transaction
    // call per role.
    expect($transaction).toHaveBeenCalledTimes(3);

    // Each call must receive an array of length 2 (row-write + audit-event).
    for (const callArgs of $transaction.mock.calls) {
      const ops = callArgs[0];
      expect(Array.isArray(ops)).toBe(true);
      expect(ops).toHaveLength(2);
    }
  });

  it('does NOT call markSeederVersion when the per-role $transaction throws (caller can retry on next boot)', async () => {
    // First $transaction call rejects → loop terminates with exception.
    const deps = makeDeps();
    (deps.prisma as PrismaMock).$transaction = vi
      .fn()
      .mockRejectedValueOnce(new Error('audit chain corrupted'));

    await expect(seedRegistryFromHelm(deps)).rejects.toThrow();

    // markSeederVersion (systemConfiguration.upsert) MUST NOT have been called
    // because the loop exited before reaching the version stamp.
    const { upsert } = (deps.prisma as PrismaMock).systemConfiguration;
    expect(upsert).not.toHaveBeenCalled();
  });
});
