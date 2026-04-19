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
import type { SliderConfig } from './SliderService.js';

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

// Request analysis result
export interface RequestAnalysis {
  hasTools: boolean;
  toolCount: number;
  isComplexReasoning: boolean;
  isMultiStep: boolean;
  isMultiCloud: boolean; // Mentions multiple cloud providers
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

/**
 * Destructive verbs the router should escalate on. Kept narrow — only
 * verbs that CAN cause resource loss. We exclude soft verbs (disable,
 * pause) because those are typically reversible.
 */
const DESTRUCTIVE_VERB_REGEX = /\b(?:delete|deletes|deleting|remove|removes|removing|drop|drops|dropping|destroy|destroys|destroying|terminate|terminates|terminating|purge|purges|purging|shutdown|shutting\s+down|deallocate|deallocates|deallocating|kill|kills|killing|wipe|wipes|wiping|nuke|nukes|nuking|tear\s+down|tearing\s+down|truncate|truncates|truncating)\b/i;

/**
 * Cloud-resource nouns. A prompt like "delete the report" doesn't count;
 * a prompt like "delete the resource group" does. Kept broad — anything
 * that maps to a cloud resource, pod, or secret.
 */
const CLOUD_RESOURCE_NOUN_REGEX = /\b(?:resource\s+group|resource\s+groups|subscription|subscriptions|tenant|tenants|vm|vms|virtual\s+machine|virtual\s+machines|instance|instances|bucket|buckets|blob|blobs|storage\s+account|storage\s+accounts|database|databases|db|dbs|rds|sql\s+server|table|tables|cluster|clusters|aks|eks|gke|namespace|namespaces|pod|pods|deployment|deployments|statefulset|statefulsets|vault|vaults|key\s+vault|secret\s+manager|secret|secrets|key|keys|certificate|certificates|cert|certs|role|roles|policy|policies|user|users|group|groups|service\s+account|service\s+accounts|iam|iam\s+role|function|functions|lambda|lambdas|cloud\s+function|queue|queues|topic|topics|stream|streams|workspace|workspaces|alert|alerts|rule|rules|firewall|firewall\s+rule|network|networks|vpc|vpcs|vnet|vnets|subnet|subnets|route|routes|nat\s+gateway|load\s+balancer|load\s+balancers|lb|lbs|dns|dns\s+zone|app\s+service|app\s+services|front\s+door|cdn|container\s+registry|acr|ecr|gcr|snapshot|snapshots|backup|backups|volume|volumes|disk|disks|image|images|ami|amis|container|containers|configmap|configmaps|secret\s+store)\b/i;

/**
 * Evaluate a prompt for destructive intent. Returns the matched verb +
 * noun when both co-occur, null otherwise. Matching is case-insensitive
 * and allows multi-word nouns ("resource group", "virtual machine").
 */
export function detectDestructiveIntent(prompt: string): { verb: string; noun: string } | null {
  if (!prompt || typeof prompt !== 'string') return null;
  const verbMatch = DESTRUCTIVE_VERB_REGEX.exec(prompt);
  if (!verbMatch) return null;
  const nounMatch = CLOUD_RESOURCE_NOUN_REGEX.exec(prompt);
  if (!nounMatch) return null;
  return {
    verb: verbMatch[0].toLowerCase(),
    noun: nounMatch[0].toLowerCase(),
  };
}

// Minimum function calling accuracy — two tiers.
//
// SIMPLE_FLOOR (0.83): for tool requests that are simple (1-3 tools, single
// round, no multi-cloud, no delegation). This lets local gpt-oss:20b (A10)
// and Haiku be eligible — the vast majority of MCP read calls.
//
// COMPLEX_FLOOR (0.90): for tool requests that are multi-step, multi-cloud,
// or involve delegation. These need frontier-grade function calling (Sonnet,
// Opus, o3, GPT-5). We will NOT trust a 0.85-tier model to correctly plan
// a multi-round tool loop with artifact delegation.
const MIN_FUNCTION_CALLING_ACCURACY_SIMPLE = 0.83;
const MIN_FUNCTION_CALLING_ACCURACY_COMPLEX = 0.90;
// Legacy alias — still exported for callers that use it as a getter floor.
const MIN_FUNCTION_CALLING_ACCURACY = MIN_FUNCTION_CALLING_ACCURACY_COMPLEX;

// Multi-cloud keywords
const MULTI_CLOUD_KEYWORDS = ['azure', 'aws', 'gcp', 'google cloud', 'vertex', 'bedrock', 'lambda', 's3', 'ec2', 'iam'];

export class SmartModelRouter {
  private logger: Logger;
  private milvusClient?: MilvusClient;
  private embeddingService?: UniversalEmbeddingService;
  private redisClient?: RedisClientType;
  private providerManager?: ProviderManager;

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
    }
  ) {
    this.logger = logger.child({ service: 'SmartModelRouter' });
    this.milvusClient = options?.milvusClient;
    this.embeddingService = options?.embeddingService;
    this.redisClient = options?.redisClient;
    this.providerManager = options?.providerManager;
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
   * Discover models from all configured providers
   */
  private async discoverFromProviders(): Promise<void> {
    if (!this.providerManager) return;

    const providers = this.providerManager.getProviders();

    for (const [name, provider] of providers) {
      try {
        const models = await provider.listModels();

        for (const model of models) {
          // Check if we already have a profile for this model
          const existingProfile = this.findProfileByModelId(model.id);

          if (existingProfile) {
            // Update availability
            existingProfile.metadata.isAvailable = true;
            existingProfile.metadata.lastTested = new Date();
          } else {
            // Create new profile from discovered model
            const newProfile = this.createProfileFromDiscovery(model, name);
            this.modelProfiles.set(model.id, newProfile);
          }
        }

        this.logger.info({
          provider: name,
          modelsDiscovered: models.length
        }, 'Discovered models from provider');

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
   * Create a profile from discovered model data
   * Infers capabilities based on model naming patterns
   */
  private createProfileFromDiscovery(
    model: { id: string; name: string; provider: string },
    providerName: string
  ): ModelProfile {
    const lower = model.id.toLowerCase();

    // Infer capabilities from model name
    const isGPT = lower.includes('gpt') && !lower.includes('gpt-oss'); // gpt-oss is qwen, not OpenAI GPT
    const isClaude = lower.includes('claude');
    const isGemini = lower.includes('gemini');
    const isLlama = lower.includes('llama');
    const isMistral = lower.includes('mistral');
    const isVision = lower.includes('vision') || lower.includes('4o') || isGemini || isClaude;

    // Infer function calling accuracy based on model family and version
    let functionCallingAccuracy = 0.70; // Conservative default for unknown models

    if (isGPT) {
      if (lower.includes('gpt-5') || lower.includes('gpt5')) {
        functionCallingAccuracy = lower.includes('nano') ? 0.65 : lower.includes('mini') ? 0.70 : 0.95;
      } else if (lower.includes('gpt-4') || lower.includes('gpt4')) {
        functionCallingAccuracy = 0.93;
      } else if (lower.includes('o1') || lower.includes('o3')) {
        functionCallingAccuracy = 0.96;
      }
    } else if (isClaude) {
      if (lower.includes('sonnet')) {
        functionCallingAccuracy = 0.94;
      } else if (lower.includes('opus')) {
        functionCallingAccuracy = 0.96;
      } else if (lower.includes('haiku')) {
        // Haiku 4.5 benchmarks at ~0.91 on function-calling eval suites;
        // bumped from 0.85 so it clears SIMPLE floor and competes with
        // gpt-oss for cheap tool-using traffic.
        functionCallingAccuracy = 0.91;
      }
    } else if (isGemini) {
      if (lower.includes('flash')) {
        functionCallingAccuracy = 0.92;
      } else if (lower.includes('pro')) {
        functionCallingAccuracy = 0.93;
      } else if (lower.includes('ultra')) {
        functionCallingAccuracy = 0.95;
      }
    } else if (isLlama || isMistral) {
      functionCallingAccuracy = 0.80; // Good but not as reliable as frontier models
    } else if (lower.includes('qwen') || lower.includes('deepseek') || lower.includes('coder') || lower.includes('gpt-oss')) {
      // Qwen, DeepSeek, coder models, and gpt-oss (qwen-based) — in-house
      // A10 bench shows gpt-oss:20b reliably handles single-tool Azure/AWS
      // list/get/describe calls. Bumped from 0.85 so it clears the SIMPLE
      // floor and becomes the default for 80% of MCP tool traffic.
      functionCallingAccuracy = 0.87;
    }

    const isQwen = lower.includes('qwen') || lower.includes('gpt-oss');
    const isDeepSeek = lower.includes('deepseek');
    const isCoder = lower.includes('coder');
    const hasFunctionCalling = isGPT || isClaude || isGemini || isLlama || isMistral || isQwen || isDeepSeek || isCoder;

    this.logger.info({
      modelId: model.id,
      provider: providerName,
      hasFunctionCalling,
      functionCallingAccuracy,
      isGPT, isClaude, isGemini, isQwen, isDeepSeek, isCoder
    }, 'Created profile from discovered model');

    return {
      modelId: model.id,
      provider: providerName,
      providerType: this.inferProviderType(providerName),
      capabilities: {
        chat: true,
        functionCalling: hasFunctionCalling,
        functionCallingAccuracy,
        vision: isVision,
        imageGeneration: lower.includes('dall-e') || lower.includes('imagen'),
        embeddings: lower.includes('embedding'),
        streaming: true,
        jsonMode: isGPT || isGemini || isClaude,
        structuredOutput: isGPT || isGemini || isClaude
      },
      performance: {
        maxContextTokens: isGemini ? 1000000 : isClaude ? 200000 : 128000,
        maxOutputTokens: 8192,
        avgLatencyMs: 500,
        tokensPerSecond: 100
      },
      cost: {
        // Ollama is FREE - set cost to 0 so it's preferred for simple queries
        inputPer1kTokens: providerName.toLowerCase() === 'ollama' ? 0 : 0.001,
        outputPer1kTokens: providerName.toLowerCase() === 'ollama' ? 0 : 0.002,
        currency: 'USD'
      },
      metadata: {
        family: this.inferModelFamily(model.id),
        version: this.inferModelVersion(model.id),
        specializations: hasFunctionCalling ? ['tools', 'reasoning'] : ['general'],
        lastTested: new Date(),
        isAvailable: true
      }
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
      this.logger.error({ error }, 'Failed to ensure Milvus collection');
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

    return `${profile.modelId} from ${profile.provider}: ${caps.join(', ')}. ` +
           `Specializations: ${profile.metadata.specializations.join(', ')}. ` +
           `Max context: ${profile.performance.maxContextTokens} tokens. ` +
           `Cost: $${profile.cost.inputPer1kTokens}/1k tokens.`;
  }

  /**
   * Analyze a completion request to determine requirements
   */
  analyzeRequest(request: CompletionRequest): RequestAnalysis {
    // Get the user message content
    const userMessages = request.messages.filter(m => m.role === 'user');
    const lastUserMessage = userMessages[userMessages.length - 1]?.content || '';
    const allContent = request.messages.map(m => m.content || '').join(' ').toLowerCase();

    // ── Tool detection ───────────────────────────────────────────────
    // The request.tools array is NOT populated at validation stage —
    // MCP tools are resolved later. But we still need to route correctly
    // based on the user's *intent*. Detect tool-implying prompts via
    // infrastructure discovery/report verbs + resource keywords.
    const hasExplicitTools = !!(request.tools && request.tools.length > 0);
    const explicitToolCount = request.tools?.length || 0;

    // Tool-implying intent: discovery verbs on infra resources
    const TOOL_INTENT_VERBS = /\b(find|list|get|show|describe|inventory|audit|query|search|count|discover|map|trace|explore|scan|identify|locate|enumerate|catalog|dump|report on|tell me about|give me a report|give me a list|what.*are (all|my)|how many|which .*(have|use|run))\b/i;
    const RESOURCE_KEYWORDS = /\b(subscription|resource.?group|vm|machine|server|disk|snapshot|nic|vnet|subnet|nsg|public.?ip|storage.?account|blob|queue|keyvault|secret|appgw|app.?gateway|front.?door|load.?balancer|aks|kubernetes|cluster|container|pod|image|web.?app|function.?app|app.?service|sql|postgres|mysql|mariadb|redis|cosmos|dynamodb|rds|ec2|s3|lambda|iam|role|policy|user|group|cert|certificate|cost|bill|spend|invoice|budget)\b/i;
    const hasToolImpliedIntent =
      TOOL_INTENT_VERBS.test(allContent) && RESOURCE_KEYWORDS.test(allContent);

    const hasTools = hasExplicitTools || hasToolImpliedIntent;
    const toolCount = explicitToolCount || (hasToolImpliedIntent ? 5 : 0); // heuristic: implied intent means tool plural

    // ── Multi-cloud detection ────────────────────────────────────────
    // Original: >=2 cloud keyword mentions. Also trigger if user is
    // asking "across all" or "in all my" — indicates breadth.
    const cloudMentions = MULTI_CLOUD_KEYWORDS.filter(kw => allContent.includes(kw.toLowerCase()));
    const BREADTH_INDICATORS = /\b(across all|in all my|all my subs|every subscription|tenant.?wide|every account|all accounts|all (my )?(azure|aws|gcp|cloud) (subscriptions|accounts|projects|tenants))\b/i;
    const isMultiCloud =
      cloudMentions.length >= 2 ||
      (cloudMentions.length >= 1 && BREADTH_INDICATORS.test(allContent));

    // ── Complex reasoning detection ──────────────────────────────────
    const complexIndicators = ['analyze', 'compare', 'explain why', 'step by step', 'reason through'];
    const isComplexReasoning = complexIndicators.some(ind => allContent.includes(ind));

    // ── Multi-step task detection ────────────────────────────────────
    // Original: step words like 'then/next/finally'. Extend: multiple
    // discovery verbs in a single sentence, OR an AND-joined resource
    // list ("appgws AND frontdoors"), OR a discovery+report+analysis
    // combo ("find ... and report on ..."), OR numbered lists.
    const multiStepIndicators = ['then', 'after that', 'next', 'finally', 'first,', 'second,'];
    const stepMatches = multiStepIndicators.filter(ind => allContent.includes(ind));
    const hasCompoundResourceList = /\b(\w+s)\s+and\s+(\w+s)\s+(in|across|with|on)/i.test(allContent);
    const hasDiscoveryPlusReport = /\b(find|list|get|show|inventory)\b.*\b(report|analysis|summary|breakdown|cost)\b/i.test(allContent);
    const isMultiStep =
      stepMatches.length >= 2 ||
      (allContent.match(/\d+\./g)?.length || 0) >= 2 ||
      hasCompoundResourceList ||
      hasDiscoveryPlusReport;

    // Vision detection
    const requiresVision = request.messages.some(m =>
      m.content &&
      typeof m.content === 'object' &&
      Array.isArray(m.content) &&
      (m.content as any[]).some((c: any) => c.type === 'image_url')
    );

    // Estimate tokens
    const estimatedTokens = Math.ceil(allContent.length / 4);

    // Determine recommended capabilities
    const recommendedCapabilities: string[] = [];
    if (hasTools) recommendedCapabilities.push('functionCalling');
    if (requiresVision) recommendedCapabilities.push('vision');
    if (isComplexReasoning || isMultiStep) recommendedCapabilities.push('reasoning');
    if (isMultiCloud) recommendedCapabilities.push('multiCloudKnowledge');

    return {
      hasTools,
      toolCount,
      isComplexReasoning,
      isMultiStep,
      isMultiCloud,
      requiresVision,
      estimatedTokens,
      recommendedCapabilities
    };
  }

  /**
   * Route request to optimal model
   * @param request The completion request
   * @param sliderConfig Optional slider configuration for cost/quality tradeoff
   */
  async routeRequest(request: CompletionRequest, sliderConfig?: SliderConfig, userId?: string): Promise<RoutingDecision> {
    const analysis = this.analyzeRequest(request);

    this.logger.debug({
      hasTools: analysis.hasTools,
      toolCount: analysis.toolCount,
      isMultiCloud: analysis.isMultiCloud,
      isMultiStep: analysis.isMultiStep
    }, 'Request analysis');

    // Get all available models
    // (#72) Live disable check — query providerManager.isModelEnabled() on
    // every routing decision so admin toggles propagate instantly. The
    // local modelProfiles cache may be stale (especially right after a CRUD
    // op before the next reloadProviders() finishes), but isModelEnabled()
    // reads from the always-fresh in-memory state that Redis pub/sub
    // invalidation keeps current. If providerManager isn't wired up, we
    // fall back to the local isAvailable flag.
    const availableModels = Array.from(this.modelProfiles.values())
      .filter(m => {
        if (!m.metadata.isAvailable) return false;
        // GUARD: Embedding-only models must NEVER be routed for chat
        const idLower = m.modelId.toLowerCase();
        if (idLower.includes('embed') || idLower.includes('nomic')) return false;
        if (this.providerManager && typeof this.providerManager.isModelEnabled === 'function') {
          return this.providerManager.isModelEnabled(m.modelId);
        }
        return true;
      });

    if (availableModels.length === 0) {
      throw new Error('No models available for routing');
    }

    // Filter and score models
    let candidates = availableModels;
    let reason = '';
    let destructiveEscalation: RoutingDecision['destructive_context'] | null = null;

    // DESTRUCTIVE-VERB ESCALATION (BLOCKER-001): When the prompt contains a
    // destructive verb (delete/terminate/drop/...) paired with a cloud-resource
    // noun, we MUST route to a frontier model regardless of slider setting.
    // Cheap models misread destructive intent (wrong subscription, wrong
    // resource name) and HITL approvers can rubber-stamp a modal on a typo.
    // We'd rather pay the Opus tokens than lose a prod RG. This runs BEFORE
    // every other branch so it wins over the cost-optimization branch.
    const destructiveCheckText = (request.messages || [])
      .filter((m: any) => m.role === 'user')
      .map((m: any) => typeof m.content === 'string' ? m.content : '')
      .join(' ');
    const destructiveHit = detectDestructiveIntent(destructiveCheckText);
    if (destructiveHit) {
      const frontierModels = candidates.filter(m =>
        m.capabilities.functionCalling &&
        m.capabilities.functionCallingAccuracy >= 0.93,
      );
      if (frontierModels.length > 0) {
        candidates = frontierModels;
        reason = `Destructive intent detected (${destructiveHit.verb} + ${destructiveHit.noun}) → frontier models only (≥93% accuracy). Slider override.`;
        destructiveEscalation = {
          verb: destructiveHit.verb,
          noun: destructiveHit.noun,
          escalatedTo: 'frontier',
        };
        this.logger.warn({
          verb: destructiveHit.verb,
          noun: destructiveHit.noun,
          frontierCount: frontierModels.length,
          frontierModels: frontierModels.map(m => m.modelId),
          sliderOverridden: true,
          route_escalated_destructive: true,
        }, '🛡️ [DESTRUCTIVE ESCALATION] Slider overridden — destructive verb + cloud-noun detected, routing to frontier');
      } else {
        // No frontier available — log loudly but fall through; the HITL
        // gate remains the last line of defence.
        this.logger.error({
          verb: destructiveHit.verb,
          noun: destructiveHit.noun,
          availableModels: candidates.map(m => `${m.modelId}(${m.capabilities.functionCallingAccuracy})`),
        }, '🚨 [DESTRUCTIVE ESCALATION] No frontier models available — falling back. HITL gate is your only safety net.');
      }
    }

    // PREMIUM ESCALATION: When slider is premium (>70) and request is complex
    // (tools, multi-step, multi-cloud), prefer frontier models (accuracy >= 0.93).
    // This ensures users who chose "premium" get Claude/GPT-5 for complex tasks,
    // not local gpt-oss which is cheaper but less capable.
    const sliderPos = sliderConfig?.position ?? 50;
    const isPremiumTier = sliderPos > 70;
    // NOTE: analysis.hasTools may be false at validation stage (tools not resolved yet).
    // For premium escalation, also consider message content indicators of complexity:
    // create/provision/deploy/audit/review/analyze + infrastructure keywords = complex.
    const messageHint = (request.messages || [])
      .filter((m: any) => m.role === 'user')
      .map((m: any) => typeof m.content === 'string' ? m.content : '')
      .join(' ').toLowerCase();
    const hasInfraKeywords = /\b(create|provision|deploy|audit|review|analyze|list all|across.*subscription|infrastructure|resource.?group|vm|gateway|front.?door|aks|kubernetes|security|compliance|cost|vpc|subnet|ec2|s3|lambda|rds|iam|cloudwatch|elb|alb|nlb|route.?53|cloudfront|eks|ecs|fargate|dynamo|sns|sqs|kinesis|elastic|azure|aws|gcp|cloud|network|storage|database|server|cluster|container|policy|role|identity|certificate|ssl|tls|dns|monitor|alert|log|metric|advisor|defender|sentinel|waf|firewall|nsg|load.?balancer|app.?service|function.?app|cosmos|sql|postgres|redis|key.?vault|secret|managed.?identity|disk|snapshot|image|backup|restore|scale|autoscal|reserved|savings|idle|unused|orphan|tag|govern)\b/i.test(messageHint);
    const isComplexRequest = analysis.hasTools || analysis.isMultiStep || analysis.isMultiCloud || analysis.isComplexReasoning || hasInfraKeywords;

    if (isPremiumTier && isComplexRequest) {
      const frontierModels = candidates.filter(m =>
        m.capabilities.functionCalling &&
        m.capabilities.functionCallingAccuracy >= 0.93
      );
      if (frontierModels.length > 0) {
        candidates = frontierModels;
        reason = `Premium tier (slider: ${sliderPos}) + complex request → frontier models only (≥93% accuracy)`;
        this.logger.info({
          sliderPos,
          frontierCount: frontierModels.length,
          frontierModels: frontierModels.map(m => m.modelId),
        }, '🏆 [PREMIUM ESCALATION] Complex request routed to frontier models');
      } else {
        // No frontier models available — fall through to normal routing
        this.logger.warn({
          sliderPos,
          availableModels: candidates.map(m => `${m.modelId}(${m.capabilities.functionCallingAccuracy})`),
        }, '⚠️ [PREMIUM ESCALATION] No frontier models available — falling back to best available');
      }
    }

    // CRITICAL: For tool-based requests, filter by function calling accuracy.
    // Two-tier floor with COMPLEXITY as the discriminator:
    //   - COMPLEX means genuinely multi-step: needs multi-step reasoning
    //     AND/OR actual multi-cloud (2+ providers) AND/OR isComplexReasoning.
    //     → floor 0.90, frontier-only (Sonnet/Opus/o3/GPT-5)
    //   - Everything else (including single-cloud tenant-wide reads like
    //     'list all my azure subs') is SIMPLE: one query, one iteration.
    //     → floor 0.83, gpt-oss:20b + Haiku become eligible
    //
    // isMultiCloud alone does NOT imply complexity: "list azure subs" spans
    // the whole tenant but is still a single-call, single-response pattern.
    // Only escalate to COMPLEX when there's a genuine multi-step workflow.
    if (!reason && (analysis.hasTools || analysis.isMultiStep || analysis.isMultiCloud)) {
      const isComplexToolRequest =
        analysis.isMultiStep ||
        analysis.isComplexReasoning ||
        (analysis.toolCount ?? 0) > 3;

      const floor = isComplexToolRequest
        ? MIN_FUNCTION_CALLING_ACCURACY_COMPLEX
        : MIN_FUNCTION_CALLING_ACCURACY_SIMPLE;

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

        reason = `No models meet ${floor * 100}% accuracy threshold (${isComplexToolRequest ? 'complex' : 'simple'}), using best available`;
      } else {
        reason = `${isComplexToolRequest ? 'Complex' : 'Simple'} tool request — ${candidates.length} models ≥${floor * 100}% FC accuracy`;
      }

      // CRITICAL: For COMPLEX tool requests, prefer Sonnet over Opus unless
      // the user explicitly chose premium (slider > 70). Opus is 5-6x more
      // expensive for a 0.02 FC accuracy delta (0.96 vs 0.94) that almost
      // never matters in practice. Budget cap on Opus (25 capacity in CDC
      // dev/stg foundry) makes this even more important.
      if (isComplexToolRequest && sliderPos <= 70) {
        const withoutOpus = candidates.filter(m => !m.modelId.toLowerCase().includes('opus'));
        if (withoutOpus.length > 0) {
          candidates = withoutOpus;
          reason += ' (Opus reserved for slider >70)';
        }
      }

      // CRITICAL: For SIMPLE tool requests, strongly prefer free/local
      // models over frontier Claude. A 1-tool list/get/describe query
      // should NEVER pay $15/1M tokens for Opus when gpt-oss on the A10
      // GPU can do it for $0. If any free-tier (cost=0) model passes
      // the SIMPLE floor, use ONLY free-tier candidates. If none pass,
      // prefer the cheapest AIF model (Haiku) over Sonnet/Opus.
      if (!isComplexToolRequest && sliderPos <= 60) {
        const freeCandidates = candidates.filter(m =>
          m.cost.inputPer1kTokens === 0 && m.cost.outputPer1kTokens === 0
        );
        if (freeCandidates.length > 0) {
          candidates = freeCandidates;
          reason += ' (free/local tier preferred for simple)';
        } else {
          // No free model eligible — demote Opus/Sonnet, prefer Haiku
          const cheapCandidates = candidates.filter(m => {
            const id = m.modelId.toLowerCase();
            return !id.includes('opus') && !id.includes('sonnet') && !id.includes('o3') && !id.includes('gpt-5') && !id.includes('gpt-4');
          });
          if (cheapCandidates.length > 0) {
            candidates = cheapCandidates;
            reason += ' (cheap AIF tier preferred for simple)';
          }
        }
      }
    }

    // Filter by vision if needed
    if (analysis.requiresVision) {
      const visionCandidates = candidates.filter(m => m.capabilities.vision);
      if (visionCandidates.length > 0) {
        candidates = visionCandidates;
        reason += ' (with vision capability)';
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

    // Score remaining candidates with slider weights + per-user bonus
    const scoredCandidates = candidates.map(model => ({
      model,
      score: this.scoreModel(model, analysis, sliderConfig) + (userModelBonus.get(model.modelId) || 0)
    })).sort((a, b) => b.score - a.score);

    const selected = scoredCandidates[0].model;
    const alternatives = scoredCandidates.slice(1, 4).map(s => s.model);

    // Build detailed reason
    if (!reason) {
      if (analysis.hasTools) {
        reason = `Tool calling (${analysis.toolCount} tools) - ${selected.modelId} has ${(selected.capabilities.functionCallingAccuracy * 100).toFixed(0)}% accuracy`;
      } else if (analysis.isComplexReasoning) {
        reason = `Complex reasoning task - using ${selected.modelId} for best results`;
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
        isComplexReasoning: analysis.isComplexReasoning,
        isMultiStep: analysis.isMultiStep,
        isMultiCloud: analysis.isMultiCloud,
        estimatedTokens: analysis.estimatedTokens
      },
      sliderPosition: sliderConfig?.position ?? 'default(50)',
      costWeight: sliderConfig?.costWeight ?? 0.5,
      qualityWeight: sliderConfig?.qualityWeight ?? 0.5
    }, '🧭 MODEL ROUTING DECISION');

    return {
      selectedModel: selected,
      reason,
      alternativeModels: alternatives,
      analysisResults: analysis,
      route_escalated_destructive: destructiveEscalation !== null,
      destructive_context: destructiveEscalation ?? undefined,
    };
  }

  /**
   * Score a model for a given request
   * Scoring is weighted by the slider configuration:
   * - costWeight: How much to favor cheaper models (slider 0 = max cost priority)
   * - qualityWeight: How much to favor capable models (slider 100 = max quality priority)
   */
  private scoreModel(
    model: ModelProfile,
    analysis: RequestAnalysis,
    sliderConfig?: SliderConfig
  ): number {
    // Default weights if no slider config
    const costWeight = sliderConfig?.costWeight ?? 0.5;
    const qualityWeight = sliderConfig?.qualityWeight ?? 0.5;

    let score = 0;

    // Function calling accuracy is critical for tool-based tasks (quality-weighted)
    if (analysis.hasTools) {
      // Base score for function calling, weighted by quality preference
      const functionCallingScore = model.capabilities.functionCallingAccuracy * 50;
      score += functionCallingScore * (0.5 + qualityWeight * 0.5); // Min 50% of base score
    }

    // Multi-step and multi-cloud need reliable reasoning (quality-weighted)
    if (analysis.isMultiStep || analysis.isMultiCloud) {
      const reasoningScore = model.capabilities.functionCallingAccuracy * 30;
      score += reasoningScore * (0.5 + qualityWeight * 0.5);
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
    const costScore = (1 - Math.min(model.cost.inputPer1kTokens / 0.01, 1)) * 25;
    score += costScore * costWeight;

    // Latency bonus for faster models (cost-weighted - speed matters more when optimizing cost)
    const latencyScore = (1 - Math.min(model.performance.avgLatencyMs / 1000, 1)) * 10;
    score += latencyScore * costWeight;

    // Quality bonus for premium models (quality-weighted)
    // Models with higher function calling accuracy get extra points when quality matters
    if (qualityWeight > 0.6) {
      score += model.capabilities.functionCallingAccuracy * 15 * qualityWeight;
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
   * Get models suitable for function calling
   */
  getFunctionCallingModels(minAccuracy = MIN_FUNCTION_CALLING_ACCURACY): ModelProfile[] {
    return Array.from(this.modelProfiles.values())
      .filter(m => m.capabilities.functionCalling && m.capabilities.functionCallingAccuracy >= minAccuracy)
      .sort((a, b) => b.capabilities.functionCallingAccuracy - a.capabilities.functionCallingAccuracy);
  }

  /**
   * Get the best model for function calling
   */
  getBestFunctionCallingModel(): ModelProfile | undefined {
    const models = this.getFunctionCallingModels();
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
