/**
 * Smart Model Router
 *
 * Intelligently routes LLM requests to the optimal model based on:
 * - Task complexity (simple chat vs tool calling vs multi-step reasoning)
 * - Model capabilities (function calling accuracy, context length, specializations)
 * - Cost optimization (use cheaper models for simple tasks)
 * - Provider availability and health
 *
 * Discovers models from ALL configured providers on startup and stores
 * capabilities in Milvus for semantic search.
 */

import { Logger } from 'pino';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { ProviderManager } from './llm-providers/ProviderManager.js';
import { ILLMProvider, CompletionRequest } from './llm-providers/ILLMProvider.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { RedisClientType } from 'redis';
import { RouterTuningService, RouterTuning, ROUTER_TUNING_DEFAULTS } from './RouterTuningService.js';
// Phase E.1 (2026-05-10) — the intent classifier service (RIPPED 2026-05-10 Phase E.1) import REMOVED.
// Spec §50: model decides; no pre-LLM classifier. SmartModelRouter
// routes purely on FCA scoring + structural analysis (vision, tools,
// prompt length). The `trivialIntent` cheapest-chat shortcut is gone.
import { getModelCapabilityRegistry } from './ModelCapabilityRegistry.js';
import { classifyModelCost } from './model-routing/classifyModelCost.js';
import { resolveContextWindow } from './resolveContextWindow.js';
// 2026-04-19 — SliderConfig import removed (task #144, slider rip).
import {
  routerDecisionCounter,
  routerEscalationCounter,
  routerFloorExcludedCounter,
  routerRouteRequestDurationMs,
  routerQualityBonusCounter,
} from '../metrics/index.js';
// Q1-fix-3 (2026-05-12) — prompt-pattern task classifier. Maps prompt
// shape to a CAPABILITY profile (FCA floor + context floor + reasoning
// pref). The router filters DB-discovered models by capability; no
// model IDs hardcoded here. See PromptClassifier.ts header for the
// non-overlap argument with the banned regex-detector set.
import { classifyAndProfile } from './router/PromptClassifier.js';

// Model capability profile
export interface ModelProfile {
  modelId: string;
  provider: string;
  providerType: 'azure-openai' | 'azure-ai-foundry' | 'aws-bedrock' | 'google-vertex' | 'ollama';
  deployment?: string; // For Azure deployments

  capabilities: {
    chat: boolean;
    functionCalling: boolean;
    functionCallingAccuracy: number; // 0-1 score (e.g., 0.967 for GPT-4)
    vision: boolean;
    imageGeneration: boolean;
    embeddings: boolean;
    streaming: boolean;
    jsonMode: boolean;
    structuredOutput: boolean;

    // --- A₂ parity flags (added 2026-04-19) -----------------------------------
    //
    // These flags drive UI code paths that depend on wire-exact streaming
    // features (per-char tool arg deltas, native extended-thinking, citations,
    // signature chains). UI falls back gracefully when a flag is false — it
    // simply skips the optional render path (e.g. no live tool-arg typing,
    // no thinking block, no citation underlines).

    /**
     * True when the model streams tool-use input JSON per-character as
     * `input_json_delta` chunks (Anthropic native, also OpenAI Responses
     * API `response.function_call_arguments.delta`, Vertex Gemini partial
     * function-call args, Qwen3Parser-era Ollama).
     *
     * False for legacy Bedrock Converse (non-Claude) and older providers
     * that batch tool args into a single post-completion payload.
     */
    supportsToolInputDelta: boolean;

    /**
     * True when the model supports native extended-thinking blocks emitted
     * during generation (Claude extended-thinking, GPT-5 + o-series
     * reasoning, Gemini 3 thinking, DeepSeek-R1 / gpt-oss / Qwen3 thinking
     * tags). Lifted from ModelCapabilityRegistry.supportsThinking() when
     * available, otherwise inferred from the model-name pattern.
     */
    supportsThinking: boolean;

    /**
     * True when the model emits first-class inline citations
     * (Anthropic Citations API on Claude 3.5+, Vertex Gemini with
     * groundingMetadata). False for plain text-only responses.
     */
    supportsCitations: boolean;

    /**
     * True for adapters that FAKE thinking blocks on top of models that
     * don't natively stream them — typically Ollama parsers for
     * DeepSeek-R1 / Qwen3 / gpt-oss that pattern-match `<thinking>` tags
     * out of the text stream and re-emit them as synthetic
     * `thinking_*` events. The UI shows a subtle "synthetic" badge
     * so users know the thinking trace came from a parser, not the
     * model's native reasoning channel.
     */
    supportsSyntheticThinking: boolean;
  };

  performance: {
    maxContextTokens: number;
    maxOutputTokens: number;
    avgLatencyMs: number;
    tokensPerSecond: number;
  };

  cost: {
    inputPer1kTokens: number;
    outputPer1kTokens: number;
    currency: string;
  };

  metadata: {
    family: string; // gpt, claude, gemini, llama, etc.
    version: string;
    specializations: string[]; // coding, math, creative, reasoning
    lastTested: Date;
    isAvailable: boolean;
  };

  // Vector embedding for semantic search
  embedding?: number[];
}

// Request analysis result.
//
// 2026-04-29 — chatmode-ux-mock-parity Wave2-D, task 1.7+1.17:
// `isComplexReasoning`, `isMultiStep`, `isMultiCloud` removed. Those
// signals were derived from 5 hand-tuned regex detectors inside
// `analyzeRequest()` (verb / resource / breadth / compound-list /
// discovery-plus-report). The classifier-driven FCA-floor escalation
// path that briefly replaced them was itself ripped 2026-05-02
// alongside the viz-tier ladder — the router now relies on the
// neutral structural FCA floors (chat-pool / simple-tool) and
// vendor-agnostic capability flags. Plan:
// docs/chatmode-ux-mock-parity/02-plan-canonical.md §38-52.
export interface RequestAnalysis {
  hasTools: boolean;
  toolCount: number;
  requiresVision: boolean;
  estimatedTokens: number;
  recommendedCapabilities: string[];
}

// Routing decision
export interface RoutingDecision {
  selectedModel: ModelProfile;
  reason: string;
  alternativeModels: ModelProfile[];
  analysisResults: RequestAnalysis;
  /**
   * True when the router escalated above the chat pool because a structural
   * capability gate fired (T3 capability gate or agentic capability profile).
   * Default-first (2026-05-24): resolveChatModel uses the router's pick ONLY
   * when this is true; otherwise the configured DB default wins.
   */
  escalated?: boolean;
  /** Routing path label: cost_quality_score | chat_pool_floor | tool_floor | t3_capability_gate | capability_profile. */
  resolvedBy?: string;
  /**
   * True when the router overrode the normal candidate pool because the
   * prompt contained destructive verbs (delete / terminate / drop / ...)
   * paired with a cloud-resource noun. In that case the chosen model MUST
   * be at Sonnet-tier or higher regardless of slider position — cheap
   * models mis-parse destructive intent and we'd rather pay the extra
   * tokens than risk a mis-targeted delete sneaking past HITL on a typo.
   */
  route_escalated_destructive?: boolean;
  /** Matched verb + noun + chosen escalation tier, for audit log. */
  destructive_context?: {
    verb: string;
    noun: string;
    escalatedTo: string;
  };
}

// REGEX DETECTORS DELETED (chatmode-ux-mock-parity Wave2-D, 2026-04-29).
//
// The four detectors that previously lived here (destructive / infra-ops /
// cloud-list / complexity) were ~240 LOC of hand-tuned regex with documented
// false-positives. The follow-on classifier-driven FCA-floor escalation
// branch in `routeRequest()` / `simulatePrompt()` was itself ripped on
// 2026-05-02 alongside the viz-tier ladder — the FCA-floor map encoded
// model-specific knowledge in router config. The classifier itself stays;
// its output previously flowed to the legacy per-intent ranker (ripped
// Phase E.2 / E.10) and the V2 chat pipeline. Routing now relies on the
// structural chat-pool / simple-tool FCA floors plus vendor-agnostic
// capability flags.
//
// Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §38-52, §80
//       ("Regex-as-fallback IS regex routing").

// Function-calling accuracy floors moved to RouterTuning DB row on
// 2026-05-22 (#1049). The simple-tool floor is now `tuning.fcaSimpleToolFloor`
// (default 0.83) and the complex-tool floor is `tuning.fcaComplexToolFloor`
// (default 0.90). The legacy `MIN_FUNCTION_CALLING_ACCURACY*` constants
// + their `getFunctionCallingModels` default-arg were ripped at the same
// time — getFunctionCallingModels now requires an explicit floor arg
// (callers should pass `tuning.fcaComplexToolFloor` or `tuning.fcaSimpleToolFloor`).

// MULTI_CLOUD_KEYWORDS RIPPED 2026-04-29 (chatmode-ux-mock-parity Wave2-D).
// The breadth/multi-cloud signal briefly flowed through the intent classifier service (RIPPED 2026-05-10 Phase E.1)
// + the per-intent FCA-floor field; that FCA-escalation branch was ripped
// 2026-05-02 with the viz-tier ladder. Tool-bearing requests fall through
// to the structural simple-tool FCA floor; per-intent tool surface tuning
// (formerly the per-intent top-K) was ripped 2026-05-10 (Phase E.10).

/**
 * Parity-flag inference for the A₂ streaming-parity overhaul.
 *
 * Drives four capability flags on `ModelProfile.capabilities`:
 *
 *   - `supportsToolInputDelta` — per-char tool-arg streaming
 *       (`input_json_delta` in Anthropic events). True for Anthropic /
 *       Claude via any provider, OpenAI Responses-era (GPT-5, o-series),
 *       Gemini 3 Flash/Pro, and Ollama models served by Qwen3Parser
 *       (Qwen / DeepSeek-R1 / gpt-oss). False for Bedrock Converse
 *       non-Claude and legacy providers.
 *
 *   - `supportsThinking` — native extended-thinking channel. True for
 *       Anthropic 4.x (opus/sonnet/haiku), GPT-5 + o-series, Gemini 2.5+
 *       / Gemini 3, DeepSeek-R1, Qwen3, gpt-oss. False for plain
 *       chat-only models.
 *
 *   - `supportsCitations` — Anthropic Citations API or Vertex
 *       groundingMetadata. Anthropic Claude 3.5+ / 4.x, Vertex Gemini
 *       with grounding — both TRUE. Everything else FALSE.
 *
 *   - `supportsSyntheticThinking` — adapter fakes thinking blocks by
 *       pattern-matching `<thinking>` tags in the raw text stream. True
 *       for Ollama-served models whose native wire protocol is plain
 *       text but the adapter synthesizes thinking_* events. Used by the
 *       UI to show a subtle "synthetic reasoning" badge.
 */
