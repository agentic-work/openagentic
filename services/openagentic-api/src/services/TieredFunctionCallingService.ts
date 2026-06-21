/**
 * TieredFunctionCallingService - Intelligent tiered model routing for function calling
 *
 * Features:
 * 1. Tiered Function Calling: Use cheap models (Gemini Flash, GPT-4o-mini) for function calling decisions
 * 2. Tool Stripping: Strip tools from requests when message doesn't need them (saves tokens)
 * 3. Function Call Decision Caching: Cache function calling decisions to avoid repeated analysis
 *
 * 2026-04-19 — slider ripped (task #144). Routing is now capability-only
 * (cheap/balanced/premium tiers chosen by message complexity), and the
 * admin console picks the concrete model for each tier.
 *
 * All models are configurable via:
 * - Environment variables (buildtime)
 * - SystemConfiguration table (runtime via admin portal)
 */

import { Logger } from 'pino';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

// Configuration keys for SystemConfiguration table
const CONFIG_KEYS = {
  FUNCTION_CALLING_CHEAP: 'function_calling_model_cheap',
  FUNCTION_CALLING_BALANCED: 'function_calling_model_balanced',
  FUNCTION_CALLING_PREMIUM: 'function_calling_model_premium',
  TOOL_STRIPPING_ENABLED: 'tool_stripping_enabled',
  FUNCTION_DECISION_CACHE_ENABLED: 'function_decision_cache_enabled',
  FUNCTION_DECISION_CACHE_TTL: 'function_decision_cache_ttl_seconds',
};

// Environment variable names (used as fallback if SystemConfiguration not set)
const ENV_VARS = {
  FUNCTION_CALLING_CHEAP: 'FUNCTION_CALLING_MODEL_CHEAP',
  FUNCTION_CALLING_BALANCED: 'FUNCTION_CALLING_MODEL_BALANCED',
  FUNCTION_CALLING_PREMIUM: 'FUNCTION_CALLING_MODEL_PREMIUM',
  TOOL_STRIPPING_ENABLED: 'TOOL_STRIPPING_ENABLED',
  FUNCTION_DECISION_CACHE_ENABLED: 'FUNCTION_DECISION_CACHE_ENABLED',
  FUNCTION_DECISION_CACHE_TTL: 'FUNCTION_DECISION_CACHE_TTL_SECONDS',
};

// Tool-requiring keywords (if message contains these, tools are needed)
// CRITICAL: Keep these in sync with mcp.stage.ts isSimpleConversationalMessage()
const TOOL_REQUIRING_PATTERNS = [
  // Azure/Cloud operations
  /\b(list|get|describe|show|display)\b.*\b(subscription|resource|vm|storage|network|blob|container|aks|kubernetes|database)/i,
  /\b(azure|aws|gcp|cloud)\b/i,
  /\b(deploy|create|update|delete|remove|provision)\b.*\b(resource|vm|container|service)/i,

  // Web operations - EXPANDED to match MCP stage webKeywords
  /\b(search|browse|fetch|scrape|web)\b/i,
  /\b(url|website|link|page)\b/i,
  /\b(weather|news|current events|google)\b/i,  // Common queries needing live data

  // File operations - EXPANDED to include all file creation/editing
  /\b(file|read|write|upload|download|save|open)\b.*\b(document|pdf|image|csv|json|yaml)/i,
  /\b(create|make|write|generate|build)\b.*\b(file|app|application|project|code|script)/i,

  // Artifact / document operations — always need tools
  /\b(artifact|dashboard|report|chart|diagram|visualization)\b/i,
  /\b(read|analyze|parse|extract|summarize)\b.*\b(document|file|attachment|pdf|csv|upload)\b/i,
  /\b(create|generate|build)\b.*\b(html|svg|markdown|artifact|app|dashboard)\b/i,

  // Memory operations
  /\b(remember|recall|memory|memorize|store|save|retrieve)\b/i,

  // Code operations - EXPANDED to include creation verbs and common frameworks/languages
  /\b(run|execute|compile|build|test)\b.*\b(code|script|program|command)/i,
  /\b(create|make|write|generate|build|develop|implement)\b.*\b(code|function|class|module|component|api|endpoint)/i,

  // Code generation - specific frameworks, languages, file types
  // This is CRITICAL for codemode to work properly
  /\b(flask|django|react|vue|angular|express|fastapi|nextjs|rails)\b/i,
  /\b(python|javascript|typescript|java|go|rust|ruby|php|html|css|sql)\b/i,
  /\b(create|make|build|write|generate)\b.*\b(app|application|website|page|site|project)/i,
  /\b(add|create|write|make)\b.*\b(style|styles|stylesheet|css)/i,
  /\.(py|js|ts|jsx|tsx|html|css|json|yaml|yml|md|txt|sh|sql|go|rs|rb|php)\b/i,

  // Diagram operations
  /\b(diagram|chart|graph|flow|visualize|draw)\b/i,

  // System operations
  /\b(system|config|settings|preferences)\b/i,

  // Monitoring/Observability operations
  /\b(prometheus|grafana|metrics|logs|loki|alert|monitor|observability)\b/i,
  /\b(cpu|memory|disk|network)\b.*\b(usage|utilization|stats)\b/i,
  /\b(pod|container|node|cluster)\b.*\b(status|health|resource)/i,

  // Explicit tool mentions
  /\btool\b/i,
  /\bmcp\b/i,

  // Agent delegation / orchestration
  /\b(delegate|agent|parallel|orchestrat|spawn|sub-?task|multi-?agent)\b/i,
  /\b(research|investigate|analyze|audit|compare)\b.*\b(across|multiple|sources|simultaneously|in parallel)\b/i,

  // Code mode specific - ANY request involving files or coding in openagentic context
  /\b(codemode|openagentic|coding|programming)\b/i,
];

