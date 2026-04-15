/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Logger } from 'pino';

interface ModelResolutionContext {
  explicitModel?: string;
  userId: string;
  isAdmin: boolean;
  complexity?: number;
  sliderPosition?: number;
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

    return this.resolveByComplexity(context, providers);
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

  private async resolveByComplexity(context: ModelResolutionContext, providers: any[]): Promise<ModelResolutionResult> {
    const sorted = [...providers].sort((a, b) => (a.priority || 99) - (b.priority || 99));

    if (sorted.length === 1) {
      const p = sorted[0];
      const model = (p.model_config as any)?.chatModel || 'default';
      return { model, provider: p.provider_type, reason: 'Only provider available' };
    }

    const sliderPos = context.sliderPosition ?? 50;
    let tier: 'economical' | 'balanced' | 'premium';
    if (sliderPos <= 40) tier = 'economical';
    else if (sliderPos <= 70) tier = 'balanced';
    else tier = 'premium';

    if (tier === 'economical') {
      const p = sorted[sorted.length - 1];
      const model = (p.model_config as any)?.chatModel || 'default';
      return { model, provider: p.provider_type, reason: `Economical tier (slider: ${sliderPos})` };
    } else if (tier === 'premium') {
      const p = sorted[0];
      const model = (p.model_config as any)?.chatModel || 'default';
      return { model, provider: p.provider_type, reason: `Premium tier (slider: ${sliderPos})` };
    } else {
      const midIdx = Math.floor(sorted.length / 2);
      const p = sorted[midIdx];
      const model = (p.model_config as any)?.chatModel || 'default';
      return { model, provider: p.provider_type, reason: `Balanced tier (slider: ${sliderPos})` };
    }
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