interface ParityFlags {
  supportsToolInputDelta: boolean;
  supportsThinking: boolean;
  supportsCitations: boolean;
  supportsSyntheticThinking: boolean;
}

export function inferParityFlags(input: {
  lower: string;
  providerType: ModelProfile['providerType'];
  isGPT: boolean;
  isClaude: boolean;
  isGemini: boolean;
  isQwen: boolean;
  isDeepSeek: boolean;
}): ParityFlags {
  const { lower, providerType, isGPT, isClaude, isGemini, isQwen, isDeepSeek } = input;

  // --- Native tool-input-delta support -------------------------------------
  //
  // H2 (defensible): wire-format gate. Decides whether the upstream
  // provider's stream format includes the OpenAI Responses-API
  // `function_call_arguments.delta` event (GPT-5/o-series),
  // Gemini-3/2.5's grounded-stream protocol, or Anthropic's tool-use
  // delta. This is an SDK contract check on the request/response
  // shape — NOT a registry-bypass decision. The substrings below stay
  // because the wire-format envelope is keyed by the model family,
  // not by an admin-configurable column.
  const isOpenAIResponsesGeneration =
    isGPT &&
    (lower.includes('gpt-5') ||
      lower.includes('gpt5') ||
      lower.includes('o1') ||
      lower.includes('o3') ||
      lower.includes('o4'));
  const isGemini3 =
    isGemini &&
    (lower.includes('gemini-3') ||
      lower.includes('gemini 3') ||
      lower.includes('gemini-2.5') ||
      lower.includes('gemini 2.5'));
  const isOllamaParserEra =
    providerType === 'ollama' && (isQwen || isDeepSeek || lower.includes('gpt-oss'));

  const supportsToolInputDelta =
    isClaude || isOpenAIResponsesGeneration || isGemini3 || isOllamaParserEra;

  // --- Native extended-thinking --------------------------------------------
  //
  // Mirror of `ModelCapabilityRegistry.supportsThinking()` semantics, but
  // derived locally from the model-name pattern so the router doesn't need
  // to round-trip through the registry during profile construction.
  const supportsThinking =
    (isClaude &&
      (lower.includes('sonnet-4') ||
        lower.includes('opus-4') ||
        lower.includes('haiku-4') ||
        lower.includes('claude-4') ||
        lower.includes('sonnet-3.7') ||
        lower.includes('sonnet 3.7'))) ||
    isOpenAIResponsesGeneration ||
    isGemini3 ||
    (providerType === 'ollama' &&
      (isQwen ||
        isDeepSeek ||
        lower.includes('gpt-oss') ||
        lower.includes('r1') ||
        lower.includes('reasoning')));

  // --- Citations / grounding -----------------------------------------------
  //
  // Anthropic Claude 3.5+ and 4.x expose citations via the Citations API.
  // Vertex Gemini emits groundingMetadata + groundingSupports when
  // grounded generation is enabled.
  const isClaude35Plus =
    isClaude &&
    (lower.includes('3.5') ||
      lower.includes('3-5') ||
      lower.includes('3.7') ||
      lower.includes('3-7') ||
      lower.includes('claude-4') ||
      lower.includes('opus-4') ||
      lower.includes('sonnet-4') ||
      lower.includes('haiku-4'));
  const supportsCitations =
    isClaude35Plus || (isGemini && providerType === 'google-vertex');

  // --- Synthetic thinking (adapter-faked) ----------------------------------
  //
  // Ollama-served reasoning-style models emit `<thinking>` tags in the
  // raw text stream; our OllamaProvider normalizer re-emits them as
  // `thinking_*` events. Mark supportsSyntheticThinking so the UI can
  // show a "synthetic reasoning" badge that distinguishes these from
  // Claude's native thinking channel.
  const supportsSyntheticThinking = isOllamaParserEra;

  return {
    supportsToolInputDelta,
    supportsThinking,
    supportsCitations,
    supportsSyntheticThinking,
  };
}

/**
 * Capability-based filter: a profile is "image-or-audio only" when its
 * `imageGeneration`/`audioGeneration` flag is true, OR when the modelId
 * contains a well-known audio/speech/whisper substring as a defense-in-
 * depth fallback (since the heuristic at inferProfileFromName always sets
 * `chat:true` and may not set `imageGeneration`).
 *
 * Used by `isProfileRoutable` to keep test/specialty models out of the
 * chat candidate pool. No hardcoded model IDs — substring heuristics
 * only target generic audio/speech model name patterns, not specific
 * vendor models.
 *
 * Exported separately for unit testing without singleton mocking.
 */
export function isImageOrAudioOnlyProfile(profile: ModelProfile): boolean {
  const caps = (profile.capabilities ?? {}) as any;

  // Capability flags are the SoT.
  if (caps.imageGeneration === true && caps.chat !== true) return true;
  if (caps.audioGeneration === true && caps.chat !== true) return true;

  // When chat:true AND a generation capability is set, treat as
  // generation-primary unless explicitly tagged for chat use.
  // (nemotron3:33b: heuristic chat=true + imageGeneration=true → exclude.)
  if (caps.imageGeneration === true || caps.audioGeneration === true) {
    return true;
  }

  // Defense in depth: substring fallback for audio/speech models that
  // may not yet have the capability flag wired in their profile.
  const idLower = (profile.modelId || '').toLowerCase();
  if (
    /\b(whisper|tts|stt|speech|audio|voice|sd-?xl|sdxl|stable-?diffusion|flux|dall-?e|imagen|midjourney)\b/.test(
      idLower,
    )
  ) {
    return true;
  }

  return false;
}

export class SmartModelRouter {
  private logger: Logger;
  private milvusClient?: MilvusClient;
  private embeddingService?: UniversalEmbeddingService;
  private redisClient?: RedisClientType;
  private providerManager?: ProviderManager;
  private tuningService?: RouterTuningService;

  private modelProfiles: Map<string, ModelProfile> = new Map();
  private initialized = false;
  private collectionName = 'model_capabilities_v2';

  constructor(
    logger: Logger,
    options?: {
      milvusClient?: MilvusClient;
      embeddingService?: UniversalEmbeddingService;
      redisClient?: RedisClientType;
      providerManager?: ProviderManager;
      tuningService?: RouterTuningService;
    }
  ) {
    this.logger = logger.child({ service: 'SmartModelRouter' });
    this.milvusClient = options?.milvusClient;
    this.embeddingService = options?.embeddingService;
    this.redisClient = options?.redisClient;
    this.providerManager = options?.providerManager;
    this.tuningService = options?.tuningService;
  }

  /**
   * Fetch live tuning constants. Falls back to in-code defaults when
   * no RouterTuningService is injected (e.g. in unit tests that don't
   * need live tunables).
   */
  private async getTuning(): Promise<RouterTuning> {
    if (this.tuningService) return this.tuningService.getTuning();
    return {
      id: 'singleton',
      ...ROUTER_TUNING_DEFAULTS,
      updated_at: new Date(0),
      updated_by: null,
    };
  }

  /**
   * Initialize the router - discover models from all providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('SmartModelRouter already initialized');
      return;
    }

    this.logger.info('Initializing SmartModelRouter...');
    const startTime = Date.now();

    try {
      // ONLY discover models dynamically from enabled providers
      // No hardcoded profiles - let the providers tell us what's available
      if (this.providerManager) {
        await this.discoverFromProviders();
      } else {
        this.logger.warn('No ProviderManager available - SmartModelRouter will have no models');
      }

      // Setup Milvus collection if available
      if (this.milvusClient) {
        await this.ensureMilvusCollection();
        await this.storeProfilesInMilvus();
      }

      this.initialized = true;
      const duration = Date.now() - startTime;

      this.logger.info({
        modelsLoaded: this.modelProfiles.size,
        providers: [...new Set([...this.modelProfiles.values()].map(m => m.provider))],
        durationMs: duration,
        milvusEnabled: !!this.milvusClient
      }, 'SmartModelRouter initialized successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize SmartModelRouter');
      // Don't throw - allow the system to function with known profiles
      this.initialized = true;
    }
  }

  /**
   * Re-read the Model Registry and rebuild the profile set.
   *
   * Called from invalidateAllModelCaches() whenever an admin adds /
   * updates / removes a model through /api/admin/llm-providers/**. The
   * profile Map stays stable-referenced; we wipe its contents in place
   * so any in-flight routing decision that captured the router instance
   * sees the fresh set the moment this method returns.
   *
   * SoT invariant: after reload() finishes, router's routable set ==
   * ModelConfigurationService.availableModels (registry), period.
   */
  async reload(): Promise<void> {
    const startTime = Date.now();
    const prevSize = this.modelProfiles.size;
    this.modelProfiles.clear();
    if (this.providerManager) {
      await this.discoverFromProviders();
    }
    if (this.milvusClient) {
      // Best-effort re-stash; failure here is non-fatal for routing.
      await this.storeProfilesInMilvus().catch(() => {});
    }
    this.logger.info({
      prevCount: prevSize,
      newCount: this.modelProfiles.size,
      durationMs: Date.now() - startTime,
    }, '[SmartModelRouter] Reloaded from Model Registry');
  }

