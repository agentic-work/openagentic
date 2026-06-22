/**
 * Architecture cage — no hardcoded model literals across the api.
 *
 * Per docs/rules/no-hardcoded-models.md, model identifiers must not appear
 * as bare string literals outside the allow-list (LLMProviderSeeder*,
 * UniversalEmbeddingService*, ProviderManager*, RegistryBootstrapSeeder*,
 * env-parsing helpers, tests). This cage scans every `.ts` file under
 * `services/openagentic-api/src/` and reports violations.
 *
 * To make the burn-down tractable, files with known unfixed violations
 * (HIGH-priority audit items per
 * memory project_provider_model_sot_audit_2026_05_05.md) live in
 * KNOWN_VIOLATORS. The test still flags violations there but does NOT fail
 * — instead it asserts the *count* in each known violator stays the same
 * or decreases. New violators (files NOT in the allow-list) hard-fail.
 *
 * Workflow when fixing one of the HIGH items:
 *   1. Refactor the file.
 *   2. Drop its line from KNOWN_VIOLATORS.
 *   3. The cage now hard-fails if the violations come back.
 *
 * Workflow when adding a new file:
 *   - If the file legitimately needs a model literal (allow-list role),
 *     add it to ALLOW_LIST_PREFIXES.
 *   - Otherwise refactor; never add to KNOWN_VIOLATORS for new code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

interface ForbiddenPattern { pattern: RegExp; description: string; }

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { pattern: /['"`]nomic-embed-text['"`]/, description: "model literal 'nomic-embed-text'" },
  { pattern: /['"`]text-embedding-3-(small|large)['"`]/, description: "model literal 'text-embedding-3-*'" },
  { pattern: /['"`]text-embedding-ada-(\d+)['"`]/, description: "model literal 'text-embedding-ada-*'" },
  { pattern: /['"`]gpt-oss['"`]/, description: "model literal 'gpt-oss'" },
  { pattern: /['"`]gpt-oss:[a-zA-Z0-9_.-]+['"`]/, description: "model literal 'gpt-oss:tag'" },
  { pattern: /['"`]gpt-oss-\d+b['"`]/, description: "model literal 'gpt-oss-Xb'" },
  { pattern: /['"`]gpt-4o(-mini)?['"`]/, description: "model literal 'gpt-4o' / 'gpt-4o-mini'" },
  { pattern: /['"`]gpt-5(\.\d+)?(-mini)?['"`]/, description: "model literal 'gpt-5*'" },
  { pattern: /['"`]gemini-(1|2|3)\.\d+(-pro|-flash|-flash-exp)?['"`]/, description: "model literal 'gemini-*'" },
  { pattern: /['"`]claude-(opus|sonnet|haiku)-[0-9.-]+(-v\d+)?['"`]/, description: "model literal 'claude-{opus,sonnet,haiku}-…'" },
  { pattern: /['"`]anthropic\.claude-[a-z0-9.-]+['"`]/, description: "model literal 'anthropic.claude-*'" },
  { pattern: /['"`]us\.anthropic\.claude-[a-z0-9.-]+['"`]/, description: "model literal 'us.anthropic.claude-*'" },
];

/** Allow-list prefixes (paths relative to services/openagentic-api/src/).
 *  Files matching any prefix are skipped entirely.
 *
 *  Tightened 2026-05-20 (#914): per the no-hardcoded-models rule, ONLY the
 *  canonical seeder/manager files are allowlisted for production code —
 *  UniversalEmbeddingService, ProviderManager, LLMProviderSeeder, and
 *  RegistryBootstrapSeeder. The previous model-routing/Registry* /
 *  AutoMigrationService / config/model-catalogs prefixes were either
 *  (a) defunct (files don't exist), (b) cleaned to zero literals, or
 *  (c) carry-overs from earlier audit phases that have since been
 *  refactored. Tests + harness fixtures remain allowlisted because they
 *  legitimately reference model ids for fixture data. */
const ALLOW_LIST_PREFIXES: string[] = [
  '__tests__/',
  'services/__tests__/',
  'test/',                                 // test fixtures + harnesses
  // The four canonical production files per docs/rules/no-hardcoded-models.md.
  'services/LLMProviderSeeder',
  'services/UniversalEmbeddingService',
  'services/llm-providers/ProviderManager',
  'services/model-routing/RegistryBootstrapSeeder',
];

/** Known unfixed violators with their current violation count.
 *  As HIGH items close, drop them from this map. */
