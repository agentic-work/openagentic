/**
 * RbacSystemPromptService — Layer-1 of the chatmode three-layer prompt
 * architecture. Reads role-keyed RBAC system prompts from the
 * `rbac_system_prompts` table, with monotonic version + audit on every
 * write. Process-local cache keyed by role; bust via `invalidate(role)`
 * (called by the redis-pubsub subscriber wired in P-Live-3).
 *
 * the design notes
 */
import type { PrismaClient } from '@prisma/client';

export type UserRole = 'admin' | 'member';

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>(['admin', 'member']);

export const RBAC_PROMPT_INVALIDATE_CHANNEL = 'prompt:invalidate';

export interface SetTemplateOptions {
  actorUserId: string | null;
  reason?: string;
}

export interface RbacSystemPromptVersion {
  id: string;
  role_key: string;
  body: string;
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Minimal redis surface RbacSystemPromptService needs. Matches the
 * openagentic redis-client `publish(channel, message)` + `subscribe(channel, cb)`
 * shape so production wires `getRedisClient()` directly and tests can pass
 * a fake.
 */
export interface RbacRedisLike {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, callback: (message: string) => void | Promise<void>): Promise<void>;
}

const cache = new Map<UserRole, string>();

export function __resetRbacPromptCacheForTests(): void {
  cache.clear();
}

export class RbacSystemPromptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis?: RbacRedisLike,
  ) {}

  async getActiveTemplate(role: UserRole): Promise<string> {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Unknown role: ${String(role)}. Valid roles: admin, member.`);
    }
    const cached = cache.get(role);
    if (cached !== undefined) return cached;

    const row = await this.prisma.rbacSystemPrompt.findFirst({
      where: { role_key: role, is_active: true },
      orderBy: { version: 'desc' },
    });
    if (!row) {
      throw new Error(
        `No active rbac_system_prompt for role '${role}'. Seed via seedRbacSystemPromptsFromFiles or POST /api/admin/prompt-templates.`,
      );
    }
    cache.set(role, row.body);
    return row.body;
  }

  invalidate(role: UserRole): void {
    cache.delete(role);
  }

  invalidateAll(): void {
    cache.clear();
  }

  async setActiveTemplate(
    role: UserRole,
    body: string,
    opts: SetTemplateOptions,
  ): Promise<RbacSystemPromptVersion> {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Unknown role: ${String(role)}. Valid roles: admin, member.`);
    }
    if (!body || body.trim().length === 0) {
      throw new Error('Refusing to write empty rbac_system_prompt body.');
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const current = await tx.rbacSystemPrompt.findFirst({
        where: { role_key: role, is_active: true },
        orderBy: { version: 'desc' },
      });

      const nextVersion = (current?.version ?? 0) + 1;

      if (current) {
        await tx.rbacSystemPrompt.updateMany({
          where: { role_key: role, is_active: true },
          data: { is_active: false },
        });
      }

      const created: RbacSystemPromptVersion = await tx.rbacSystemPrompt.create({
        data: {
          role_key: role,
          body,
          version: nextVersion,
          is_active: true,
        },
      });

      await tx.rbacSystemPromptAudit.create({
        data: {
          prompt_id: created.id,
          role_key: role,
          action: current ? 'update' : 'create',
          before_body: current?.body ?? null,
          after_body: body,
          before_version: current?.version ?? null,
          after_version: nextVersion,
          actor_user_id: opts.actorUserId,
          reason: opts.reason ?? null,
        },
      });

      return created;
    });

    cache.set(role, body);
    await this.publishInvalidate(role);
    return result;
  }

  async listVersions(role: UserRole): Promise<RbacSystemPromptVersion[]> {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Unknown role: ${String(role)}.`);
    }
    return this.prisma.rbacSystemPrompt.findMany({
      where: { role_key: role },
      orderBy: { version: 'desc' },
    });
  }

  async rollback(
    role: UserRole,
    targetVersion: number,
    opts: SetTemplateOptions,
  ): Promise<RbacSystemPromptVersion> {
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Unknown role: ${String(role)}.`);
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const target = await tx.rbacSystemPrompt.findFirst({
        where: { role_key: role, version: targetVersion },
      });
      if (!target) {
        throw new Error(`No rbac_system_prompt for role='${role}' version=${targetVersion}.`);
      }
      const current = await tx.rbacSystemPrompt.findFirst({
        where: { role_key: role, is_active: true },
        orderBy: { version: 'desc' },
      });

      if (current && current.version !== targetVersion) {
        await tx.rbacSystemPrompt.updateMany({
          where: { role_key: role, is_active: true },
          data: { is_active: false },
        });
      }
      await tx.rbacSystemPrompt.updateMany({
        where: { role_key: role, version: targetVersion },
        data: { is_active: true },
      });

      await tx.rbacSystemPromptAudit.create({
        data: {
          prompt_id: target.id,
          role_key: role,
          action: 'rollback',
          before_body: current?.body ?? null,
          after_body: target.body,
          before_version: current?.version ?? null,
          after_version: targetVersion,
          actor_user_id: opts.actorUserId,
          reason: opts.reason ?? null,
        },
      });

      return { ...target, is_active: true };
    });

    cache.set(role, result.body);
    await this.publishInvalidate(role);
    return result;
  }

  /**
   * Subscribe this process's cache to redis-pubsub invalidations from any
   * other replica. Wires once at startup. Idempotent: re-calling adds a
   * second handler — startup wiring should call this exactly once per pod.
   */
  async subscribeInvalidations(): Promise<void> {
    if (!this.redis) return;
    await this.redis.subscribe(RBAC_PROMPT_INVALIDATE_CHANNEL, (message: string) => {
      try {
        const payload = JSON.parse(message) as { role_key?: string };
        if (payload?.role_key && VALID_ROLES.has(payload.role_key)) {
          this.invalidate(payload.role_key as UserRole);
        }
      } catch {
        /* ignore malformed payloads — a missed bust falls back to 60s TTL */
      }
    });
  }

  private async publishInvalidate(role: UserRole): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.publish(
        RBAC_PROMPT_INVALIDATE_CHANNEL,
        JSON.stringify({ role_key: role, ts: Date.now() }),
      );
    } catch {
      /* publish failure should not break the write — fall back to 60s TTL */
    }
  }
}
