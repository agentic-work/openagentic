/**
 * Regression lock: the three fix sites from commit 5424d0f4 must NEVER
 * re-introduce process.env.DEFAULT_MODEL / TITLE_GENERATION_MODEL reads.
 *
 * This is a static-source test (grep-style). It's weaker than a behavioral
 * unit test but catches the specific class of regression — somebody adding
 * a "quick fix" env fallback during a merge/refactor — without the test
 * infrastructure lift of fastify.inject + a fully mocked handler stack.
 *
 * If this test fails, look at what the grep matched. If the new env-read is
 * (a) a DB-fallback when the row legitimately doesn't exist (bootstrap), add
 * it to the KNOWN_BOOTSTRAP_SITES allowlist. If it's a live-path override,
 * the fix got reverted — see docs/rules/no-hardcoded-models.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

// Known bootstrap sites in these files that ARE allowed to read env
// (pre-seed fallback when the DB is empty — documented in CLAUDE.md).
// None currently; listed for future diff clarity.
const KNOWN_BOOTSTRAP_SITES: Array<{ file: string; pattern: RegExp; reason: string }> = [];

describe('SoT regression: no env-overrides in three commit-5424d0f4 fix sites', () => {
  it('routes/chat/services/ChatSessionService.ts — addMessage() path', () => {
    const src = read('src/routes/chat/services/ChatSessionService.ts');
    // addMessage() block must not contain process.env.DEFAULT_MODEL
    // (the pre-fix pattern was `|| process.env.DEFAULT_MODEL` on the model field).
    const addMessageBlock = src.match(/async addMessage\([\s\S]*?^  \}/m)?.[0] ?? '';
    expect(addMessageBlock).not.toMatch(/process\.env\.DEFAULT_MODEL/);
    expect(addMessageBlock).not.toMatch(/process\.env\.TITLE_GENERATION_MODEL/);
    // Positive assertion: the helper is used.
    expect(addMessageBlock).toMatch(/resolveChatModel/);
  });

  it('routes/chat/handlers/stream.handler.ts — titleModel metadata write', () => {
    const src = read('src/routes/chat/handlers/stream.handler.ts');
    // The titleModel property must resolve from ModelConfigurationService, not env.
    // Find each occurrence of `titleModel:` — the WRITE site must not be an env read.
    const lines = src.split('\n');
    const titleModelLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /titleModel\s*:/.test(line));
    expect(titleModelLines.length).toBeGreaterThan(0);
    for (const { line } of titleModelLines) {
      expect(line).not.toMatch(/process\.env\.DEFAULT_MODEL/);
      expect(line).not.toMatch(/process\.env\.TITLE_GENERATION_MODEL/);
    }
    // Positive: at least one titleModel assignment calls the DB service.
    expect(src).toMatch(/titleModel:\s*await[\s\S]{0,200}ModelConfigurationService/);
  });

  it('routes/chat/index.ts — debug tool-visibility probe', () => {
    const src = read('src/routes/chat/index.ts');
    // The probe test request's `model:` must not default from env.
    // The pre-fix was `model: process.env.DEFAULT_MODEL`.
    expect(src).not.toMatch(/model:\s*process\.env\.DEFAULT_MODEL/);
    // Positive: probeModel is resolved via ModelConfigurationService.
    expect(src).toMatch(/probeModel[\s\S]{0,100}ModelConfigurationService\.getDefaultChatModel/);
  });

  it('routes/chat/pipeline/ChatPipeline.ts — buildConfig provider default (plan task 1) [obsolete after Wave 5 deletion]', () => {
    // Wave 5 (chatmode-ux-mock-parity Phase 1): the V1 ChatPipeline.ts is
    // GONE. The env-override regression it locked is no longer reachable —
    // V2's ProviderManager wires every provider via DB rows, not env vars.
    // The test stays green by skipping the read when the file is absent.
    const filePath = 'src/routes/chat/pipeline/ChatPipeline.ts';
    if (!existsSync(path.join(ROOT, filePath))) {
      // File deleted in Wave 5 — assertion no longer applicable. PASS.
      return;
    }
    const src = read(filePath);
    expect(src).not.toMatch(/process\.env\.DEFAULT_LLM_PROVIDER/);
  });

  it('routes/chat/pipeline/pipeline-config.schema.ts — getDefaultPipelineConfiguration body (plan task 2) [obsolete after V1 rip 2026-05-05]', () => {
    // V1 chat-pipeline rip (2026-05-05): pipeline-config.schema.ts is GONE.
    // The env-override regression it locked is no longer reachable — V2 reads
    // every model identifier through resolveModel() against the Registry.
    // The test stays green by skipping the read when the file is absent.
    const filePath = 'src/routes/chat/pipeline/pipeline-config.schema.ts';
    if (!existsSync(path.join(ROOT, filePath))) {
      // File deleted in V1 rip — assertion no longer applicable. PASS.
      return;
    }
    const src = read(filePath);
    // getDefaultPipelineConfiguration must not read any of the model env vars.
    // Pre-fix: process.env.DEFAULT_MODEL / FALLBACK_MODEL / PREMIUM_MODEL / ECONOMICAL_MODEL
    // / MULTI_MODEL_*_PRIMARY were the sole source of model IDs in the returned defaults.
    expect(src).not.toMatch(/process\.env\.(DEFAULT_MODEL|FALLBACK_MODEL|PREMIUM_MODEL|ECONOMICAL_MODEL|MULTI_MODEL_\w+_PRIMARY)/);
  });

  it('services/ChatService.ts — generateTitle() must not read TITLE_GENERATION_MODEL or DEFAULT_MODEL (plan task 3)', () => {
    const src = read('src/services/ChatService.ts');
    // generateTitle() must resolve from ModelConfigurationService, not env.
    // Pre-fix: process.env.TITLE_GENERATION_MODEL || process.env.DEFAULT_MODEL
    const generateTitleBlock = src.match(/async generateTitle\([\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    expect(generateTitleBlock).not.toMatch(/process\.env\.TITLE_GENERATION_MODEL/);
    expect(generateTitleBlock).not.toMatch(/process\.env\.DEFAULT_MODEL/);
    // Positive assertion: DB service call is present
    expect(generateTitleBlock).toMatch(/ModelConfigurationService\.getServiceModel\('titleGeneration'\)/);
  });

  it('services/AITitleGenerationService.ts — generateAITitle() must not read env model vars (plan task 3)', () => {
    const src = read('src/services/AITitleGenerationService.ts');
    // generateAITitle() must not fall back to any env model var.
    // Pre-fix: process.env.TITLE_GENERATION_MODEL || ECONOMICAL_MODEL || SECONDARY_MODEL || DEFAULT_MODEL
    expect(src).not.toMatch(/process\.env\.(TITLE_GENERATION_MODEL|ECONOMICAL_MODEL|SECONDARY_MODEL|DEFAULT_MODEL)/);
    // Positive assertion: DB service call is present
    expect(src).toMatch(/ModelConfigurationService\.getServiceModel\('titleGeneration'\)/);
  });

  it('services/TitleGenerationClient.ts — constructor must not assign env model vars to config.defaultModel (plan task 3)', () => {
    const src = read('src/services/TitleGenerationClient.ts');
    // The constructor must not read TITLE_GENERATION_MODEL / ECONOMICAL_MODEL /
    // SECONDARY_MODEL / DEFAULT_MODEL to set this.config.defaultModel.
    // Pre-fix: defaultModel: process.env.TITLE_GENERATION_MODEL || ... || process.env.DEFAULT_MODEL
    expect(src).not.toMatch(/process\.env\.(TITLE_GENERATION_MODEL|ECONOMICAL_MODEL|SECONDARY_MODEL|DEFAULT_MODEL)/);
    // Positive assertion: DB service call is present in resolveModel()
    expect(src).toMatch(/ModelConfigurationService\.getServiceModel\('titleGeneration'\)/);
  });

  it('services/ConversationCompactionWorker.ts — must not read COMPACTION_MODEL from env (plan task 4)', () => {
    const src = read('src/services/ConversationCompactionWorker.ts');
    // Pre-fix: this.compactionModel = process.env.COMPACTION_MODEL || process.env.DEFAULT_MODEL
    // The live path must read from ModelConfigurationService, not env.
    // Comments/JSDoc may mention the env var name as historical context — the grep
    // targets the actual runtime expression process\.env\.COMPACTION_MODEL.
    expect(src).not.toMatch(/process\.env\.COMPACTION_MODEL/);
    // Positive assertion: DB service call is present in resolveCompactionModel()
    expect(src).toMatch(/ModelConfigurationService\.getServiceModel\('compaction'\)/);
  });

  // ── Task 6a: Health/analysis/orchestrator bundle ────────────────────────────

  it('services/ModelHealthCheck.ts — checkModelHealth must not read env model vars (plan task 6a)', () => {
    const src = read('src/services/ModelHealthCheck.ts');
    // Pre-fix lines 78-81: four-way env chain for model selection.
    expect(src).not.toMatch(/process\.env\.VERTEX_AI_MODEL/);
    expect(src).not.toMatch(/process\.env\.AZURE_OPENAI_MODEL/);
    expect(src).not.toMatch(/process\.env\.BEDROCK_MODEL/);
    // DEFAULT_MODEL used in context of model selection must be gone.
    // Note: other env reads (e.g. DISABLE_MODEL_HEALTH_CHECK) in the same file are fine.
    const checkBlock = src.match(/async checkModelHealth\([\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    expect(checkBlock).not.toMatch(/process\.env\.DEFAULT_MODEL/);
    // Positive assertion: DB accessor used in the method body.
    expect(checkBlock).toMatch(/ModelConfigurationService\.getDefaultChatModel/);
  });

  it('services/RAGHealthCheck.ts — checkRAGHealth must not read env embedding vars (plan task 6a)', () => {
    const src = read('src/services/RAGHealthCheck.ts');
    // Pre-fix line 35: env chain + hardcoded 'text-embedding-3-small'.
    const checkBlock = src.match(/async checkRAGHealth\([\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    expect(checkBlock).not.toMatch(/process\.env\.EMBEDDING_MODEL/);
    expect(checkBlock).not.toMatch(/process\.env\.DEFAULT_EMBEDDING_MODEL/);
    expect(checkBlock).not.toMatch(/process\.env\.AZURE_OPENAI_EMBEDDING_DEPLOYMENT/);
    expect(checkBlock).not.toMatch(/text-embedding-3-small/); // hardcoded model literal
    // Positive assertion: DB accessor present.
    expect(checkBlock).toMatch(/ModelConfigurationService\.getServiceModel\('embedding'\)/);
  });

  it('services/SelfConsistencyService.ts — must not assign env model vars in constructor (plan task 6a)', () => {
    const src = read('src/services/SelfConsistencyService.ts');
    // Pre-fix line 66: this.model = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL
    expect(src).not.toMatch(/process\.env\.AZURE_OPENAI_DEPLOYMENT/);
    // Positive assertions: resolveModel() method and DB accessor present.
    expect(src).toMatch(/resolveModel\(\)/);
    expect(src).toMatch(/ModelConfigurationService\.getDefaultChatModel/);
  });

  it('services/CapabilityIntegration.ts — must not read env model vars for fallbackModel or catch block (plan task 6a)', () => {
    const src = read('src/services/CapabilityIntegration.ts');
    // Pre-fix line 35 (constructor): fallbackModel: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL
    // Pre-fix lines 232-233 (selectModelForMessage catch): same pattern.
    // We scan the whole file — neither pattern may appear anywhere.
    expect(src).not.toMatch(/process\.env\.AZURE_OPENAI_DEPLOYMENT/);
    expect(src).not.toMatch(/fallbackModel:\s*process\.env/);
    // DEFAULT_MODEL must not appear as a model-resolution fallback.
    // (We allow process.env references to non-model vars like API keys elsewhere.)
    expect(src).not.toMatch(/process\.env\.DEFAULT_MODEL/);
    // Positive assertion: DB accessor present in file (used in selectModelForMessage catch block).
    expect(src).toMatch(/ModelConfigurationService\.getDefaultChatModel/);
  });

  // services/SubagentOrchestrator.ts arch case removed Phase E.8.g+h
  // (2026-05-11) — the file is deleted; defaults flow through the
  // recursor sub-agent path which has no env-model-var coupling.

  it('services/DynamicModelManager.ts — getEmbeddingModel must not read env model vars (plan task 6a)', () => {
    const src = read('src/services/DynamicModelManager.ts');
    // Pre-fix lines 52-56: five-way env chain for embedding model.
    const getEmbedBlock = src.match(/async getEmbeddingModel\([\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    expect(getEmbedBlock).not.toMatch(/process\.env\.EMBEDDING_MODEL/);
    expect(getEmbedBlock).not.toMatch(/process\.env\.EMBEDDING_OLLAMA_MODEL/);
    expect(getEmbedBlock).not.toMatch(/process\.env\.AZURE_OPENAI_EMBEDDING_DEPLOYMENT/);
    expect(getEmbedBlock).not.toMatch(/process\.env\.VERTEX_AI_EMBEDDING_MODEL/);
    expect(getEmbedBlock).not.toMatch(/process\.env\.AWS_BEDROCK_EMBEDDING_MODEL/);
    // Positive assertion: DB accessor present.
    expect(getEmbedBlock).toMatch(/ModelConfigurationService\.getServiceModel\('embedding'\)/);
  });

  // ── Task 6b: MODELS.* removal from non-provider consumers ──────────────────

  it('services/WorkflowExecutionEngine.ts — must not reference MODELS.default, .vertexChat, .azureOpenai (plan task 6b)', () => {
    const src = read('src/services/WorkflowExecutionEngine.ts');
    // Pre-fix: four sites used MODELS.default (×2), MODELS.vertexChat, MODELS.azureOpenai.
    // Provider-class transitive use is NOT in this file.
    expect(src).not.toMatch(/MODELS\.default/);
    expect(src).not.toMatch(/MODELS\.vertexChat/);
    expect(src).not.toMatch(/MODELS\.azureOpenai/);
  });

  it('server.ts startup log — must not reference MODELS.* or getDefaultModel() (plan task 6b)', () => {
    const src = read('src/server.ts');
    // Find the startup log block
    const logBlock = src.match(
      /logger\.info\(\{[\s\S]{0,600}Model configuration loaded[\s\S]{0,200}\}/
    )?.[0] ?? '';
    expect(logBlock.length).toBeGreaterThan(10);
    expect(logBlock).not.toMatch(/MODELS\./);
    expect(logBlock).not.toMatch(/getDefaultModel\(\)/);
    // Positive: must reference ModelConfigurationService.getConfig
    expect(logBlock).toMatch(/ModelConfigurationService\.getConfig/);
  });

  // ── Task 7: Orphan file deletions ─────────────────────────────────────────

  it('orphan files removed (plan task 7)', () => {
    // routes/chat.ts was a pre-split monolith; live path is routes/chat/* registered via chatPlugin.
    expect(existsSync(path.join(ROOT, 'src/routes/chat.ts'))).toBe(false);
    // azureOpenAIConfigService.ts was deprecated; only reference was a commented-out import.
    expect(existsSync(path.join(ROOT, 'src/services/azureOpenAIConfigService.ts'))).toBe(false);

    // The 6 legacy env-only loader methods in ProviderConfigService must be gone.
    // They were defined but never called after the DB-SoT migration.
    const providerConfigSrc = readFileSync(
      path.join(ROOT, 'src/services/llm-providers/ProviderConfigService.ts'),
      'utf8',
    );
    for (const deleted of [
      'loadEnvironmentProviders',
      'loadAzureOpenAIConfig',
      'loadBedrockConfig',
      'loadVertexAIConfig',
      'loadOllamaConfig',
      'loadAzureAIFoundryConfig',
    ]) {
      expect(providerConfigSrc).not.toMatch(new RegExp(`\\b${deleted}\\b`));
    }
  });
});
