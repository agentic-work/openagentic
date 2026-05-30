/**
 * CodeRoleBackfillService — task #360
 *
 * Boot-time backfill to guarantee the codemode `/model` picker has at
 * least ONE registered model. Before this service, every deploy that
 * pre-dated the seeder code-role upsert (i.e. basically every deploy)
 * shipped with an empty `admin.model_role_assignments WHERE role='code'`
 * set, and the CodemodeModelPill rendered "no code-role models
 * registered" with no admin recovery path short of a psql INSERT.
 *
 * Scope:
 *   - If ANY row with role='code' AND enabled=true exists → no-op.
 *   - Otherwise, pick the currently-configured codemode default (from
 *     admin.system_configuration.default_models.code), find its
 *     matching role='chat' row, and CLONE it into a role='code' row.
 *   - If default_models.code is unset, fall back to the provider's
 *     default chat model so the picker is never completely empty on
 *     an otherwise-healthy deploy.
 *
 * Idempotent. Safe to call on every pod start. Does not mutate any
 * existing rows — it only INSERTs the missing one.
 *
 * Security: created_by must be a valid users(id) FK. We resolve the
 * ADMIN_USER_EMAIL env to a user row (same contract as the bootstrap
 * seeder) and defer if no admin user is present yet (seed-race guard).
 */
import type { Logger } from 'pino';

export interface CodeRoleBackfillPrismaLike {
  // Tagged-template `$queryRaw` is what Prisma exposes as a callable. Tests
  // mock it as a plain async function — narrow the surface so we don't have
  // to import the full Prisma.Sql type just for advisory lock SQL.
  $queryRaw(...args: unknown[]): Promise<unknown>;
  modelRoleAssignment: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string; [k: string]: any } | null>;
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }): Promise<any[]>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  systemConfiguration: {
    findUnique(args: { where: { key: string } }): Promise<{ value: unknown } | null>;
  };
  user: {
    findUnique(args: { where: { email: string } }): Promise<{ id: string } | null>;
  };
}

export interface CodeRoleBackfillResult {
  inserted: boolean;
  reason:
    | 'already-present'
    | 'inserted-from-default'
    | 'inserted-from-chat-fallback'
    | 'no-chat-row-available'
    | 'no-admin-user'
    | 'lock-contended';
  insertedRowId?: string;
  insertedModel?: string;
  insertedProvider?: string;
}

/**
 * 8-byte ASCII for 'codeBack' = 0x636f6465_4261636b — distinct from any other
 * api-side `pg_try_advisory_lock` key. BigInt literal because the value
 * exceeds int4 range; Prisma serializes bigint to int8 in tagged-template
 * `$queryRaw`, which `pg_try_advisory_lock(bigint)` accepts.
 */
const CODE_ROLE_BACKFILL_LOCK_KEY = 0x636f64654261636bn;

export class CodeRoleBackfillService {
  constructor(
    private readonly prisma: CodeRoleBackfillPrismaLike,
    private readonly logger: Logger,
    private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  ) {}

  async backfill(): Promise<CodeRoleBackfillResult> {
    // Concurrency guard (#632): when api scales beyond 1 replica — or when
    // the seeder + role backfill race within a single replica — multiple
    // writers race the `findFirst` ⇒ `create` window and one of them dies
    // on the unique constraint `(role, model, provider)`. Wrap the whole
    // backfill in a Postgres advisory lock so only one writer runs at a
    // time; other concurrent attempts no-op and let the winner finish.
    let acquired = false;
    try {
      const lockResult = (await this.prisma.$queryRaw`
        SELECT pg_try_advisory_lock(${CODE_ROLE_BACKFILL_LOCK_KEY}) as pg_try_advisory_lock
      `) as Array<{ pg_try_advisory_lock: boolean }>;
      acquired = Boolean(lockResult?.[0]?.pg_try_advisory_lock);
    } catch (err: any) {
      // If the SELECT itself fails (eg. permission, connection blip), fail
      // open: log and skip the backfill rather than crash boot. The picker
      // is best-effort populated from this seam — admins can always add a
      // model via the UI.
      this.logger.warn(
        { error: err?.message },
        '[CodeRoleBackfill] advisory-lock acquire failed — skipping backfill this boot',
      );
      return { inserted: false, reason: 'lock-contended' };
    }

    if (!acquired) {
      this.logger.info(
        '[CodeRoleBackfill] advisory lock contended — another replica is backfilling, skipping',
      );
      return { inserted: false, reason: 'lock-contended' };
    }

    try {
      return await this.doBackfill();
    } finally {
      // Release is best-effort. If the unlock fails the lock auto-releases
      // on session/connection close anyway, so don't crash boot over it.
      await this.prisma
        .$queryRaw`SELECT pg_advisory_unlock(${CODE_ROLE_BACKFILL_LOCK_KEY})`
        .catch(() => {
          /* non-fatal — lock auto-releases on session end */
        });
    }
  }

