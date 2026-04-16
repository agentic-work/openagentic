/**
 * Task Analysis Service - Intelligent Model Routing
 *
 * Analyzes user requests to determine optimal model routing based on complexity.
 *
 * CRITICAL: NO hardcoded providers or models!
 * Uses ModelConfigurationService to get configured models from database/env.
 * Provider routing is delegated to ProviderManager which maintains the actual
 * model-to-provider mappings from provider configuration.
 *
 * This service ONLY analyzes task complexity and returns analysis.
 * Model selection uses the centralized ModelConfigurationService.
 */

import type { Logger } from 'pino';
import { ModelConfigurationService, type ModelConfiguration } from './ModelConfigurationService.js';

export interface TaskAnalysis {
  taskType: 'reasoning' | 'vision' | 'image_generation' | 'standard' | 'multimodal';
  confidence: number; // 0-1
  suggestedModel: string | undefined;
  reasoning: string;
  requiresVision: boolean;
  requiresImageGen: boolean;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedCost: 'free' | 'minimal' | 'low' | 'medium' | 'high' | 'premium';
  /**
   * Advisory hint to AgentsStage that the LLM should strongly prefer delegating
   * to a named sub-agent role via delegate_to_agents. NOT a hard rule — the LLM
   * still chooses, but the hint is injected into the system prompt. Set when the
   * complexity classifier matches a long-horizon multi-step pattern (e.g.
   * cloud_operations for multi-step provisioning + enterprise audit).
   */
  suggestedAgent?: string;
}

export interface TaskRequirements {
  messages: Array<{
    role: string;
    content: any;
  }>;
  hasImages?: boolean;
  tools?: any[];
  requestedModel?: string;  // Model explicitly requested by user/system
  sliderConfig?: {
    position: number;       // 0-100
    costWeight: number;     // Higher = prefer cheaper models
    qualityWeight: number;  // Higher = prefer quality models
    enableThinking: boolean;
    source: 'user' | 'global' | 'default' | 'budget-auto-adjust';
  };
  // Caller-supplied metadata that lets specific frontends opt out of slider-driven
  // routing. Used by the workflow AI builder which has a huge system prompt
  // (full canvas state + workflow JSON + MCP tool list) and a tiny user message —
  // the slider-based heuristic would route it to a cheap small-context model that
  // silently truncates the system prompt and "doesn't see the flow context".
  metadata?: {
    source?: string;          // e.g. 'ai-builder', 'chat', 'agent-loop'
    requiresJSON?: boolean;   // structured output requirement
    contextSize?: number;     // approximate system prompt char count
    [key: string]: any;
  };
}

export class TaskAnalysisService {
  private modelConfig: ModelConfiguration | null = null;

  constructor(private logger: Logger) {
    this.logger.info('[TaskAnalysis] Initialized - using ModelConfigurationService for model selection');
  }

  /**
   * Get model configuration from centralized service (cached)
   */
  private async getModelConfig(): Promise<ModelConfiguration> {
    if (!this.modelConfig) {
      this.modelConfig = await ModelConfigurationService.getConfig();
    }
    return this.modelConfig;
  }

  /**
   * Get the appropriate model based on slider position and task complexity
   * Uses ModelConfigurationService tiers with robust fallback
   */
  private async getModelForSliderPosition(position: number, complexity: 'simple' | 'moderate' | 'complex' | 'expert'): Promise<string> {
    try {
      const config = await this.getModelConfig();
      const tiers = config?.sliderConfig?.tiers;

      // PREMIUM OVERRIDE: complex/expert tasks ALWAYS use premium model (regardless of slider)
      // gpt-oss/economy models cannot handle artifact creation, multi-cloud ops, security audits, etc.
      if ((complexity === 'expert' || complexity === 'complex') && tiers?.premium?.modelId) {
        return tiers.premium.modelId;
      }

      // SIMPLE tasks ALWAYS use economical (gpt-oss is free — no reason to waste cloud tokens)
      if (complexity === 'simple' && tiers?.economical?.modelId) {
        return tiers.economical.modelId;
      }

      // ECONOMICAL MODE (slider 0-40): Use economical for moderate tasks too
      if (position <= 40 && tiers?.economical?.modelId) {
        return tiers.economical.modelId;
      }

      // PREMIUM MODE (slider 61-100): Use premium for moderate+ tasks
      if (position > 60 && tiers?.premium?.modelId) {
        return tiers.premium.modelId;
      }

      // BALANCED MODE (slider 41-60, moderate tasks): Use balanced tier
      if (tiers?.balanced?.modelId) {
        return tiers.balanced.modelId;
      }

      // Fallback to default model from config
      if (config?.defaultModel?.modelId) {
        return config.defaultModel.modelId;
      }
    } catch (err) {
      this.logger.error({ err }, '[TaskAnalysis] Failed to get model config');
    }

    // Ultimate fallback - use environment DEFAULT_MODEL
    // CRITICAL: Do NOT hardcode any model IDs! If nothing is configured, return undefined
    // and let the calling code handle it (completion stage has its own fallback logic)
    const fallback = process.env.DEFAULT_MODEL || process.env.DEFAULT_CHAT_MODEL;
    if (fallback) {
      this.logger.warn({ fallback }, '[TaskAnalysis] Using environment fallback model');
      return fallback;
    }
    this.logger.error('[TaskAnalysis] No fallback model configured - DEFAULT_MODEL or DEFAULT_CHAT_MODEL env var required');
    throw new Error('No model configured. Set DEFAULT_MODEL or configure LLM providers in admin.');
  }

