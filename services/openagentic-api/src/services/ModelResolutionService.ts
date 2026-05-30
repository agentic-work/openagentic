import type { Logger } from 'pino';

/**
 * ModelResolutionService
 *
 * 2026-04-19 — slider ripped (task #144). Model resolution now honours
 * explicit model requests (for admin / opt-in users) and otherwise picks
 * the highest-priority enabled provider's chatModel. SmartModelRouter
 * applies FCA floors and capability escalation downstream; per-user
 * × per-model caps live in UserModelBudgetService at dispatch time.
 */

interface ModelResolutionContext {
  explicitModel?: string;
  userId: string;
  isAdmin: boolean;
  complexity?: number;
  hasImages?: boolean;
  hasTools?: boolean;
}

interface ModelResolutionResult {
  model: string;
  provider: string;
  reason: string;
}

export class ModelResolutionService {
  private prisma: any;
  private logger: Logger;
  private cache: { providers: any[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 30000;

  constructor(prisma: any, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async resolveModel(context: ModelResolutionContext): Promise<ModelResolutionResult> {
    const providers = await this.getEnabledProviders();

    if (providers.length === 0) {
      throw new Error('No LLM providers configured. Add one via Admin Console > LLM Providers.');
    }

    if (context.explicitModel && context.explicitModel !== 'auto' &&
        context.explicitModel !== 'default' && context.explicitModel !== 'model-router') {
      if (!context.isAdmin) {
        const canSelect = await this.userCanSelectModels(context.userId);
        if (!canSelect) {
          this.logger.info({ userId: context.userId, requestedModel: context.explicitModel },
            '[ModelResolution] Non-admin without model selection permission, using Smart Router');
        } else {
          return this.resolveExplicitModel(context.explicitModel, providers);
        }
      } else {
        return this.resolveExplicitModel(context.explicitModel, providers);
      }
    }

    return this.resolveDefault(providers);
  }

  private async resolveExplicitModel(model: string, providers: any[]): Promise<ModelResolutionResult> {
    for (const p of providers) {
      const config = p.model_config as any || {};
      const allModels = [
        config.chatModel, config.embeddingModel, config.visionModel,
        config.imageModel, config.compactionModel,
        ...(config.additionalModels || [])
      ].filter(Boolean);

      if (allModels.includes(model) || (p.provider_config as any)?.modelId === model) {
        return { model, provider: p.provider_type, reason: `User selected: ${model}` };
      }
    }
    return { model, provider: 'auto', reason: `User selected: ${model} (provider auto-detected)` };
  }

  /**
   * 2026-04-19 — slider ripped. Use the highest-priority provider's chat
   * model as the default; SmartModelRouter applies FCA floors /
   * destructive / infra-ops escalation and UserModelBudgetService
   * enforces per-model spend caps downstream.
   */
  private async resolveDefault(providers: any[]): Promise<ModelResolutionResult> {
    const sorted = [...providers].sort((a, b) => (a.priority || 99) - (b.priority || 99));
    const p = sorted[0];
    const model = (p.model_config as any)?.chatModel || 'default';
    const reason = sorted.length === 1
      ? 'Only provider available'
      : `Top-priority provider (${sorted.length} configured)`;
    return { model, provider: p.provider_type, reason };
  }

  private async getEnabledProviders(): Promise<any[]> {
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.providers;
    }

    try {
      const providers = await this.prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null, status: 'active' },
        orderBy: { priority: 'asc' }
      });
      this.cache = { providers, timestamp: Date.now() };
      return providers;
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[ModelResolution] Failed to query LLMProvider table');
      return this.cache?.providers || [];
    }
  }

  private async userCanSelectModels(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { is_admin: true, ui_preferences: true }
      });
      if (!user) return false;
      if (user.is_admin) return true;
      const prefs = user.ui_preferences as any;
      return prefs?.allow_model_selection === true;
    } catch {
      return false;
    }
  }

  async getDefaultModel(): Promise<string> {
    const providers = await this.getEnabledProviders();
    if (providers.length === 0) {
      throw new Error('No LLM providers configured.');
    }
    const topProvider = providers[0];
    return (topProvider.model_config as any)?.chatModel || 'default';
  }
}
