/**

 * Enhanced Prompt Orchestrator
 * Coordinates all prompting techniques for optimal response generation
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
// import { FewShotService } from './FewShotService.js'; // REMOVED: Prompt techniques disabled
import { ReActService } from './ReActService.js';
import { SelfConsistencyService } from './SelfConsistencyService.js';
import { RAGService } from './RAGService.js';
import { DirectiveService } from './DirectiveService.js';
import { CachedPromptService } from './CachedPromptService.js';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { prisma } from '../utils/prisma.js';

export interface PromptOrchestratorConfig {
  userId: string;
  sessionId: string;
  messageId: string;
  userMessage: string;
  context?: any;
  availableTools?: string[];
}

export interface EnhancedPrompt {
  systemPrompt: string;
  userPrompt: string;
  metadata: {
    techniques: string[];
    templateUsed?: string;
    examplesIncluded?: number;
    consistencySamples?: number;
    ragResults?: number;
  };
  reactInstructions?: string;
  consistencyConfig?: {
    enabled: boolean;
    samples: number;
    temperature: number;
  };
}

export class EnhancedPromptOrchestrator {
  private logger: any;
  private promptService: CachedPromptService;
  // private fewShotService: FewShotService; // REMOVED: Prompt techniques disabled
  private reactService: ReActService;
  private selfConsistencyService: SelfConsistencyService;
  private ragService: RAGService;
  private directiveService: DirectiveService;

  constructor(milvusClient: MilvusClient, logger: any) {
    this.logger = logger;

    // Initialize all services with caching support for performance
    this.promptService = new CachedPromptService(logger, {
      enableCache: true,
      cacheTTL: 1800,
      cacheUserAssignments: true,
      cacheTemplates: true
    });
    // this.fewShotService = new FewShotService(logger); // REMOVED: Prompt techniques disabled
    this.reactService = new ReActService(logger);
    this.selfConsistencyService = new SelfConsistencyService(logger);
    this.ragService = new RAGService(milvusClient, logger);
    this.directiveService = new DirectiveService(logger);
  }

  /**
   * Orchestrate all prompting techniques to create an enhanced prompt
   */
  async createEnhancedPrompt(config: PromptOrchestratorConfig): Promise<EnhancedPrompt> {
    const { userId, sessionId, messageId, userMessage, context, availableTools } = config;
    const techniquesUsed: string[] = [];
    const metadata: any = {};

    try {
      // 1. Get user's prompting settings
      const settings = await this.getUserSettings(userId);

      // 2. RAG - Find most relevant prompt template
      let selectedTemplate = null;
      if (settings.rag.enabled) {
        const ragResults = await this.ragService.searchSimilarTemplates(
          userMessage,
          settings.rag.topK,
          { similarityThreshold: settings.rag.similarityThreshold }
        );
        
        if (ragResults.length > 0) {
          selectedTemplate = ragResults[0].data;
          techniquesUsed.push('RAG');
          metadata.ragResults = ragResults.length;
          metadata.templateUsed = selectedTemplate.name;
        }
      }

      // 3. Get base system prompt
      const { content: basePrompt, promptTemplate } = await this.promptService.getSystemPromptForUser(
        userId,
        userMessage
      );

      let enhancedSystemPrompt = selectedTemplate?.content || basePrompt;

      // 4. Apply Directive Enhancements
      const category = selectedTemplate?.category || promptTemplate?.category || 'general';
      enhancedSystemPrompt = this.directiveService.enhanceWithMultipleDirectives(
        enhancedSystemPrompt,
        {
          category,
          style: settings.directives.style,
          includeExamples: settings.directives.includeExamples,
          includeReferences: settings.directives.includeReferences,
          context: {
            userRole: context?.userRole,
            environment: context?.environment,
            priority: context?.priority
          }
        }
      );
      techniquesUsed.push('Directives');

      // 5. Add Few-Shot Examples - REMOVED: Prompt techniques disabled
      // if (settings.fewShot.enabled && (selectedTemplate?.id || promptTemplate?.id)) {
      //   const templateId = selectedTemplate?.id || promptTemplate?.id;
      //   const examples = await this.fewShotService.loadExamples(templateId);
      //
      //   if (examples.length > 0) {
      //     enhancedSystemPrompt = await this.fewShotService.enhancePromptWithExamples(
      //       enhancedSystemPrompt,
      //       examples,
      //       userMessage,
      //       {
      //         maxExamples: settings.fewShot.maxExamples,
      //         includeExplanations: settings.fewShot.includeExplanations,
      //         exampleFormat: settings.fewShot.exampleFormat
      //       }
      //     );
      //     techniquesUsed.push('Few-Shot');
      //     metadata.examplesIncluded = Math.min(examples.length, settings.fewShot.maxExamples);
      //   }
      // }

      // 6. Add ReAct Pattern if tools are available
      let reactInstructions;
      if (settings.react.enabled && availableTools && availableTools.length > 0) {
        enhancedSystemPrompt = this.reactService.enhancePromptWithReAct(enhancedSystemPrompt);
        techniquesUsed.push('ReAct');
        
        // Generate initial ReAct step
        const reactStep = await this.reactService.generateReActStep(
          userMessage,
          availableTools,
          context
        );
        reactInstructions = `Initial thought: ${reactStep.thought}`;
      }

      // 7. Check if Self-Consistency should be used
      let consistencyConfig;
      if (settings.selfConsistency.enabled) {
        const shouldUseConsistency = settings.selfConsistency.criticalOnly
          ? this.selfConsistencyService.shouldUseSelfConsistency(userMessage, context)
          : true;

        if (shouldUseConsistency) {
          consistencyConfig = {
            enabled: true,
            samples: settings.selfConsistency.samples,
            temperature: settings.selfConsistency.temperature
          };
          techniquesUsed.push('Self-Consistency');
          metadata.consistencySamples = settings.selfConsistency.samples;
        }
      }

      // 8. Add custom directives if any
      const customDirectives = await this.directiveService.loadCustomDirectives(userId, 'user');
      if (customDirectives.length > 0) {
        enhancedSystemPrompt += `\n\nAdditional instructions:\n- ${customDirectives.join('\n- ')}`;
      }

      // Log the techniques used
      this.logger.info({
        userId,
        sessionId,
        messageId,
        techniquesUsed,
        templateUsed: metadata.templateUsed
      }, 'Enhanced prompt created');

      return {
        systemPrompt: enhancedSystemPrompt,
        userPrompt: userMessage,
        metadata: {
          techniques: techniquesUsed,
          ...metadata
        },
        reactInstructions,
        consistencyConfig
      };

    } catch (error) {
      this.logger.error('Failed to create enhanced prompt:', error);
      
      // Fallback to basic prompt
      return {
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: userMessage,
        metadata: {
          techniques: ['Fallback']
        }
      };
    }
  }

  /**
   * Process response with consistency checking if enabled
   */
  async processWithConsistency(
    enhancedPrompt: EnhancedPrompt,
    generateResponse: (prompt: string) => Promise<string>
  ): Promise<{
    response: string;
    consensus?: any;
    alternatives?: any[];
  }> {
    if (!enhancedPrompt.consistencyConfig?.enabled) {
      // Single response
      const response = await generateResponse(enhancedPrompt.systemPrompt);
      return { response };
    }

    // Multiple samples for consistency
    const samples = await this.selfConsistencyService.sampleResponses(
      enhancedPrompt.userPrompt,
      enhancedPrompt.consistencyConfig.samples,
      { temperature: enhancedPrompt.consistencyConfig.temperature }
    );

    const consensus = await this.selfConsistencyService.findConsensus(samples);
    
    // Store consensus result for audit
    await this.selfConsistencyService.storeConsensusResult(
      enhancedPrompt.metadata.templateUsed || 'unknown',
      enhancedPrompt.userPrompt,
      consensus,
      enhancedPrompt.userPrompt
    );

    return {
      response: consensus.recommendation,
      consensus,
      alternatives: consensus.alternatives
    };
  }

  /**
   * Store ReAct history if ReAct was used
   */
  async storeReActHistory(
    sessionId: string,
    messageId: string,
    steps: any[]
  ): Promise<void> {
    if (steps.length > 0) {
      await this.reactService.storeReActHistory(sessionId, messageId, steps);
    }
  }

  /**
   * Get user prompting settings
   */
  private async getUserSettings(userId: string): Promise<any> {
    try {
      const settings = await prisma.promptingSettings.findMany({ 
        where: { user_id: userId } 
      });

      if (settings.length > 0) {
        const userSettings = settings[0].setting_value as any;
        return {
          fewShot: {
            enabled: userSettings.few_shot_enabled || true,
            maxExamples: userSettings.few_shot_max_examples || 3,
            includeExplanations: true,
            exampleFormat: 'conversation'
          },
          react: {
            enabled: userSettings.react_enabled || true,
            showSteps: true,
            includeReflections: true
          },
          selfConsistency: {
            enabled: userSettings.self_consistency_enabled || false,
            samples: userSettings.self_consistency_samples || 3,
            temperature: 0.7,
            threshold: parseFloat(userSettings.self_consistency_threshold || '0.6'),
            criticalOnly: true
          },
          rag: {
            enabled: userSettings.rag_enabled || true,
            similarityThreshold: parseFloat(userSettings.rag_similarity_threshold || '0.5'),
            topK: 3
          },
          directives: {
            style: userSettings.directive_style || 'balanced',
            includeExamples: true,
            includeReferences: true
          }
        };
      }
    } catch (error) {
      this.logger.error('Failed to get user settings:', error);
    }

    // Return defaults
    return {
      fewShot: { enabled: true, maxExamples: 3, includeExplanations: true, exampleFormat: 'conversation' },
      react: { enabled: true, showSteps: true, includeReflections: true },
      selfConsistency: { enabled: false, samples: 3, temperature: 0.7, threshold: 0.6, criticalOnly: true },
      rag: { enabled: true, similarityThreshold: 0.5, topK: 3 },
      directives: { style: 'balanced', includeExamples: true, includeReferences: true }
    };
  }

  /**
   * Initialize all services (e.g., Milvus collection)
   */
  async initialize(): Promise<void> {
    try {
      await this.ragService.initializeCollection();
      this.logger.info('Enhanced Prompt Orchestrator initialized');
    } catch (error) {
      this.logger.error('Failed to initialize orchestrator:', error);
    }
  }
}