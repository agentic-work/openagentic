/**
 * ChatLoopConfigService — admin-tunable knobs for the chat loop.
 *
 * SoT for the chat-loop runtime parameters that operators want to tune
 * live without redeploying. First knob: `max_turns` (the Sev-1 surfaced
 * by the 2026-05-11 multi-cloud capstone: gpt-5.4 hit `max-turns cap
 * (12)` during cascade discovery + 32-tool fanout). The schema is
 * future-proofed for additional knobs (per_tool_timeout_ms,
 * max_parallel_tools) — only `maxTurns` is exposed today.
 *
 * Storage: row in `admin.system_configuration` keyed by `chat_loop`.
 * Caching: in-memory (30s TTL) + Redis (60s TTL). Setter invalidates
 * both. Pattern mirrors `WebhookSecurityService` exactly so it
 * integrates cleanly into the existing admin tooling.
 */

import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

// ---------------------------------------------------------------------------
// Types + Defaults
// ---------------------------------------------------------------------------

/**
 * Full config bag. Future knobs go here. Single source of truth — every
 * caller reads through `getConfig()` / `getMaxTurns()`; never DIY from
 * SystemConfiguration directly.
 */
export interface ChatLoopConfig {
  /**
   * Maximum number of ReAct turns chatLoop will run before forcing an
   * `end_turn` and returning `ok: false` with `error: 'hit max-turns
   * cap (N) without an end_turn'`. Range [4, 100].
   *
   * Why 24 default (was 12 hardcoded): the 2026-05-11 multi-cloud
   * capstone hit 12 during 32-tool cascade discovery + per-cloud fanout;
   * 24 gives 2x headroom while still keeping a safety cap on
   * pathological loops.
   */
  maxTurns: number;

  /**
   * Maximum number of parallel `Task` (sub-agent) dispatches the model
   * can fire in a single turn. Beyond this, chatLoop short-circuits with
   * a guidance annotation telling the model to split-by-turn.
   *
   * Cost-safety guard — one misguided turn that fires `Task` 32 times
   * (one per subscription / region / cloud) creates unbounded sub-agent
   * cost. Anthropic's multi-agent research system recommends scaling to
   * query complexity: simple = 1, complex = 10+. Default 4 strikes a
   * balance between useful fan-out and runaway cost.
   *
   * Range [1, 32]. Source:
   * https://www.anthropic.com/engineering/multi-agent-research-system
   */
  maxConcurrentSubagents: number;
}

export const CHAT_LOOP_CONFIG_DEFAULTS: ChatLoopConfig = {
  maxTurns: 24,
  maxConcurrentSubagents: 4,
};

/** Inclusive lower bound for `maxTurns` (anything below is a typo). */
export const MAX_TURNS_FLOOR = 4;
/** Inclusive upper bound for `maxTurns` (above is a runaway). */
export const MAX_TURNS_CEILING = 100;
/** Inclusive lower bound for `maxConcurrentSubagents`. */
export const MAX_CONCURRENT_SUBAGENTS_FLOOR = 1;
/** Inclusive upper bound for `maxConcurrentSubagents`. */
export const MAX_CONCURRENT_SUBAGENTS_CEILING = 32;