// Pure chat patterns (if message matches these AND no tool patterns, strip tools)
// IMPORTANT: Be conservative here - only match truly pure chat, not real queries
// Removed /\?$/ which was too broad and stripped tools from legitimate questions
const PURE_CHAT_PATTERNS = [
  /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i,  // Greetings only
  /^(thanks|thank\s+you|appreciate|bye|goodbye|see you)/i,  // Thanks/goodbye
  /^(yes|no|ok|okay|sure|got it|understood|makes sense)\b/i,  // Short acknowledgments
  // Basic factual knowledge questions (geography, science, math, definitions)
  /^what\s+(is|are)\s+the\s+(capital|population|currency|language|flag|president|king|queen)\b/i,
  /^(what|who|where|when)\s+(is|are|was|were)\b.{0,80}$/i,  // Short factual questions (under 80 chars after prefix)
  /^(explain|define|translate)\s+/i,  // Knowledge-based requests (NOT describe/summarize — those often need tools for documents)
  /^(how\s+do\s+(you|i)\s+(say|spell|pronounce|write))\b/i,  // Language questions
  /^(calculate|compute|what\s+is\s+\d|solve)\b/i,  // Math questions
  /^(write|compose)\s+(a\s+)?(poem|story|essay|email|letter)\b/i,  // Creative writing only (NOT code/artifacts/functions)
  /^(can you|could you|please)\s+(help|explain|tell|write|create)\b/i,  // Polite knowledge requests
  /^(what|how) about\b/i,  // Conversational follow-ups ("What about Germany?")
  /^(and|also|same for|now)\b.{0,60}$/i,  // Short follow-ups in conversation
];

export interface FunctionCallDecision {
  requiresTools: boolean;
  selectedModel: string;
  tier: 'cheap' | 'balanced' | 'premium';
  stripTools: boolean;
  reasoning: string;
  cachedDecision: boolean;
}

export interface TieredFunctionCallingConfig {
  cheapModel: string;
  balancedModel: string;
  premiumModel: string;
  toolStrippingEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheTtlSeconds: number;
}

interface CachedDecision {
  decision: FunctionCallDecision;
  expiresAt: Date;
}

let serviceInstance: TieredFunctionCallingService | null = null;

export class TieredFunctionCallingService {
  private logger: Logger;
  private prisma: PrismaClient;
  private config: TieredFunctionCallingConfig;
  private configLastLoaded: Date | null = null;
  private configCacheTtlMs = 60000; // Reload config every 60 seconds

  // In-memory decision cache (could be extended to Redis for distributed caching)
  private decisionCache: Map<string, CachedDecision> = new Map();
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  constructor(logger: Logger, prisma: PrismaClient) {
    this.logger = logger.child({ service: 'TieredFunctionCalling' });
    this.prisma = prisma;

    // Initialize with environment defaults
    this.config = this.getEnvConfig();

    // Start cache cleanup interval
    this.cacheCleanupInterval = setInterval(() => this.cleanupExpiredCache(), 60000);
  }

