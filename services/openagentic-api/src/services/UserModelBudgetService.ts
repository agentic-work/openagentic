/**
 * User Model Budget Service (2026-04-19 — replaces SliderService / auto-adjust)
 *
 * Per-user × per-model monthly spend cap, enforced at LLM dispatch time.
 * Hard caps only: once a user hits the cap on model X, further dispatches
 * to X return a dedicated BUDGET_EXHAUSTED error carrying the list of
 * still-affordable alternatives the user has registered — the UI turns
 * that into a "pick another model" prompt rather than silently routing
 * to a cheaper default.
 *
 * Contract:
 *   - one row per (user_id, model_id) in the `user_model_budgets` table
 *     (to be migrated; stored here as JSON on user_permissions.metadata
 *     until the Prisma migration lands so this service ships without
 *     schema changes)
 *   - null / missing budget = no cap (unlimited for that user × model)
 *   - 0 = explicitly blocked
 *   - currentSpendCents is computed from LLMUsageAggregate filtered by
 *     (userId, model) within the current period window (month by default)
 *
 * Not-responsibilities (deliberate):
 *   - this service does NOT silently downshift the model when the cap
 *     is hit; the caller (dispatch stage) gets a hard rejection and the
 *     user decides whether to bump the cap or pick another model
 *   - no slider coupling; the slider is gone
 *   - no hardcoded model-name guards — the cap is by registered model id
 *
 * Prisma migration stub (land separately):
 *   model UserModelBudget {
 *     id                String   @id @default(cuid())
 *     user_id           String
 *     model_id          String
 *     monthly_cap_cents Int?     // null = unlimited
 *     period_start      DateTime @default(now())
 *     updated_at        DateTime @updatedAt
 *     @@unique([user_id, model_id])
 *   }
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export interface ModelBudgetStatus {
  userId: string;
  modelId: string;
  /** Hard monthly cap in cents. null = unlimited, 0 = blocked. */
  capCents: number | null;
  spentCents: number;
  /** capCents - spentCents, or null when capCents is null. Non-negative. */
  remainingCents: number | null;
  /** Percentage of cap used (spentCents / capCents * 100). null when uncapped. */
  percentUsed: number | null;
  /** True when no headroom remains AND capCents was set. */
  exhausted: boolean;
  /** Current rolling-month period window. */
  periodStart: Date;
  periodEnd: Date;
}

export interface ModelBudgetCheckResult {
  allowed: boolean;
  /** On deny: the failure rationale surfaced to the user. */
  reason?: string;
  /** On deny: sibling models the user has registered whose cap still has
   *  headroom. Ordered by absolute remaining cents desc. */
  alternatives?: string[];
  status: ModelBudgetStatus;
}

interface RawBudgetRow {
  model_id: string;
  monthly_cap_cents: number | null;
}

export class UserModelBudgetService {
  private prisma: PrismaClient;
  private logger: Logger;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  /**
   * Load all per-model caps configured for a user. Until the dedicated
   * `user_model_budgets` table ships, we read from the JSON
   * `userPermissions.metadata.modelBudgets` bag and fall back to an
   * empty list when the key is missing.
   */
  async getAllBudgetsForUser(userId: string): Promise<RawBudgetRow[]> {
    try {
      const perms = await this.prisma.userPermissions.findUnique({
        where: { user_id: userId },
      });
      const meta = ((perms as any)?.metadata ?? null) as
        | null
        | { modelBudgets?: Record<string, number | null> };
      if (!meta?.modelBudgets) return [];
      return Object.entries(meta.modelBudgets).map(([model_id, monthly_cap_cents]) => ({
        model_id,
        monthly_cap_cents,
      }));
    } catch (err: any) {
      this.logger.warn({ err: err.message, userId }, '[UserModelBudget] read failed — assuming no caps');
      return [];
    }
  }