  /**
   * Analyze the task requirements and suggest a model
   *
   * NOTE: This method analyzes complexity and uses ModelConfigurationService for model selection.
   * NO hardcoded provider names or model IDs - everything comes from centralized config.
   * Provider selection is handled by ProviderManager based on its model-to-provider mapping.
   *
   * SLIDER INTEGRATION (uses ModelConfigurationService tiers):
   * - Position 0-40: ECONOMICAL tier model
   * - Position 41-60: BALANCED tier model
   * - Position 61-100: PREMIUM tier model
   */
  async analyzeTask(requirements: TaskRequirements): Promise<TaskAnalysis> {
    const lastMessage = this.getLastUserMessage(requirements.messages);
    const toolsAvailable = requirements.tools && requirements.tools.length > 0;
    const slider = requirements.sliderConfig;
    const config = await this.getModelConfig();

    if (toolsAvailable) {
      this.logger.debug({
        toolsAvailable,
        toolCount: requirements.tools?.length,
        messagePreview: lastMessage.substring(0, 80)
      }, '🔧 [TaskAnalysis] Tools available - LLM will decide if needed');
    }

    // Log slider config for debugging
    if (slider) {
      this.logger.info({
        sliderPosition: slider.position,
        costWeight: slider.costWeight,
        qualityWeight: slider.qualityWeight,
        source: slider.source
      }, '🎚️ [TaskAnalysis] Slider config received');
    }

    // If model is explicitly requested, use it (honor user's choice)
    if (requirements.requestedModel && requirements.requestedModel !== 'default' && requirements.requestedModel !== 'auto' && requirements.requestedModel !== 'model-router') {
      return {
        taskType: 'standard',
        confidence: 0.95,
        suggestedModel: requirements.requestedModel,
        reasoning: `Using explicitly requested model: ${requirements.requestedModel}`,
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'simple',
        estimatedCost: 'low'
      };
    }

    // FLOWS AI BUILDER OVERRIDE: workflow builder requests have a huge system
    // prompt (full canvas state + flow definition + MCP tool list = 10k+ chars)
    // but a short user message. The slider-driven heuristic routes them to a
    // cheap small-context model that truncates the system prompt and loses the
    // flow context. Force premium-tier classification regardless of message text.
    if (requirements.metadata?.source === 'ai-builder' || requirements.metadata?.requiresJSON === true) {
      const premiumModel = config.sliderConfig?.tiers?.premium?.modelId || config.defaultModel.modelId;
      this.logger.info({
        source: requirements.metadata?.source,
        contextSize: requirements.metadata?.contextSize,
        selectedModel: premiumModel,
      }, '🎨 [TaskAnalysis] AI Builder request detected → forcing premium tier');
      return {
        taskType: 'standard',
        confidence: 0.95,
        suggestedModel: premiumModel,
        reasoning: `AI Builder source detected — premium tier required for large context (${requirements.metadata?.contextSize ?? '?'} chars) and structured JSON output`,
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'complex',
        estimatedCost: 'high'
      };
    }

    // Check for image inputs (vision task) - use vision model from config
    if (requirements.hasImages || this.hasImageContent(requirements.messages)) {
      const visionModel = config.services.vision?.modelId || config.defaultModel.modelId;
      return {
        taskType: 'vision',
        confidence: 0.95,
        suggestedModel: visionModel,
        reasoning: 'Image content detected - routing to vision-capable model',
        requiresVision: true,
        requiresImageGen: false,
        complexity: 'moderate',
        estimatedCost: 'low'
      };
    }

    // Check for image generation requests
    if (this.isImageGenerationRequest(lastMessage)) {
      const imageModel = config.services.imageGeneration?.modelId;
      return {
        taskType: 'image_generation',
        confidence: 0.9,
        suggestedModel: imageModel,
        reasoning: 'Image generation request detected',
        requiresVision: false,
        requiresImageGen: true,
        complexity: 'moderate',
        estimatedCost: 'medium'
      };
    }

    // Analyze complexity for routing
    const reasoningAnalysis = this.analyzeReasoningComplexity(lastMessage);
    const sliderPosition = slider?.position ?? config.sliderConfig.defaultPosition;

    // Get model based on slider position and complexity using centralized config
    const selectedModel = await this.getModelForSliderPosition(sliderPosition, reasoningAnalysis.complexity);

    // Determine cost estimate based on tier
    let estimatedCost: TaskAnalysis['estimatedCost'] = 'low';
    if (sliderPosition <= 20) estimatedCost = 'minimal';
    else if (sliderPosition <= 40) estimatedCost = 'low';
    else if (sliderPosition <= 60) estimatedCost = 'medium';
    else if (sliderPosition <= 90) estimatedCost = 'high';
    else estimatedCost = 'premium';

    this.logger.info({
      sliderPosition,
      complexity: reasoningAnalysis.complexity,
      selectedModel,
      estimatedCost,
      configSource: config.source
    }, '🎚️ [TaskAnalysis] Model selected via ModelConfigurationService');

    return {
      taskType: reasoningAnalysis.isComplex ? 'reasoning' : 'standard',
      confidence: reasoningAnalysis.confidence,
      suggestedModel: selectedModel,
      reasoning: `Slider ${sliderPosition}% + ${reasoningAnalysis.complexity} complexity → ${selectedModel}`,
      requiresVision: false,
      requiresImageGen: false,
      complexity: reasoningAnalysis.complexity,
      estimatedCost,
      suggestedAgent: reasoningAnalysis.suggestedAgent,
    };
  }