  private getEnvConfig(): TieredFunctionCallingConfig {
    return {
      // Default to Gemini Flash for cheap (90%+ accuracy, very fast)
      cheapModel: process.env[ENV_VARS.FUNCTION_CALLING_CHEAP] || '',
      // Default to Gemini Pro or GPT-4o for balanced
      balancedModel: process.env[ENV_VARS.FUNCTION_CALLING_BALANCED] || '',
      // Default to Claude Sonnet or GPT-4o for premium
      premiumModel: process.env[ENV_VARS.FUNCTION_CALLING_PREMIUM] || '',
      toolStrippingEnabled: process.env[ENV_VARS.TOOL_STRIPPING_ENABLED] !== 'false',
      decisionCacheEnabled: process.env[ENV_VARS.FUNCTION_DECISION_CACHE_ENABLED] !== 'false',
      decisionCacheTtlSeconds: parseInt(process.env[ENV_VARS.FUNCTION_DECISION_CACHE_TTL] || '300', 10),
    };
  }

  /**
   * Load configuration from SystemConfiguration table (admin portal)
   * Falls back to environment variables if not set
   */
  async loadConfig(): Promise<TieredFunctionCallingConfig> {
    // Use cached config if fresh enough
    if (this.configLastLoaded &&
        Date.now() - this.configLastLoaded.getTime() < this.configCacheTtlMs) {
      return this.config;
    }

    try {
      const dbConfigs = await this.prisma.systemConfiguration.findMany({
        where: {
          key: {
            in: Object.values(CONFIG_KEYS)
          },
          is_active: true
        }
      });

      const configMap = new Map(dbConfigs.map(c => [c.key, c.value]));

      // Merge DB config with env defaults (DB takes precedence)
      const envConfig = this.getEnvConfig();

      this.config = {
        cheapModel: (configMap.get(CONFIG_KEYS.FUNCTION_CALLING_CHEAP) as string) || envConfig.cheapModel,
        balancedModel: (configMap.get(CONFIG_KEYS.FUNCTION_CALLING_BALANCED) as string) || envConfig.balancedModel,
        premiumModel: (configMap.get(CONFIG_KEYS.FUNCTION_CALLING_PREMIUM) as string) || envConfig.premiumModel,
        toolStrippingEnabled: configMap.has(CONFIG_KEYS.TOOL_STRIPPING_ENABLED)
          ? configMap.get(CONFIG_KEYS.TOOL_STRIPPING_ENABLED) === true
          : envConfig.toolStrippingEnabled,
        decisionCacheEnabled: configMap.has(CONFIG_KEYS.FUNCTION_DECISION_CACHE_ENABLED)
          ? configMap.get(CONFIG_KEYS.FUNCTION_DECISION_CACHE_ENABLED) === true
          : envConfig.decisionCacheEnabled,
        decisionCacheTtlSeconds: (configMap.get(CONFIG_KEYS.FUNCTION_DECISION_CACHE_TTL) as number)
          || envConfig.decisionCacheTtlSeconds,
      };

      this.configLastLoaded = new Date();

      this.logger.info({
        config: {
          cheapModel: this.config.cheapModel || '(not set)',
          balancedModel: this.config.balancedModel || '(not set)',
          premiumModel: this.config.premiumModel || '(not set)',
          toolStrippingEnabled: this.config.toolStrippingEnabled,
          decisionCacheEnabled: this.config.decisionCacheEnabled,
        }
      }, '🎯 Loaded tiered function calling config');

    } catch (error: any) {
      this.logger.warn({ error: error.message }, 'Failed to load config from DB, using env defaults');
      this.config = this.getEnvConfig();
    }

    // If tier models still empty, load from ModelConfigurationService (DB-first)
    if (!this.config.cheapModel || !this.config.balancedModel || !this.config.premiumModel) {
      try {
        const { ModelConfigurationService: mcs } = await import('./ModelConfigurationService.js');
        const tiers = await mcs.getTierModels();
        if (!this.config.cheapModel && tiers.economical) this.config.cheapModel = tiers.economical;
        if (!this.config.balancedModel && tiers.balanced) this.config.balancedModel = tiers.balanced;
        if (!this.config.premiumModel && tiers.premium) this.config.premiumModel = tiers.premium;
        this.logger.info({
          cheapModel: this.config.cheapModel,
          balancedModel: this.config.balancedModel,
          premiumModel: this.config.premiumModel,
        }, '🎯 Loaded tier models from DB registry via ModelConfigurationService');
      } catch (e: any) {
        this.logger.warn({ error: e.message }, 'Failed to load tier models from MCS');
      }
    }

    return this.config;
  }

