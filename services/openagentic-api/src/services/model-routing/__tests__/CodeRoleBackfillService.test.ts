/**
 * Tests for CodeRoleBackfillService — task #360.
 *
 * The service runs on every API boot. It MUST be idempotent, it MUST NOT
 * mutate existing rows, and it MUST stay inert when it cannot safely
 * perform the backfill (no admin FK, no chat row to clone from).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import {
  CodeRoleBackfillService,
  type CodeRoleBackfillPrismaLike,
} from '../CodeRoleBackfillService';

function makePrisma(overrides: Partial<CodeRoleBackfillPrismaLike> = {}) {
  return {
    $queryRaw: vi.fn(async (strings?: any) => {
      // Default: advisory lock acquired (true). Tests can override per-call.
      const sql = String(Array.isArray(strings) ? strings.join(' ') : strings ?? '');
      if (sql.includes('pg_try_advisory_lock')) {
        return [{ pg_try_advisory_lock: true }];
      }
      if (sql.includes('pg_advisory_unlock')) {
        return [{ pg_advisory_unlock: true }];
      }
      return [];
    }),
    modelRoleAssignment: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async (args: any) => ({ id: 'new-code-row-id', ...args.data })),
    },
    systemConfiguration: {
      findUnique: vi.fn(async () => null),
    },
    user: {
      findUnique: vi.fn(async () => ({ id: 'admin-user-1' })),
    },
    ...overrides,
  } as any as CodeRoleBackfillPrismaLike;
}

const log = pino({ level: 'silent' });

describe('CodeRoleBackfillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when a role=code row already exists (idempotent)', async () => {
    const prisma = makePrisma();
    (prisma.modelRoleAssignment.findFirst as any).mockResolvedValueOnce({
      id: 'existing-code',
      role: 'code',
      enabled: true,
    });

    const result = await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(result).toEqual({ inserted: false, reason: 'already-present' });
    expect(prisma.modelRoleAssignment.create).not.toHaveBeenCalled();
  });

  it('defers when no admin user exists (seed-race guard)', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as any).mockResolvedValue(null);

    const result = await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(result.inserted).toBe(false);
    expect(result.reason).toBe('no-admin-user');
    expect(prisma.modelRoleAssignment.create).not.toHaveBeenCalled();
  });

  it('clones the default_models.code row when that chat row exists', async () => {
    const prisma = makePrisma();
    // Default says 'gpt-oss:20b' is the code default.
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: { code: 'gpt-oss:20b', chat: 'gpt-oss:20b' },
    });
    (prisma.modelRoleAssignment.findFirst as any)
      // first call → "is there a code row?" → no
      .mockResolvedValueOnce(null)
      // second call → "find the chat row for gpt-oss:20b"
      .mockResolvedValueOnce({
        id: 'chat-row-1',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
        priority: 100,
        enabled: true,
        temperature: 0.7,
        max_tokens: 8192,
        capabilities: { chat: true, tools: true, streaming: true, thinking: true },
        description: 'gpt-oss:20b',
      });

    const result = await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe('inserted-from-default');
    expect(result.insertedModel).toBe('gpt-oss:20b');
    expect(result.insertedProvider).toBe('ollama-hal');

    const createArgs = (prisma.modelRoleAssignment.create as any).mock.calls[0][0].data;
    expect(createArgs.role).toBe('code');
    expect(createArgs.model).toBe('gpt-oss:20b');
    expect(createArgs.provider).toBe('ollama-hal');
    expect(createArgs.enabled).toBe(true);
    expect(createArgs.capabilities.thinking).toBe(true);
    expect(createArgs.options.backfill).toBe(true);
    expect(createArgs.options.clonedFromRoleChatId).toBe('chat-row-1');
    expect(createArgs.created_by).toBe('admin-user-1');
  });

  it('falls back to first enabled chat row when default_models.code is unset', async () => {
    const prisma = makePrisma();
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: {},
    });
    (prisma.modelRoleAssignment.findFirst as any).mockResolvedValue(null);
    (prisma.modelRoleAssignment.findMany as any).mockResolvedValue([
      {
        id: 'chat-fallback-1',
        role: 'chat',
        model: 'claude-sonnet-4-6',
        provider: 'aws-bedrock',
        priority: 10,
        enabled: true,
        temperature: 0.7,
        max_tokens: 8192,
        capabilities: { chat: true, tools: true, streaming: true },
      },
    ]);

    const result = await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(result.inserted).toBe(true);
    expect(result.reason).toBe('inserted-from-chat-fallback');
    expect(result.insertedModel).toBe('claude-sonnet-4-6');
    expect(result.insertedProvider).toBe('aws-bedrock');
  });

  it('gives up gracefully when there are ZERO enabled chat rows', async () => {
    const prisma = makePrisma();
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({ value: {} });
    (prisma.modelRoleAssignment.findFirst as any).mockResolvedValue(null);
    (prisma.modelRoleAssignment.findMany as any).mockResolvedValue([]);

    const result = await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(result.inserted).toBe(false);
    expect(result.reason).toBe('no-chat-row-available');
    expect(prisma.modelRoleAssignment.create).not.toHaveBeenCalled();
  });
});

describe('CodeRoleBackfillService — concurrency safety (#632)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function rawCallsAsString(prisma: any): string {
    const calls = (prisma.$queryRaw as any).mock.calls;
    // Each call is an array of args; the first arg is the template-strings array.
    // Flatten everything to a single concatenated string for substring search.
    return calls
      .map((call: any[]) =>
        call
          .map((arg: any) => {
            if (Array.isArray(arg)) return arg.join(' ');
            return String(arg);
          })
          .join(' '),
      )
      .join(' ');
  }

  it('takes a Postgres advisory lock before mutating', async () => {
    const prisma = makePrisma();
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: { code: 'gpt-oss:20b' },
    });
    (prisma.modelRoleAssignment.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'chat-row-1',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
        priority: 100,
        enabled: true,
      });

    await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    const allRaw = rawCallsAsString(prisma);
    expect(allRaw).toContain('pg_try_advisory_lock');
  });

  it('skips mutation when advisory lock is contended (other replica holds it)', async () => {
    const prisma = makePrisma();
    // First $queryRaw call (the lock acquire) returns false: lock not acquired.
    (prisma.$queryRaw as any).mockResolvedValueOnce([
      { pg_try_advisory_lock: false },
    ]);
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: { code: 'gpt-oss:20b' },
    });
    (prisma.modelRoleAssignment.findFirst as any).mockResolvedValue({
      id: 'chat-row-1',
      role: 'chat',
      model: 'gpt-oss:20b',
      provider: 'ollama-hal',
      enabled: true,
    });

    await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    expect(prisma.modelRoleAssignment.create).not.toHaveBeenCalled();
    // And we should NOT have read findFirst-for-existence-check either,
    // because the contended path returns immediately.
    expect(prisma.modelRoleAssignment.findFirst).not.toHaveBeenCalled();
  });

  it('releases the advisory lock in finally on success', async () => {
    const prisma = makePrisma();
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: { code: 'gpt-oss:20b' },
    });
    (prisma.modelRoleAssignment.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'chat-row-1',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
        enabled: true,
      });

    await new CodeRoleBackfillService(prisma, log, {
      ADMIN_USER_EMAIL: 'admin@x',
    }).backfill();

    const allRaw = rawCallsAsString(prisma);
    expect(allRaw).toContain('pg_advisory_unlock');
  });

  it('releases the advisory lock even when the body throws', async () => {
    const prisma = makePrisma();
    (prisma.systemConfiguration.findUnique as any).mockResolvedValue({
      value: { code: 'gpt-oss:20b' },
    });
    (prisma.modelRoleAssignment.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'chat-row-1',
        role: 'chat',
        model: 'gpt-oss:20b',
        provider: 'ollama-hal',
        enabled: true,
      });
    (prisma.modelRoleAssignment.create as any).mockRejectedValue(
      new Error('synthetic unique-constraint violation'),
    );

    try {
      await new CodeRoleBackfillService(prisma, log, {
        ADMIN_USER_EMAIL: 'admin@x',
      }).backfill();
    } catch {
      /* whether the service swallows or propagates is fine — unlock must still fire */
    }

    const allRaw = rawCallsAsString(prisma);
    expect(allRaw).toContain('pg_advisory_unlock');
  });
});
