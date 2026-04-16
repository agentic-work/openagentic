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
      autoAdjustEnabled: permissions?.budget_auto_adjust_slider ?? true,
      currentSlider: permissions?.intelligence_slider ?? null,
      originalSlider: permissions?.budget_original_slider ?? null,
      wasAutoAdjusted: permissions?.budget_auto_adjusted_at !== null,
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

    // Auto-adjust slider if approaching limit
    if (status.autoAdjustEnabled && status.isApproachingLimit && status.budgetCents !== null) {
      const adjustedSlider = await this.calculateAutoAdjustedSlider(status);

      if (adjustedSlider !== status.currentSlider) {
        return {
          allowed: true,
          adjustedSlider,
          reason: `Approaching budget limit (${status.percentUsed?.toFixed(1)}% used). Automatically using more economical models.`,
          budgetStatus: status,
        };
      }
    }

    return {
      allowed: true,
      budgetStatus: status,
    };
  }

  /**
   * Calculate the auto-adjusted slider based on budget remaining
   */
  private async calculateAutoAdjustedSlider(status: BudgetStatus): Promise<number> {
    if (status.budgetCents === null || status.percentUsed === null) {
      return status.currentSlider ?? 50;
    }

    // Map remaining budget percentage to slider position
    // 100% remaining -> keep current slider
    // 80% remaining -> start reducing
    // 50% remaining -> slider at 40% max
    // 20% remaining -> slider at 20% max
    // 0% remaining -> slider at 0%

    const remainingPercent = 100 - status.percentUsed;
    const originalSlider = status.originalSlider ?? status.currentSlider ?? 50;

    if (remainingPercent >= 20) {
      // Still have budget - scale slider proportionally
      // At 100% remaining: full slider
      // At 20% remaining: 20% of original slider
      const scaleFactor = Math.max(0.2, remainingPercent / 100);
      return Math.round(originalSlider * scaleFactor);
    }

    // Very low budget - go ultra-economical
    if (remainingPercent >= 5) {
      return Math.min(10, originalSlider);
    }

    // Almost no budget - most economical
    return 0;
  }

  /**
   * Apply auto-adjusted slider and track original
   */
  async applyAutoAdjustedSlider(userId: string, newSlider: number): Promise<void> {
    const permissions = await this.prisma.userPermissions.findUnique({
      where: { user_id: userId },
    });

    // Only save original if not already saved
    const originalSlider = permissions?.budget_original_slider ?? permissions?.intelligence_slider;

    await this.prisma.userPermissions.update({
      where: { user_id: userId },
      data: {
        intelligence_slider: newSlider,
        budget_original_slider: originalSlider,
        budget_auto_adjusted_at: new Date(),
      },
    });

    logger.info({
      userId,
      originalSlider,
      newSlider,
    }, 'Auto-adjusted slider for budget');
  }

  /**
   * Reset slider to original after budget period resets
   */
  async resetSliderToOriginal(userId: string): Promise<void> {
    const permissions = await this.prisma.userPermissions.findUnique({
      where: { user_id: userId },
    });

    if (permissions?.budget_original_slider !== null) {
      await this.prisma.userPermissions.update({
        where: { user_id: userId },
        data: {
          intelligence_slider: permissions.budget_original_slider,
          budget_original_slider: null,
          budget_auto_adjusted_at: null,
        },
      });

      logger.info({
        userId,
        restoredSlider: permissions.budget_original_slider,
      }, 'Reset slider to original after budget period');
    }
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

    await this.prisma.userPermissions.upsert({
      where: { user_id: userId },
      update: {
        monthly_budget_cents: budgetCents,
        budget_auto_adjust_slider: options?.autoAdjust ?? true,
        budget_warning_threshold: options?.warningThreshold ?? 80,
        budget_hard_limit: options?.hardLimit ?? false,
      },
      create: {
        user_id: userId,
        monthly_budget_cents: budgetCents,
        budget_auto_adjust_slider: options?.autoAdjust ?? true,
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
   * Record spending and check if auto-adjustment is needed
   */
  async recordSpending(userId: string, costCents: number): Promise<BudgetCheckResult | null> {
    if (costCents <= 0) return null;

    // Check budget after spending
    const result = await this.checkBudget(userId);

    // Apply auto-adjustment if needed
    if (result.adjustedSlider !== undefined && result.budgetStatus.autoAdjustEnabled) {
      await this.applyAutoAdjustedSlider(userId, result.adjustedSlider);
    }

    return result;
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
   * Reset budget period (call at start of new month)
   */
  async resetBudgetPeriod(userId: string): Promise<void> {
    await this.prisma.userPermissions.update({
      where: { user_id: userId },
      data: {
        budget_period_start: new Date(),
        budget_last_notified_at: null,
        budget_auto_adjusted_at: null,
        budget_original_slider: null,
      },
    });

    // Restore original slider
    await this.resetSliderToOriginal(userId);

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