  /**
   * Discover models from all configured providers — BUT only keep the
   * ones that have been explicitly registered in the Model Registry
   * (LLMModel table, surfaced via ModelConfigurationService.availableModels).
   *
   * The rule: `provider.listModels()` returns everything the CSP makes
   * available (Bedrock alone hands back 100+ catalog entries). We don't
   * want every Nemotron / Nova / Titan variant showing up in the Smart
   * Router — admins only want the models they've explicitly approved
   * through Add-Provider / Add-Model flows. The registry is the
   * authoritative allowlist; provider discovery is just used to mark
   * registry entries as "available in this runtime" and to seed
   * capability metadata.
   */
  private async discoverFromProviders(): Promise<void> {
    if (!this.providerManager) return;

    // Task #7 (Registry SoT): the router's candidate pool is the set of
    // admin.model_role_assignments rows where enabled=true. This is the
    // SAME source the chat toolbar and admin Models page read from —
    // provider-add auto-populates Registry (task #2), admin toggles flip
    // rows via PATCH /registry/:id (task #5), and the router picks from
    // whatever the admin has left enabled. No more drift between the UI's
    // model list and the router's actual routable set.
    const registryIds = new Set<string>();
    // #911 (2026-05-20): registry-row capabilities indexed by model id so the
    // profile builder can read them as the SoT. createProfileFromDiscovery
    // now REQUIRES the capabilities JSON — name-substring inference is gone.
    const registryRowsByModel = new Map<string, { capabilities: Record<string, any>; contextWindowTokens?: number; functionCallingAccuracy?: number | null }>();
    try {
      const { prisma } = await import('../utils/prisma.js');
      const { listRegistryCandidatePool } = await import('./model-routing/RegistryCandidatePool.js');
      const pool = await listRegistryCandidatePool(prisma as any);
      for (const entry of pool) {
        if (entry.model) {
          registryIds.add(entry.model);
          // Capabilities is a Record<string, any> per RegistryCandidate; the
          // contextWindowTokens lives inside capabilities for now (until the
          // dedicated column lands per Phase 2 of the SoT rip plan).
          const caps = (entry.capabilities ?? {}) as Record<string, any>;
          registryRowsByModel.set(entry.model, {
            capabilities: caps,
            // #1091 L1: canonicalize all 3 legacy key names
            // (contextWindowTokens / contextWindow / maxContextTokens).
            // Sonnet 4.5 seeded form uses `contextWindow` — old code
            // only checked `contextWindowTokens`/`maxContextTokens`,
            // silently falling through to 8192 default → T3 gate
            // (≥200000) rejected every model. See [[resolveContextWindow]].
            contextWindowTokens: resolveContextWindow(caps),
            functionCallingAccuracy: entry.functionCallingAccuracy ?? null,
          });
        }
      }
    } catch (err) {
      this.logger.warn({ err }, '[SmartModelRouter] Could not load Model Registry; router will have no profiles until registry is populated');
      return;
    }

    if (registryIds.size === 0) {
      this.logger.warn({}, '[SmartModelRouter] Model Registry is empty — no profiles will be created. Admin must register at least one model.');
      return;
    }

    const providers = this.providerManager.getProviders();

    for (const [name, provider] of providers) {
      try {
        const models = await provider.listModels();

        let registered = 0;
        let skipped = 0;
        for (const model of models) {
          if (!registryIds.has(model.id)) {
            skipped++;
            continue;
          }
          // Check if we already have a profile for this model
          const existingProfile = this.findProfileByModelId(model.id);
          if (existingProfile) {
            existingProfile.metadata.isAvailable = true;
            existingProfile.metadata.lastTested = new Date();
          } else {
            const registryRow = registryRowsByModel.get(model.id);
            try {
              const newProfile = this.createProfileFromDiscovery(model, name, registryRow);
              this.modelProfiles.set(model.id, newProfile);
            } catch (err) {
              // Registry row missing capabilities — skip this model rather than
              // fabricating a profile. Admin must populate capabilities.
              this.logger.warn(
                { modelId: model.id, provider: name, err: err instanceof Error ? err.message : err },
                '[SmartModelRouter] Skipping registry-listed model with missing capabilities',
              );
              skipped++;
              continue;
            }
          }
          registered++;
        }

        this.logger.info({
          provider: name,
          modelsDiscovered: models.length,
          registered,
          skippedOutOfRegistry: skipped,
        }, 'Discovered models from provider (registry-filtered)');

      } catch (error) {
        this.logger.warn({
          provider: name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to discover models from provider');
      }
    }
  }

  /**
   * Find profile by model ID (handles aliases)
   */
  private findProfileByModelId(modelId: string): ModelProfile | undefined {
    const normalized = modelId.toLowerCase();

    // Direct match
    if (this.modelProfiles.has(modelId)) {
      return this.modelProfiles.get(modelId);
    }

    // Search by partial match
    for (const [id, profile] of this.modelProfiles) {
      if (normalized.includes(id.toLowerCase()) || id.toLowerCase().includes(normalized)) {
        return profile;
      }
    }

    return undefined;
  }

  /**
   * Create a profile from discovered model data.
   *
   * #911 rip (2026-05-20): substring-sniff capability inference REMOVED.
   * Per the two-SoT contract (CLAUDE.md §7 + memory `feedback_two_sot_providers_models_only`),
   * capabilities MUST come from the registry row's `capabilities` JSON.
   * The router does NOT infer functionCalling, FCA, vision, jsonMode, etc.
   * from model-name patterns. If the registry row lacks capabilities, the
   * router throws MODEL_NOT_IN_REGISTRY rather than silently fabricating
   * a profile.
   *
   * Pricing still falls back to ModelCapabilityRegistry (pattern-keyed
   * pricing map seeded from published vendor rates) — that path is
   * allowlisted by docs/rules/no-hardcoded-models.md as a "wire-format
   * gate / pricing seed" carve-out and lives in MCR / BedrockPricingService
   * which are the only files allowed to enumerate model-id literals.
   *
   * @param model            Discovered model meta from provider.listModels().
   * @param providerName     Provider name the model lives on.
   * @param registryRow      MUST be supplied. The registry-supplied
   *                         capabilities JSON + context window. When null /
   *                         undefined / capabilities missing, throws.
   */
  private createProfileFromDiscovery(
    model: { id: string; name: string; provider: string },
    providerName: string,
    registryRow?: {
      capabilities: Record<string, any> | null;
      contextWindowTokens?: number;
      /**
       * First-class per-model FCA column (model_role_assignments.function_calling_accuracy).
       * SoT for routing capability score. Falls back to capabilities JSON for
       * legacy rows that predate the column, then 0.
       */
      functionCallingAccuracy?: number | null;
    },
  ): ModelProfile {
    if (!registryRow || !registryRow.capabilities || typeof registryRow.capabilities !== 'object') {
      throw new Error(
        `MODEL_NOT_IN_REGISTRY: createProfileFromDiscovery requires registry-supplied capabilities for ` +
          `model=${model.id} provider=${providerName}. ` +
          `The registry row's capabilities JSON is the SoT — name-substring inference is banned.`,
      );
    }

    const providerType = this.inferProviderType(providerName);
    const regCaps = registryRow.capabilities;

    // Boolean capability flags MUST come from registry row. We do not
    // OR-default any flag — undefined means "not set on registry row"
    // which by SoT contract means false.
    const capabilities: ModelProfile['capabilities'] = {
      chat: regCaps.chat === true,
      functionCalling: regCaps.functionCalling === true,
      // Column-first: the first-class function_calling_accuracy column is the
      // SoT. Fall back to the capabilities JSON for legacy rows, then 0.
      functionCallingAccuracy:
        typeof registryRow.functionCallingAccuracy === 'number'
          ? registryRow.functionCallingAccuracy
          : typeof regCaps.functionCallingAccuracy === 'number'
            ? regCaps.functionCallingAccuracy
            : 0,
      vision: regCaps.vision === true,
      imageGeneration: regCaps.imageGeneration === true,
      embeddings: regCaps.embeddings === true,
      streaming: regCaps.streaming === true,
      jsonMode: regCaps.jsonMode === true,
      structuredOutput: regCaps.structuredOutput === true,
      supportsToolInputDelta: regCaps.supportsToolInputDelta === true,
      supportsThinking: regCaps.supportsThinking === true,
      supportsCitations: regCaps.supportsCitations === true,
      supportsSyntheticThinking: regCaps.supportsSyntheticThinking === true,
    };

    // #1091 L1: row-level contextWindowTokens (populated via
    // resolveContextWindow at registry-load time) is SoT. Fall back to
    // scanning regCaps via the same canonicalizer so any registry row
    // that bypassed the loader's normalization (e.g. test fixtures,
    // direct DB inserts) still surfaces. Final fallback 8192.
    const maxContextTokens =
      (typeof registryRow.contextWindowTokens === 'number'
        ? registryRow.contextWindowTokens
        : resolveContextWindow(regCaps)) ?? 8192;
    const maxOutputTokens =
      typeof regCaps.maxOutputTokens === 'number' ? regCaps.maxOutputTokens : 8192;

    this.logger.info(
      {
        modelId: model.id,
        provider: providerName,
        sourcedFromRegistry: true,
        functionCalling: capabilities.functionCalling,
        functionCallingAccuracy: capabilities.functionCallingAccuracy,
        maxContextTokens,
      },
      'Created profile from discovered model (registry-sourced capabilities)',
    );

    return {
      modelId: model.id,
      provider: providerName,
      providerType,
      capabilities,
      performance: {
        maxContextTokens,
        maxOutputTokens,
        avgLatencyMs: 500,
        tokensPerSecond: 100,
      },
      cost: (() => {
        // Pricing stays sourced from ModelCapabilityRegistry — the documented
        // carve-out for pricing literals (see no-hardcoded-models.md). Capability
        // inference is gone; pricing seed remains. classifyModelCost gives the
        // SAME resolution the registry endpoint uses (MCR → local-free → a
        // conservative per-provider cloud estimate) so the Live Scoring Lab and
        // the router never disagree on a model's cost (#1082). The router has no
        // registry cost column in scope here, so registry* stay null and MCR /
        // estimate carry it. Null-safe: MCR may be uninitialized in tests.
        const mcr = getModelCapabilityRegistry();
        const mcrCaps = mcr ? mcr.getCapabilities(model.id) : undefined;
        const cost = classifyModelCost({
          providerName,
          mcrInputPer1k: mcrCaps?.inputCostPer1k ?? null,
          mcrOutputPer1k: mcrCaps?.outputCostPer1k ?? null,
        });
        return {
          inputPer1kTokens: cost.inputPer1k,
          outputPer1kTokens: cost.outputPer1k,
          currency: 'USD',
        };
      })(),
      metadata: {
        family: this.inferModelFamily(model.id),
        version: this.inferModelVersion(model.id),
        specializations: capabilities.functionCalling ? ['tools', 'reasoning'] : ['general'],
        lastTested: new Date(),
        isAvailable: true,
      },
    };
  }

  /**
   * Infer provider type from provider name
   */
  private inferProviderType(providerName: string): ModelProfile['providerType'] {
    const lower = providerName.toLowerCase();
    if (lower.includes('foundry')) return 'azure-ai-foundry';
    if (lower.includes('azure')) return 'azure-openai';
    if (lower.includes('bedrock')) return 'aws-bedrock';
    if (lower.includes('vertex') || lower.includes('google')) return 'google-vertex';
    if (lower.includes('ollama')) return 'ollama';
    return 'azure-openai'; // default
  }

  /**
   * Infer model family from ID
   */
  private inferModelFamily(modelId: string): string {
    const lower = modelId.toLowerCase();
    if (lower.includes('gpt')) return 'gpt';
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini')) return 'gemini';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('titan')) return 'titan';
    return 'unknown';
  }

  /**
   * Infer model version from ID
   */
  private inferModelVersion(modelId: string): string {
    const match = modelId.match(/(\d+\.?\d*)/);
    return match ? match[1] : '1.0';
  }

  /**
   * Ensure Milvus collection exists
   */
  private async ensureMilvusCollection(): Promise<void> {
    if (!this.milvusClient) return;

    try {
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: this.collectionName
      });

      if (!hasCollection.value) {
        await this.milvusClient.createCollection({
          collection_name: this.collectionName,
          fields: [
            { name: 'id', data_type: 'Int64', is_primary_key: true, autoID: true },
            { name: 'model_id', data_type: 'VarChar', max_length: 256 },
            { name: 'provider', data_type: 'VarChar', max_length: 64 },
            { name: 'capability_embedding', data_type: 'FloatVector', dim: 3072 },
            { name: 'profile_json', data_type: 'VarChar', max_length: 65535 },
            { name: 'function_calling_accuracy', data_type: 'Float' },
            { name: 'cost_input', data_type: 'Float' },
            { name: 'max_context', data_type: 'Int32' }
          ]
        });

        await this.milvusClient.createIndex({
          collection_name: this.collectionName,
          field_name: 'capability_embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'L2',
          params: { nlist: 128 }
        });

        await this.milvusClient.loadCollection({ collection_name: this.collectionName });

        this.logger.info({ collectionName: this.collectionName }, 'Created Milvus collection for model capabilities');
      }
    } catch (error) {
      // Milvus is optional here (model-capability cache). "Not ready yet" on a
      // fresh boot is non-fatal — keep it a calm warn so logs don't look broken.
      const msg = String((error as any)?.message || error || '').toLowerCase();
      if (/connect|unavailable|deadline|timeout|econnrefused|not ready|grpc|channel|draining|pool/.test(msg)) {
        this.logger.warn('Milvus not ready — skipping model-capability collection (non-fatal, retried later)');
      } else {
        this.logger.error({ error }, 'Failed to ensure Milvus collection');
      }
    }
  }