const CONFIG_KEY = 'chat_loop';
const REDIS_CONFIG_KEY = 'chat_loop_config';
const CACHE_TTL_MS = 30_000; // in-memory
const REDIS_TTL_SECONDS = 60; // Redis

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ChatLoopConfigService {
  private cached: ChatLoopConfig | null = null;
  private cacheLoadedAt = 0;

  /**
   * Load + cache the full config bag. Order: in-memory → Redis → DB.
   * On a missing DB row, seeds defaults so the operator sees the row
   * in the admin table from the first read.
   */
  async getConfig(): Promise<ChatLoopConfig> {
    const now = Date.now();
    if (this.cached && now - this.cacheLoadedAt < CACHE_TTL_MS) {
      return this.cached;
    }

    try {
      // 1. Redis
      const redis = getRedisClient();
      if (redis.isConnected()) {
        const cached = await redis.get<ChatLoopConfig>(REDIS_CONFIG_KEY);
        if (cached) {
          this.cached = { ...CHAT_LOOP_CONFIG_DEFAULTS, ...cached };
          this.cacheLoadedAt = now;
          return this.cached;
        }
      }

      // 2. DB
      const row = await prisma.systemConfiguration.findFirst({
        where: { key: CONFIG_KEY, is_active: true },
      });

      if (row?.value) {
        const parsed = row.value as Partial<ChatLoopConfig>;
        this.cached = { ...CHAT_LOOP_CONFIG_DEFAULTS, ...parsed };

        // Warm Redis for sibling pods
        if (redis.isConnected()) {
          await redis.set(REDIS_CONFIG_KEY, this.cached, REDIS_TTL_SECONDS);
        }
      } else {
        // 3. Seed defaults so admins see the row in the table on first GET.
        // This matches the WebhookSecurityService pattern — the seed makes
        // the row visible to /admin#chat-loop without a separate seeder.
        this.cached = { ...CHAT_LOOP_CONFIG_DEFAULTS };
        await this.persistConfig(this.cached, null, 'auto-seeded on first read');
      }
    } catch (err) {
      logger.warn(
        { err },
        '[ChatLoopConfig] Failed to load config — using in-memory defaults',
      );
      this.cached = { ...CHAT_LOOP_CONFIG_DEFAULTS };
    }

    this.cacheLoadedAt = now;
    return this.cached;
  }

  /**
   * Convenience accessor — the chat-loop only needs maxTurns. Other call
   * sites can use `getConfig()` directly when more knobs land.
   */
  async getMaxTurns(): Promise<number> {
    const config = await this.getConfig();
    return config.maxTurns;
  }

  /**
   * Convenience accessor for the fan-out cap. chatLoop reads this before
   * partitionToolCalls; if more Task calls than this fire in a single
   * turn, chatLoop short-circuits with an annotation frame and synthetic
   * tool_result rows guiding the model to split across turns.
   */
  async getMaxConcurrentSubagents(): Promise<number> {
    const config = await this.getConfig();
    return config.maxConcurrentSubagents;
  }

  /**
   * Admin setter — validates range, persists, invalidates caches. Throws
   * on invalid input so the REST handler can map to 400.
   */
  async setMaxTurns(value: number, updatedBy: string): Promise<ChatLoopConfig> {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < MAX_TURNS_FLOOR ||
      value > MAX_TURNS_CEILING
    ) {
      throw new RangeError(
        `chat_loop.max_turns must be an integer in [${MAX_TURNS_FLOOR}, ${MAX_TURNS_CEILING}] — got ${value}`,
      );
    }

    const current = await this.getConfig();
    const merged: ChatLoopConfig = { ...current, maxTurns: value };
    await this.persistConfig(
      merged,
      updatedBy,
      'chat-loop runtime tuning (admin-editable)',
    );
    return merged;
  }

  /**
   * Admin setter for the sub-agent fan-out cap.
   */
  async setMaxConcurrentSubagents(value: number, updatedBy: string): Promise<ChatLoopConfig> {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < MAX_CONCURRENT_SUBAGENTS_FLOOR ||
      value > MAX_CONCURRENT_SUBAGENTS_CEILING
    ) {
      throw new RangeError(
        `chat_loop.max_concurrent_subagents must be an integer in [${MAX_CONCURRENT_SUBAGENTS_FLOOR}, ${MAX_CONCURRENT_SUBAGENTS_CEILING}] — got ${value}`,
      );
    }

    const current = await this.getConfig();
    const merged: ChatLoopConfig = { ...current, maxConcurrentSubagents: value };
    await this.persistConfig(
      merged,
      updatedBy,
      'chat-loop runtime tuning (admin-editable)',
    );
    return merged;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async persistConfig(
    config: ChatLoopConfig,
    updatedBy: string | null,
    description: string,
  ): Promise<void> {
    await prisma.systemConfiguration.upsert({
      where: { key: CONFIG_KEY },
      update: {
        value: config as any,
        updated_at: new Date(),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      },
      create: {
        key: CONFIG_KEY,
        value: config as any,
        description,
        is_active: true,
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      },
    });

    // Invalidate caches so the next read picks up the change.
    this.cached = config;
    this.cacheLoadedAt = Date.now();
    const redis = getRedisClient();
    if (redis.isConnected()) {
      try {
        await redis.del(REDIS_CONFIG_KEY);
      } catch (err) {
        logger.warn(
          { err },
          '[ChatLoopConfig] Failed to invalidate Redis cache (non-fatal)',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _instance: ChatLoopConfigService | null = null;

export function getChatLoopConfigService(): ChatLoopConfigService {
  if (!_instance) {
    _instance = new ChatLoopConfigService();
  }
  return _instance;
}

/** Test helper — reset the singleton between cases. */
export function resetChatLoopConfigServiceInstance(): void {
  _instance = null;
}
