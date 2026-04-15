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

import { PromptModuleRegistry } from './PromptModuleRegistry.js';
import { ModuleScorer } from './ModuleScorer.js';
import { ModelAdapterFactory } from './adapters/ModelAdapterFactory.js';
import { TokenCounter } from '../context/TokenCounter.js';
import type {
  PromptModule,
  ComposeContext,
  ComposedPrompt,
  ModelCapabilities,
  AdapterFamily,
} from './types.js';

export class PromptComposer {
  private static instance: PromptComposer;
  private registry = PromptModuleRegistry.getInstance();
  private scorer = new ModuleScorer();
  private tokenCounter = new TokenCounter();

  static getInstance(): PromptComposer {
    if (!PromptComposer.instance) {
      PromptComposer.instance = new PromptComposer();
    }
    return PromptComposer.instance;
  }

  async compose(context: ComposeContext): Promise<ComposedPrompt> {
    const { loggers } = await import('../../utils/logger.js');
    const logger = loggers.services;

    // 1. Get all enabled modules
    const allModules = await this.registry.getEnabled();

    // 2. Get budget from ContextManagerService
    let systemPromptBudget = 8000; // default
    try {
      const { ContextManagerService } = await import('../context/ContextManagerService.js');
      const ctxMgr = ContextManagerService.getInstance();
      const budget = await ctxMgr.getBudget(context.model, context.mode);
      systemPromptBudget = budget.systemPrompt;
    } catch {
      /* use default */
    }

    // 3. Resolve model family + capabilities
    const family = this.resolveFamily(context.model);
    const capabilities = this.resolveCapabilities(context.model);

    // 4. Select core modules — role-aware identity selection
    const isAdmin = context.isAdmin ?? await this.checkIsAdmin(context.userId);
    const coreModules = allModules.filter((m) => {
      if (m.category !== 'core') return false;
      // Identity modules: pick the right one based on role
      if (m.name === 'identity-admin') return isAdmin;
      if (m.name === 'identity-default') return !isAdmin;
      // Old identity module (before split): treat as default — only inject for non-admins
      if (m.name === 'identity') return !isAdmin;
      // All other core modules: always inject unless explicitly disabled
      return m.injection.alwaysInject !== false;
    });

    // 5. Select mode module(s) matching current context mode
    const modeModules = allModules.filter(
      (m) => m.category === 'mode' && m.injection.requiresMode?.includes(context.mode),
    );

    // 6. Select capability modules based on model capabilities
    const capabilityModules = allModules.filter((m) => {
      if (m.category !== 'capability') return false;
      if (!m.injection.requiresCapabilities) return false;
      return m.injection.requiresCapabilities.some(
        (cap) => (capabilities as unknown as Record<string, unknown>)[cap] === true,
      );
    });

    // 7. Score domain modules
    const domainScores = await this.scorer.score(allModules, context);

    // 8. Apply slider budget percentage
    const sliderPosition = context.sliderPosition ?? 50;
    let domainBudgetPct: number;
    if (sliderPosition <= 30) {
      domainBudgetPct = 0.2;
    } else if (sliderPosition <= 70) {
      domainBudgetPct = 0.6;
    } else {
      domainBudgetPct = 1.0;
    }

    // 9. Calculate budgets
    const reservedTokens = [...coreModules, ...modeModules, ...capabilityModules].reduce(
      (sum, m) => sum + m.tokenCost,
      0,
    );
    const domainBudget = Math.floor((systemPromptBudget - reservedTokens) * domainBudgetPct);

    // 10. Select domain modules within budget (by score, filter score > 0.1 threshold)
    const selectedDomain: PromptModule[] = [];
    let domainTokensUsed = 0;
    for (const scored of domainScores) {
      if (scored.score < 0.1) break; // Below relevance threshold — list is sorted, so stop here
      if (domainTokensUsed + scored.module.tokenCost > domainBudget) continue; // Skip if doesn't fit
      selectedDomain.push(scored.module);
      domainTokensUsed += scored.module.tokenCost;
    }

    // 11. Assemble all selected modules
    const allSelected = [...coreModules, ...modeModules, ...capabilityModules, ...selectedDomain];

    // 12. Apply model adapter to transform modules into system prompt string
    const adapter = ModelAdapterFactory.getAdapter(context.model, family);
    const systemPrompt = adapter.transform(allSelected, capabilities);

    // 13. Calculate final token count
    const tokenCount = this.tokenCounter.estimateTokens(systemPrompt);
    const budgetUsed = tokenCount;
    const budgetRemaining = systemPromptBudget - budgetUsed;

    const composed: ComposedPrompt = {
      systemPrompt,
      modulesUsed: allSelected.map((m) => m.name),
      tokenCount,
      budgetUsed,
      budgetRemaining,
      modelFamily: family,
      capabilitiesDetected: Object.entries(capabilities)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    };

    logger.info(
      {
        mode: context.mode,
        model: context.model,
        family,
        modulesUsed: composed.modulesUsed,
        tokenCount,
        budgetUsed,
        budgetRemaining,
        sliderPosition,
        domainModulesScored: domainScores.length,
        domainModulesSelected: selectedDomain.length,
      },
      '[PROMPT-COMPOSER] Composition complete',
    );

    // Fire-and-forget: log composition for effectiveness tracking
    (async () => {
      try {
        const { prisma: p } = await import('../../utils/prisma.js');
        await p.promptEffectiveness.create({
          data: {
            session_id: context.sessionId || '00000000-0000-0000-0000-000000000000',
            modules: composed.modulesUsed,
            model: context.model,
            model_family: composed.modelFamily,
            mode: context.mode,
            outcome: 'pending',
          },
        });
      } catch {
        /* non-fatal — effectiveness tracking is best-effort */
      }
    })();

    return composed;
  }

  private async checkIsAdmin(userId: string): Promise<boolean> {
    try {
      const { prisma: p } = await import('../../utils/prisma.js');
      const user = await p.user.findUnique({
        where: { id: userId },
        select: { is_admin: true },
      });
      return user?.is_admin === true;
    } catch {
      return false; // Safe default: non-admin
    }
  }

  private resolveFamily(modelId: string): AdapterFamily {
    return ModelAdapterFactory.detectFamily(modelId);
  }

  private resolveCapabilities(modelId: string): ModelCapabilities {
    const family = this.resolveFamily(modelId);
    const m = modelId.toLowerCase();

    return {
      thinking:
        family === 'claude' || m.includes('gemini-2') || m.startsWith('o1') || m.startsWith('o3'),
      tools: family !== 'local' || m.includes('gpt-oss'),
      vision:
        family === 'claude' ||
        family === 'gemini' ||
        m.includes('gpt-4o') ||
        m.includes('gpt-4.1'),
      longContext: family === 'gemini' || family === 'claude',
      audio: m.includes('gemini-2'),
      video: m.includes('gemini-2'),
      documents: family === 'claude' || family === 'gemini',
      streaming: true,
      imageGen:
        m.includes('imagen') || m.includes('nova-canvas') || m.includes('dall-e'),
      audioGen: false,
      videoGen: false,
      embedding: m.includes('embed') || m.includes('nomic'),
      codeExecution: m.includes('gemini-2'),
      grounding: m.includes('gemini-2.5') || m.includes('gemini-2.0'),
    };
  }
}
