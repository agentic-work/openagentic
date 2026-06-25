/**
 * Router Tuning Service
 *
 * Manages the live-configurable scoring weights for SmartModelRouter.
 * Persists to a singleton row in admin.router_tuning, caches in Redis
 * (5-min TTL), and propagates invalidations via Redis pub/sub so every
 * pod drops its cache on the next read without a redeploy.
 *
 * Mirror of PipelineConfigService — same constructor signature, same
 * caching layers, same invalidation pattern.
 */

import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import {
  routerTuningUpdatedCounter,
  routerTuningCurrentGauge,
} from '../metrics/index.js';

// ============================================================================
// Types
// ============================================================================

// Phase E.10 (2026-05-10) — per-intent top-K type + field ripped
// alongside the legacy ranker service (Phase E.2). The discovery-first
// chatmode resolves tools via `tool_search` mid-turn instead.

export interface RouterTuning {
  id: string;
  fcaQualityFloor: number;
  fcaQualityMultiplier: number;
  fcaQualityGatedByComplexity: boolean;
  fcaChatPoolFloor: number;
  fcaSimpleToolFloor: number;
  fcaComplexToolFloor: number;
  fcaDestructiveFloor: number;
  fcaInfraOpsFloor: number;
  fcaCloudListFloor: number;
  fcaComplexityBiasFloor: number;
  // T3 capability gate — FCA + context floors. Ripped from the
  // hardcoded T3_FCA_FLOOR / T3_CONTEXT_FLOOR constants in
  // SmartModelRouter.ts on 2026-05-22 (#1049).
  fcaT3Floor: number;
  contextT3Floor: number;
  // T3 trigger taskType allowlist — structural classifier output only.
  // No lexical / regex safety-net (per #805 rip). When the prompt
  // classifier emits any TaskType in this list, the T3 gate fires.
  t3TriggerTaskTypes: string[];
  // Per-taskType capability floors — what each PromptClassifier-emitted
  // TaskType requires for tool-use reliability (FCA) and context window
  // size. Ripped from hardcoded CAPABILITY_PROFILES literals in
  // PromptClassifier.ts on 2026-05-22 (#1049).
  capabilityProfileFloors: Record<string, number>;
  capabilityContextFloors: Record<string, number>;
  // T2 — LLM intent classifier (replaces 4 regex detectors). Output
  // flows to the chat pipeline; the FCA-escalation branch that consumed
  // the per-intent FCA-floor field was ripped 2026-05-02 alongside the
  // viz-tier ladder, and the per-intent top-K branch was ripped
  // 2026-05-10 (Phase E.10) alongside the legacy ranker service.
  intentClassifierEnabled: boolean;
  intentClassifierModelId: string;
  costWeight: number;
  qualityWeight: number;
  costNormalizationCeiling: number;
  costBonusMaxPoints: number;
  latencyBonusMaxPoints: number;
  toolCallingBonusMaxPoints: number;
  reasoningBonusMaxPoints: number;
  updated_at: Date;
  updated_by: string | null;
}

export type RouterTuningPatch = Partial<Omit<RouterTuning, 'id' | 'updated_at' | 'updated_by'>>;

// ============================================================================
// Defaults — exactly the hardcoded constants that currently live in
// SmartModelRouter.ts; stage-C wiring will be a behavioural no-op.
// ============================================================================