  private async doBackfill(): Promise<CodeRoleBackfillResult> {
    // Fast path: any live code row means we're done.
    const existingCode = await this.prisma.modelRoleAssignment.findFirst({
      where: { role: 'code', enabled: true },
    });
    if (existingCode) {
      return { inserted: false, reason: 'already-present' };
    }

    // Resolve created_by. No admin user ⇒ defer (next boot will retry).
    const adminEmail = (this.env.ADMIN_USER_EMAIL ?? '').trim();
    const adminUser = adminEmail
      ? await this.prisma.user.findUnique({ where: { email: adminEmail } })
      : null;
    if (!adminUser?.id) {
      this.logger.warn(
        { adminEmail },
        '[CodeRoleBackfill] no admin user to stamp created_by — deferring backfill until next boot',
      );
      return { inserted: false, reason: 'no-admin-user' };
    }

    // Pick the source chat row. Preference order:
    //   1. default_models.code → exact (model) match on a role=chat row
    //   2. First enabled role=chat row by (priority asc, updatedAt desc)
    const defaults = await this.prisma.systemConfiguration.findUnique({
      where: { key: 'default_models' },
    });
    const codeDefault =
      typeof (defaults?.value as any)?.code === 'string'
        ? String((defaults!.value as any).code).trim()
        : '';

    let source: any | null = null;
    let sourceReason: CodeRoleBackfillResult['reason'] = 'inserted-from-default';

    if (codeDefault) {
      source = await this.prisma.modelRoleAssignment.findFirst({
        where: { role: 'chat', model: codeDefault, enabled: true },
      });
    }
    if (!source) {
      // Fallback: any enabled chat row, highest priority first.
      const anyChat = await this.prisma.modelRoleAssignment.findMany({
        where: { role: 'chat', enabled: true },
        orderBy: { priority: 'asc' },
      });
      source = anyChat[0] ?? null;
      sourceReason = 'inserted-from-chat-fallback';
    }

    if (!source) {
      this.logger.warn(
        {},
        '[CodeRoleBackfill] no enabled role=chat row to clone from — picker will stay empty until admin adds a model',
      );
      return { inserted: false, reason: 'no-chat-row-available' };
    }

    const created = await this.prisma.modelRoleAssignment.create({
      data: {
        role: 'code',
        model: source.model,
        provider: source.provider,
        priority: typeof source.priority === 'number' ? source.priority : 10,
        enabled: true,
        temperature:
          typeof source.temperature === 'number' ? source.temperature : 0.7,
        max_tokens: source.max_tokens ?? null,
        capabilities: source.capabilities ?? {
          chat: true,
          tools: true,
          streaming: true,
          embeddings: false,
        },
        options: {
          auto: true,
          backfill: true,
          discoveredAt: new Date().toISOString(),
          clonedFromRoleChatId: source.id,
        },
        description: source.description ?? source.model,
        created_by: adminUser.id,
      },
    });

    this.logger.info(
      {
        insertedRowId: created.id,
        model: source.model,
        provider: source.provider,
        sourceReason,
      },
      '[CodeRoleBackfill] seeded missing role=code row — /model picker is now populated',
    );

    return {
      inserted: true,
      reason: sourceReason,
      insertedRowId: created.id,
      insertedModel: source.model,
      insertedProvider: source.provider,
    };
  }
}