  /**
   * Store model profiles in Milvus with embeddings
   */
  private async storeProfilesInMilvus(): Promise<void> {
    if (!this.milvusClient || !this.embeddingService) return;

    try {
      const profiles = Array.from(this.modelProfiles.values());

      for (const profile of profiles) {
        // Generate embedding from capability description
        const description = this.createCapabilityDescription(profile);
        const embeddingResult = await this.embeddingService.generateEmbedding(description);

        if (embeddingResult && Array.isArray(embeddingResult)) {
          profile.embedding = embeddingResult;
        }
      }

      // Insert into Milvus
      const data = profiles
        .filter(p => p.embedding)
        .map(profile => ({
          model_id: profile.modelId,
          provider: profile.provider,
          capability_embedding: profile.embedding!,
          profile_json: JSON.stringify(profile),
          function_calling_accuracy: profile.capabilities.functionCallingAccuracy,
          cost_input: profile.cost.inputPer1kTokens,
          max_context: profile.performance.maxContextTokens
        }));

      if (data.length > 0) {
        await this.milvusClient.insert({
          collection_name: this.collectionName,
          data
        });

        this.logger.info({ count: data.length }, 'Stored model profiles in Milvus');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to store profiles in Milvus');
    }
  }

  /**
   * Create capability description for embedding
   */
  private createCapabilityDescription(profile: ModelProfile): string {
    const caps = [];

    if (profile.capabilities.functionCalling) {
      caps.push(`function calling tools with ${(profile.capabilities.functionCallingAccuracy * 100).toFixed(0)}% accuracy`);
    }
    if (profile.capabilities.vision) caps.push('vision image understanding');
    if (profile.capabilities.imageGeneration) caps.push('image generation');
    if (profile.capabilities.jsonMode) caps.push('JSON mode structured output');
    // A₂ parity flags — surface to the embedding so Milvus semantic search
    // can match queries like "streaming tool args" or "citations".
    if (profile.capabilities.supportsToolInputDelta) caps.push('streaming tool argument deltas');
    if (profile.capabilities.supportsThinking) caps.push('native extended thinking / reasoning');
    if (profile.capabilities.supportsCitations) caps.push('inline citations and grounding');
    if (profile.capabilities.supportsSyntheticThinking) caps.push('synthetic thinking traces');

    return `${profile.modelId} from ${profile.provider}: ${caps.join(', ')}. ` +
           `Specializations: ${profile.metadata.specializations.join(', ')}. ` +
           `Max context: ${profile.performance.maxContextTokens} tokens. ` +
           `Cost: $${profile.cost.inputPer1kTokens}/1k tokens.`;
  }

  /**
   * Analyze a completion request to determine requirements.
   *
   * 2026-04-29 — chatmode-ux-mock-parity Wave2-D (plan §38-52, task 1.7+1.17):
   * The 5 hand-tuned regex detectors that previously lived here (verb /
   * resource / breadth / compound-list / discovery-plus-report) are
   * deleted. The classifier-driven FCA-escalation branch that briefly
   * replaced them (the per-intent FCA-floor field on RouterTuning) was
   * itself ripped 2026-05-02 with the viz-tier ladder.
   *
   * What stays in here is purely structural:
   *   - hasTools / toolCount: derived from the request.tools array.
   *   - requiresVision: derived from message-content shape.
   *   - estimatedTokens: derived from total content length.
   *   - recommendedCapabilities: rolled up from the structural signals.
   *
   * No keyword regex. No prose interpretation. Plan §80: "Regex-as-fallback
   * IS regex routing" — when the classifier is unavailable we let the
   * FCA-floor scoring path handle it; we do not regex.
   */
  analyzeRequest(request: CompletionRequest): RequestAnalysis {
    const allContent = request.messages.map(m => m.content || '').join(' ').toLowerCase();

    // Tool detection — purely structural.
    const hasExplicitTools = !!(request.tools && request.tools.length > 0);
    const explicitToolCount = request.tools?.length || 0;
    const hasTools = hasExplicitTools;
    const toolCount = explicitToolCount;

    // Vision detection — purely structural (content is an array of parts
    // with `type: 'image_url'`).
    const requiresVision = request.messages.some(m =>
      m.content &&
      typeof m.content === 'object' &&
      Array.isArray(m.content) &&
      (m.content as any[]).some((c: any) => c.type === 'image_url')
    );

    // Estimate tokens
    const estimatedTokens = Math.ceil(allContent.length / 4);

    // Determine recommended capabilities — only structural signals now.
    const recommendedCapabilities: string[] = [];
    if (hasTools) recommendedCapabilities.push('functionCalling');
    if (requiresVision) recommendedCapabilities.push('vision');

    return {
      hasTools,
      toolCount,
      requiresVision,
      estimatedTokens,
      recommendedCapabilities
    };
  }

  /**
   * Route request to optimal model.
   * 2026-04-19 — slider ripped (task #144); scoring uses a fixed neutral
   * 0.5 / 0.5 cost/quality weight. Per-user × per-model budget caps live
   * in UserModelBudgetService at dispatch time.
   *
   * Q1-fix-10 (2026-05-12) — `opts.priorClassification` lets the caller
   * thread the previous turn's task type into the classifier. The
   * PromptClassifier uses it to inherit capability requirements on
   * short continuation prompts (e.g. "break it down by day" after an
   * agentic prior). Optional — when undefined the classifier behaves
   * exactly as fresh-prompt path.
   */
  async routeRequest(
    request: CompletionRequest,
    userId?: string,
    opts?: { priorClassification?: import('./router/PromptClassifier.js').TaskType },
  ): Promise<RoutingDecision> {
    const __t0 = Date.now();
    // Fetch live tuning ONCE at the top of every routing decision.
    // RouterTuningService caches aggressively (in-memory + Redis), so this
    // is effectively free on the hot path.
    const tuning = await this.getTuning();

    const analysis = this.analyzeRequest(request);

    this.logger.debug({
      hasTools: analysis.hasTools,
      toolCount: analysis.toolCount,
    }, 'Request analysis');

    // Get all available models
    // (#72) Live disable check — query providerManager.isModelEnabled() on
    // every routing decision so admin toggles propagate instantly. The
    // local modelProfiles cache may be stale (especially right after a CRUD
    // op before the next reloadProviders() finishes), but isModelEnabled()
    // reads from the always-fresh in-memory state that Redis pub/sub
    // invalidation keeps current. If providerManager isn't wired up, we
    // fall back to the local isAvailable flag.
    //
    // Phase I (2026-04-30): the filter ALSO writes back to
    // `metadata.isAvailable` so callers like getCheapestChatModel — which
    // only consult the cached flag and skip providerManager — see the same
    // exclusion. Provider that comes back online flips the flag back to
    // true so recovery is automatic without a profile-cache rebuild.
    const availableModels = Array.from(this.modelProfiles.values())
      .filter(m => this.isProfileRoutable(m));

    if (availableModels.length === 0) {
      try { routerRouteRequestDurationMs.observe(Date.now() - __t0); } catch { /* metrics error — non-fatal */ }
      throw new Error('No models available for routing');
    }

    // Filter and score models
    let candidates = availableModels;
    let reason = '';

    const promptText = (request.messages || [])
      .filter((m: any) => m.role === 'user')
      .map((m: any) => typeof m.content === 'string' ? m.content : '')
      .join(' ');

    // Q1-fix-3 (2026-05-12) — PROMPT-PATTERN TASK CLASSIFIER.
    // Detects agentic shapes (multi-cloud / cross-system / cost-analysis /
    // security-audit / file-read / single-system-read) and maps them to a
    // CAPABILITY profile. The router then filters DB-discovered models by
    // the profile's FCA + context floors. The classifier never names
    // a model; the model is whichever DB-registered one passes the floors
    // and wins the cost+quality score.
    //
    // Why this is NOT the previously-banned regex routing:
    //   - Banned routing was inside the chat tool-array stage (forced tool
    //     injection by hardcoded tool-name keyword). This is router-stage,
    //     filters CANDIDATE MODELS, never touches tools.
    //   - Banned routing reproduced specific named identifier constants.
    //     The arch-test source grep that pins them is in
    //     `__tests__/architecture/no-regex-intent-routing.source-regression.test.ts`;
    //     this classifier shares no needle with that set.
    //   - Banned routing was the cheap-pool shortcut (simple-query verb
    //     alternation) that bypassed the agents stage. This classifier
    //     does the opposite: it ESCALATES away from the cheap pool for
    //     agentic shapes; it never bypasses anything.
    // Q1-fix-10 — thread prior turn's classification (when caller provides
    // it) so a short follow-up like "break it down by day" inherits the
    // agentic capability floor instead of falling through to pure-chat.
    const { taskType, profile: capProfile } = classifyAndProfile(promptText, {
      priorClassification: opts?.priorClassification,
    });
    // #796 follow-up — every -agentic TaskType must apply its capability
    // profile floor; otherwise the classifier names the right profile but
    // the router silently falls back to chat-pool FCA. Smoking gun
    // 2026-05-13: taskType=architecture-design-agentic + profile FCA=0.90
    // BUT selectedModelId=gpt-oss:20b (FCA 0.87) resolvedBy=chat_pool_floor.
    // Root cause: this predicate was missing the new task type.
    const classifiedAgentic =
      taskType === 'multi-cloud-agentic' ||
      taskType === 'multi-system-agentic' ||
      taskType === 'cost-analysis-agentic' ||
      taskType === 'cost-audit' ||
      taskType === 'security-audit-agentic' ||
      taskType === 'architecture-design-agentic';

    // #828 T3 capability gate (structural only after #805 / #1049 rip).
    // STRUCTURAL TRIGGER ONLY — the EXPLICIT_MOST_CAPABLE_RE lexical
    // safety-net was ripped 2026-05-22 (#1049) because it reintroduced
    // the regex-routing pattern #805 deleted. The taskType allowlist,
    // FCA floor, and context-window floor are now sourced from the
    // RouterTuning DB row (admin-editable via /admin#router-tuning).
    //
    // Default allowlist (see ROUTER_TUNING_DEFAULTS.t3TriggerTaskTypes):
    //   - cost-audit
    //   - architecture-design-agentic
    //   - multi-cloud-agentic
    //   - multi-system-agentic
    //
    // Default floors: FCA ≥ tuning.fcaT3Floor (0.93) AND
    //                 context ≥ tuning.contextT3Floor (200000).
    //
    // Throws NO_T3_MODEL_IN_REGISTRY when the gate fires but no candidate
    // qualifies — never silently downgrades to a Haiku-class model.
    const t3StructuralTask = tuning.t3TriggerTaskTypes.includes(taskType);
    const forceT3Gate = t3StructuralTask;

    if (forceT3Gate) {
      const t3FcaFloor = tuning.fcaT3Floor;
      const t3ContextFloor = tuning.contextT3Floor;
      const beforeT3 = candidates.length;
      const t3Candidates = candidates.filter(
        (m) =>
          m.capabilities.chat === true &&
          m.capabilities.functionCallingAccuracy >= t3FcaFloor &&
          m.performance.maxContextTokens >= t3ContextFloor,
      );
      if (t3Candidates.length === 0) {
        // Hard fail when the gate fires and no candidate qualifies. Per
        // #828, silently downgrading to a Haiku-class model on
        // structural-T3 prompts is a Sev-0 — the operator must register
        // a Sonnet/Opus-class model before this prompt can route.
        try { routerRouteRequestDurationMs.observe(Date.now() - __t0); } catch { /* metrics — non-fatal */ }
        throw new Error(
          `NO_T3_MODEL_IN_REGISTRY: prompt requires T3 (FCA≥${t3FcaFloor}, context≥${t3ContextFloor}) ` +
            `but no candidate registry row qualifies. taskType=${taskType}`,
        );
      }
      try {
        const excluded = candidates.filter(
          (m) =>
            !(
              m.capabilities.chat === true &&
              m.capabilities.functionCallingAccuracy >= t3FcaFloor &&
              m.performance.maxContextTokens >= t3ContextFloor
            ),
        );
        for (const m of excluded) {
          routerFloorExcludedCounter.inc({ floor: 't3_capability_gate', model: m.modelId });
        }
        routerEscalationCounter.inc({ type: 't3_capability_gate' });
      } catch {
        /* metrics — non-fatal */
      }
      candidates = t3Candidates;
      reason = `T3 gate (${taskType}) — capability floor FCA≥${t3FcaFloor} + context≥${t3ContextFloor} (filtered ${beforeT3}→${candidates.length})`;
    }

    // INTENT CLASSIFIER — best-effort label, used downstream by the
    // legacy per-intent ranker (ripped Phase E.2 / E.10) and
    // validation.stage.ts (`route_escalated_destructive`). Phase E.1
    // (2026-05-10) ripped the pre-LLM LLM-classifier. The prompt-pattern
    // classifier above is its lightweight replacement for the
    // tools-not-yet-attached path (V2 discovery-mode pickModel call,
    // see chat/index.ts:401).

    // PURE-CHAT FCA FLOOR (Stage C, 2026-04-23): when the request has NO
    // tools AND the classifier did not detect an agentic shape, filter out
    // models whose FCA is below the chat-pool floor. Agentic shapes are
    // handled by the stricter capability-profile floor below.
    if (!analysis.hasTools && !classifiedAgentic) {
      const chatCapable = candidates.filter(
        (m) => m.capabilities.functionCallingAccuracy >= tuning.fcaChatPoolFloor,
      );
      if (chatCapable.length > 0 && chatCapable.length < candidates.length) {
        try {
          const excluded = candidates.filter((m) => m.capabilities.functionCallingAccuracy < tuning.fcaChatPoolFloor);
          for (const m of excluded) { routerFloorExcludedCounter.inc({ floor: 'chat_pool', model: m.modelId }); }
          routerEscalationCounter.inc({ type: 'chat_pool_filter' });
        } catch { /* metrics error — non-fatal */ }
        candidates = chatCapable;
        reason = `Pure chat — filtered to FCA ≥ ${tuning.fcaChatPoolFloor}`;
      }
    }

    // Q1-fix-3 — CAPABILITY-PROFILE FLOOR: apply the classifier's FCA +
    // context floors. For agentic shapes this gates FCA-0.87-class models
    // (gpt-oss:20b) out of contention so they don't get picked for a
    // multi-cloud tool fan-out plan they empirically can't execute.
    if (classifiedAgentic) {
      // Floors now sourced from tuning DB (#1049, 2026-05-22). Fallbacks
      // mirror the cheapest classifier profile (single-system-read) so an
      // operator who prunes the map doesn't accidentally remove the floor.
      const profileFcaFloor =
        tuning.capabilityProfileFloors[taskType] ?? 0.85;
      const profileContextFloor =
        tuning.capabilityContextFloors[taskType] ?? 8000;
      const beforeCount = candidates.length;
      const profileCandidates = candidates.filter(
        (m) =>
          m.capabilities.functionCallingAccuracy >= profileFcaFloor &&
          m.performance.maxContextTokens >= profileContextFloor,
      );
      if (profileCandidates.length > 0) {
        try {
          const excluded = candidates.filter(
            (m) =>
              m.capabilities.functionCallingAccuracy < profileFcaFloor ||
              m.performance.maxContextTokens < profileContextFloor,
          );
          for (const m of excluded) {
            routerFloorExcludedCounter.inc({ floor: 'capability_profile', model: m.modelId });
          }
          routerEscalationCounter.inc({ type: 'capability_profile_filter' });
        } catch { /* metrics error — non-fatal */ }
        candidates = profileCandidates;
        reason = `${taskType} — capability profile FCA≥${profileFcaFloor} (filtered ${beforeCount}→${candidates.length})`;
      } else {
        // No model clears the strict floor — keep the original candidate
        // set so chat never crashes. Surface a soft warning in the reason.
        reason = `${taskType} — capability profile FCA≥${profileFcaFloor} unmet by any DB model; falling back to all candidates`;
      }
    }

    // SIMPLE TOOL FLOOR: For tool-based requests, filter by function-calling
    // accuracy. Single-tier — the classifier-driven complex-tool escalation
    // was ripped 2026-05-02 with the viz-tier ladder. gpt-oss:20b + Haiku
    // remain eligible at the 0.83 default; per-intent tool surface tuning
    // (formerly per-intent top-K) was ripped Phase E.10.
    if (analysis.hasTools) {
      const floor = tuning.fcaSimpleToolFloor;
      const floorLabel = 'simple_tool';
      try {
        const toolExcluded = candidates.filter((m) => !(m.capabilities.functionCalling && m.capabilities.functionCallingAccuracy >= floor));
        for (const m of toolExcluded) { routerFloorExcludedCounter.inc({ floor: floorLabel, model: m.modelId }); }
      } catch { /* metrics error — non-fatal */ }

      candidates = candidates.filter(m =>
        m.capabilities.functionCalling &&
        m.capabilities.functionCallingAccuracy >= floor
      );

      if (candidates.length === 0) {
        // Fallback to best available function calling model
        candidates = availableModels
          .filter(m => m.capabilities.functionCalling)
          .sort((a, b) => b.capabilities.functionCallingAccuracy - a.capabilities.functionCallingAccuracy)
          .slice(0, 3);

        reason = `No models meet ${floor * 100}% accuracy threshold, using best available`;
      } else {
        reason = `Tool request — ${candidates.length} models ≥${floor * 100}% FC accuracy`;
      }
    }

    // Filter by vision if needed — HARD GUARD (Chat VISION path, sev1).
    // A vision-required prompt is a STRUCTURAL capability gate, exactly like
    // the T3 / agentic-profile gates: the pick is forced by the prompt's
    // modality, not by cost scoring. analysis.requiresVision derives
    // structurally from an `image_url` content part. Two behaviours:
    //   (1) flag `visionGated` so the resolvedBy derivation below labels it
    //       `vision_capability_gate` and `escalated=true` — otherwise the
    //       default-first contract in resolveChatModel could revert a vision
    //       pick back to the configured, possibly non-vision, DB default.
    //   (2) when NO vision-capable candidate is registered/enabled, FAIL LOUD.
    //       A non-vision model handed an image silently ignores it and
    //       confidently hallucinates — strictly worse than surfacing the
    //       misconfiguration. The error propagates through resolveChatModel →
    //       stream.handler pickModel as a user-facing message, not a blind turn.
    let visionGated = false;
    if (analysis.requiresVision) {
      const visionCandidates = candidates.filter(m => m.capabilities.vision);
      if (visionCandidates.length > 0) {
        candidates = visionCandidates;
        reason += ' (with vision capability)';
        visionGated = true;
      } else {
        try { routerEscalationCounter.inc({ type: 'no_vision_model_surface' }); } catch { /* metrics — non-fatal */ }
        this.logger.warn(
          { availableCount: availableModels.length },
          '[router] image turn but NO vision-capable model is registered/enabled — surfacing NO_VISION_MODEL (never routes an image to a blind model)',
        );
        try { routerRouteRequestDurationMs.observe(Date.now() - __t0); } catch { /* metrics — non-fatal */ }
        throw new Error(
          'NO_VISION_MODEL: this turn includes an image but no vision-capable model is configured or enabled. Ask an admin to register/enable a vision-capable model, or remove the image.',
        );
      }
    }

    // Filter by context length
    if (analysis.estimatedTokens > 8000) {
      const longContextCandidates = candidates.filter(m =>
        m.performance.maxContextTokens >= analysis.estimatedTokens * 2
      );
      if (longContextCandidates.length > 0) {
        candidates = longContextCandidates;
      }
    }

    // Load per-user model preferences (if available)
    let userModelBonus = new Map<string, number>();
    if (userId) {
      try {
        const { getFeedbackLearningService } = await import('./FeedbackLearningService.js');
        userModelBonus = await getFeedbackLearningService().getUserModelPreferences(userId);
      } catch { /* FeedbackLearningService not available */ }
    }

    // Score remaining candidates with live tuning weights + per-user bonus.
    // Phase E.1 (2026-05-10) — `classification` arg dropped. Spec §50: model
    // decides; FCA scoring is the sole routing signal. scoreModel's
    // `classification` param is retained for backwards-compat but never
    // populated; the intent-based FCA bonus is effectively dead code (gated
    // by `classification?.intent` which is now always undefined) until a
    // follow-up rips the parameter from scoreModel itself.
    const scoredCandidates = candidates.map(model => ({
      model,
      // #872 — pass classifiedAgentic through so the quality bonus fires
      // for *-agentic taskTypes when analysis.hasTools=false (v2 discovery).
      score: this.scoreModel(model, analysis, tuning, null, classifiedAgentic) + (userModelBonus.get(model.modelId) || 0)
    })).sort((a, b) => b.score - a.score);

    const selected = scoredCandidates[0].model;
    const alternatives = scoredCandidates.slice(1, 4).map(s => s.model);

    // VISION POST-SELECTION ASSERTION (Chat VISION path, sev1). The vision
    // filter above narrows to vision-capable candidates, but later floors
    // (context-length) and the empty-pool guard can REPLACE `candidates` with
    // the full available pool — which may re-introduce a blind model on an
    // image turn. This assertion is the definitive belt: when the turn carries
    // an image, the FINAL pick MUST be vision-capable or we surface, never
    // return a model that would silently ignore the image.
    if (analysis.requiresVision && !selected.capabilities.vision) {
      try { routerEscalationCounter.inc({ type: 'no_vision_model_surface' }); } catch { /* metrics — non-fatal */ }
      this.logger.warn(
        { selectedModelId: selected.modelId, availableCount: availableModels.length },
        '[router] post-selection vision assertion failed — selected model lacks vision on an image turn; surfacing NO_VISION_MODEL',
      );
      try { routerRouteRequestDurationMs.observe(Date.now() - __t0); } catch { /* metrics — non-fatal */ }
      throw new Error(
        'NO_VISION_MODEL: this turn includes an image but no vision-capable model is configured or enabled. Ask an admin to register/enable a vision-capable model, or remove the image.',
      );
    }

    // Build detailed reason
    if (!reason) {
      if (analysis.hasTools) {
        reason = `Tool calling (${analysis.toolCount} tools) - ${selected.modelId} has ${(selected.capabilities.functionCallingAccuracy * 100).toFixed(0)}% accuracy`;
      } else {
        reason = `Simple chat - using cost-effective ${selected.modelId}`;
      }
    }

    // VERBOSE LOGGING for model selection analytics
    this.logger.info({
      selectedModel: selected.modelId,
      selectedProvider: selected.provider,
      selectedCost: `$${selected.cost.inputPer1kTokens.toFixed(4)}/1k tokens`,
      functionCallingAccuracy: `${(selected.capabilities.functionCallingAccuracy * 100).toFixed(0)}%`,
      reason,
      alternatives: alternatives.map(a => ({
        model: a.modelId,
        provider: a.provider,
        cost: `$${a.cost.inputPer1kTokens.toFixed(4)}/1k`
      })),
      requestAnalysis: {
        hasTools: analysis.hasTools,
        toolCount: analysis.toolCount,
        estimatedTokens: analysis.estimatedTokens
      },
    }, '[ROUTER] MODEL ROUTING DECISION (slider removed)');

    // Derive resolved_by label from the routing path taken. The
    // `intent_classifier` resolvedBy was ripped 2026-05-02 alongside
    // the FCA-floor escalation branch; the prompt-pattern classifier
    // (Q1-fix-3, 2026-05-12) is its lightweight replacement for the
    // tools-not-yet-attached path.
    let resolvedBy = 'cost_quality_score';
    if (reason.startsWith('T3 gate')) resolvedBy = 't3_capability_gate';
    else if (classifiedAgentic) resolvedBy = 'capability_profile';
    // Vision capability gate — a vision-required prompt forced the pick to a
    // vision-capable model. STRUCTURAL escalation: it must outrank the cost-
    // score / chat-pool / tool-floor labels so `escalated` below is true and
    // the default-first contract in resolveChatModel cannot revert the pick to
    // the (possibly non-vision) configured default.
    else if (visionGated) resolvedBy = 'vision_capability_gate';
    else if (reason.startsWith('Pure chat')) resolvedBy = 'chat_pool_floor';
    else if (reason.startsWith('Tool request')) resolvedBy = 'tool_floor';

    // Log the classified task type + chosen profile so operators can audit
    // the new routing branch from kibana / api logs without re-running the
    // request.
    this.logger.info(
      {
        promptHead: promptText.slice(0, 120),
        taskType,
        capabilityProfile: {
          // Floors sourced from RouterTuning DB (#1049, 2026-05-22).
          // Profile fallbacks mirror cheapest-tier defaults so a
          // partially-configured map never produces NaN floors.
          requiresToolUseReliability:
            tuning.capabilityProfileFloors[taskType] ?? 0.85,
          requiresContextTokens:
            tuning.capabilityContextFloors[taskType] ?? 8000,
          requiresReasoning: capProfile.requiresReasoning,
        },
        selectedModelId: selected.modelId,
        selectedFca: selected.capabilities.functionCallingAccuracy,
        resolvedBy,
      },
      '[ROUTER] task classification + capability profile',
    );

    // Derive tier label from FCA
    const fca = selected.capabilities.functionCallingAccuracy;
    const tier = fca >= 0.93 ? 'frontier' : fca >= 0.85 ? 'high' : fca >= 0.80 ? 'mid' : 'low';

    try {
      routerDecisionCounter.inc({ resolved_by: resolvedBy, selected_model: selected.modelId, tier });
      routerRouteRequestDurationMs.observe(Date.now() - __t0);
    } catch { /* metrics error — non-fatal */ }

    // Persist the decision so admin Router Health pane + escalation triggers
    // pane have real history to render. Fire-and-forget; a DB write failure
    // must never kill a routing call. context blob carries everything the
    // admin/v3-extras /router/decisions reader expects. 2026-05-25 audit
    // — pane was permanently empty because nothing wrote this table.
    (async () => {
      try {
        const { prisma } = await import('../utils/prisma.js');
        const sessionId = (request as any).sessionId ?? userId ?? 'unknown';
        const previousModel = (analysis as any).previousModel ?? selected.modelId;
        const alternates = (alternatives ?? []).slice(0, 5).map((a: any) => a?.modelId ?? a?.id ?? String(a));
        const firstMsg = Array.isArray((request as any)?.messages) ? (request as any).messages[0] : undefined;
        await prisma.modelRoutingDecision.create({
          data: {
            session_id: String(sessionId),
            model_from: String(previousModel),
            model_to: String(selected.modelId),
            reason: String(reason),
            context: {
              intent: (analysis as any)?.intent,
              prompt: typeof firstMsg?.content === 'string'
                ? String(firstMsg.content).slice(0, 500)
                : undefined,
              score: (selected as any)?.score,
              fca: selected.capabilities.functionCallingAccuracy,
              tier,
              resolvedBy,
              alternates,
              latencyMs: Date.now() - __t0,
              inputCostPer1k: (selected as any)?.capabilities?.inputCostPer1k,
              outputCostPer1k: (selected as any)?.capabilities?.outputCostPer1k,
            },
          },
        });
      } catch (err: any) {
        this.logger.debug({ err: err?.message }, 'modelRoutingDecision write skipped (non-fatal)');
      }
    })();

    return {
      selectedModel: selected,
      reason,
      // DEFAULT-FIRST (2026-05-24): resolveChatModel uses the router's pick
      // ONLY when it escalated above the chat pool. `escalated` is true when
      // a structural capability gate fired (T3 gate / agentic capability
      // profile). For ordinary prompts (cost_quality_score / chat_pool_floor
      // / tool_floor) escalated=false → the configured DB default wins, so a
      // cheap model is never silently substituted for the operator's default.
      // The vision gate is included because a vision-required pick is
      // structurally forced by the prompt's modality — reverting it to a
      // non-vision default would break the turn.
      escalated:
        resolvedBy === 't3_capability_gate' ||
        resolvedBy === 'capability_profile' ||
        resolvedBy === 'vision_capability_gate',
      resolvedBy,
      alternativeModels: alternatives,
      analysisResults: analysis,
      // Phase E.1 (2026-05-10) — `route_escalated_destructive` always
      // false post-classifier-rip. The destructive-write intent label
      // was a classifier output; without a classifier, downstream audit
      // consumers fall back to reading the tool name + arguments.
      route_escalated_destructive: false,
      destructive_context: undefined,
    };
  }

  /**
   * Simulate routing for a user prompt without actually dispatching to an LLM.
   * Returns the same RoutingDecision as routeRequest plus a ranked list of
   * every candidate the router scored (including those filtered out by
   * floors), so the admin Live Scoring Lab can show the full picture.
   */
  async simulatePrompt(prompt: string): Promise<{
    analysis: RequestAnalysis;
    decision: {
      selectedModelId: string;
      reason: string;
      resolvedBy: string;
      tier: string;
    };
    ranked: Array<{
      modelId: string;
      provider: string;
      score: number;
      fca: number;
      inputCostPer1k: number;
      avgLatencyMs: number;
      tier: string;
      eligible: boolean;
      rank: number;
    }>;
    filteredOut: Array<{
      modelId: string;
      fca: number;
      excludedBy: string;
    }>;
  }> {
    const request: CompletionRequest = {
      messages: [{ role: 'user', content: prompt }],
      model: 'auto',
    } as CompletionRequest;

    const tuning = await this.getTuning();
    const analysis = this.analyzeRequest(request);

    // Phase I — same isProfileRoutable() helper as routeRequest. Flips
    // metadata.isAvailable in-place so the simulator stays consistent with
    // the live router.
    const allModels = Array.from(this.modelProfiles.values()).filter((m) => this.isProfileRoutable(m));

    // Run the same filter chain as routeRequest but track exclusions.
    //
    // 2026-04-29 (chatmode-ux-mock-parity Wave2-D): the destructive /
    // infra-ops / cloud-list / complexity-bias regex branches were
    // deleted alongside the 5 named regex detectors in `analyzeRequest`.
    // 2026-05-02 (viz-tier-ladder rip): the classifier-driven per-intent
    // FCA-floor escalation that briefly replaced them was also ripped —
    // the simulator now mirrors the live routeRequest path exactly:
    // structural chat-pool / simple-tool FCA floors only.
    const filteredOut: Array<{ modelId: string; fca: number; excludedBy: string }> = [];
    let candidates = [...allModels];

    // PURE-CHAT FCA FLOOR — when the request has no explicit tools,
    // filter the chat pool by tuning.fcaChatPoolFloor. Keeps
    // Ministral-3B-class garbage out.
    if (!analysis.hasTools) {
      const survivors = candidates.filter(
        (m) => m.capabilities.functionCallingAccuracy >= tuning.fcaChatPoolFloor,
      );
      if (survivors.length > 0 && survivors.length < candidates.length) {
        for (const m of candidates) {
          if (m.capabilities.functionCallingAccuracy < tuning.fcaChatPoolFloor) {
            filteredOut.push({
              modelId: m.modelId,
              fca: m.capabilities.functionCallingAccuracy,
              excludedBy: `chat pool floor (FCA ≥ ${tuning.fcaChatPoolFloor})`,
            });
          }
        }
        candidates = survivors;
      }
    }

    // SIMPLE-TOOL FCA FLOOR — applies to tool-bearing requests. Single
    // tier; the per-intent escalation knob was ripped 2026-05-02. Per-intent
    // tool surface tuning (formerly per-intent top-K) was ripped Phase E.10.
    if (analysis.hasTools) {
      const floor = tuning.fcaSimpleToolFloor;
      const before = candidates;
      candidates = candidates.filter(
        (m) => m.capabilities.functionCalling && m.capabilities.functionCallingAccuracy >= floor,
      );
      for (const m of before) {
        if (!candidates.includes(m)) {
          filteredOut.push({
            modelId: m.modelId,
            fca: m.capabilities.functionCallingAccuracy,
            excludedBy: `simple tool floor (FCA ≥ ${floor})`,
          });
        }
      }
    }

    // Vision filter
    if (analysis.requiresVision) {
      const visionCandidates = candidates.filter((m) => m.capabilities.vision);
      if (visionCandidates.length > 0) {
        for (const m of candidates) {
          if (!m.capabilities.vision) {
            filteredOut.push({
              modelId: m.modelId,
              fca: m.capabilities.functionCallingAccuracy,
              excludedBy: 'vision required but model lacks vision',
            });
          }
        }
        candidates = visionCandidates;
      }
    }

    // Score surviving candidates
    const scored = candidates
      .map((model) => ({
        model,
        score: this.scoreModel(model, analysis, tuning),
      }))
      .sort((a, b) => b.score - a.score);

    const tierOf = (fca: number): string =>
      fca >= 0.93 ? 'frontier' : fca >= 0.85 ? 'high' : fca >= 0.8 ? 'mid' : 'low';

    const ranked = scored.map((s, idx) => ({
      modelId: s.model.modelId,
      provider: s.model.provider,
      score: Number(s.score.toFixed(2)),
      fca: s.model.capabilities.functionCallingAccuracy,
      inputCostPer1k: s.model.cost.inputPer1kTokens,
      avgLatencyMs: s.model.performance.avgLatencyMs,
      tier: tierOf(s.model.capabilities.functionCallingAccuracy),
      eligible: true,
      rank: idx + 1,
    }));

    // Post-hoc resolvedBy/reason derivation from the structural
    // analysis signals. The classifier-driven escalation override was
    // ripped 2026-05-02 with the viz-tier ladder.
    const resolvedBy = analysis.hasTools ? 'tool_floor' : 'chat_pool_floor';
    const reason = scored[0]
      ? analysis.hasTools
        ? `Tool calling (${analysis.toolCount} tools) — ${scored[0].model.modelId} wins at ${(scored[0].model.capabilities.functionCallingAccuracy * 100).toFixed(0)}% FCA`
        : `Chat pool (FCA ≥ ${tuning.fcaChatPoolFloor}) — ${scored[0].model.modelId} wins on cost`
      : 'No eligible candidates after filters';

    const decision = {
      selectedModelId: scored[0]?.model.modelId ?? '(no eligible model)',
      reason,
      resolvedBy,
      tier: scored[0] ? tierOf(scored[0].model.capabilities.functionCallingAccuracy) : 'none',
    };

    return { analysis, decision, ranked, filteredOut };
  }

  /**
   * Score a model for a given request.
   * 2026-04-19 — slider ripped (task #144). Cost/quality weights default
   * to 0.5/0.5 (balanced) but are now live-configurable via RouterTuningService.
   * UserModelBudgetService enforces per-user spend caps at dispatch time.
   *
   * Stage C (2026-04-23): all scoring constants sourced from `tuning` so
   * admins can adjust them live via the admin router-tuning endpoint.
   */
  private scoreModel(
    model: ModelProfile,
    analysis: RequestAnalysis,
    tuning: RouterTuning,
    classification?: { intent?: string | null } | null,
    // #872 (2026-05-15) — pass the classifier verdict down so the quality
    // bonus fires for *-agentic taskTypes even in v2 discovery-mode where
    // analysis.hasTools=false (tools resolve mid-turn). Without this, the
    // Q1 Azure list prompt classifies as multi-system-agentic but the
    // bonus skips, scoring collapses to cost+latency, and gpt-oss:20b
    // beats Sonnet 4.6. Live regression of #796/#658/#670.
    classifiedAgentic?: boolean,
  ): number {
    const { costWeight, qualityWeight } = tuning;

    let score = 0;

    // Function calling accuracy is critical for tool-based tasks (quality-weighted)
    if (analysis.hasTools) {
      // Base score for function calling, weighted by quality preference
      const functionCallingScore = model.capabilities.functionCallingAccuracy * tuning.toolCallingBonusMaxPoints;
      score += functionCallingScore * (0.5 + qualityWeight * 0.5); // Min 50% of base score
    }

    // Vision requirement
    if (analysis.requiresVision && model.capabilities.vision) {
      score += 20;
    }

    // Context length bonus for long conversations
    if (analysis.estimatedTokens > 4000) {
      score += Math.min(model.performance.maxContextTokens / 50000, 10);
    }

    // Cost optimization (cost-weighted)
    // Higher cost weight = more bonus for cheaper models
    const costScore = (1 - Math.min(model.cost.inputPer1kTokens / tuning.costNormalizationCeiling, 1)) * tuning.costBonusMaxPoints;
    score += costScore * costWeight;

    // Latency bonus for faster models (cost-weighted - speed matters more when optimizing cost)
    const latencyScore = (1 - Math.min(model.performance.avgLatencyMs / 1000, 1)) * tuning.latencyBonusMaxPoints;
    score += latencyScore * costWeight;

    // Quality bonus (quality-weighted, gated on complexity signals).
    //
    // 2026-04-29 (chatmode-ux-mock-parity Wave2-D): hasTools was the only
    // structural signal. That broke #670: when the v2 cascade is in
    // discovery-mode, `tools=[]` at routing time even for action prompts
    // ("show me my cloud resources" with intent=cloud-list arrives with
    // 0 tools — the model picks them up mid-turn via tool_search). With
    // hasTools as the only gate, the quality bonus was skipped and
    // routing collapsed to pure cost+latency, which always picks the
    // cheapest model regardless of which models are enabled.
    //
    // 2026-05-07 #670: add intent as a complexity signal. Any non-chat
    // intent (cloud-list / code-gen / architecture / destructive-write
    // / render-artifact / single-read / unclear) implies "this prompt
    // wants real work done" — quality bonus fires so the highest-FCA
    // available model wins, regardless of registry topology.
    const intent = classification?.intent;
    const isActionIntent = intent != null && intent !== 'chat';
    // #872 (2026-05-15) — classifiedAgentic is the third complexity signal.
    // Required because v2 discovery-mode delivers analysis.hasTools=false
    // even for agentic prompts (tools resolve mid-turn via tool_search).
    // The intent classifier was ripped Phase E.1 so `intent` is always
    // null. Without classifiedAgentic, hasAnyComplexity is false for
    // every action prompt and scoring collapses to cost+latency.
    const hasAnyComplexity = analysis.hasTools || isActionIntent || classifiedAgentic === true;
    if (!tuning.fcaQualityGatedByComplexity || hasAnyComplexity) {
      const qualityHeadroom = Math.max(
        0,
        model.capabilities.functionCallingAccuracy - tuning.fcaQualityFloor,
      );
      // 2026-05-07 #670 — multiplier amplification for action intents.
      //
      // Default fcaQualityMultiplier=100 with qualityWeight=0.5 produces a
      // max quality-bonus of ~12.5 points, which is below the cost-side
      // headroom of ~35 (cost 25 + latency 10). That meant cheap models
      // beat smart models even when the prompt was clearly action-y. For
      // any intent the classifier locked onto something other than chat
      // — or even when it returned `unclear` — capability has to outweigh
      // cost. Empirical 5x amplifier: a 0.07 FCA gap (sonnet 0.94 vs
      // gpt-oss 0.87) produces ~17.5 quality points, comfortably beating
      // the ~3.6 cost-side delta when comparing $0.003/1k vs $0.0001/1k
      // models. Cost-conscious operators can still tilt back via
      // RouterTuning.qualityWeight (admin-editable).
      //
      // #872 (2026-05-15) — classifiedAgentic ALSO triggers the 5x amp,
      // matching the isActionIntent contract for the post-intent-classifier
      // world. Without this, agentic prompts get the gate-pass but no
      // amplification, so cost still nudges cheap models ahead.
      const actionAmp = isActionIntent || classifiedAgentic === true ? 5 : 1;
      score += qualityHeadroom * tuning.fcaQualityMultiplier * qualityWeight * actionAmp;
      try { routerQualityBonusCounter.inc({ applied: 'yes' }); } catch { /* metrics error — non-fatal */ }
    } else {
      // fcaQualityGatedByComplexity=true AND no complexity signals — bonus skipped
      try { routerQualityBonusCounter.inc({ applied: 'no_complexity_gate' }); } catch { /* metrics error — non-fatal */ }
    }

    // Feedback-driven bonus: adjust score based on real user satisfaction data
    score += this.getFeedbackBonus(model.modelId);

    return score;
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): ModelProfile | undefined {
    return this.modelProfiles.get(modelId) || this.findProfileByModelId(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): ModelProfile[] {
    return Array.from(this.modelProfiles.values());
  }

  /**
   * Get models suitable for function calling.
   * Floor moved to RouterTuning DB row (#1049, 2026-05-22). Callers must
   * pass the floor explicitly — the previous default constant
   * (MIN_FUNCTION_CALLING_ACCURACY = 0.90) was ripped because it embedded
   * routing policy in source. Pass `tuning.fcaComplexToolFloor` for the
   * old default behaviour, or `tuning.fcaSimpleToolFloor` for cheap-pool
   * eligibility.
   */
  async getFunctionCallingModels(minAccuracy?: number): Promise<ModelProfile[]> {
    const floor =
      typeof minAccuracy === 'number'
        ? minAccuracy
        : (await this.getTuning()).fcaComplexToolFloor;
    return Array.from(this.modelProfiles.values())
      .filter(m => m.capabilities.functionCalling && m.capabilities.functionCallingAccuracy >= floor)
      .sort((a, b) => b.capabilities.functionCallingAccuracy - a.capabilities.functionCallingAccuracy);
  }

  /**
   * Get the best model for function calling
   */
  async getBestFunctionCallingModel(): Promise<ModelProfile | undefined> {
    const models = await this.getFunctionCallingModels();
    return models[0];
  }

  /**
   * Get cheapest model for simple chat
   */
  getCheapestChatModel(): ModelProfile | undefined {
    return Array.from(this.modelProfiles.values())
      .filter(m => m.capabilities.chat && m.metadata.isAvailable)
      .sort((a, b) => a.cost.inputPer1kTokens - b.cost.inputPer1kTokens)[0];
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Update model availability
   */
  updateModelAvailability(modelId: string, isAvailable: boolean): void {
    const profile = this.modelProfiles.get(modelId);
    if (profile) {
      profile.metadata.isAvailable = isAvailable;
      profile.metadata.lastTested = new Date();
    }
  }

  /**
   * Phase I — single routability check shared by routeRequest, simulateRouting
   * and any other candidate-pool consumer.
   *
   * Returns true iff:
   *   1. The model is not an embedding-only profile (chat-side guard).
   *   2. The model's provider is currently live in providerManager
   *      (i.e. enabled=true AND deleted_at=null at the DB layer; absent
   *      from getProviders() / isModelEnabled() if not).
   *
   * Side effect: writes back to `profile.metadata.isAvailable` to mirror the
   * live provider status. This makes downstream callers that ONLY check the
   * cached flag (e.g. getCheapestChatModel) consistent with the routing path
   * without forcing a profile-cache rebuild every CRUD cycle.
   */
  private isProfileRoutable(profile: ModelProfile): boolean {
    // Embedding-side guard: never route an embed-only model for chat.
    const idLower = profile.modelId.toLowerCase();
    if (idLower.includes('embed') || idLower.includes('nomic')) {
      profile.metadata.isAvailable = false;
      return false;
    }

    // Capability-side guard: image-gen / audio-gen models never route for chat.
    // Ref: 2026-05-02 Sev-0 — `nemotron3:33b` (a GPU test model for image/audio)
    // leaked into chat candidate pool because the heuristic at line ~637
    // unconditionally sets `chat:true`. Causes 30s OllamaProvider timeout
    // when its `OLLAMA_BASE_URL` is unset, surfacing as "REQUEST_TIMEOUT" to
    // the chat user. Filter capability-first; no hardcoded model ids.
    if (isImageOrAudioOnlyProfile(profile)) {
      profile.metadata.isAvailable = false;
      return false;
    }

    // Live provider check via providerManager (the always-fresh source of
    // truth). When a provider is soft-deleted or admin-disabled, ProviderManager
    // removes it from `getProviders()` / returns false from `isModelEnabled`.
    if (this.providerManager && typeof this.providerManager.isModelEnabled === 'function') {
      const live = this.providerManager.isModelEnabled(profile.modelId);
      // Sync the cached flag both ways so the next read is correct.
      if (profile.metadata.isAvailable !== live) {
        profile.metadata.isAvailable = live;
        profile.metadata.lastTested = new Date();
      }
      return live;
    }

    // No providerManager wired up (some test fixtures): fall back to the
    // cached flag. We don't write to it here.
    return profile.metadata.isAvailable;
  }

  /**
   * Add or update a model profile
   */
  addModelProfile(profile: ModelProfile): void {
    this.modelProfiles.set(profile.modelId, profile);
    this.logger.info({ modelId: profile.modelId }, 'Added/updated model profile');
  }

  // ── Feedback-driven scoring ──────────────────────────────────────
  // Map of modelId → satisfaction rate (0-1) from ResponseFeedback table
  private feedbackScores: Map<string, { satisfaction: number; sampleSize: number }> = new Map();

  /**
   * Ingest user feedback from the ResponseFeedback table and update per-model satisfaction scores.
   * Call periodically (e.g. every 30 min) via setInterval.
   */
  async updateFromFeedback(prismaClient: any): Promise<void> {
    try {
      // Query feedback grouped by model, only last 30 days
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows: Array<{ model: string; feedback_type: string; _count: { id: number } }> =
        await prismaClient.responseFeedback.groupBy({
          by: ['model', 'feedback_type'],
          where: {
            created_at: { gte: cutoff },
            model: { not: null },
          },
          _count: { id: true },
        });

      // Build per-model counts
      const modelStats = new Map<string, { positive: number; negative: number }>();
      for (const row of rows) {
        if (!row.model) continue;
        const stats = modelStats.get(row.model) || { positive: 0, negative: 0 };
        if (['thumbs_up', 'copy', 'share'].includes(row.feedback_type)) {
          stats.positive += row._count.id;
        } else if (['thumbs_down', 'report', 'regenerate'].includes(row.feedback_type)) {
          stats.negative += row._count.id;
        }
        modelStats.set(row.model, stats);
      }

      // Compute satisfaction rates
      for (const [model, stats] of modelStats) {
        const total = stats.positive + stats.negative;
        if (total < 3) continue; // Need minimum sample
        const satisfaction = stats.positive / total;
        this.feedbackScores.set(model, { satisfaction, sampleSize: total });
      }

      this.logger.info(
        { modelCount: this.feedbackScores.size, scores: Object.fromEntries(this.feedbackScores) },
        '📊 Model feedback scores updated'
      );
    } catch (err) {
      this.logger.warn({ err }, 'Failed to update model feedback scores');
    }
  }

  /**
   * Get the feedback-derived satisfaction bonus for a model (0-15 points).
   * Returns 0 if no feedback data exists.
   */
  getFeedbackBonus(modelId: string): number {
    const entry = this.feedbackScores.get(modelId);
    if (!entry) return 0;
    // Scale: 50% satisfaction = 0 bonus, 100% = 15 points
    // Below 50% = negative penalty (up to -15)
    const bonus = (entry.satisfaction - 0.5) * 30;
    // Confidence scaling: more samples = more weight (cap at 50 samples)
    const confidence = Math.min(entry.sampleSize / 50, 1);
    return bonus * confidence;
  }
}

// Singleton instance
let smartModelRouterInstance: SmartModelRouter | null = null;

export function getSmartModelRouter(): SmartModelRouter | null {
  return smartModelRouterInstance;
}

export function setSmartModelRouter(router: SmartModelRouter): void {
  smartModelRouterInstance = router;
}