  /**
   * Determine if a message requires tools based on content analysis
   */
  private messageRequiresTools(message: string): { required: boolean; reasoning: string } {
    // Check for explicit tool-requiring patterns
    for (const pattern of TOOL_REQUIRING_PATTERNS) {
      if (pattern.test(message)) {
        return {
          required: true,
          reasoning: `Message matches tool pattern: ${pattern.toString().substring(0, 50)}`
        };
      }
    }

    // Check for pure chat patterns
    for (const pattern of PURE_CHAT_PATTERNS) {
      if (pattern.test(message)) {
        return {
          required: false,
          reasoning: `Message matches pure chat pattern: ${pattern.toString().substring(0, 50)}`
        };
      }
    }

    // Default: be conservative and include tools
    // Only strip tools if we're CERTAIN the message is pure chat
    // Short messages can still need tools (e.g., "Show me metrics")
    // IMPORTANT: When in doubt, keep tools - stripping tools incorrectly breaks functionality
    return { required: true, reasoning: 'Default: include tools (conservative approach)' };
  }

  /**
   * Generate cache key for decision caching
   */
  private generateCacheKey(message: string, toolCount: number, tier: 'cheap' | 'balanced' | 'premium'): string {
    // Hash the message to create a stable cache key
    const messageHash = crypto.createHash('sha256')
      .update(message.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);

    // Include tool count and tier in key
    return `fc:${messageHash}:${toolCount}:${tier}`;
  }

