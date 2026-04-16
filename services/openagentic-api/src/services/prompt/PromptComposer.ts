import { PromptModuleRegistry } from './PromptModuleRegistry.js';
import { ModuleScorer } from './ModuleScorer.js';
import { ModelAdapterFactory } from './adapters/ModelAdapterFactory.js';
import { TokenCounter } from '../context/TokenCounter.js';
import { evaluateUserIntent } from './ArtifactIntentGate.js';
import type {
  PromptModule,
  ComposeContext,
  ComposedPrompt,
  ModelCapabilities,
  AdapterFamily,
  UserIntent,
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

    // 0. Evaluate user intent gate (if not pre-supplied). Used downstream to
    //    filter modules whose injection rule requires a specific user intent.
    //    See openagentic-omhs#327 — replaces broad keyword heuristics that
    //    biased every chat toward artifact / cost-visualization output.
    const intentDecision = context.userIntent !== undefined
      ? { intent: context.userIntent ?? null, reason: 'caller-supplied' as const, matched: undefined as string | undefined }
      : evaluateUserIntent(context.message);
    const userIntent: UserIntent | null = intentDecision.intent;

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

    // 10. Select domain modules. Two passes:
    //   a) Intent-required modules whose `requiresUserIntent` matches the
    //      caller-signalled / gate-evaluated intent ALWAYS get selected when
    //      they fit the budget. They bypass the relevance-score threshold
    //      because their injection rule already declares "only include when
    //      intent matches" — so the intent signal IS the relevance signal.
    //      Without this, intent-gated modules (e.g. `artifact-creation` on
    //      the artifact agent's resolve path) were scored 0 on an empty
    //      message and filtered out before even reaching the intent gate.
    //      See openagentic-omhs#327.
    //   b) Remaining domain modules filtered by score threshold as before.
    const selectedDomain: PromptModule[] = [];
    let domainTokensUsed = 0;
    const intentMatchedNames = new Set<string>();
    if (userIntent) {
      for (const scored of domainScores) {
        const req = scored.module.injection?.requiresUserIntent;
        if (!req || !req.includes(userIntent)) continue;
        if (domainTokensUsed + scored.module.tokenCost > domainBudget) continue;
        selectedDomain.push(scored.module);
        domainTokensUsed += scored.module.tokenCost;
        intentMatchedNames.add(scored.module.name);
      }
    }
    for (const scored of domainScores) {
      if (intentMatchedNames.has(scored.module.name)) continue;
      if (scored.score < 0.1) break; // Below relevance threshold — list is sorted, so stop here
      if (domainTokensUsed + scored.module.tokenCost > domainBudget) continue; // Skip if doesn't fit
      selectedDomain.push(scored.module);
      domainTokensUsed += scored.module.tokenCost;
    }

    // 11. Assemble all selected modules, then apply the user-intent gate.
    //     Two complementary intent rules:
    //       - `requiresUserIntent`: only inject when intent MATCHES one
    //         of the listed values (positive gate, e.g. artifact-creation
    //         only fires on visualization intent).
    //       - `excludesUserIntent`: only inject when intent does NOT
    //         match any of the listed values (inverse gate, e.g. an
    //         "artifact-inhibitor" module fires on every non-visual
    //         request to suppress the local model's training bias toward
    //         emitting unsolicited artifact:html blocks).
    //     See openagentic-omhs#327 + #330 follow-up.
    const preGate = [...coreModules, ...modeModules, ...capabilityModules, ...selectedDomain];
    const droppedByIntentGate: string[] = [];
    const allSelected = preGate.filter((m) => {
      const required = m.injection?.requiresUserIntent;
      const excluded = m.injection?.excludesUserIntent;
      // Positive gate: must match if set
      if (required && required.length > 0) {
        if (!userIntent || !required.includes(userIntent)) {
          droppedByIntentGate.push(m.name);
          return false;
        }
      }
      // Inverse gate: must NOT match if set
      if (excluded && excluded.length > 0) {
        if (userIntent && excluded.includes(userIntent)) {
          droppedByIntentGate.push(m.name);
          return false;
        }
      }
      return true;
    });

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
        userIntent,
        userIntentReason: intentDecision.reason,
        userIntentMatched: intentDecision.matched,
        droppedByIntentGate,
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
      // Tool use is not a family-level distinction. Every model in our
      // routing reaches MCP tools through the same server-side bridge —
      // local ollama models (gpt-oss, qwen3.5, ...) and cloud Claude
      // models both emit tool-call JSON that the server executes.
      // Treating `family === 'local'` as "no tools" excluded local
      // models from capability-gated modules like `chart-rendering`
      // even though they can and do use tools. See openagentic-omhs#327.
      tools: true,
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