export const ROUTER_TUNING_DEFAULTS: Omit<RouterTuning, 'id' | 'updated_at' | 'updated_by'> = {
  fcaQualityFloor: 0.75,
  fcaQualityMultiplier: 100.0,
  fcaQualityGatedByComplexity: true,
  fcaChatPoolFloor: 0.82,
  fcaSimpleToolFloor: 0.83,
  fcaComplexToolFloor: 0.90,
  fcaDestructiveFloor: 0.93,
  fcaInfraOpsFloor: 0.85,
  fcaCloudListFloor: 0.90,
  fcaComplexityBiasFloor: 0.93,
  // T3 capability gate defaults — same numerics as the prior
  // T3_FCA_FLOOR / T3_CONTEXT_FLOOR constants in SmartModelRouter.ts.
  // Defaults match the migration seed; behaviour is a no-op until an
  // admin edits them via /admin#router-tuning.
  fcaT3Floor: 0.93,
  contextT3Floor: 200_000,
  t3TriggerTaskTypes: [
    'cost-audit',
    'architecture-design-agentic',
    'multi-cloud-agentic',
    'multi-system-agentic',
  ],
  capabilityProfileFloors: {
    'multi-cloud-agentic': 0.90,
    'multi-system-agentic': 0.90,
    'cost-analysis-agentic': 0.90,
    'cost-audit': 0.93,
    'security-audit-agentic': 0.90,
    'architecture-design-agentic': 0.90,
    'single-system-read': 0.85,
    'file-read': 0.85,
    'pure-chat': 0.82,
  },
  capabilityContextFloors: {
    'multi-cloud-agentic': 30_000,
    'multi-system-agentic': 30_000,
    'cost-analysis-agentic': 100_000,
    'cost-audit': 100_000,
    'security-audit-agentic': 30_000,
    'architecture-design-agentic': 30_000,
    'single-system-read': 8_000,
    'file-read': 16_000,
    'pure-chat': 4_000,
  },
  // T2 defaults — classifier on, classifier-model auto-resolved from the
  // registry. Empty string is the sentinel for "look up the chat-role
  // default at construction time" (see startup/04-providers.ts). Admin
  // can pin a specific model via the /admin#routing UI for cost control.
  // The classifier output flows to the chat pipeline; the
  // FCA-escalation branch that consumed the per-intent FCA-floor field
  // was ripped 2026-05-02 with the viz-tier ladder, and the per-intent
  // top-K branch was ripped 2026-05-10 (Phase E.10) alongside the
  // legacy ranker service.
  // Why no literal: docs/rules/no-hardcoded-models.md. Pinned by
  // src/__tests__/architecture/router-tuning-no-classifier-model-literal.source-regression.test.ts.
  intentClassifierEnabled: true,
  intentClassifierModelId: '',
  costWeight: 0.5,
  qualityWeight: 0.5,
  costNormalizationCeiling: 0.01,
  costBonusMaxPoints: 25.0,
  latencyBonusMaxPoints: 10.0,
  toolCallingBonusMaxPoints: 50.0,
  reasoningBonusMaxPoints: 30.0,
};

// ============================================================================
// Redis interface (same shape as PipelineConfigService)
// ============================================================================

interface RedisLike {
  get<T = any>(key: string): Promise<T | string | null>;
  set(key: string, value: any, ttl?: number): Promise<any>;
  del(key: string): Promise<any>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

const SINGLETON_ID = 'singleton';
const CACHE_KEY = 'router-tuning:current';
const INVALIDATION_CHANNEL = 'router-tuning:invalidated';
const CACHE_TTL_SECONDS = 300; // 5 minutes

// ============================================================================
// Service
// ============================================================================

export class RouterTuningService {
  private readonly logger: pino.Logger;
  private readonly prisma: PrismaClient;
  private readonly redis: RedisLike | null;

  /** In-process cache so a burst of reads in one pod only hits Redis once. */
  private cached: RouterTuning | null = null;
  private cacheTimestamp = 0;
  private readonly IN_MEMORY_TTL_MS = 60_000; // 1 minute

  /** Guards the one-time cross-pod invalidation subscription (lazy, see ensureSubscribed). */
  private subscribed = false;

  constructor(prisma: PrismaClient, redis?: RedisLike | null) {
    this.logger = pino({ name: 'RouterTuningService' });
    this.prisma = prisma;
    this.redis = redis ?? null;
    // The cross-pod pub/sub subscription is wired lazily on first read
    // (ensureSubscribed) so no async work runs in the constructor.
  }