  /**
   * Check decision cache for existing decision
   */
  private getCachedDecision(cacheKey: string): FunctionCallDecision | null {
    const cached = this.decisionCache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      return { ...cached.decision, cachedDecision: true };
    }
    return null;
  }

  /**
   * Store decision in cache
   */
  private cacheDecision(cacheKey: string, decision: FunctionCallDecision): void {
    const expiresAt = new Date(Date.now() + this.config.decisionCacheTtlSeconds * 1000);
    this.decisionCache.set(cacheKey, { decision, expiresAt });
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = new Date();
    let cleaned = 0;
    for (const [key, value] of this.decisionCache.entries()) {
      if (value.expiresAt < now) {
        this.decisionCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug({ cleaned }, 'Cleaned expired function call decision cache entries');
    }
  }

  /**
   * Select model tier by message complexity + tool count.
   * 2026-04-19 — slider ripped (task #144); tier comes from the request
   * shape rather than a user-position knob.
   *   • tier=cheap     — simple single-tool prompts (<= 3 tools, short msg)
   *   • tier=balanced  — moderate prompts (default)
   *   • tier=premium   — multi-tool + long / multi-step / multi-cloud
   */
  private selectTier(message: string, toolCount: number): 'cheap' | 'balanced' | 'premium' {
    const msgLen = (message || '').length;
    const lower = (message || '').toLowerCase();
    const multiStepLike = /\b(then|after|next|step\s*\d|first[\s\S]{0,80}then)\b/i.test(lower);
    const multiCloud = /\b(azure|aws|gcp|cloud)\b[\s\S]{0,200}\b(azure|aws|gcp|cloud|k8s|kubernetes)\b/i.test(lower);
    if (toolCount > 8 || msgLen > 800 || multiStepLike || multiCloud) return 'premium';
    if (toolCount <= 3 && msgLen < 200) return 'cheap';
    return 'balanced';
  }

  /**
   * Get the model for a given tier
   * Returns undefined if no model configured for tier (caller should use default)
   */
  private getModelForTier(tier: 'cheap' | 'balanced' | 'premium'): string | undefined {
    switch (tier) {
      case 'cheap':
        return this.config.cheapModel || undefined;
      case 'balanced':
        return this.config.balancedModel || undefined;
      case 'premium':
        return this.config.premiumModel || undefined;
    }
  }

  /**
   * Main entry point: Make function calling decision.
   *
   * 2026-04-19 — slider ripped (task #144). Tier is picked from message
   * complexity + tool count instead of a slider position.
   *
   * @param message - The user message
   * @param tools - Available tools
   * @returns Decision about tools and model selection
   */
  async makeDecision(
    message: string,
    tools: any[] | undefined,
    _sliderConfig?: { position?: number; overrides?: Record<string, unknown> },
  ): Promise<FunctionCallDecision> {
    void _sliderConfig;
    // Ensure config is loaded
    await this.loadConfig();

    const toolCount = tools?.length ?? 0;

    // Determine tier from message complexity + tool count
    const tier = this.selectTier(message, toolCount);

    // Check cache first
    if (this.config.decisionCacheEnabled) {
      const cacheKey = this.generateCacheKey(message, toolCount, tier);
      const cached = this.getCachedDecision(cacheKey);
      if (cached) {
        this.logger.debug({ cacheKey }, '[TieredFC] Function call decision cache HIT');
        return cached;
      }
    }

    // Analyze if message requires tools
    const toolAnalysis = this.messageRequiresTools(message);

    // Should we strip tools?
    const stripTools = this.config.toolStrippingEnabled &&
                       !toolAnalysis.required &&
                       toolCount > 0;

    // Select model for function calling
    const selectedModel = this.getModelForTier(tier) || '';

    const decision: FunctionCallDecision = {
      requiresTools: toolAnalysis.required,
      selectedModel,
      tier,
      stripTools,
      reasoning: toolAnalysis.reasoning,
      cachedDecision: false,
    };

    // Cache the decision
    if (this.config.decisionCacheEnabled) {
      const cacheKey = this.generateCacheKey(message, toolCount, tier);
      this.cacheDecision(cacheKey, decision);
    }

    this.logger.info({
      tier,
      stripTools,
      requiresTools: toolAnalysis.required,
      selectedModel: selectedModel || '(use default)',
      toolCount,
      reasoning: toolAnalysis.reasoning,
    }, '[TieredFC] Function calling decision made (slider removed)');

    return decision;
  }

  /**
   * Get current configuration (for admin portal display)
   */
  async getConfig(): Promise<TieredFunctionCallingConfig> {
    await this.loadConfig();
    return { ...this.config };
  }

  /**
   * Update configuration via admin portal
   */
  async updateConfig(updates: Partial<TieredFunctionCallingConfig>): Promise<void> {
    const configUpdates: { key: string; value: any }[] = [];

    if (updates.cheapModel !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.FUNCTION_CALLING_CHEAP, value: updates.cheapModel });
    }
    if (updates.balancedModel !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.FUNCTION_CALLING_BALANCED, value: updates.balancedModel });
    }
    if (updates.premiumModel !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.FUNCTION_CALLING_PREMIUM, value: updates.premiumModel });
    }
    if (updates.toolStrippingEnabled !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.TOOL_STRIPPING_ENABLED, value: updates.toolStrippingEnabled });
    }
    if (updates.decisionCacheEnabled !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.FUNCTION_DECISION_CACHE_ENABLED, value: updates.decisionCacheEnabled });
    }
    if (updates.decisionCacheTtlSeconds !== undefined) {
      configUpdates.push({ key: CONFIG_KEYS.FUNCTION_DECISION_CACHE_TTL, value: updates.decisionCacheTtlSeconds });
    }

    // Upsert each config value
    for (const { key, value } of configUpdates) {
      await this.prisma.systemConfiguration.upsert({
        where: { key },
        create: {
          key,
          value,
          description: `Tiered function calling config: ${key}`,
          is_active: true,
        },
        update: {
          value,
          updated_at: new Date(),
        },
      });
    }

    // Force config reload
    this.configLastLoaded = null;
    await this.loadConfig();

    this.logger.info({ updates }, 'Updated tiered function calling config');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.decisionCache.size,
      enabled: this.config.decisionCacheEnabled,
    };
  }

  /**
   * Clear decision cache
   */
  clearCache(): void {
    this.decisionCache.clear();
    this.logger.info('Cleared function call decision cache');
  }

  /**
   * Shutdown service
   */
  shutdown(): void {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }
  }
}

/**
 * Get singleton instance
 */
export function getTieredFunctionCallingService(): TieredFunctionCallingService | null {
  return serviceInstance;
}

/**
 * Initialize singleton instance
 */
export function initializeTieredFunctionCalling(
  logger: Logger,
  prisma: PrismaClient
): TieredFunctionCallingService {
  if (!serviceInstance) {
    serviceInstance = new TieredFunctionCallingService(logger, prisma);
  }
  return serviceInstance;
}

export default TieredFunctionCallingService;
