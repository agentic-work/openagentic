import { ModuleEmbeddingService } from './ModuleEmbeddingService.js';
import type { PromptModule, ComposeContext, ModuleScore } from './types.js';

export class ModuleScorer {
  /**
   * Score domain modules for relevance to the current request.
   * Returns modules sorted by score descending.
   * Non-domain modules (core/mode/capability) are skipped — they are pre-selected by PromptComposer.
   */
  async score(modules: PromptModule[], context: ComposeContext): Promise<ModuleScore[]> {
    const scores: ModuleScore[] = [];

    // 1. Semantic similarity via pgvector
    const semanticScores = new Map<string, number>();
    try {
      const { UniversalEmbeddingService } = await import('../UniversalEmbeddingService.js');
      const embeddingService = new UniversalEmbeddingService();
      const result = await embeddingService.generateEmbedding(context.message);
      const queryEmbedding = result?.embedding;
      if (queryEmbedding && queryEmbedding.length > 0) {
        const similar = await ModuleEmbeddingService.searchSimilar(queryEmbedding, 20);
        for (const s of similar) {
          semanticScores.set(s.module_name, s.similarity);
        }
      }
    } catch {
      // Semantic search unavailable — score will rely on other signals
    }

    // 2. Tool-rule matching: gather available tool names from context
    const availableToolNames = (context.availableTools || [])
      .map((t: any) => t.function?.name || t.name || '')
      .filter(Boolean) as string[];

    // 3. History boost signals from StructuredSummary
    const summaryProviders: string[] = context.structuredSummary?.cloudProviders || [];
    const summaryTools: string[] = context.structuredSummary?.toolsUsed || [];

    for (const mod of modules) {
      // Only score domain modules (core/mode/capability are pre-selected by PromptComposer)
      if (mod.category !== 'domain') continue;

      // ── Semantic score ───────────────────────────────────────────────────────
      const semantic = semanticScores.get(mod.name) || 0;

      // ── Tool rule match ──────────────────────────────────────────────────────
      let toolRule = 0;

      // alwaysInject short-circuits to full toolRule score
      if (mod.injection.alwaysInject) {
        toolRule = 1.0;
      } else if (mod.injection.requiresTools && mod.injection.requiresTools.length > 0) {
        for (const pattern of mod.injection.requiresTools) {
          // Support glob-style prefix patterns: "azure_*" → prefix "azure_"
          const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
          const matched = prefix
            ? availableToolNames.some((t) => t.startsWith(prefix))
            : availableToolNames.some((t) => t === pattern);
          if (matched) {
            toolRule = 1.0;
            break;
          }
        }
      }

      // ── History boost ────────────────────────────────────────────────────────
      let historyBoost = 0;
      const modNameLower = mod.name.toLowerCase();

      if (modNameLower.includes('azure') && summaryProviders.includes('azure')) {
        historyBoost = 1.0;
      } else if (modNameLower.includes('aws') && summaryProviders.includes('aws')) {
        historyBoost = 1.0;
      } else if (modNameLower.includes('gcp') && summaryProviders.includes('gcp')) {
        historyBoost = 1.0;
      } else if (modNameLower.includes('k8s') && summaryProviders.includes('kubernetes')) {
        historyBoost = 1.0;
      } else if (mod.injection.requiresTools && mod.injection.requiresTools.length > 0) {
        // Check if any of the module's required tools were used in conversation history
        for (const pattern of mod.injection.requiresTools) {
          const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null;
          const matched = prefix
            ? summaryTools.some((t) => t.startsWith(prefix))
            : summaryTools.some((t) => t === pattern);
          if (matched) {
            historyBoost = 0.7;
            break;
          }
        }
      }

      // ── Effectiveness (placeholder — will be wired to Milvus in Task 15) ────
      const effectiveness = 0; // Cold start: neutral

      // ── Combined weighted score ──────────────────────────────────────────────
      const score =
        semantic * 0.4 + toolRule * 0.3 + historyBoost * 0.2 + effectiveness * 0.1;

      scores.push({
        module: mod,
        score,
        breakdown: { semantic, toolRule, historyBoost, effectiveness },
      });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores;
  }
}