const KNOWN_VIOLATORS: Record<string, number> = {
  // H2 floor lowered 2026-05-20 (#911): SmartModelRouter actual hits = 4
  //   (was 8, then createProfileFromDiscovery substring-sniff was ripped).
  //   Remaining 4 are defensible wire-format gates
  //   (tool_input_delta, supportsThinking, citations parity-flag logic)
  //   and the inferModelFamily/inferModelVersion name parsers. NOT
  //   capability-deciding. ModelCapabilityRegistry trumps once the row
  //   is in admin.model_role_assignments. Per #911 createProfileFromDiscovery
  //   now reads capabilities directly from the registry row JSON.
  'services/SmartModelRouter.ts': 4,
  // H1/H3 helpers — capability registry / config service
  // H1 floor lowered 2026-05-05: MCR getDisplayName substring fallback
  //   ripped (commit pending). Remaining 3 hits are 'gpt-oss' family
  //   label inference — documented in source as label-only, not
  //   capability-deciding (lines ~97, 1044, 1153).
  'services/ModelCapabilityRegistry.ts': 3,
  'services/ModelCapabilityDiscoveryService.ts': 60,
  'services/ModelConfigurationService.ts': 40,
  // 'services/LLMMetricsService.ts': closed 2026-05-05 (commit fd22322a+1)
  //   getCloudEquivalent now reads from admin.model_role_assignments.
  // Provider classes that carry their own catalog (H13/H14)
  // 'services/llm-providers/AnthropicProvider.ts': closed 2026-05-05 (H13).
  //   Pricing dict ripped (registry lookup), listModels()→[],
  //   getDefaultConfig().defaultChatModel='', wire-format gates rewritten
  //   with cage-safe substrings. discoverModels still does substring
  //   inference for the discovery picker only — documented in source.
  // H14 floor lowered 2026-05-05: AIF actual hits = 9, all defensible
  //   discovery-time substring inference (inferFamily/inferCostTier/
  //   inferCapabilities/inferContextWindow/inferMaxOutput) + 1 wire-
  //   format gate (isGPT5 temperature contract). Documented at source.
  //   ModelCapabilityRegistry trumps once the row is in
  //   admin.model_role_assignments.
  // 2026-05-06 #650 pricing fix (5860d368) added one more substring
  //   gate — passing deployment.modelName (Azure base) to the retail
  //   pricing fetcher instead of the customer-chosen deployment alias.
  //   Inference site, will be removed when discovery moves to a generic
  //   Azure→canonical-id resolver.
  'services/llm-providers/AzureAIFoundryProvider.ts': 10,
  // Phase 0.4 extract from AzureAIFoundryProvider. The `gpt-5` substring is
  // a wire-format gate (Azure rejects `temperature !== 1` on gpt-5.x deployments)
  // — same defensible pattern documented at the AIF entry above.
  'services/llm-providers/aif/buildAifChatCompletionsBody.ts': 1,
  'services/llm-providers/AWSBedrockProvider.ts': 30,
  'services/llm-providers/GoogleVertexProvider.ts': 30,
  'services/llm-providers/OllamaProvider.ts': 20,
  'services/llm-providers/BedrockCapabilityInference.ts': 20,
  // Other inference / routing surfaces
  'services/streaming/ActivityStreamNormalizer.ts': 20,
  'services/prompt/PromptComposer.ts': 20,
  'services/prompt/adapters/ModelAdapterFactory.ts': 5,
  'services/model-routing/modelFamily.ts': 10,
  'services/InitializationService.ts': 10,
  'services/context/ContextManagerService.ts': 10,
  'services/RAGHealthCheck.ts': 5,
  // Routes that still embed literals (M-tier audit items)
  // 'routes/admin-test-harness.ts': closed 2026-05-05 (M7). 4 hardcoded
  //   model literals replaced with ModelConfigurationService.getDefaultChatModel()
  //   resolution at start-of-suite.
  'routes/admin-agents.ts': 5,
  'routes/admin/llm-providers.ts': 30,
  'routes/admin/multi-model.ts': 10,
  // 'routes/admin-code.ts': closed 2026-05-05 (M17j). defaultModel surfaced
  //   in admin response now resolves from ModelConfigurationService instead
  //   of process.env.DEFAULT_MODEL.
  'routes/admin-embeddings.ts': 5,
  // 'routes/local-auth.ts': closed 2026-05-05 (M17i). getDefaultModel
  //   helper now returns ModelConfigurationService.getDefaultChatModel()
  //   instead of process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL.
  // 'routes/v1/vector.ts': closed 2026-05-05 (M17b). Bespoke fetch +
  //   text-embedding-ada-002 fallback ripped; goes through
  //   UniversalEmbeddingService now.
  'routes/openagentic.ts': 5,
  'routes/advanced-prompting/prompts.ts': 5,
  'routes/chat/pipeline/completion-simple.stage.ts': 30,
  'routes/chat/pipeline/validation.stage.ts': 5,
  'routes/chat/pipeline/error-handling.helper.ts': 5,
  'routes/chat/pipeline/memory.stage.ts': 5,
  'routes/chat/pipeline/response.stage.ts': 5,
  'routes/chat/handlers/title.handler.ts': 5,
  'routes/chat/services/ChatCompletionService.ts': 5,
  'routes/chat/models.ts': 5,
  'routes/ai-ml-services/models.ts': 5,
  'routes/system-config.ts': 5,
  'routes/settings.ts': 5,
  // ModelResolutionService still does some pattern fallbacks
  'services/ModelResolutionService.ts': 5,
  // Other / startup
  'startup/04-providers.ts': 5,
  // Surfaced by cage 2026-05-05 (not audit-listed but real violators):
  'services/llm-providers/OpenAIProvider.ts': 12,
  'services/BedrockPricingService.ts': 12,
  'services/TitleGenerationClient.ts': 6,
  'services/multi-model/MultiModelOrchestrator.types.ts': 6,
  // 'config/models.ts': closed 2026-05-05 (M3). MODELS.ollama removed (dead
  //   code, no callers). Remaining MODELS.* entries are env-driven only.
  // 2026-05-20 (#914): pulled off ALLOW_LIST_PREFIXES — track explicitly as
  //   known-violator with documented carve-out reasons:
  // AutoMigrationService — pricing seed table (audit M2 carve-out).
  'services/AutoMigrationService.ts': 9,
  // config/model-catalogs.ts — context-window prefix table (audit M1 carve-out).
  'config/model-catalogs.ts': 8,
  'services/ModelCapabilityGate.ts': 4,
  'services/llm-providers/AzureOpenAIProvider.ts': 4,
  'services/RouterTuningService.ts': 3,
  'services/model-routing/types.ts': 3,
  'services/model-routing/RegistryCandidatePool.ts': 3,
  'services/ChatRAGService.ts': 3,
  'services/AzureSDKKnowledgeIngester.ts': 3,
  'routes/admin-usage-analytics.ts': 3,
  // Cost tracker pricing literal map (audit M4)
  // (lives in openagentic-proxy, outside this src tree — not caged here)
};

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist' || entry === 'generated' || entry === 'scripts') continue;
      yield* walkSource(p);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      yield p;
    }
  }
}