  async setBudget(userId: string, modelId: string, capCents: number | null): Promise<void> {
    const existing = await this.prisma.userPermissions.findUnique({
      where: { user_id: userId },
    });
    const meta = (((existing as any)?.metadata as any) ?? {}) as {
      modelBudgets?: Record<string, number | null>;
    };
    meta.modelBudgets = { ...(meta.modelBudgets ?? {}), [modelId]: capCents };

    if (existing) {
      await this.prisma.userPermissions.update({
        where: { user_id: userId },
        data: { metadata: meta as any } as any,
      });
    } else {
      await this.prisma.userPermissions.create({
        data: { user_id: userId, metadata: meta as any } as any,
      });
    }

    this.logger.info({ userId, modelId, capCents }, '[UserModelBudget] cap updated');
  }

  /**
   * Compute spend for (user, model) during the current period window.
   * Reads from LLMUsageAggregate (the same table UserBudgetService uses
   * for totals) so the two budget layers stay coherent. The table keeps
   * cost as a Decimal in dollars (not cents); we convert on read.
   */
  async getSpendForModel(
    userId: string,
    modelId: string,
    periodStart: Date,
  ): Promise<number> {
    try {
      const rows = await this.prisma.lLMUsageAggregate.findMany({
        where: {
          user_id: userId,
          model: modelId,
          period_start: { gte: periodStart },
        },
        select: { total_cost: true },
      });
      return rows.reduce((sum, r) => {
        const dollars = Number((r as any).total_cost ?? 0);
        return sum + Math.round(dollars * 100);
      }, 0);
    } catch (err: any) {
      this.logger.warn(
        { err: err.message, userId, modelId },
        '[UserModelBudget] spend lookup failed — treating as $0 (fail-open on read errors)',
      );
      return 0;
    }
  }

  getCurrentPeriodStart(anchor?: Date | null): Date {
    const base = anchor ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }

  getCurrentPeriodEnd(periodStart: Date): Date {
    return new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
  }

  async getStatus(userId: string, modelId: string): Promise<ModelBudgetStatus> {
    const periodStart = this.getCurrentPeriodStart();
    const periodEnd = this.getCurrentPeriodEnd(periodStart);
    const all = await this.getAllBudgetsForUser(userId);
    const row = all.find((r) => r.model_id === modelId);
    const capCents = row?.monthly_cap_cents ?? null;
    const spentCents = await this.getSpendForModel(userId, modelId, periodStart);
    const remainingCents = capCents === null ? null : Math.max(0, capCents - spentCents);
    const percentUsed =
      capCents === null || capCents === 0 ? null : (spentCents / capCents) * 100;
    const exhausted = capCents !== null && spentCents >= capCents;
    return {
      userId,
      modelId,
      capCents,
      spentCents,
      remainingCents,
      percentUsed,
      exhausted,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Return allowed=true when the user is still within the per-model cap
   * (or has no cap set). On deny, suggest alternative registered models
   * that still have headroom.
   */
  async check(userId: string, modelId: string): Promise<ModelBudgetCheckResult> {
    const status = await this.getStatus(userId, modelId);

    if (!status.exhausted) {
      return { allowed: true, status };
    }

    // Exhausted: look for siblings with remaining headroom
    const all = await this.getAllBudgetsForUser(userId);
    const alternatives: Array<{ modelId: string; remaining: number }> = [];
    for (const row of all) {
      if (row.model_id === modelId) continue;
      if (row.monthly_cap_cents === 0) continue;
      const sibStatus = await this.getStatus(userId, row.model_id);
      if (
        sibStatus.capCents === null ||
        (sibStatus.remainingCents !== null && sibStatus.remainingCents > 0)
      ) {
        alternatives.push({
          modelId: row.model_id,
          remaining: sibStatus.remainingCents ?? Number.POSITIVE_INFINITY,
        });
      }
    }
    alternatives.sort((a, b) => b.remaining - a.remaining);

    return {
      allowed: false,
      reason: `Monthly budget exhausted for model ${modelId} (spent $${(status.spentCents / 100).toFixed(2)} of $${status.capCents ? (status.capCents / 100).toFixed(2) : '?'} cap).`,
      alternatives: alternatives.map((a) => a.modelId),
      status,
    };
  }
}
