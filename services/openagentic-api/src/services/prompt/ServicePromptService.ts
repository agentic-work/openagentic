/**
 * ServicePromptService — DB-backed storage for non-RBAC service prompts.
 *
 * Provides the same live-edit + Redis-pubsub invalidation pattern used by
 * `RbacSystemPromptService` but for named service prompt keys rather than
 * role-keyed RBAC bodies.
 *
 * Recognised keys (seeded at boot from DEFAULT_SERVICE_PROMPTS):
 *   slack.integration_prompt
 *   title_gen.ai_service
 *   title_gen.client
 *   memory.context_system
 *   memory.context_build
 *
 * Keys are arbitrary strings; the constraint is just that the admin can edit
 * them at /admin/prompts (Service Prompts tab) and the consumer reads from DB
 * on every call (with a module-scoped in-memory cache backed by redis-pubsub).
 *
 * Sprint W — 2026-05-19
 */
import type { PrismaClient } from '@prisma/client';

export const SERVICE_PROMPT_INVALIDATE_CHANNEL = 'service-prompt:invalidate';

export interface ServicePromptVersion {
  id: string;
  prompt_key: string;
  body: string;
  version: number;
  is_active: boolean;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ServicePromptRedisLike {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, callback: (message: string) => void | Promise<void>): Promise<void>;
}

export interface SetServicePromptOptions {
  actorUserId: string | null;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Module-scope in-memory cache (one per process). Keyed by prompt_key.
// ---------------------------------------------------------------------------
const cache = new Map<string, string>();

export function __resetServicePromptCacheForTests(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Default seed values — used on fresh deploy when the `service_prompts`
// table is empty. Also used as test defaults.
// ---------------------------------------------------------------------------
export const DEFAULT_SERVICE_PROMPTS: Record<string, { body: string; description: string }> = {
  'slack.integration_prompt': {
    description: 'System prompt for Slack integration direct-chat fallback',
    body: 'You are OpenAgentic AI, responding via Slack. Be concise, use Slack markdown (*bold*, _italic_, `code`, ```code blocks```). If the user wants to run a workflow, tell them to use `/run <workflow-name>`.',
  },
  'title_gen.ai_service': {
    description: 'System prompt used by AITitleGenerationService to produce chat titles',
    body: `You are a title generator for chat conversations. Your task is to create clear, informative titles.

Rules:
1. Be extremely concise, 2-5 words maximum.
2. Capture the main topic or intent
3. Use proper capitalization
4. No punctuation unless it's a question
5. No quotes or special characters
6. Focus on the user's intent, not implementation details
7. If code is discussed, mention the language/framework
8. Be specific but not verbose

Examples of good titles:
- "Python DataFrame Filtering"
- "React Component Optimization"
- "Database Migration Strategy"
- "Fix Authentication Error"
- "Explain Neural Networks"
- "API Rate Limiting Setup"

Return ONLY the title, nothing else.`,
  },
  'title_gen.client': {
    description: 'System prompt used by TitleGenerationClient.generateMultipleTitles',
    body: `Generate title suggestions for a chat conversation. Each title should be on a new line. Focus on different aspects of the user's message. No numbers, bullets, or prefixes - just the titles.`,
  },
  'memory.context_system': {
    description: 'Fallback system prompt returned by MemoryContextService when building from cache',
    body: 'You are a helpful AI assistant.',
  },
  'memory.context_build': {
    description: 'Fallback system prompt returned by MemoryContextService.buildSystemPrompt()',
    body: 'You are a helpful AI assistant with access to conversation history and relevant context.',
  },
};

// ---------------------------------------------------------------------------
// ServicePromptService
// ---------------------------------------------------------------------------

export class ServicePromptService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis?: ServicePromptRedisLike,
  ) {}

  /**
   * Get the active body for a key.
   * Throws if no active row exists (caller should have ensured seeding).
   */
  async getPrompt(key: string): Promise<string> {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const row = await this.prisma.servicePrompt.findFirst({
      where: { prompt_key: key, is_active: true },
      orderBy: { version: 'desc' },
    });
    if (!row) {
      throw new Error(
        `No active service_prompt for key '${key}'. Seed via seedServicePromptsFromDefaults or POST /api/admin/service-prompts/${key}.`,
      );
    }
    cache.set(key, row.body);
    return row.body;
  }

  /** Invalidate a single key's cache entry (called by redis-pubsub subscriber). */
  invalidate(key: string): void {
    cache.delete(key);
  }

  /** Invalidate all cache entries. */
  invalidateAll(): void {
    cache.clear();
  }