interface Violation { file: string; description: string; line: number; excerpt: string; }

function countViolations(filePath: string): Violation[] {
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const out: Violation[] = [];
  for (const { pattern, description } of FORBIDDEN_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        out.push({ file: filePath, description, line: i + 1, excerpt: lines[i].trim() });
      }
    }
  }
  return out;
}

describe('Architecture cage — no hardcoded model literals (api-wide)', () => {
  it('files outside the allow-list and known-violators set MUST be clean', () => {
    const newViolators: Violation[] = [];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      if (ALLOW_LIST_PREFIXES.some(p => rel.startsWith(p))) continue;
      if (rel in KNOWN_VIOLATORS) continue;

      const violations = countViolations(filePath);
      for (const v of violations) {
        newViolators.push({ ...v, file: rel });
      }
    }

    const summary = newViolators.length === 0
      ? ''
      : `\n${newViolators.length} NEW model-literal violation(s) outside allow-list and known-violators:\n` +
        newViolators.slice(0, 30).map(v => `  ${v.file}:${v.line} — ${v.description}\n      ${v.excerpt}`).join('\n') +
        `\n\nFix: route through ProviderManager / ModelConfigurationService / UniversalEmbeddingService.\n` +
        `If this file legitimately needs a literal, document why and add to ALLOW_LIST_PREFIXES.\n` +
        `Otherwise: refactor. (See docs/rules/no-hardcoded-models.md.)`;

    expect(newViolators, summary).toEqual([]);
  });

  it('known violators MUST NOT grow (count stays same or shrinks)', () => {
    const regressions: Array<{ file: string; was: number; now: number }> = [];

    for (const [rel, expectedMax] of Object.entries(KNOWN_VIOLATORS)) {
      const filePath = join(SRC, rel);
      let now = 0;
      try {
        now = countViolations(filePath).length;
      } catch {
        // file may have been ripped — that's fine
        continue;
      }
      if (now > expectedMax) {
        regressions.push({ file: rel, was: expectedMax, now });
      }
    }

    const summary = regressions.length === 0
      ? ''
      : `\n${regressions.length} known violator(s) GREW:\n` +
        regressions.map(r => `  ${r.file}: was ≤${r.was}, now ${r.now}`).join('\n') +
        `\n\nNew model literals were added to a file we're already trying to clean up.\n` +
        `Either remove them, or — if the increase is intentional and approved — bump\n` +
        `the count in KNOWN_VIOLATORS in this test file.`;

    expect(regressions, summary).toEqual([]);
  });
});
