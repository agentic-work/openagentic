/**
 * User Budget Service
 *
 * Manages user spending budgets with auto-slider adjustment.
 *
 * Features:
 * - Monthly budget limits in dollars (stored as cents)
 * - Auto-adjust intelligence slider when approaching budget
 * - Hard limit option to block requests when budget is hit
 * - Budget period tracking and reset
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

export interface BudgetStatus {
  userId: string;
  budgetCents: number | null; // null = unlimited
  spentCents: number;
  remainingCents: number | null;
  percentUsed: number | null;
  isOverBudget: boolean;
  isApproachingLimit: boolean;
  warningThreshold: number;
  hardLimit: boolean;
  autoAdjustEnabled: boolean;
  currentSlider: number | null;
  originalSlider: number | null;
  wasAutoAdjusted: boolean;
  periodStart: Date;
  periodEnd: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedSlider?: number;
  budgetStatus: BudgetStatus;
}

export class UserBudgetService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get current budget status for a user
   */
  async getBudgetStatus(userId: string): Promise<BudgetStatus> {
    // Get user permissions with budget settings
    const permissions = await this.prisma.userPermissions.findUnique({
      where: { user_id: userId },
    });

    const budgetCents = permissions?.monthly_budget_cents ?? null;
    const periodStart = this.getCurrentPeriodStart(permissions?.budget_period_start);
    const periodEnd = this.getCurrentPeriodEnd(periodStart);

    // Get current month spending from LLMUsageAggregate
    const spentCents = await this.getCurrentMonthSpending(userId, periodStart);

    const remainingCents = budgetCents !== null ? Math.max(0, budgetCents - spentCents) : null;
    const percentUsed = budgetCents !== null && budgetCents > 0 ? (spentCents / budgetCents) * 100 : null;

    const warningThreshold = permissions?.budget_warning_threshold ?? 80;
    const isApproachingLimit = percentUsed !== null && percentUsed >= warningThreshold;
    const isOverBudget = budgetCents !== null && spentCents >= budgetCents;

    return {
      userId,
      budgetCents,
      spentCents,
      remainingCents,
      percentUsed,
      isOverBudget,
      isApproachingLimit,
      warningThreshold,
      hardLimit: permissions?.budget_hard_limit ?? false,
      // 2026-04-19 — slider fields are vestigial (task #144, slider rip).
      // Keep them on the BudgetStatus type for back-compat with callers,
      // but always return null/false — TS no longer reads from the DB.
      autoAdjustEnabled: false,
      currentSlider: null,
      originalSlider: null,
      wasAutoAdjusted: false,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Check if a request is allowed based on budget
   * Returns adjusted slider if auto-adjust is enabled
   */
  async checkBudget(userId: string, estimatedCostCents: number = 0): Promise<BudgetCheckResult> {
    const status = await this.getBudgetStatus(userId);

    // No budget = always allowed
    if (status.budgetCents === null) {
      return {
        allowed: true,
        budgetStatus: status,
      };
    }

    // Hard limit check
    if (status.hardLimit && status.isOverBudget) {
      return {
        allowed: false,
        reason: `Monthly budget of $${(status.budgetCents / 100).toFixed(2)} has been reached. Request blocked.`,
        budgetStatus: status,
      };
    }

    // Would this request exceed budget?
    const projectedSpent = status.spentCents + estimatedCostCents;
    if (status.hardLimit && projectedSpent > status.budgetCents) {
      return {
        allowed: false,
        reason: `This request would exceed your monthly budget. Remaining: $${((status.remainingCents ?? 0) / 100).toFixed(2)}`,
        budgetStatus: status,
      };
    }

    // 2026-04-19 — auto-adjust slider block removed (task #144, slider
    // rip). Per-user × per-model caps enforced at dispatch time by
    // UserModelBudgetService instead of shifting a per-user slider.

    return {
      allowed: true,
      budgetStatus: status,
    };
  }

  /**
   * 2026-04-19 — calculateAutoAdjustedSlider kept as vestigial stub for
   * back-compat; no code path calls it after the slider rip. Always
   * returns 50 (neutral).
   */
  private async calculateAutoAdjustedSlider(_status: BudgetStatus): Promise<number> {
    return 50;
  }

  /**
   * 2026-04-19 — applyAutoAdjustedSlider / resetSliderToOriginal are
   * NO-OP after task #144 (slider rip). The DB columns
   * (intelligence_slider, budget_original_slider, budget_auto_adjusted_at)
   * are left in place for back-compat but the TS layer no longer writes
   * to them. Per-user × per-model spend caps now live in
   * UserModelBudgetService and are enforced at dispatch time.
   */
  async applyAutoAdjustedSlider(_userId: string, _newSlider: number): Promise<void> {
    // no-op after 2026-04-19 slider rip
  }

  async resetSliderToOriginal(_userId: string): Promise<void> {
    // no-op after 2026-04-19 slider rip
  }

  /**
   * Set user budget
   */
  async setBudget(
    userId: string,
    budgetDollars: number | null,
    options?: {
      autoAdjust?: boolean;
      warningThreshold?: number;
      hardLimit?: boolean;
    }
  ): Promise<void> {
    const budgetCents = budgetDollars !== null ? Math.round(budgetDollars * 100) : null;

    // 2026-04-19 — slider ripped (task #144); budget_auto_adjust_slider
    // column is left untouched on this write. The DB column stays for
    // back-compat but the API no longer writes to it.
    await this.prisma.userPermissions.upsert({
      where: { user_id: userId },
      update: {
        monthly_budget_cents: budgetCents,
        budget_warning_threshold: options?.warningThreshold ?? 80,
        budget_hard_limit: options?.hardLimit ?? false,
      },
      create: {
        user_id: userId,
        monthly_budget_cents: budgetCents,
        budget_warning_threshold: options?.warningThreshold ?? 80,
        budget_hard_limit: options?.hardLimit ?? false,
      },
    });

    logger.info({
      userId,
      budgetDollars,
      budgetCents,
      options,
    }, 'Set user budget');
  }

  /**
   * Record spending and re-check the budget cap. 2026-04-19 — slider
   * auto-adjust removed (task #144, slider rip); caller just gets the
   * updated status.
   */
  async recordSpending(userId: string, costCents: number): Promise<BudgetCheckResult | null> {
    if (costCents <= 0) return null;
    return await this.checkBudget(userId);
  }

  /**
   * Get current month spending from LLMUsageAggregate
   */
  private async getCurrentMonthSpending(userId: string, periodStart: Date): Promise<number> {
    const result = await this.prisma.lLMUsageAggregate.aggregate({
      where: {
        user_id: userId,
        period_type: 'daily',
        period_start: {
          gte: periodStart,
        },
      },
      _sum: {
        total_cost: true,
      },
    });

    // Convert from dollars to cents
    const totalDollars = Number(result._sum.total_cost ?? 0);
    return Math.round(totalDollars * 100);
  }

  /**
   * Get start of current budget period
   */
  private getCurrentPeriodStart(customStart?: Date | null): Date {
    if (customStart) {
      // Check if custom start is in current month
      const now = new Date();
      const customDate = new Date(customStart);
      if (customDate.getMonth() === now.getMonth() && customDate.getFullYear() === now.getFullYear()) {
        return customDate;
      }
    }

    // Default: first day of current month
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  /**
   * Get end of current budget period
   */
  private getCurrentPeriodEnd(periodStart: Date): Date {
    const nextMonth = new Date(periodStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return nextMonth;
  }

  /**
   * Reset budget period (call at start of new month).
   * 2026-04-19 — slider columns no longer written (task #144, slider rip).
   */
  async resetBudgetPeriod(userId: string): Promise<void> {
    await this.prisma.userPermissions.update({
      where: { user_id: userId },
      data: {
        budget_period_start: new Date(),
        budget_last_notified_at: null,
      },
    });

    logger.info({ userId }, 'Reset budget period');
  }
}

// Singleton instance
let budgetService: UserBudgetService | null = null;

export function getUserBudgetService(prisma: PrismaClient): UserBudgetService {
  if (!budgetService) {
    budgetService = new UserBudgetService(prisma);
  }
  return budgetService;
}