  async setPrompt(
    key: string,
    body: string,
    opts: SetServicePromptOptions,
  ): Promise<ServicePromptVersion> {
    if (!key || key.trim().length === 0) {
      throw new Error('prompt key must not be empty');
    }
    if (!body || body.trim().length === 0) {
      throw new Error('Refusing to write empty service prompt body.');
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const current = await tx.servicePrompt.findFirst({
        where: { prompt_key: key, is_active: true },
        orderBy: { version: 'desc' },
      });

      const nextVersion = (current?.version ?? 0) + 1;

      if (current) {
        await tx.servicePrompt.updateMany({
          where: { prompt_key: key, is_active: true },
          data: { is_active: false },
        });
      }

      const created: ServicePromptVersion = await tx.servicePrompt.create({
        data: {
          prompt_key: key,
          body,
          version: nextVersion,
          is_active: true,
          description: opts.reason ?? null,
        },
      });

      return created;
    });

    cache.set(key, body);
    await this.publishInvalidate(key);
    return result;
  }

  async listVersions(key: string): Promise<ServicePromptVersion[]> {
    return this.prisma.servicePrompt.findMany({
      where: { prompt_key: key },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Roll back a prompt key to a specific prior version.
   * Deactivates the current active row, activates the target version row,
   * updates the in-memory cache, and publishes redis invalidation.
   * Mirrors the rollback pattern of RbacSystemPromptService.
   *
   * Phase W P2.2 — 2026-05-19
   */
  async rollback(
    key: string,
    targetVersion: number,
    opts: SetServicePromptOptions,
  ): Promise<ServicePromptVersion> {
    if (!key || key.trim().length === 0) {
      throw new Error('prompt key must not be empty');
    }

    const result = await this.prisma.$transaction(async (tx: any) => {
      const target = await tx.servicePrompt.findFirst({
        where: { prompt_key: key, version: targetVersion },
      });
      if (!target) {
        throw new Error(`No service_prompt for key='${key}' version=${targetVersion}.`);
      }

      const current = await tx.servicePrompt.findFirst({
        where: { prompt_key: key, is_active: true },
        orderBy: { version: 'desc' },
      });

      if (current && current.version !== targetVersion) {
        await tx.servicePrompt.updateMany({
          where: { prompt_key: key, is_active: true },
          data: { is_active: false },
        });
      }

      await tx.servicePrompt.updateMany({
        where: { prompt_key: key, version: targetVersion },
        data: {
          is_active: true,
          // store rollback reason in description
          description: opts.reason ? `[rollback] ${opts.reason}` : `[rollback to v${targetVersion}]`,
        },
      });

      return { ...target, is_active: true };
    });

    cache.set(key, result.body);
    await this.publishInvalidate(key);
    return result;
  }

  async listKeys(): Promise<Array<{ prompt_key: string; version: number | null; updated_at: Date | null; description: string | null; preview: string | null }>> {
    // Group by prompt_key, return one row per key (the active one)
    const rows = await this.prisma.servicePrompt.findMany({
      where: { is_active: true },
      orderBy: { prompt_key: 'asc' },
    });
    return rows.map((r: any) => ({
      prompt_key: r.prompt_key,
      version: r.version,
      updated_at: r.updated_at,
      description: r.description,
      preview: typeof r.body === 'string' ? r.body.slice(0, 200) : null,
    }));
  }

  /**
   * Subscribe to redis invalidation events from other replicas.
   * Call once at startup — idempotent per channel semantics.
   */
  async subscribeInvalidations(): Promise<void> {
    if (!this.redis) return;
    await this.redis.subscribe(SERVICE_PROMPT_INVALIDATE_CHANNEL, (message: string) => {
      try {
        const payload = JSON.parse(message) as { prompt_key?: string };
        if (payload?.prompt_key) {
          this.invalidate(payload.prompt_key);
        }
      } catch {
        /* ignore malformed payloads */
      }
    });
  }

  private async publishInvalidate(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.publish(
        SERVICE_PROMPT_INVALIDATE_CHANNEL,
        JSON.stringify({ prompt_key: key, ts: Date.now() }),
      );
    } catch {
      /* publish failure should not break the write */
    }
  }
}

// ---------------------------------------------------------------------------
// seedServicePromptsFromDefaults — run at startup, idempotent
// ---------------------------------------------------------------------------

/**
 * Ensures every key in DEFAULT_SERVICE_PROMPTS has at least one active row.
 * Safe to call on every boot — skips keys that already have an active row.
 */
export async function seedServicePromptsFromDefaults(
  prisma: PrismaClient,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const [key, { body, description }] of Object.entries(DEFAULT_SERVICE_PROMPTS)) {
    const existing = await prisma.servicePrompt.findFirst({
      where: { prompt_key: key, is_active: true },
    });
    if (existing) {
      skipped.push(key);
      continue;
    }
    await prisma.servicePrompt.create({
      data: {
        prompt_key: key,
        body,
        version: 1,
        is_active: true,
        description,
      },
    });
    created.push(key);
  }

  return { created, skipped };
}