  /**
   * Wire up the pub/sub subscriber so this pod invalidates its cache when
   * another pod publishes a tuning change. Runs at most once, lazily, on the
   * first read. Best-effort: a subscribe failure degrades to single-replica mode.
   */
  private ensureSubscribed(): void {
    if (this.subscribed || !this.redis) return;
    this.subscribed = true;
    this.redis
      .subscribe(INVALIDATION_CHANNEL, () => {
        this.cached = null;
        this.cacheTimestamp = 0;
        this.logger.info('Router tuning cache invalidated via pub/sub');
      })
      .catch((err: Error) => {
        this.logger.warn({ err: err.message }, 'Failed to subscribe to router-tuning:invalidated — single-replica mode');
      });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Return the current router tuning config.
   * Read order: in-memory cache → Redis → DB → hardcoded defaults.
   */
  async getTuning(): Promise<RouterTuning> {
    this.ensureSubscribed();

    // 1. In-memory cache
    if (this.cached && Date.now() - this.cacheTimestamp < this.IN_MEMORY_TTL_MS) {
      return this.cached;
    }

    // 2. Redis cache
    if (this.redis) {
      try {
        const raw = await this.redis.get<RouterTuning>(CACHE_KEY);
        if (raw) {
          const tuning = typeof raw === 'string' ? JSON.parse(raw) as RouterTuning : raw;
          this.cached = tuning;
          this.cacheTimestamp = Date.now();
          return tuning;
        }
      } catch (err: any) {
        this.logger.warn({ err: err.message }, 'Failed to read router tuning from Redis');
      }
    }

    // 3. Database
    const tuning = await this.loadFromDb();
    await this.writeCache(tuning);
    return tuning;
  }

  /**
   * Apply a partial patch, persist to DB, bump Redis cache, and publish
   * an invalidation so sibling pods drop their caches on next read.
   */
  async updateTuning(patch: RouterTuningPatch, updatedBy: string): Promise<RouterTuning> {
    this.validatePatch(patch);

    const current = await this.getTuning();
    const merged: RouterTuning = {
      ...current,
      ...patch,
      id: SINGLETON_ID,
      updated_at: new Date(),
      updated_by: updatedBy,
    };

    await this.saveToDb(merged);
    await this.writeCache(merged);
    await this.publishInvalidation();

    // Metrics: counter per changed field + gauge per numeric field
    try {
      for (const field of Object.keys(patch) as Array<keyof RouterTuningPatch>) {
        routerTuningUpdatedCounter.inc({ field: field as string, updated_by: updatedBy || 'unknown' });
      }
      this._emitTuningGauges(merged);
    } catch { /* metrics error — non-fatal */ }

    this.logger.info({ updatedBy, patch }, 'Router tuning updated');
    return merged;
  }

  /**
   * Restore all tunables to their hardcoded defaults.
   */
  async resetToDefaults(updatedBy: string): Promise<RouterTuning> {
    const defaults: RouterTuning = {
      id: SINGLETON_ID,
      ...ROUTER_TUNING_DEFAULTS,
      updated_at: new Date(),
      updated_by: updatedBy,
    };

    await this.saveToDb(defaults);
    await this.writeCache(defaults);
    await this.publishInvalidation();

    // Metrics: counter per field (all fields reset) + gauge for each numeric field
    try {
      for (const field of Object.keys(ROUTER_TUNING_DEFAULTS)) {
        routerTuningUpdatedCounter.inc({ field, updated_by: updatedBy || 'admin' });
      }
      this._emitTuningGauges(defaults);
    } catch { /* metrics error — non-fatal */ }

    this.logger.info({ updatedBy }, 'Router tuning reset to defaults');
    return defaults;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async loadFromDb(): Promise<RouterTuning> {
    try {
      const row = await (this.prisma as any).routerTuning.findUnique({
        where: { id: SINGLETON_ID },
      });

      if (row) {
        try { this._emitTuningGauges(row as RouterTuning); } catch { /* metrics error — non-fatal */ }
        return row as RouterTuning;
      }
    } catch (err: any) {
      this.logger.warn({ err: err.message }, 'Failed to load router tuning from DB, using defaults');
    }

    // Fall back to in-memory defaults — the seeder hasn't run yet or DB is unavailable.
    const fallback: RouterTuning = {
      id: SINGLETON_ID,
      ...ROUTER_TUNING_DEFAULTS,
      updated_at: new Date(0),
      updated_by: null,
    };
    try { this._emitTuningGauges(fallback); } catch { /* metrics error — non-fatal */ }
    return fallback;
  }

  /**
   * Emit Prometheus gauges for all numeric tuning fields.
   * Called on DB reads and writes so the gauge always reflects current state.
   * Booleans are skipped — Gauge requires a numeric value.
   */
  private _emitTuningGauges(tuning: RouterTuning): void {
    const numericFields: Array<keyof typeof ROUTER_TUNING_DEFAULTS> = [
      'fcaQualityFloor',
      'fcaQualityMultiplier',
      'fcaChatPoolFloor',
      'fcaSimpleToolFloor',
      'fcaComplexToolFloor',
      'fcaDestructiveFloor',
      'fcaInfraOpsFloor',
      'fcaCloudListFloor',
      'fcaComplexityBiasFloor',
      'fcaT3Floor',
      'contextT3Floor',
      'costWeight',
      'qualityWeight',
      'costNormalizationCeiling',
      'costBonusMaxPoints',
      'latencyBonusMaxPoints',
      'toolCallingBonusMaxPoints',
      'reasoningBonusMaxPoints',
    ];
    for (const field of numericFields) {
      const val = (tuning as any)[field];
      if (typeof val === 'number') {
        routerTuningCurrentGauge.set({ field: field as string }, val);
      }
    }
  }

  private async saveToDb(tuning: RouterTuning): Promise<void> {
    await (this.prisma as any).routerTuning.upsert({
      where: { id: SINGLETON_ID },
      create: tuning,
      update: {
        ...tuning,
        id: undefined, // id is the where key; don't include in update payload
      },
    });
  }

  private async writeCache(tuning: RouterTuning): Promise<void> {
    this.cached = tuning;
    this.cacheTimestamp = Date.now();

    if (this.redis) {
      try {
        await this.redis.set(CACHE_KEY, tuning, CACHE_TTL_SECONDS);
      } catch (err: any) {
        this.logger.warn({ err: err.message }, 'Failed to write router tuning to Redis cache');
      }
    }
  }

  private async publishInvalidation(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.publish(
        INVALIDATION_CHANNEL,
        JSON.stringify({ ts: Date.now(), source: process.env.HOSTNAME ?? 'unknown' }),
      );
    } catch (err: any) {
      this.logger.warn({ err: err.message }, 'Failed to publish router-tuning:invalidated');
    }
  }

  /**
   * Validate that all numeric fields are actually numbers and the boolean is boolean.
   * Throws on invalid input so the API layer can return 400.
   */
  private validatePatch(patch: RouterTuningPatch): void {
    const numericFields: Array<keyof RouterTuningPatch> = [
      'fcaQualityFloor',
      'fcaQualityMultiplier',
      'fcaChatPoolFloor',
      'fcaSimpleToolFloor',
      'fcaComplexToolFloor',
      'fcaDestructiveFloor',
      'fcaInfraOpsFloor',
      'fcaCloudListFloor',
      'fcaComplexityBiasFloor',
      'fcaT3Floor',
      'contextT3Floor',
      'costWeight',
      'qualityWeight',
      'costNormalizationCeiling',
      'costBonusMaxPoints',
      'latencyBonusMaxPoints',
      'toolCallingBonusMaxPoints',
      'reasoningBonusMaxPoints',
    ];

    for (const field of numericFields) {
      const val = patch[field];
      if (val !== undefined && (typeof val !== 'number' || Number.isNaN(val as number))) {
        throw new TypeError(`RouterTuning.${field} must be a number, got ${typeof val}`);
      }
    }

    // JSON shape validation — t3TriggerTaskTypes must be string[];
    // capabilityProfileFloors / capabilityContextFloors must be
    // Record<string, number>. Reject any other shape with TypeError
    // so the API layer can return 400.
    if (patch.t3TriggerTaskTypes !== undefined) {
      if (
        !Array.isArray(patch.t3TriggerTaskTypes) ||
        !patch.t3TriggerTaskTypes.every((v) => typeof v === 'string')
      ) {
        throw new TypeError(
          `RouterTuning.t3TriggerTaskTypes must be a string[] of TaskType identifiers, ` +
            `got ${typeof patch.t3TriggerTaskTypes}`,
        );
      }
    }

    for (const field of ['capabilityProfileFloors', 'capabilityContextFloors'] as const) {
      const val = patch[field];
      if (val === undefined) continue;
      if (val === null || typeof val !== 'object' || Array.isArray(val)) {
        throw new TypeError(
          `RouterTuning.${field} must be an object (Record<string, number>), got ${
            Array.isArray(val) ? 'array' : typeof val
          }`,
        );
      }
      for (const [k, v] of Object.entries(val)) {
        if (typeof v !== 'number' || Number.isNaN(v as number)) {
          throw new TypeError(
            `RouterTuning.${field}["${k}"] must be a number, got ${typeof v}`,
          );
        }
      }
    }

    if (
      patch.fcaQualityGatedByComplexity !== undefined &&
      typeof patch.fcaQualityGatedByComplexity !== 'boolean'
    ) {
      throw new TypeError(
        `RouterTuning.fcaQualityGatedByComplexity must be a boolean, got ${typeof patch.fcaQualityGatedByComplexity}`,
      );
    }

    if (
      patch.intentClassifierEnabled !== undefined &&
      typeof patch.intentClassifierEnabled !== 'boolean'
    ) {
      throw new TypeError(
        `RouterTuning.intentClassifierEnabled must be a boolean, got ${typeof patch.intentClassifierEnabled}`,
      );
    }

    if (
      patch.intentClassifierModelId !== undefined &&
      typeof patch.intentClassifierModelId !== 'string'
    ) {
      throw new TypeError(
        `RouterTuning.intentClassifierModelId must be a string ` +
          `(empty string '' = auto-resolve from registry's chat-role default; ` +
          `non-empty = pinned override)`,
      );
    }

    // Phase E.10 (2026-05-10) — per-intent top-K validation block ripped.
  }
}

// ============================================================================
// Singleton factory (mirrors getPipelineConfigService)
// ============================================================================

let _instance: RouterTuningService | null = null;

export function getRouterTuningService(
  prisma: PrismaClient,
  redis?: RedisLike | null,
): RouterTuningService {
  if (!_instance) {
    _instance = new RouterTuningService(prisma, redis);
  }
  return _instance;
}

/** Test helper — reset the module-level singleton between test cases. */
export function resetRouterTuningServiceInstance(): void {
  _instance = null;
}