  private getLastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content :
               Array.isArray(content) ? content.map(c => c.text || '').join(' ') : '';
      }
    }
    return '';
  }

  private hasImageContent(messages: any[]): boolean {
    return messages.some(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.some(c => c.type === 'image_url' || c.type === 'image');
      }
      return false;
    });
  }

  private isImageGenerationRequest(message: string): boolean {
    const imageGenKeywords = [
      'generate image', 'create image', 'draw', 'paint', 'sketch',
      'make picture', 'create picture', 'design image',
      'show me an image', 'show me a picture', 'show me a photo',
      'generate a picture', 'generate a photo', 'make an image',
      'dall-e', 'midjourney', 'stable diffusion', 'text to image',
      'create artwork', 'generate art', 'make illustration'
    ];

    const lowerMessage = message.toLowerCase();
    return imageGenKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  // NOTE: queryRequiresTools() was REMOVED intentionally.
  // The LLM should decide if it needs tools, not this router.
  // All Claude models (Haiku, Sonnet, Opus) support tool calling.
  // Model selection should be based on QUERY COMPLEXITY, not tool availability.

  private analyzeReasoningComplexity(message: string): {
    isComplex: boolean;
    confidence: number;
    reason: string;
    complexity: 'simple' | 'moderate' | 'complex' | 'expert';
    suggestedAgent?: string;
  } {
    // ─── Multi-step cloud orchestration / enterprise audit ──────────────────
    // MUST be checked BEFORE the artifact pattern below — otherwise the artifact
    // regex's `create...app` clause matches "create...web app" and short-circuits
    // before this rule fires. The long-horizon cloud path needs to win for any
    // request that mixes provisioning + audit, multi-step provisioning, or
    // enterprise-scope discovery.
    const multiStepProvisioningPattern =
      /\b(create|provision|deploy|spin\s*up|set\s*up|launch|stand\s*up)\b[\s\S]{0,400}\b(then|after|next|and\s+(?:then|also|create|provision|deploy|run|spin|set|launch|stand|list|fetch)|step\s*\d|first[\s\S]{0,80}then|plus\s+a)\b/i;
    const enterpriseAuditPattern =
      /\b(audit|inventory|enumerate|discover|map|catalog)\b[\s\S]{0,300}\b(across|all|every|enterprise|organi[sz]ation|tenant|subscriptions?|accounts?|projects?|resource\s*groups?|public[- ]facing)\b/i;
    // Combined-task pattern: explicit "create X then audit/list/query Y" or any
    // request that mixes provisioning verbs with audit/list verbs in the same message.
    const provisionPlusAuditPattern =
      /\b(create|provision|deploy|spin\s*up|launch)\b[\s\S]+\b(audit|list\s+all|inventory|enumerate|fetch\s+(advisor|service\s+health|recommendations))\b/i;
    if (
      multiStepProvisioningPattern.test(message) ||
      enterpriseAuditPattern.test(message) ||
      provisionPlusAuditPattern.test(message)
    ) {
      return {
        isComplex: true,
        confidence: 0.92,
        reason: 'Multi-step cloud orchestration / enterprise audit — delegate to cloud_operations',
        complexity: 'expert',
        suggestedAgent: 'cloud_operations',
      };
    }

    // Artifact/complex task detection — always classify as complex
    const complexTaskPattern = /\b(create|build|generate|make|design)\b.*\b(artifact|dashboard|visualization|diagram|interactive|app|application|website|page|report|chart|infographic|blackhole|simulation)\b/i;
    if (complexTaskPattern.test(message)) {
      return { isComplex: true, confidence: 0.9, reason: 'Artifact/complex creation detected', complexity: 'complex' };
    }

    // Single-resource cloud operation — complex but doesn't necessarily need delegation.
    const cloudOpsPattern = /\b(create|deploy|provision|launch|spin up|set up)\b.*\b(vm|instance|server|cluster|database|container|lambda|function|bucket|disk|network|resource)\b/i;
    if (cloudOpsPattern.test(message)) {
      return { isComplex: true, confidence: 0.85, reason: 'Cloud operation detected', complexity: 'complex' };
    }

    // Multi-cloud queries — querying costs, resources, or status across cloud providers
    const multiCloudPattern = /\b(azure|aws|gcp|cloud)\b.*\b(azure|aws|gcp|cloud|kubernetes|k8s)\b/i;
    const cloudQueryPattern = /\b(show|list|get|check|fetch|query|compare)\b.*\b(cost|spend|bill|pod|node|instance|resource|service|subscription|budget)\b/i;
    if (multiCloudPattern.test(message) || (cloudQueryPattern.test(message) && message.length > 60)) {
      return { isComplex: true, confidence: 0.85, reason: 'Multi-cloud/infrastructure query detected', complexity: 'complex' };
    }

    const deepThinkingKeywords = [
      'analyze', 'reasoning', 'logic', 'proof', 'theorem', 'hypothesis',
      'deep thinking', 'complex problem', 'step by step', 'chain of thought',
      'philosophical', 'ethical dilemma', 'critical thinking',
      'research', 'investigate', 'comprehensive analysis', 'thorough',
      'detailed study', 'in-depth', 'systematic approach',
      'strategy', 'plan', 'roadmap', 'architecture', 'design system',
      'framework', 'methodology', 'best practices', 'optimization',
      'algorithm', 'performance analysis', 'scalability',
      'security audit', 'code review', 'system design', 'debugging',
      'scientific method', 'literature review', 'meta-analysis',
      'statistical analysis', 'data analysis', 'correlation', 'causation',
      'creative solution', 'innovative approach', 'alternative perspective',
      'brainstorm', 'ideation', 'thought experiment'
    ];

    const expertKeywords = [
      'expert level', 'advanced', 'sophisticated', 'nuanced',
      'multi-faceted', 'interdisciplinary', 'holistic approach',
      'systems thinking', 'meta-cognitive', 'epistemological'
    ];

    const moderateKeywords = [
      'explain', 'compare', 'contrast', 'evaluate', 'assess',
      'summarize', 'breakdown', 'outline', 'overview'
    ];

    const lowerMessage = message.toLowerCase();

    const expertMatches = expertKeywords.filter(keyword => lowerMessage.includes(keyword));
    if (expertMatches.length > 0) {
      return {
        isComplex: true,
        confidence: 0.95,
        reason: `Expert-level: ${expertMatches.join(', ')}`,
        complexity: 'expert'
      };
    }

    const deepMatches = deepThinkingKeywords.filter(keyword => lowerMessage.includes(keyword));
    // Require 2+ deep keywords AND length > 300 for complex classification.
    // Previously: any message >150 chars was complex, forcing premium regardless of slider.
    if (deepMatches.length >= 2 && message.length > 300) {
      return {
        isComplex: true,
        confidence: 0.9,
        reason: `Complex: ${deepMatches.join(', ')}`,
        complexity: 'complex'
      };
    }

    // 2+ deep keywords but shorter message, or 1 deep keyword → moderate (not complex).
    // Previously: single keyword was classified complex, bypassing slider entirely.
    if (deepMatches.length >= 2 || deepMatches.length === 1) {
      return {
        isComplex: deepMatches.length >= 2,
        confidence: deepMatches.length >= 2 ? 0.75 : 0.6,
        reason: `Moderate: ${deepMatches.join(', ')}`,
        complexity: 'moderate'
      };
    }

    const moderateMatches = moderateKeywords.filter(keyword => lowerMessage.includes(keyword));
    if (moderateMatches.length > 0 && message.length > 100) {
      return {
        isComplex: false,
        confidence: 0.6,
        reason: `Moderate: ${moderateMatches.join(', ')}`,
        complexity: 'moderate'
      };
    }

    return {
      isComplex: false,
      confidence: 0.8,
      reason: 'Simple conversation',
      complexity: 'simple'
    };
  }
}
