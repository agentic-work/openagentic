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

/**
 * Chat Processing Pipeline
 * 
 * Orchestrates the flow of chat messages through multiple processing stages:
 * 1. Authentication - Validate user and extract context
 * 2. Validation - Sanitize and validate input
 * 3. Prompt Engineering - Select and enhance system prompt
 * 4. MCP Integration - Execute tools and gather results
 * 5. Completion - Generate AI response
 * 6. Response Processing - Format and stream output
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';
import {
  PipelineContext,
  PipelineStage,
  PipelineConfig,
  PipelineError,
  PipelineMetrics,
  PipelineArtifact
} from './pipeline.types.js';
import { ChatRequest, ChatUser, StreamContext, ChatErrorCode } from '../interfaces/chat.types.js';
// REMOVED: import { generateStageThinking } from '../utils/thinkingMessageGenerator.js';
// Fake thinking removed - now using real LLM reasoning from completion stage
import { AuthStage } from './auth.stage.js';
import { ValidationStage } from './validation.stage.js';
import { RAGStage } from './rag.stage.js';
import { MemoryStage } from './memory.stage.js';
import { PromptStage } from './prompt.stage.js';
import { MCPStage } from './mcp.stage.js';
import { MessagePreparationStage } from './message-preparation.stage.js';
import { CompletionStage } from './completion-simple.stage.js';
import { MultiModelOrchestrationStage } from './multi-model.stage.js';
// REMOVED: import { generateThinkingMessage } from '../utils/thinkingMessageGenerator.js';
// Now using real LLM thinking instead of generated fake messages
import { AgentsStage } from './agents.stage.js';
import { ResponseStage } from './response.stage.js';
import { AuditLogger } from '../../../services/AuditLogger.js';
import { executeToolCalls, formatToolResultsAsMessages, createAgentEventRelay } from './tool-execution.helper.js';
import { AgentSpawnManager, type SubAgentConfig, type SubAgentResult } from '../../../services/AgentSpawnManager.js';
import jwt from 'jsonwebtoken';
import { LargeResultStorageService, setLargeResultStorageServiceInstance } from '../../../services/LargeResultStorageService.js';
import { enrichErrorForAdmin, getDefaultRecommendations, isRetryableError } from './error-handling.helper.js';
import { getPipelineConfigService } from '../../../services/PipelineConfigService.js';
import { contextManagementService } from '../../../services/ContextManagementService.js';
import { getTieredFunctionCallingService, initializeTieredFunctionCalling } from '../../../services/TieredFunctionCallingService.js';
import { prisma as globalPrisma } from '../../../utils/prisma.js';

export class ChatPipeline extends EventEmitter {
  private stages: PipelineStage[];
  private config: PipelineConfig;
  private logger: any;
  private services: any;
  private auditLogger: AuditLogger;
  private resultStorageService: LargeResultStorageService;
  private isRunning: boolean = false;
  private activeContexts: Map<string, PipelineContext> = new Map();

  constructor(services: any, logger: any, config: Partial<PipelineConfig> = {}) {
    super();
    
    this.services = services;
    this.logger = logger.child({ component: 'ChatPipeline' }) as Logger;
    this.auditLogger = new AuditLogger(this.logger);
    this.resultStorageService = new LargeResultStorageService(this.logger);
    // Register singleton so DataQueryTool can access stored results
    setLargeResultStorageServiceInstance(this.resultStorageService);
    this.config = this.buildConfig(config);
    
    // Debug log to check if milvus is available
    this.logger.info({ 
      hasMilvus: !!services.milvus,
      milvusType: typeof services.milvus,
      servicesKeys: Object.keys(services)
    }, 'ChatPipeline initialized with services');
    
    // Initialize pipeline stages with all enhanced services
    const stages: PipelineStage[] = [
      new AuthStage(services.auth, this.logger),
      new ValidationStage(
        services.validation,
        this.logger,
        services.redis,
        services.milvus,
        services.semanticCache,
        services.fileAttachmentService
      )
    ];

    // Add RAG stage if enabled and service available
    this.logger.info({
      enableRAG: this.config.enableRAG,
      hasKnowledgeIngestion: !!services.knowledgeIngestionService,
      hasMilvus: !!services.milvus,
      hasMilvusGetter: !!services.getMilvus
    }, '[ChatPipeline] RAG stage eligibility check');

    // Use getMilvus() getter if direct milvus isn't available
    const milvusClient = services.milvus || (services.getMilvus ? services.getMilvus() : null);

    if (this.config.enableRAG && (services.knowledgeIngestionService || milvusClient)) {
      stages.push(new RAGStage(
        services.knowledgeIngestionService,
        milvusClient,
        this.logger,
        { enabled: true }
      ));
      this.logger.info('[ChatPipeline] RAG stage ADDED to pipeline');
    } else {
      this.logger.warn({
        enableRAG: this.config.enableRAG,
        hasServices: !!(services.knowledgeIngestionService || milvusClient)
      }, '[ChatPipeline] RAG stage NOT added');
    }

    // Add Memory stage if enabled and service available
    if (this.config.enableMemory && (services.redis || services.prisma)) {
      stages.push(new MemoryStage(
        services.redis,
        services.prisma,
        this.logger,
        { enabled: true }
      ));
    }

    // Continue with remaining stages
    stages.push(
      new PromptStage(
        services.prompt,
        this.logger,
        services.promptTechniqueService,
        services.directiveService,
        services.knowledgeIngestionService
      ),
      new MCPStage(), // Semantic MCP stage - gets services from context
      new AgentsStage(), // Agent delegation + background results injection
      new MessagePreparationStage() // NEW: Deduplicate and validate messages
    );

    // Multi-model collaboration: Use orchestration stage if feature flag enabled
    // The multi-model stage internally handles fallback to single model based on:
    // - ENABLE_MULTI_MODEL env var (build-time feature flag)
    // - Runtime toggle from SystemConfiguration
    // - Intelligence slider position threshold
    // - Task complexity analysis
    const enableMultiModel = process.env.ENABLE_MULTI_MODEL === 'true';
    if (enableMultiModel) {
      this.logger.info('[PIPELINE] Multi-model collaboration ENABLED - using MultiModelOrchestrationStage');
      stages.push(new MultiModelOrchestrationStage()); // Can use multiple models per request
    } else {
      stages.push(new CompletionStage()); // SIMPLIFIED: Single model - AI decides when to generate images
    }

    stages.push(
      new ResponseStage(
        services.session,
        this.logger,
        services.titleService
      )
    );

    this.stages = stages;

    this.logger.info({ 
      stageCount: this.stages.length,
      config: this.config 
    }, 'Chat pipeline initialized');
  }

  /**
   * Process a chat request through the entire pipeline
   */
  async process(request: ChatRequest, user: ChatUser, streamCallback: (event: any) => void | Promise<void>, abortController?: AbortController): Promise<void> {
    const context = this.createContext(request, user, streamCallback);

    // Wire abort signal into pipeline context for propagation
    if (abortController) {
      context.abortController = abortController;
      context.abortSignal = abortController.signal;
    }

    // Load pipeline configuration for skills system and other dynamic settings
    try {
      const pipelineConfigService = getPipelineConfigService(this.services.prisma, this.services.redis);
      context.pipelineConfig = await pipelineConfigService.getConfiguration();
      this.logger.debug({
        messageId: context.messageId,
        hasSkills: context.pipelineConfig?.stages?.prompt?.enableSkills,
        activeSkillIds: context.pipelineConfig?.stages?.prompt?.activeSkillIds
      }, '[PIPELINE] Loaded pipeline configuration');
    } catch (configError: any) {
      this.logger.warn({
        messageId: context.messageId,
        error: configError.message
      }, '[PIPELINE] Failed to load pipeline config, skills features will be disabled');
    }

    const startTime = Date.now();
    let auditEntry: any = {
      userId: context.user.id,
      sessionId: context.request.sessionId,
      messageId: context.messageId,
      rawQuery: context.request.content || context.request.message || '',
      queryType: 'chat' as const,
      ipAddress: context.request.ipAddress,
      userAgent: context.request.userAgent,
      requestPayload: {
        content: context.request.content || context.request.message || '',
        model: context.request.model,
        sessionId: context.request.sessionId
      }
    };

    try {
      this.activeContexts.set(context.messageId, context);
      this.emit('pipeline:start', { context });

      // CONTEXT MANAGEMENT: Check and silently compact if approaching limits
      // This runs in background without blocking the request
      // Pass streamCallback so compaction can notify the client via SSE
      if (context.request.sessionId) {
        contextManagementService.checkAndCompact(
          context.request.sessionId,
          context.request.model,
          streamCallback
        ).catch(err => {
          this.logger.warn({ err, sessionId: context.request.sessionId }, 'Context compaction check failed');
        });
      }

      // REMOVED: Fake thinking messages - now only show REAL LLM reasoning
      // The completion stage (completion-simple.stage.ts) captures actual thinking from:
      // - Claude: delta.thinking (native extended thinking API)
      // - Gemini: delta.reasoning, thinking_config (native thinking)
      // - OpenAI/Ollama: <thinking> tags extracted from prompt-based reasoning
      // See lines 968-979 and 1080-1135 in completion-simple.stage.ts

      const metrics = await this.executeStages(context);
      
      // Update audit entry with results
      auditEntry.responseTimeMs = Date.now() - startTime;
      auditEntry.success = true;
      auditEntry.tokensConsumed = metrics.tokenUsage?.totalTokens;
      auditEntry.modelUsed = context.request.model;
      auditEntry.responsePayload = {
        content: context.response || '',
        toolCalls: context.mcpCalls,
        metrics: {
          totalTime: metrics.totalTime,
          mcpCalls: metrics.mcpCalls,
          cacheHits: metrics.cacheHits
        }
      };
      
      // Log successful completion
      await this.auditLogger.logUserQuery(auditEntry);
      
      this.emit('pipeline:complete', { context, metrics });
      this.logger.info({
        messageId: context.messageId,
        totalTime: metrics.totalTime,
        stageTimings: metrics.stageTimings
      }, 'Pipeline completed successfully');

      // Fire-and-forget: store pipeline artifacts in user's Milvus collection
      this.storePipelineArtifacts(context).catch(err => {
        this.logger.warn({ error: err.message }, '[ARTIFACT-REGISTRY] Artifact storage failed (non-blocking)');
      });

      // Fire-and-forget: background agent triggers based on response content
      this.triggerBackgroundAgents(context).catch(err => {
        this.logger.debug({ error: err.message }, 'Background agent trigger skipped');
      });

    } catch (error) {
      // Update audit entry with error details
      auditEntry.responseTimeMs = Date.now() - startTime;
      auditEntry.success = false;
      auditEntry.errorMessage = error.message;
      auditEntry.errorCode = error.code || 'PIPELINE_ERROR';
      
      // Log failed execution
      await this.auditLogger.logUserQuery(auditEntry);
      
      await this.handleError(context, error);
    } finally {
      this.activeContexts.delete(context.messageId);
    }
  }

  /**
   * Execute all pipeline stages with optimized parallelization
   *
   * NON-BLOCKING MODE (PIPELINE_MODE=nonblocking):
   * - Auth/Validation: < 50ms (Redis cached)
   * - MCP: < 100ms (pre-indexed tools from Milvus cache)
   * - RAG: ASYNC - runs in background, enriches NEXT turn
   * - Completion: Starts streaming immediately
   *
   * BLOCKING MODE (default):
   * - All stages complete before streaming starts
   */
  private async executeStages(context: PipelineContext): Promise<PipelineMetrics> {
    const metrics: PipelineMetrics = {
      stageTimings: {},
      totalTime: 0,
      tokenUsage: null,
      mcpCalls: 0,
      cacheHits: 0,
      errors: 0
    };

    const startTime = Date.now();
    const nonBlockingMode = process.env.PIPELINE_MODE === 'nonblocking';

    if (nonBlockingMode) {
      this.logger.info({
        messageId: context.messageId,
        mode: 'nonblocking'
      }, '⚡ NON-BLOCKING PIPELINE: Starting fast path');
    }

    // OPTIMIZATION: Execute auth and validation in parallel (they're independent)
    const parallelStages = ['auth', 'validation'];
    const parallelStartTime = Date.now();

    // Find auth and validation stages
    const authStage = this.stages.find(s => s.name === 'auth');
    const validationStage = this.stages.find(s => s.name === 'validation');

    if (authStage && validationStage) {
      try {
        this.logger.info({
          messageId: context.messageId,
          stages: ['auth', 'validation']
        }, 'Executing auth and validation stages in parallel');

        const [authResult, validationResult] = await Promise.all([
          authStage.execute(context).catch(error => {
            metrics.errors++;
            throw error;
          }),
          validationStage.execute(context).catch(error => {
            metrics.errors++;
            throw error;
          })
        ]);

        // Merge results back to context (auth doesn't modify context much)
        context = validationResult; // Validation result has the session data

        const parallelTime = Date.now() - parallelStartTime;
        metrics.stageTimings['auth'] = parallelTime;
        metrics.stageTimings['validation'] = parallelTime;

        this.logger.info({
          messageId: context.messageId,
          executionTime: parallelTime
        }, 'Parallel auth/validation completed');

      } catch (error) {
        const parallelTime = Date.now() - parallelStartTime;
        metrics.stageTimings['parallel-auth-validation'] = parallelTime;

        this.logger.error({
          messageId: context.messageId,
          error: error.message
        }, 'Parallel auth/validation failed');

        throw error;
      }
    }

    // OPTIMIZATION 2: Execute RAG + MCP in parallel (they're independent)
    // Both only need user query and context from validation - they don't depend on each other
    const ragStage = this.stages.find(s => s.name === 'rag');
    const mcpStage = this.stages.find(s => s.name === 'mcp');

    // ═══════════════════════════════════════════════════════════════════════════════
    // NON-BLOCKING MODE: Skip RAG/Memory blocking - start streaming faster
    // RAG embedding generation is cached to Redis by rag.stage.ts
    // Memory results are cached for next turn
    // CRITICAL: MCP MUST still be awaited - tools are required for current completion!
    // ═══════════════════════════════════════════════════════════════════════════════
    if (nonBlockingMode) {
      this.logger.info({
        messageId: context.messageId,
        mode: 'nonblocking',
        hasRag: !!ragStage,
        hasMcp: !!mcpStage
      }, '⚡ NON-BLOCKING: RAG/Memory async, MCP awaited for tools');

      // Mark RAG as processed so we skip in sequential loop (MCP handled below)
      parallelStages.push('rag');
      metrics.stageTimings['rag'] = 0;

      // Emit context injection event - frontend knows RAG enrichment is pending
      context.emit('context_injection_pending', {
        rag: !!ragStage,
        mcp: false, // MCP is NOT pending - it will be awaited
        timestamp: new Date().toISOString()
      });

      // Start RAG in background (fire and forget for this request)
      // Results will be cached for next request via Redis/Milvus
      if (ragStage) {
        ragStage.execute(context).then(result => {
          this.logger.info({
            messageId: context.messageId,
            ragResults: result.retrievedKnowledge?.metadata?.totalResults || 0
          }, '⚡ [ASYNC] RAG completed in background - results cached');
        }).catch(err => {
          this.logger.warn({ error: err.message }, '⚡ [ASYNC] RAG failed in background');
        });
      }

      // Run MCP (tool injection) and Memory (context injection) IN PARALLEL
      // Both are required before completion, but they're independent of each other.
      // Running them concurrently saves ~50-100ms vs sequential execution.
      const memoryStage = this.stages.find(s => s.name === 'memory');
      const mcpStartTime = Date.now();
      const memoryStartTime = Date.now();

      const [mcpSettled, memorySettled] = await Promise.allSettled([
        // MCP: Load tools for the current completion
        mcpStage ? (async () => {
          parallelStages.push('mcp');
          const result = await mcpStage.execute(context);
          context.availableTools = result.availableTools || context.availableTools;
          context.mcpServices = result.mcpServices || context.mcpServices;
          metrics.stageTimings['mcp'] = Date.now() - mcpStartTime;
          return result;
        })() : Promise.resolve(null),
        // Memory: Inject user memory/context
        memoryStage ? (async () => {
          parallelStages.push('memory');
          const result = await memoryStage.execute(context);
          context.systemPrompt = result.systemPrompt || context.systemPrompt;
          context.metadata = { ...context.metadata, ...result.metadata };
          metrics.stageTimings['memory'] = Date.now() - memoryStartTime;
          return result;
        })() : Promise.resolve(null),
      ]);

      // Log results
      if (mcpSettled.status === 'fulfilled') {
        this.logger.info({
          messageId: context.messageId,
          toolsFound: context.availableTools?.length || 0,
          executionTime: metrics.stageTimings['mcp'] || 0
        }, '⚡ [PARALLEL] MCP + Memory completed — tools loaded');
      } else {
        metrics.stageTimings['mcp'] = Date.now() - mcpStartTime;
        this.logger.warn({ error: (mcpSettled as any).reason?.message }, '⚡ [PARALLEL] MCP failed, continuing without tools');
        context.availableTools = [];
      }
      if (memorySettled.status === 'rejected') {
        metrics.stageTimings['memory'] = Date.now() - memoryStartTime;
        this.logger.warn({ error: (memorySettled as any).reason?.message }, '⚡ [PARALLEL] Memory failed, continuing without context');
      }

    } else if (ragStage && mcpStage) {
      // BLOCKING MODE: Wait for RAG + MCP before starting completion
      const ragMcpStartTime = Date.now();
      parallelStages.push('rag', 'mcp'); // Add to skip list for sequential loop

      try {
        this.logger.info({
          messageId: context.messageId,
          stages: ['rag', 'mcp']
        }, '[OPTIMIZATION] Executing RAG and MCP stages in parallel');

        const [ragResult, mcpResult] = await Promise.all([
          ragStage.execute(context).catch(error => {
            this.logger.warn({ error: error.message }, '[OPTIMIZATION] RAG stage failed, continuing without RAG');
            metrics.errors++;
            return context; // Return original context on RAG failure
          }),
          mcpStage.execute(context).catch(error => {
            this.logger.warn({ error: error.message }, '[OPTIMIZATION] MCP stage failed, continuing without tools');
            metrics.errors++;
            return context; // Return original context on MCP failure
          })
        ]);

        // Merge RAG results (retrievedKnowledge) and MCP results (availableTools) into context
        context.retrievedKnowledge = ragResult.retrievedKnowledge || context.retrievedKnowledge;
        context.ragMetrics = ragResult.ragMetrics || context.ragMetrics;
        context.availableTools = mcpResult.availableTools || context.availableTools;
        context.mcpServices = mcpResult.mcpServices || context.mcpServices;

        const ragMcpTime = Date.now() - ragMcpStartTime;
        metrics.stageTimings['rag'] = ragMcpTime;
        metrics.stageTimings['mcp'] = ragMcpTime;

        this.logger.info({
          messageId: context.messageId,
          executionTime: ragMcpTime,
          toolsFound: context.availableTools?.length || 0,
          ragResults: context.retrievedKnowledge?.metadata?.totalResults || 0
        }, '[OPTIMIZATION] Parallel RAG/MCP completed - saved ~1-2s latency');

      } catch (error) {
        const ragMcpTime = Date.now() - ragMcpStartTime;
        metrics.stageTimings['parallel-rag-mcp'] = ragMcpTime;
        this.logger.error({
          messageId: context.messageId,
          error: error.message
        }, '[OPTIMIZATION] Parallel RAG/MCP failed');
        // Don't throw - continue with sequential fallback
      }
    } else if (ragStage && !mcpStage) {
      // Only RAG stage exists - execute it now
      const ragStartTime = Date.now();
      parallelStages.push('rag');
      try {
        context = await ragStage.execute(context);
        metrics.stageTimings['rag'] = Date.now() - ragStartTime;
        this.logger.info({ messageId: context.messageId, executionTime: Date.now() - ragStartTime }, '[RAG] Stage completed');
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[RAG] Stage failed, continuing without RAG');
        metrics.errors++;
      }
    } else if (mcpStage && !ragStage) {
      // Only MCP stage exists - execute it now (CRITICAL FIX: was being skipped!)
      const mcpStartTime = Date.now();
      parallelStages.push('mcp');
      try {
        const mcpResult = await mcpStage.execute(context);
        context.availableTools = mcpResult.availableTools || context.availableTools;
        context.mcpServices = mcpResult.mcpServices || context.mcpServices;
        metrics.stageTimings['mcp'] = Date.now() - mcpStartTime;
        this.logger.info({
          messageId: context.messageId,
          executionTime: Date.now() - mcpStartTime,
          toolsFound: context.availableTools?.length || 0
        }, '[MCP] Stage completed - tools loaded');
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[MCP] Stage failed, continuing without tools');
        metrics.errors++;
      }
    }

    // Execute remaining stages sequentially (they have dependencies)
    for (const stage of this.stages) {
      // Skip already executed stages
      if (parallelStages.includes(stage.name)) {
        continue;
      }

      if (context.aborted) {
        this.logger.warn({
          messageId: context.messageId,
          stage: stage.name
        }, 'Pipeline aborted, skipping remaining stages');
        break;
      }

      const stageStartTime = Date.now();

      try {
        this.logger.debug({
          messageId: context.messageId,
          stage: stage.name
        }, 'Executing pipeline stage');

        // REMOVED: Fake stage thinking messages
        // Real thinking now comes directly from LLM responses in completion-simple.stage.ts
        // See lines 968-979 (Claude/Gemini native thinking) and 1080-1135 (<thinking> tag extraction)

        // TieredFC: Strip tools for pure-chat queries BEFORE the first completion call
        // This prevents models like Gemini from calling memory_store/recall for "What is the capital of France?"
        if ((stage.name === 'completion' || stage.name === 'multi-model-orchestration') && context.availableTools?.length) {
          try {
            let tieredFCService = getTieredFunctionCallingService();
            if (!tieredFCService) {
              tieredFCService = initializeTieredFunctionCalling(this.logger, globalPrisma);
            }
            if (tieredFCService) {
              const userMessage = context.request.message || '';
              const tieredFCDecision = await tieredFCService.makeDecision(
                userMessage,
                context.availableTools
              );
              if (tieredFCDecision.stripTools) {
                this.logger.info({
                  messageId: context.messageId,
                  toolCount: context.availableTools.length,
                  reasoning: tieredFCDecision.reasoning
                }, '[TieredFC] Stripping tools for pure-chat query');
                (context as any)._savedToolsBeforeStrip = [...context.availableTools];
                context.availableTools = [];
              }
            }
          } catch (tfcErr: any) {
            this.logger.warn({ err: tfcErr.message }, '[TieredFC] Error in tiered FC check (non-fatal, keeping tools)');
          }
        }

        // ARTIFACT AUTO-DELEGATION: If the user requests an artifact, skip the LLM
        // decision and programmatically inject a delegate_to_agents tool call.
        // GPT-4.1 ignores "MUST delegate" instructions — this enforces it.
        const isArtifactAutoDelegate = (stage.name === 'completion' || stage.name === 'multi-model-orchestration') &&
          /\b(create|build|make|generate|design)\b.*\b(artifact|dashboard|visualization|interactive|textbook|simulation|presentation)\b/i.test(context.request.message || '') &&
          !context.request.message?.toLowerCase().includes('do not delegate');

        if (isArtifactAutoDelegate) {
          this.logger.info({ messageId: context.messageId }, '[ARTIFACT-AUTO-DELEGATE] Detected artifact request — routing directly to openagentic-proxy');

          // Pre-generate image if the task mentions image/photo/illustration
          // The openagentic-proxy doesn't have access to generate_image (it's a pipeline-internal tool)
          // so we generate the image here and pass the URL to the artifact agent.
          let artifactTask = context.request.message || '';
          const wantsImage = /\b(generat|creat|make|draw|render)\w*\s+(an?\s+)?(image|photo|picture|illustration|visual)\b/i.test(artifactTask);
          if (wantsImage) {
            try {
              this.logger.info({ messageId: context.messageId }, '[ARTIFACT-AUTO-DELEGATE] Image requested — pre-generating before artifact delegation');
              context.emit('tool_progress', { name: 'generate_image', status: 'executing', message: 'Generating image...', timestamp: new Date().toISOString() });
              const { ImageStorageService } = await import('../../../services/ImageStorageService.js');
              const providerManager = (global as any).providerManager;
              // Extract image description from prompt
              const imageDescMatch = artifactTask.match(/(?:generat|creat|make|draw|render)\w*\s+(?:an?\s+)?(?:image|photo|picture|illustration|visual)\s+(?:of\s+)?(.{10,300}?)(?:\.\s|;\s|Then\b|and\s+(?:then|create|build|make))/i);
              const imagePrompt = imageDescMatch?.[1]?.trim() || artifactTask.substring(0, 300);
              const result = await providerManager.generateImage({ prompt: imagePrompt, size: '1024x1024', style: 'vivid' });
              if (result.imageBase64) {
                // Store in MinIO + Milvus (same as image-gen-tool.ts)
                const storageService = new ImageStorageService(this.logger);
                await storageService.connect();
                const imageId = await storageService.storeImage(
                  result.imageBase64,
                  imagePrompt,
                  context.user?.id || 'system',
                  { model: result.model, revisedPrompt: result.revisedPrompt, dimensions: '1024x1024', generationTime: result.generationTimeMs }
                );
                const cleanId = imageId?.replace(/\.png$/, '') || imageId;
                const imageUrl = `/api/images/${cleanId}.png`;
                artifactTask = `${artifactTask}\n\n[GENERATED IMAGE AVAILABLE] The requested image has already been generated and stored. Embed it in your artifact HTML as:\n<img src="${imageUrl}" alt="Generated image" style="width:100%;max-width:1200px;border-radius:12px;">\nDo NOT generate another image — use this URL directly.`;
                this.logger.info({ imageUrl, imageId: cleanId }, '[ARTIFACT-AUTO-DELEGATE] Image pre-generated, URL passed to artifact agent');
                context.emit('image', { imageUrl: `image://${cleanId}`, revisedPrompt: imagePrompt, messageId: context.messageId });
              }
            } catch (imgErr: any) {
              this.logger.warn({ error: imgErr.message }, '[ARTIFACT-AUTO-DELEGATE] Image pre-generation failed, artifact agent will proceed without');
            }
          }

          // Synthesize a tool call as if the LLM decided to delegate
          context.request.toolCalls = [{
            id: `auto-delegate-${Date.now()}`,
            type: 'function',
            function: {
              name: 'delegate_to_agents',
              arguments: JSON.stringify({
                agents: [{
                  role: 'artifact_creation',
                  task: artifactTask,
                  // Pass the pipeline's resolved model so agents use admin-configured model
                  model: context.request.model || (context as any).resolvedModel || undefined
                }],
                orchestration: 'sequential',
                aggregation: 'first'
              })
            }
          }];
          // Emit a brief status so the user sees something
          context.emit('content_delta', { content: '' });
        } else {
          context = await stage.execute(context);
        }

        // Handle tool call loop after completion or multi-model orchestration stage
        if (stage.name === 'completion' || stage.name === 'multi-model-orchestration') {
          // Handle tool calls in a loop to support multiple rounds
          let toolCallRound = 0;

          // Load maxToolCallRounds from pipeline config (default 8, cap at 15)
          // Most queries need 1-3 tool calls. If >8 rounds, tool selection is the problem.
          let maxToolCallRounds = 20;
          try {
            const pipelineConfigService = getPipelineConfigService(this.services.prisma, this.services.redis);
            const pipelineConfig = await pipelineConfigService.getConfiguration();
            maxToolCallRounds = Math.min(pipelineConfig.stages.toolExecution.maxToolCallRounds || 20, 25); // Cap at 25
            this.logger.info({
              messageId: context.messageId,
              maxToolCallRounds,
              source: 'pipeline-config'
            }, '[TOOL-EXECUTION] Loaded maxToolCallRounds from pipeline config');
          } catch (configError: any) {
            this.logger.warn({
              messageId: context.messageId,
              error: configError.message,
              defaultValue: 8
            }, '[TOOL-EXECUTION] Failed to load pipeline config, using default maxToolCallRounds=8');
          }

          // MODEL-AWARE ROUND LIMITS:
          // Premium models (Claude, Gemini) can handle long tool chains — give them more rounds
          // Local models (gpt-oss, qwen) tend to loop — cap them low
          const modelLower = (context.request.model || '').toLowerCase();
          const isLocalModel = modelLower.includes('gpt-oss') || modelLower.includes('qwen') ||
            modelLower.includes('llama') || modelLower.includes('deepseek') || modelLower.includes('phi');
          const isPremiumModel = modelLower.includes('claude') || modelLower.includes('gemini') ||
            modelLower.includes('sonnet') || modelLower.includes('opus');

          if (isLocalModel && maxToolCallRounds > 8) {
            maxToolCallRounds = 8;
            this.logger.info({
              messageId: context.messageId,
              model: context.request.model,
              maxToolCallRounds: 8,
              reason: 'Local model - capped tool rounds (8 allows multi-cloud queries)'
            }, '[TOOL-EXECUTION] Capped maxToolCallRounds for local model');
          } else if (isPremiumModel && maxToolCallRounds < 20) {
            maxToolCallRounds = 20;
            this.logger.info({
              messageId: context.messageId,
              model: context.request.model,
              maxToolCallRounds: 20,
              reason: 'Premium model - increased rounds for complex multi-step tasks'
            }, '[TOOL-EXECUTION] Increased maxToolCallRounds for premium model');
          }

          // Track reasoning-only tools that should only run once per session
          const reasoningOnlyTools = new Set(['sequentialthinking', 'sequential_thinking', 'reasoning', 'think']);
          let reasoningToolsUsed = new Set<string>();

          // Track duplicate tool calls (same tool + same args) to break infinite loops
          // Models like Gemini sometimes call the same tool with identical args repeatedly
          const toolCallHistory = new Map<string, number>(); // key → count
          const MAX_IDENTICAL_CALLS = 2; // Allow max 2 identical calls before forcing stop

          // Track per-tool-name invocations (catches loops where args change slightly each time)
          // Particularly important for synth_synthesize where Gemini modifies HTML on each retry.
          //
          // The cap was originally 3 — too aggressive for legitimate multi-step infrastructure
          // work where one polymorphic tool (e.g., azure_arm_execute) is called many times with
          // genuinely different bodies (try F1 → B1 → S1 → westus2 → Container App). Bumped to
          // 10 globally, AND polymorphic execute-style tools are exempted entirely below — they
          // are by-design called many times with different arguments to drive multi-step work.
          // Exact-arg dedup (MAX_IDENTICAL_CALLS) still catches actual no-progress loops.
          const toolNameCallCounts = new Map<string, number>();
          const MAX_SAME_TOOL_CALLS = 10;
          // Polymorphic "execute" tools that legitimately carry the entire intent in their args
          // and may be called many times in a multi-step infra task. The exact-args dedup still
          // catches the no-progress case for these.
          const POLYMORPHIC_EXEC_TOOLS = new Set([
            'azure_arm_execute',
            'azure_arm_execute_and_wait',
            'aws_cli_execute',
            'call_aws',
            'gcp_api_execute',
            'gcp_cli_execute',
            'k8s_apply',
            'k8s_patch',
            'helm_install',
            'helm_upgrade',
            'synth_synthesize',
            'openagentic_execute',
            'admin_postgres_raw_query',
          ]);

          // CRITICAL FIX: Save the original tools list from MCP stage so we can restore it
          // if something clears it during the tool execution loop (tiered FC, Gemini reduction, etc.)
          const savedAvailableTools = context.availableTools ? [...context.availableTools] : [];

          while (context.request.toolCalls && context.request.toolCalls.length > 0 && toolCallRound < maxToolCallRounds) {
            toolCallRound++;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              hasToolCalls: !!(context.request.toolCalls),
              toolCallsLength: context.request.toolCalls?.length || 0,
              toolCallsType: Array.isArray(context.request.toolCalls) ? 'array' : typeof context.request.toolCalls,
              toolCallsStructure: context.request.toolCalls ? JSON.stringify(context.request.toolCalls).substring(0, 200) : null
            }, `Tool call round ${toolCallRound}: Processing tool calls`);

            // EARLY TERMINATION: Filter out reasoning-only tools that have already been called
            // This prevents the LLM from calling sequentialthinking 10+ times in a row
            const originalToolCalls = context.request.toolCalls;
            const filteredToolCalls = originalToolCalls.filter(tc => {
              const toolName = tc.function.name.toLowerCase();
              if (reasoningOnlyTools.has(toolName) && reasoningToolsUsed.has(toolName)) {
                this.logger.info({
                  messageId: context.messageId,
                  toolCallRound,
                  skippedTool: tc.function.name
                }, `[TOOL-OPTIMIZATION] Skipping duplicate reasoning tool: ${tc.function.name}`);
                return false;
              }
              return true;
            });

            // Track reasoning tools being used
            originalToolCalls.forEach(tc => {
              const toolName = tc.function.name.toLowerCase();
              if (reasoningOnlyTools.has(toolName)) {
                reasoningToolsUsed.add(toolName);
              }
            });

            // DUPLICATE CALL DETECTION: Filter out tool calls that have been called too many times
            // Two checks: (1) exact same name+args, (2) same tool name regardless of args
            const deduplicatedToolCalls = filteredToolCalls.filter(tc => {
              const argsStr = typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {});
              const callKey = `${tc.function.name}::${argsStr}`;
              const toolName = tc.function.name;

              // Check 1: Exact duplicate (same tool + same args)
              const exactCount = toolCallHistory.get(callKey) || 0;
              if (exactCount >= MAX_IDENTICAL_CALLS) {
                this.logger.warn({
                  messageId: context.messageId,
                  toolCallRound,
                  tool: toolName,
                  duplicateCount: exactCount
                }, `[TOOL-DEDUP] Skipping exact duplicate (${exactCount}x): ${toolName}`);
                return false;
              }

              // Check 2: Same tool name called too many times (catches varied-args loops)
              // e.g., Gemini calling synth_synthesize with slightly different HTML each time.
              // Polymorphic execute tools (azure_arm_execute, aws_cli_execute, etc.) are
              // exempted because they carry the full intent in their args and are designed
              // to be called many times in legitimate multi-step infra work.
              const nameCount = toolNameCallCounts.get(toolName) || 0;
              if (!POLYMORPHIC_EXEC_TOOLS.has(toolName) && nameCount >= MAX_SAME_TOOL_CALLS) {
                this.logger.warn({
                  messageId: context.messageId,
                  toolCallRound,
                  tool: toolName,
                  nameCallCount: nameCount
                }, `[TOOL-DEDUP] Skipping ${toolName} — called ${nameCount}x already (max ${MAX_SAME_TOOL_CALLS})`);
                return false;
              }

              toolCallHistory.set(callKey, exactCount + 1);
              toolNameCallCounts.set(toolName, nameCount + 1);
              return true;
            });

            // If all remaining tools were filtered out, exit the loop
            if (deduplicatedToolCalls.length === 0) {
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                filteredOut: originalToolCalls.length,
                reason: 'all tools were duplicates or reasoning tools'
              }, '[TOOL-OPTIMIZATION] All requested tools filtered out - forcing final synthesis');

              // Run one final completion WITHOUT tools to force text synthesis
              context.request.toolCalls = undefined;
              context.forceFinalCompletion = true;

              const completionStageForSynth = this.stages.find(s => s.name === 'completion' || s.name === 'multi-model-orchestration');
              if (completionStageForSynth) {
                // Add synthesis instruction
                context.messages.push({
                  id: `system_synthesis_dedup_${context.messageId}`,
                  role: 'system' as const,
                  content: `All tool calls have been completed. Now provide your final answer to the user based on the tool results above. Do NOT call any more tools — just answer the question directly.`,
                  timestamp: new Date(),
                  tokenUsage: null
                });

                this.logger.info({ messageId: context.messageId }, '[DEDUP-SYNTHESIS] Running forced synthesis completion');
                const synthStart = Date.now();
                context = await completionStageForSynth.execute(context);
                metrics.stageTimings['completion-synthesis-forced'] = Date.now() - synthStart;
              }
              break;
            }

            // Use deduplicated tool calls
            context.request.toolCalls = deduplicatedToolCalls;

            // HITL gate is enforced inside `executeToolCalls` (tool-execution.helper.ts:2185)
            // via ToolApprovalGate.evaluate() which emits `mcp_approval_required` SSE event,
            // waits for the user's decision via Redis pub/sub, and returns approved=false to
            // block execution on deny. Per-tool, per-call. The legacy `tool_approval_request`
            // event + hard auto-approve here was a placeholder from the early HITL design and
            // was actively masking deny — REMOVED.
            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              toolCount: context.request.toolCalls.length,
              tools: context.request.toolCalls.map(tc => ({ id: tc.id, name: tc.function.name })),
            }, '[TOOL-EXECUTION] Proceeding to per-tool HITL gate inside executeToolCalls');

            // Execute tool calls via MCP Proxy with user's Azure AD token
            const toolExecutionStart = Date.now();

            // CRITICAL: Emit tool execution start event to keep SSE stream alive
            // This prevents frontend from showing flashing cursor/freeze during tool execution
            context.emit('tool_execution_start', {
              toolCallRound,
              toolCount: context.request.toolCalls.length,
              tools: context.request.toolCalls.map(tc => ({
                id: tc.id,
                name: tc.function.name
              })),
              timestamp: new Date().toISOString()
            });

            try {
              // =====================================================================
              // MULTI-AGENT: Handle delegate_to_agents and spawn_parallel_agents
              // Cap: only 1 delegation per conversation turn (prevents loop)
              // =====================================================================
              const agentCalls = context.request.toolCalls.filter(
                tc => tc.function.name === 'delegate_to_agents' || tc.function.name === 'spawn_parallel_agents'
              );
              const regularToolCalls = context.request.toolCalls.filter(
                tc => tc.function.name !== 'delegate_to_agents' && tc.function.name !== 'spawn_parallel_agents'
              );

              let toolResults: any[] = [];
              let updatedCodeContext = context.codeExecutionContext;

              // Track delegation — only allow once per turn
              if (!(context as any)._agentDelegationDone) (context as any)._agentDelegationDone = false;

              // Handle agent delegation calls (max 1 per turn)
              if (agentCalls.length > 0 && !(context as any)._agentDelegationDone) {
                (context as any)._agentDelegationDone = true; // Mark delegation as done
                const openagenticProxyUrl = (context as any).openagenticProxyUrl || process.env.OPENAGENTIC_PROXY_URL;

                for (const agentCall of agentCalls) {
                  let spec: any = {};
                  try { spec = JSON.parse(agentCall.function.arguments || '{}'); } catch { spec = {}; }

                  // FORCE SINGLE AGENT for artifact_creation — LLMs keep spawning 2 agents
                  // which causes truncation, failures, and lost images. 1 agent is enough.
                  if (spec.agents && spec.agents.length > 1) {
                    const hasArtifact = spec.agents.some((a: any) => a.role === 'artifact_creation');
                    if (hasArtifact) {
                      // Merge all tasks into a single artifact agent
                      const mergedTask = spec.agents.map((a: any) => a.task).join('\n\nADDITIONAL REQUIREMENTS:\n');
                      spec.agents = [{ role: 'artifact_creation', task: mergedTask, model: spec.agents[0].model }];
                      spec.orchestration = 'parallel'; // Single agent, orchestration doesn't matter
                      context.logger.info({ originalCount: spec.agents.length }, '[AGENT-GUARD] Forced single artifact_creation agent (was multiple)');
                    }
                  }

                  // Try openagentic-proxy first if available, fall back to inline AgentSpawnManager
                  if (openagenticProxyUrl) {
                    try {
                      const axios = (await import('axios')).default;

                      // ─── Redis Pub/Sub relay for real-time agent event streaming ───
                      // Subscribe BEFORE the blocking POST so we catch events from the start
                      const relay = await createAgentEventRelay({
                        sessionId: context.request.sessionId,
                        userId: context.user.id,
                        emit: (event: string, data: any) => context.emit(event, data),
                        logger: context.logger,
                        timeoutMs: 900_000,
                      });
                      context.logger.info({ executionId: relay.executionId }, '[AGENT-TREE] Event relay subscribed');

                      // Emit progress heartbeat during openagentic-proxy execution
                      let agentHeartbeatCount = 0;
                      const agentStartTime = Date.now();
                      const agentHeartbeat = setInterval(() => {
                        agentHeartbeatCount++;
                        const elapsedSec = agentHeartbeatCount * 5;
                        context.emit('tool_progress', {
                          toolCallId: agentCall.id,
                          name: 'delegate_to_agents',
                          elapsed: elapsedSec,
                          status: 'executing',
                          message: `Agents executing... (${elapsedSec}s)`,
                          agentCount: (spec.agents || []).length,
                          orchestration: spec.orchestration || 'parallel',
                          timestamp: new Date().toISOString()
                        });
                      }, 5000);

                      // Generate a valid token for openagentic-proxy to use with MCP proxy
                      let agentUserToken = context.user.accessToken || context.request.rawBearerToken;
                      if (!agentUserToken || (context.user.authMethod !== 'azure-ad' && !agentUserToken?.startsWith('eyJ'))) {
                        // Generate internal JWT for API key / local auth users
                        const jwtSecret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
                        if (jwtSecret) {
                          agentUserToken = jwt.sign({
                            userId: context.user.id,
                            email: context.user.email || '',
                            name: context.user.displayName || context.user.name || 'Agent User',
                            isAdmin: context.user.isAdmin || false,
                            groups: context.user.groups || [],
                            source: 'openagentic-proxy-internal'
                          }, jwtSecret, { expiresIn: '15m' });
                        }
                      }

                      let response;
                      // Collect generated image URLs for artifact agents.
                      // Primary source: context.artifacts (populated by image-gen-tool capture above)
                      // Fallback: scan context.messages for markdown image refs
                      const recentImageUrls: string[] = [];

                      // 1) Pipeline artifacts — most reliable source
                      for (const art of context.artifacts) {
                        if (art.type === 'image' && art.url) {
                          recentImageUrls.push(art.url);
                        }
                      }

                      // 2) Fallback: scan message content for image refs not yet in artifacts
                      for (const msg of context.messages) {
                        if (msg.content && typeof msg.content === 'string') {
                          const imgMatches = msg.content.match(/!\[.*?\]\((image:\/\/[^\s)]+|\/api\/images\/[^\s)]+)\)/g);
                          if (imgMatches) {
                            for (const m of imgMatches) {
                              const urlMatch = m.match(/\((image:\/\/[^\s)]+|\/api\/images\/[^\s)]+)\)/);
                              if (urlMatch && !recentImageUrls.includes(urlMatch[1])) {
                                recentImageUrls.push(urlMatch[1]);
                              }
                            }
                          }
                        }
                        if ((msg as any).metadata?.imageRefId) {
                          const url = `image://${(msg as any).metadata.imageRefId}`;
                          if (!recentImageUrls.includes(url)) recentImageUrls.push(url);
                        }
                      }
                      context.logger.info({
                        recentImageUrls,
                        artifactCount: context.artifacts.length,
                        messageCount: context.messages.length,
                      }, '[AGENT-DISPATCH] Image URL injection check');

                      try {
                        response = await axios.post(`${openagenticProxyUrl}/api/agents/execute-sync`, {
                          executionId: relay.executionId,
                          agents: (spec.agents || []).map((a: any) => {
                            let task = a.task || '';
                            // Defensive sanitizer: if any prior code path prepended a
                            // [SYSTEM ROUTING DIRECTIVE] block (or similar bracketed
                            // meta-instruction) into the user message and the LLM faithfully
                            // copied it into the task field, strip it before passing to the
                            // sub-agent. The sub-agent's task should only ever be the user's
                            // actual request — meta-routing instructions don't belong inside.
                            task = task.replace(/^\[SYSTEM ROUTING DIRECTIVE[\s\S]*?\[END DIRECTIVE\]\s*\n*/i, '');
                            task = task.replace(/^Routing hint for THIS turn only:[\s\S]*?(?=\n\n|$)/i, '');
                            task = task.trim();
                            // Inject image references into artifact_creation agent tasks
                            // so they can embed the generated image in their HTML artifacts
                            if (recentImageUrls.length > 0 && (a.role === 'artifact_creation' || /artifact|html|page|dashboard/i.test(task))) {
                              const imageContext = recentImageUrls.map((url, i) =>
                                `[Generated Image ${i + 1}]: ${url}`
                              ).join('\n');
                              task += `\n\nIMPORTANT: The following images were already generated and stored. Use these exact URLs in your HTML (as img src attributes) — do NOT create SVG placeholders:\n${imageContext}\nFor image:// protocol URLs, convert to /api/images/{id}.png format for the img src.`;
                            }
                            const role = a.role || 'custom';
                            // cloud_operations: force a high maxTurns floor so the LLM doesn't
                            // stop after a few turns mid-task. SUPERVISOR PATTERN: allow a
                            // top-level cloud_operations agent to spawn child cloud_operations
                            // workers ONE level deep (supervisor → workers → leaf). This is
                            // required for enterprise-scale audits that fan out across 100+
                            // subscriptions in parallel batches. The cap is enforced in
                            // openagentic-proxy AgentRunner via CLOUD_OPS_SUPERVISOR_MAX_DEPTH=1.
                            const isCloudOps = role === 'cloud_operations';
                            const maxTurns = isCloudOps
                              ? Math.max(a.maxTurns ?? 40, 30)
                              : a.maxTurns;
                            return {
                              role,
                              task,
                              tools: a.tools,
                              // Fall back to user's selected model when LLM doesn't specify one
                              model: a.model || context.request.model || undefined,
                              maxTurns,
                              workflow_id: a.workflow_id,
                              // Supervisor pattern for cloud_operations: spawn depth 0 can
                              // recurse once (to depth 1), depth 1 is a leaf. AgentRunner
                              // strips delegate_to_agents at depth 1 so the chain can't
                              // infinitely nest.
                              delegationAllowed: isCloudOps ? true : undefined,
                              maxSpawnDepth: isCloudOps ? 1 : undefined,
                            };
                          }),
                          orchestration: spec.orchestration || 'parallel',
                          aggregation: spec.aggregation || 'synthesize',
                          sessionId: context.request.sessionId,
                          userId: context.user.id,
                          userMessage: context.request.message,
                          // GAP-2 FIX: pass conversation history so sub-agents have full session context.
                          // Without this, the sub-agent only sees its `task` string and has no idea
                          // who the user is, what was discussed earlier, or what preferences were set.
                          // Limit to last 12 messages to keep payload reasonable but cover most context.
                          sessionMessages: (context.messages || [])
                            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
                            .slice(-12)
                            .map((m: any) => ({
                              role: m.role,
                              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                            })),
                          userDisplayName: context.user.displayName || context.user.name || context.user.email || 'User',
                          userEmail: context.user.email,
                          userToken: agentUserToken,
                          // GAP-#277: pass the user's Azure AD ID token (separate audience from
                          // accessToken) so sub-agents can hit Azure / AWS Identity Center MCP
                          // tools via OBO. Without this, sub-agent cloud calls fail with
                          // InvalidAuthenticationToken / "AWS OBO failed and no fallback creds".
                          userIdToken: (context.user as any).idToken,
                          authMethod: context.user.authMethod,
                          userGroups: context.user.groups || [],
                          isAdmin: context.user.isAdmin || false,
                          flowContext: (context.request as any).flowContext,
                        }, {
                          headers: {
                            'Content-Type': 'application/json',
                            'X-Openagentic-Proxy': 'true',
                            'Authorization': `Bearer ${process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || ''}`,
                          },
                          timeout: 900000, // 15 minutes for complex multi-agent + LRO operations
                        });
                      } finally {
                        clearInterval(agentHeartbeat);
                        await relay.cleanup();
                      }

                      const totalTimeMs = Date.now() - agentStartTime;

                      // Agent lifecycle events already delivered in real-time via Redis relay.
                      // Only emit fallback events if relay never connected (Redis down).
                      const agentResults = response.data?.results || [];
                      context.logger.info({
                        agentResultCount: agentResults.length,
                        responseKeys: Object.keys(response.data || {}),
                        totalTimeMs,
                      }, '[AGENT-TREE] Agent proxy response received');

                      // Include agent sub-results metadata so UI can render agent tree after streaming
                      const agentResultsSummary = agentResults.map((ar: any) => ({
                        agentId: ar.agentId || ar.id,
                        role: ar.role || 'custom',
                        status: ar.status || 'completed',
                        output: typeof ar.output === 'string' ? ar.output?.substring(0, 300) : JSON.stringify(ar.output)?.substring(0, 300),
                        metrics: ar.metrics ? {
                          durationMs: ar.metrics.durationMs,
                          modelUsed: ar.metrics.modelUsed,
                          inputTokens: ar.metrics.inputTokens,
                          outputTokens: ar.metrics.outputTokens,
                        } : undefined,
                      }));
                      // Extract agent HTML output and emit as artifact directly to SSE
                      // This bypasses the LLM round-trip which often dumps raw JSON instead of rendering artifacts
                      let agentOutput = response.data?.output || '';
                      let extractedHtml: string | null = null;
                      let artifactTitle = 'Agent Artifact';
                      if (agentOutput && typeof agentOutput === 'string') {
                        // Extract markdown images from agent output BEFORE any replacements
                        // These need to be emitted inline so users see generated images in chat
                        const imagePattern = /!\[([^\]]*)\]\((image:\/\/[^\s)]+|\/api\/images\/[^\s)]+)\)/g;
                        const inlineImages: string[] = [];
                        let imgMatch;
                        while ((imgMatch = imagePattern.exec(agentOutput)) !== null) {
                          inlineImages.push(imgMatch[0]);
                        }
                        if (inlineImages.length > 0) {
                          const imageMarkdown = '\n\n' + inlineImages.join('\n\n') + '\n\n';
                          context.emit('content_delta', { content: imageMarkdown });
                          context.logger.info({ imageCount: inlineImages.length }, '[ChatPipeline] Emitted inline images from agent output');
                        }

                        // Check if agent output contains an artifact:html code fence already
                        const artifactMatch = agentOutput.match(/```artifact:html\n([\s\S]*?)```/);
                        if (artifactMatch) {
                          // Extract the HTML from the code fence and emit directly
                          extractedHtml = artifactMatch[1].trim();
                          // Try to extract title from HTML <title> tag
                          const titleMatch = extractedHtml.match(/<title>([^<]+)<\/title>/i);
                          if (titleMatch) artifactTitle = titleMatch[1].trim();

                          // Collect ALL generated image URLs from agent results + context.artifacts
                          const generatedImageUrls: string[] = [];
                          // From context.artifacts (pipeline-level image generation)
                          for (const art of (context.artifacts || [])) {
                            if (art.type === 'image' && art.url && !art.url.startsWith('data:')) {
                              generatedImageUrls.push(art.url);
                            }
                          }
                          // From agent tool results (generate_image calls within openagentic-proxy)
                          for (const ar of agentResults) {
                            const output = ar.output || '';
                            const urlMatches = output.match(/\/api\/images\/[^\s"'<>]+\.png/g);
                            if (urlMatches) {
                              for (const url of urlMatches) {
                                if (!generatedImageUrls.includes(url)) generatedImageUrls.push(url);
                              }
                            }
                          }
                          // Also scan the raw agent output for image URLs
                          const rawOutputUrls = (response.data?.output || '').match(/\/api\/images\/[^\s"'<>]+\.png/g);
                          if (rawOutputUrls) {
                            for (const url of rawOutputUrls) {
                              if (!generatedImageUrls.includes(url)) generatedImageUrls.push(url);
                            }
                          }

                          if (generatedImageUrls.length > 0) {
                            // Strategy 1: Replace placeholder/SVG img src with real generated images
                            let imgIdx = 0;
                            extractedHtml = extractedHtml.replace(
                              /<img\s+([^>]*?)src=["']([^"']*?)["']/gi,
                              (match: string, before: string, src: string) => {
                                if (src.startsWith('/api/images/')) return match; // Already a real image
                                if (imgIdx < generatedImageUrls.length) {
                                  const realUrl = generatedImageUrls[imgIdx++];
                                  return `<img ${before}src="${realUrl}"`;
                                }
                                return match;
                              }
                            );

                            // Strategy 2: If no <img> tags exist but we have images, inject them after the first <h2> or <h1>
                            if (!extractedHtml.includes('<img') && generatedImageUrls.length > 0) {
                              const imgTags = generatedImageUrls.map((url, i) =>
                                `<div style="text-align:center;margin:2rem 0"><img src="${url}" alt="Generated illustration ${i+1}" style="max-width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)"></div>`
                              ).join('\n');
                              // Insert after first heading
                              const headingMatch = extractedHtml.match(/<\/h[12]>/i);
                              if (headingMatch) {
                                const idx = extractedHtml.indexOf(headingMatch[0]) + headingMatch[0].length;
                                extractedHtml = extractedHtml.slice(0, idx) + '\n' + imgTags + '\n' + extractedHtml.slice(idx);
                              }
                            }

                            context.logger.info({ imageCount: generatedImageUrls.length, urls: generatedImageUrls }, '[ARTIFACT-HTML] Injected generated image URLs into artifact');
                          }

                          agentOutput = agentOutput.replace(artifactMatch[0], '[HTML Dashboard artifact rendered above]');
                          context.emit('artifact_start', { type: 'html', title: artifactTitle });
                          context.emit('artifact_delta', { content: extractedHtml });
                          context.emit('artifact_end', {});
                        } else {
                          // Auto-detect HTML and wrap — Sonnet often outputs raw HTML without ```artifact:html fence
                          const lowerOutput = agentOutput.toLowerCase();
                          const hasFullHtml = lowerOutput.includes('<html') || lowerOutput.includes('<!doctype');
                          const hasChart = lowerOutput.includes('plotly') || lowerOutput.includes('d3.') || lowerOutput.includes('chart.js') || lowerOutput.includes('echarts');
                          // Broader detection: any substantial HTML structure (div+style, or multiple HTML tags)
                          const htmlTagCount = (agentOutput.match(/<\/?[a-z][a-z0-9]*[\s>]/gi) || []).length;
                          const hasSubstantialHtml = htmlTagCount >= 10 && (lowerOutput.includes('<div') || lowerOutput.includes('<section') || lowerOutput.includes('<table'));
                          const hasStyleBlock = lowerOutput.includes('<style') && lowerOutput.includes('</style>');
                          if (hasFullHtml || hasChart || hasSubstantialHtml || (hasStyleBlock && htmlTagCount >= 5)) {
                            extractedHtml = agentOutput;
                            // Try to extract title from HTML
                            const titleTag = agentOutput.match(/<title>([^<]+)<\/title>/i);
                            const h1Tag = agentOutput.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                            artifactTitle = titleTag?.[1]?.trim() || h1Tag?.[1]?.trim() || 'Agent Dashboard';

                            // Inject generated image URLs into the HTML
                            const generatedImageUrls: string[] = [];
                            for (const art of (context.artifacts || [])) {
                              if (art.type === 'image' && art.url && !art.url.startsWith('data:')) generatedImageUrls.push(art.url);
                            }
                            for (const ar of agentResults) {
                              const urlMatches = (ar.output || '').match(/\/api\/images\/[^\s"'<>]+\.png/g);
                              if (urlMatches) for (const url of urlMatches) if (!generatedImageUrls.includes(url)) generatedImageUrls.push(url);
                            }
                            const rawOutputUrls = (response.data?.output || '').match(/\/api\/images\/[^\s"'<>]+\.png/g);
                            if (rawOutputUrls) for (const url of rawOutputUrls) if (!generatedImageUrls.includes(url)) generatedImageUrls.push(url);

                            if (generatedImageUrls.length > 0) {
                              let imgIdx = 0;
                              extractedHtml = extractedHtml.replace(
                                /<img\s+([^>]*?)src=["']([^"']*?)["']/gi,
                                (match: string, before: string, src: string) => {
                                  if (src.startsWith('/api/images/')) return match;
                                  if (imgIdx < generatedImageUrls.length) return `<img ${before}src="${generatedImageUrls[imgIdx++]}"`;
                                  return match;
                                }
                              );
                              if (!extractedHtml.includes('<img') && generatedImageUrls.length > 0) {
                                const imgTags = generatedImageUrls.map((url, i) =>
                                  `<div style="text-align:center;margin:2rem 0"><img src="${url}" alt="Generated illustration ${i+1}" style="max-width:100%;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)"></div>`
                                ).join('\n');
                                const headingMatch = extractedHtml.match(/<\/h[12]>/i);
                                if (headingMatch) {
                                  const idx = extractedHtml.indexOf(headingMatch[0]) + headingMatch[0].length;
                                  extractedHtml = extractedHtml.slice(0, idx) + '\n' + imgTags + '\n' + extractedHtml.slice(idx);
                                }
                              }
                              context.logger.info({ imageCount: generatedImageUrls.length }, '[ARTIFACT-HTML] Injected images into auto-detected HTML artifact');
                            }

                            context.emit('artifact_start', { type: 'html', title: artifactTitle });
                            context.emit('artifact_delta', { content: extractedHtml });
                            context.emit('artifact_end', {});
                            agentOutput = `[HTML artifact "${artifactTitle}" rendered in panel]`;
                          }
                        }

                        // Store artifact in user's Milvus collection for RAG access
                        // and push into context.artifacts for cross-stage visibility
                        if (extractedHtml) {
                          const artId = `agent-artifact-${Date.now()}`;
                          context.artifacts.push({
                            id: artId,
                            type: 'html',
                            url: '', // Agent HTML artifacts are inline, not URL-based
                            title: artifactTitle,
                            mimeType: 'text/html',
                            createdBy: 'agent',
                            sessionId: context.request.sessionId,
                            metadata: { htmlLength: extractedHtml.length },
                          });
                          try {
                            const { ArtifactService } = await import('../../../services/ArtifactService.js');
                            const artifactService = new ArtifactService(context.logger);
                            const sessionId = context.request.sessionId || 'unknown';
                            await artifactService.uploadArtifact(context.user.id, {
                              file: Buffer.from(extractedHtml, 'utf-8'),
                              filename: `artifact-${Date.now()}.html`,
                              mimeType: 'text/html',
                              title: artifactTitle,
                              description: `Agent-generated HTML artifact in session ${sessionId}`,
                              tags: ['artifact', 'html', 'agent-generated', `session:${sessionId}`],
                            });
                            context.logger.info({ artifactTitle, sessionId, artifactCount: context.artifacts.length },
                              '[ARTIFACT-REGISTRY] Agent artifact stored in Milvus');
                          } catch (artifactStoreErr) {
                            context.logger.warn({ err: artifactStoreErr }, '[ARTIFACT-REGISTRY] Non-blocking: failed to store agent artifact in Milvus');
                          }
                        }
                      }
                      // Build a clean, human-readable result for the LLM's next turn.
                      // If an artifact was already emitted to SSE, don't dump raw JSON/HTML back
                      // into the conversation — the user already sees the rendered artifact.
                      let resultForLLM: string;
                      if (extractedHtml) {
                        // Artifact already rendered in the UI — give LLM a brief summary
                        resultForLLM = `Agent completed successfully. An HTML artifact titled "${artifactTitle}" has been rendered for the user. ` +
                          `Do NOT repeat the artifact content. Simply acknowledge it was created and ask if the user wants any changes.`;
                      } else {
                        // No artifact:html code fence — emit the full output as content for the user.
                        // Don't truncate — the user needs to see the complete result.
                        const output = agentOutput || response.data?.output || '';
                        // Emit the agent output directly to the SSE stream so user sees it immediately
                        if (output && typeof output === 'string' && output.length > 100) {
                          context.emit('content_delta', { content: output });
                          resultForLLM = 'Agent output has been delivered to the user. Do NOT repeat it. Simply acknowledge completion and ask if changes are needed.';
                        } else {
                          resultForLLM = output;
                        }
                      }
                      toolResults.push({
                        toolName: agentCall.function.name,
                        toolCallId: agentCall.id,
                        result: resultForLLM,
                      });

                      // Emit completion events for the agent execution
                      context.emit('tool_progress', {
                        toolCallId: agentCall.id,
                        name: 'delegate_to_agents',
                        elapsed: Math.round(totalTimeMs / 1000),
                        status: 'completed',
                        message: `Agents completed (${Math.round(totalTimeMs / 1000)}s)`,
                        timestamp: new Date().toISOString()
                      });
                      // Emit tool_end to mark the orchestration block as complete in UI
                      context.emit('tool_end', {
                        toolCallId: agentCall.id,
                        name: 'delegate_to_agents',
                        status: 'completed',
                        duration: totalTimeMs,
                        result: resultForLLM.substring(0, 500),
                        timestamp: new Date().toISOString()
                      });
                      // Emit orchestration_complete so frontend clears all orchestrator spinners
                      context.emit('orchestration_complete', {
                        executionId: response.data?.executionId,
                        status: 'completed',
                        agentCount: (spec.agents || []).length,
                        totalTimeMs,
                        timestamp: new Date().toISOString()
                      });

                      continue;
                    } catch (proxyErr: any) {
                      this.logger.warn({ error: proxyErr.message }, 'Openagentic-proxy unavailable, falling back to inline');
                    }
                  }

                  // Fallback: inline AgentSpawnManager (original behavior)
                  const providerManager = this.services?.completion;
                  if (providerManager?.createCompletion) {
                    const spawnManager = new AgentSpawnManager(providerManager, this.logger);
                    const agentConfigs: SubAgentConfig[] = (spec.agents || []).map((a: any) => ({
                      role: a.role || 'custom',
                      task: a.task || '',
                      tools: a.tools,
                      model: a.model,
                      systemPrompt: a.system_prompt,
                      maxTurns: a.max_turns,
                    }));

                    if (agentConfigs.length > 0) {
                      // Strip delegate_to_agents from sub-agent tools to prevent nested delegation loops
                      const subAgentTools = (context.availableTools || []).filter(
                        (t: any) => t.function?.name !== 'delegate_to_agents' && t.function?.name !== 'spawn_parallel_agents'
                      );
                      const results = await spawnManager.spawnAgents(agentConfigs,
                        (event: string, data: any) => context.emit(event, data),
                        {
                          maxConcurrency: 5,
                          aggregationStrategy: (spec.aggregation as any) || 'merge',
                          userToken: context.user.accessToken,
                          idToken: (context.user as any).idToken,
                          userId: context.user.id,
                          sessionId: context.request.sessionId,
                          messageId: context.messageId,
                          userGroups: context.user.groups || [],
                          isAdmin: context.user.isAdmin || false,
                          userName: context.user.displayName || context.user.name,
                          userEmail: context.user.email,
                          availableTools: subAgentTools,
                          authMethod: context.user.authMethod,
                        }
                      );

                      toolResults.push({
                        toolName: agentCall.function.name,
                        toolCallId: agentCall.id,
                        result: AgentSpawnManager.formatResults(results, spec.aggregation || 'merge'),
                        error: results.every(r => r.status === 'error') ? 'All agents failed' : undefined,
                      });

                      // Emit orchestration_complete for inline fallback path too
                      context.emit('orchestration_complete', {
                        status: results.every(r => r.status === 'error') ? 'failed' : 'completed',
                        agentCount: results.length,
                        timestamp: new Date().toISOString()
                      });
                    }
                  }
                }
              }

              // After any delegation (successful or already-done), remove delegate_to_agents from tools
              // to prevent the model from trying to call it again
              if ((context as any)._agentDelegationDone && context.availableTools) {
                context.availableTools = context.availableTools.filter(
                  (t: any) => t.function?.name !== 'delegate_to_agents' && t.function?.name !== 'spawn_parallel_agents'
                );
              }

              if (agentCalls.length > 0 && (context as any)._agentDelegationDone && toolResults.length === 0) {
                // Edge case: delegation flag was set but no results added above (shouldn't happen)
                for (const agentCall of agentCalls) {
                  toolResults.push({
                    toolName: agentCall.function.name,
                    toolCallId: agentCall.id,
                    result: 'Agent delegation already completed this turn. Use the results already received to answer the user.',
                  });
                }
              }

              // Handle regular MCP tool calls (if any)
              if (regularToolCalls.length > 0) {
                const toolExecutionResult = await executeToolCalls(
                  regularToolCalls,
                  this.logger,
                  context.availableTools,
                  context.user.accessToken,
                  (context.user as any).idToken,
                  context.user.id,
                  context.request.sessionId,
                  context.messageId,
                  undefined, undefined,
                  (event: string, data: any) => context.emit(event, data),
                  context.request.message,
                  context.user.groups || [],
                  context.user.isAdmin || false,
                  context.config.model || context.request.model,
                  context.config.provider,
                  context.user.displayName || context.user.name,
                  context.user.email,
                  context.codeExecutionContext,
                  context.user.authMethod
                );
                toolResults = [...toolResults, ...toolExecutionResult.results];
                if (toolExecutionResult.codeExecutionContext) {
                  updatedCodeContext = toolExecutionResult.codeExecutionContext;
                }
              } else if (agentCalls.length === 0) {
                // Fallback: all tool calls go to MCP if no spawn calls detected
                const toolExecutionResult = await executeToolCalls(
                  context.request.toolCalls,
                  this.logger,
                  context.availableTools,
                  context.user.accessToken,
                  (context.user as any).idToken,
                  context.user.id,
                  context.request.sessionId,
                  context.messageId,
                  undefined, undefined,
                  (event: string, data: any) => context.emit(event, data),
                  context.request.message,
                  context.user.groups || [],
                  context.user.isAdmin || false,
                  context.config.model || context.request.model,
                  context.config.provider,
                  context.user.displayName || context.user.name,
                  context.user.email,
                  context.codeExecutionContext,
                  context.user.authMethod
                );
                toolResults = toolExecutionResult.results;
                if (toolExecutionResult.codeExecutionContext) {
                  updatedCodeContext = toolExecutionResult.codeExecutionContext;
                }
              }

              // Update code execution context
              if (updatedCodeContext) {
                context.codeExecutionContext = updatedCodeContext;
              }

              const toolExecutionTime = Date.now() - toolExecutionStart;

              // CRITICAL: Emit tool execution complete event
              context.emit('tool_execution_complete', {
                toolCallRound,
                toolCount: toolResults.length,
                executionTimeMs: toolExecutionTime,
                successCount: toolResults.filter(r => !r.error).length,
                errorCount: toolResults.filter(r => r.error).length,
                timestamp: new Date().toISOString()
              });
              metrics.stageTimings[`tool-execution-${toolCallRound}`] = toolExecutionTime;

              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                executionTime: toolExecutionTime,
                resultsCount: toolResults.length,
                successCount: toolResults.filter(r => !r.error).length,
                errorCount: toolResults.filter(r => r.error).length
              }, `Tool call round ${toolCallRound}: Tool execution completed`);

              // ── Capture pipeline artifacts from tool results ──────────────
              for (const tr of toolResults) {
                if (tr.toolName === 'generate_image' && !tr.error && tr.result?.imageUrl) {
                  context.artifacts.push({
                    id: tr.result.imageId || `img-${Date.now()}`,
                    type: 'image',
                    url: tr.result.imageUrl,
                    title: tr.result.revisedPrompt || 'Generated image',
                    mimeType: 'image/png',
                    createdBy: 'image-gen',
                    sessionId: context.request.sessionId,
                    metadata: {
                      provider: tr.result.provider,
                      model: tr.result.model,
                      prompt: (tr as any).args?.prompt,
                    },
                  });
                  this.logger.info({ imageUrl: tr.result.imageUrl, artifactCount: context.artifacts.length },
                    '[ARTIFACT-REGISTRY] Image artifact captured');
                }
              }

              // Convert tool results to messages and add to conversation
              const toolMessages = formatToolResultsAsMessages(toolResults);

              // OPTIMIZATION: Store large results to prevent context bloat
              const resultStorageService = (context as any).resultStorageService;

              // Add tool messages to context (with large result interception)
              for (let i = 0; i < toolMessages.length; i++) {
                const toolMessage = toolMessages[i];
                const toolResult = toolResults[i];

                // =================================================================
                // DATA LAYER INTEGRATION: processedResult > raw result
                // =================================================================
                // formatToolResultsAsMessages now uses processedResult when available:
                // - DataLayerService stores >16KB results in Redis, returns dataset reference
                // - LLM sees "Dataset stored (ID: data_xxx)" instead of 100K+ raw chars
                // - LLM can use query_data tool to drill into stored datasets
                // - Prevents 210K+ token context overflow that was crashing requests
                const messageContent = toolMessage.content;

                // Log large results for monitoring (strip base64 to prevent log bloat)
                if (!toolResult.error && toolResult.result) {
                  let resultForSize = toolResult.result;
                  if (typeof resultForSize === 'object' && resultForSize !== null) {
                    const { imageBase64, imageData, ...safeResult } = resultForSize as any;
                    resultForSize = safeResult;
                  }
                  const resultStr = typeof resultForSize === 'string' ? resultForSize : JSON.stringify(resultForSize);
                  const sizeBytes = Buffer.byteLength(resultStr, 'utf8');
                  const estimatedTokens = Math.ceil(sizeBytes / 4);
                  const hasProcessedResult = !!(toolResult as any).processedResult;

                  if (sizeBytes > 50 * 1024) { // 50KB
                    this.logger.info({
                      toolName: toolResult.toolName,
                      rawSizeBytes: sizeBytes,
                      rawEstimatedTokens: estimatedTokens,
                      contextSizeBytes: Buffer.byteLength(messageContent, 'utf8'),
                      usedProcessedResult: hasProcessedResult,
                      action: hasProcessedResult ? 'PROCESSED_RESULT_TO_LLM' : 'RAW_RESULT_TO_LLM'
                    }, hasProcessedResult
                      ? '📊 Large tool result - using data layer reference (context optimized)'
                      : '⚠️ Large tool result - no processedResult available, sending raw');
                  }
                }

                context.messages.push({
                  id: `tool_${toolMessage.tool_call_id}`,
                  role: 'tool',
                  content: messageContent,
                  toolCallId: toolMessage.tool_call_id,
                  timestamp: new Date(),
                  tokenUsage: null
                });
              }

              // OPTIMIZATION: Flag that we have new tool messages, so message-prep re-runs
              (context as any).hasNewToolMessages = true;

              // DATABASE-FIRST: Save tool messages to PostgreSQL IMMEDIATELY after execution
              // This ensures correct message order for follow-up questions
              const chatStorage = (context as any).chatStorage;
              const sessionId = (context as any).sessionId || context.session?.id;

              if (chatStorage && sessionId && toolMessages.length > 0) {
                this.logger.info('┌─────────────────────────────────────────────────────────────');
                this.logger.info('│ [DB-FIRST] 💾 Saving tool messages to PostgreSQL IMMEDIATELY');
                this.logger.info('└─────────────────────────────────────────────────────────────');

                try {
                  const saveStartTime = Date.now();

                  for (const toolMessage of toolMessages) {
                    const toolMessageData = {
                      role: 'tool' as const,
                      content: toolMessage.content,
                      toolCallId: toolMessage.tool_call_id,
                      timestamp: new Date(),
                      userId: context.user.id
                    };

                    const savedMessage = await chatStorage.addMessage(sessionId, toolMessageData);

                    this.logger.info({
                      messageId: savedMessage.id,
                      toolCallId: toolMessage.tool_call_id,
                      contentLength: toolMessage.content?.length || 0
                    }, `│ [SAVE] ✅ Message saved (tool) - ${savedMessage.id}`);

                    // Mark as saved in context to prevent duplicate saving in response stage
                    const contextMessage = context.messages.find(m => m.id === `tool_${toolMessage.tool_call_id}`);
                    if (contextMessage) {
                      contextMessage.id = savedMessage.id; // Use DB ID
                      contextMessage.metadata = { savedToDb: true };
                    }

                    // Emit to frontend
                    context.emit('message_saved', {
                      messageId: savedMessage.id,
                      role: 'tool',
                      content: toolMessage.content,
                      toolCallId: toolMessage.tool_call_id,
                      timestamp: new Date().toISOString(),
                      source: 'database',
                      confirmed: true
                    });
                  }

                  const saveTime = Date.now() - saveStartTime;

                  this.logger.info({
                    toolMessagesCount: toolMessages.length,
                    saveTimeMs: saveTime,
                    performance: saveTime < 100 ? '🚀 FAST' : saveTime < 500 ? '✅ OK' : '⚠️  SLOW'
                  }, '│ [DB-FIRST] ✅ All tool messages saved to PostgreSQL');

                } catch (error) {
                  this.logger.error({
                    error: error.message,
                    errorStack: error.stack,
                    sessionId,
                    userId: context.user.id,
                    toolMessagesCount: toolMessages.length
                  }, '│ [DB-FIRST] ❌ ERROR: Failed to save tool messages');
                  // Don't throw - tool messages are still in context for this request
                }
              }

              // Update MCP calls count in context
              const newMcpCalls = toolResults.map((r, index) => {
                // Parse arguments if string
                let parsedArgs;
                const argsString = context.request.toolCalls![index]?.function?.arguments || '{}';
                try {
                  parsedArgs = typeof argsString === 'string' ? JSON.parse(argsString) : argsString;
                } catch (e) {
                  parsedArgs = argsString;
                }

                return {
                  id: r.toolCallId,
                  name: r.toolName,
                  tool: r.toolName,
                  toolName: r.toolName,
                  serverId: r.serverName || 'mcp-proxy',  // Dynamic MCP server name (admin, fetch, azure_mcp, etc.)
                  serverName: r.serverName || 'MCP Proxy',  // Display name for the MCP server
                  executedOn: r.executedOn,  // K8s pod/container hostname for traceability
                  arguments: parsedArgs,
                  result: r.result, // Direct result data, not wrapped
                  error: r.error,
                  status: r.error ? 'failed' : 'completed',
                  startTime: Date.now() - toolExecutionTime,
                  endTime: Date.now(),
                  duration: toolExecutionTime,
                  timestamp: new Date()
                };
              });

              context.mcpCalls.push(...newMcpCalls);

              // Emit MCP calls to frontend for display
              context.emit('mcp_calls_data', {
                calls: newMcpCalls,
                totalCalls: context.mcpCalls.length,
                round: toolCallRound
              });

              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                messageCount: context.messages.length,
                toolMessagesAdded: toolMessages.length,
                mcpCallsCount: context.mcpCalls.length,
                emittedMcpCalls: newMcpCalls.length,
                lastThreeMessages: context.messages.slice(-3).map(m => ({
                  role: m.role,
                  hasContent: !!m.content,
                  hasToolCalls: !!m.toolCalls,
                  hasToolCallId: !!m.toolCallId,
                  toolCallId: m.toolCallId
                }))
              }, `Tool call round ${toolCallRound}: Tool results added to conversation and emitted to frontend`);

            } catch (error: any) {
              this.logger.error({
                messageId: context.messageId,
                toolCallRound,
                error: error.message,
                stack: error.stack
              }, `Tool call round ${toolCallRound}: Tool execution failed`);

              // Add error message to conversation
              context.messages.push({
                id: `tool_error_${toolCallRound}`,
                role: 'system',
                content: `Tool execution failed: ${error.message}`,
                timestamp: new Date(),
                tokenUsage: null
              });
            }

            // Clear tool calls before re-running completion
            context.request.toolCalls = undefined;

            // ── PHASE 1: System feedback on tool results ────────────────
            // Give the model explicit awareness of what happened — errors,
            // empty results, duplicate calls — so it can self-correct.
            // Uses mcpCalls (always available) instead of toolResults (scoped to try block).
            if (toolCallRound > 0) {
              const roundCalls = (context.mcpCalls || []).slice(-20); // Last round's calls
              const feedback = this.buildToolRoundFeedbackFromMcp(roundCalls, context, toolCallRound);
              if (feedback) {
                context.messages.push({
                  id: `system_feedback_${toolCallRound}`,
                  role: 'system',
                  content: feedback,
                  timestamp: new Date(),
                  tokenUsage: null,
                });
                this.logger.info({ toolCallRound, feedbackLength: feedback.length },
                  '[SELF-CORRECT] Injected system feedback for tool round');
              }
            }

            // ── LAYER 2: Progress tracking ──────────────────────────────
            // Summarize what has been accomplished and what gaps remain.
            // Pure heuristics — zero LLM calls.
            const { ToolProgressTracker } = await import('./tool-progress-tracker.js');
            const progressSummary = ToolProgressTracker.summarize(
              context.mcpCalls || [],
              context.request?.message || '',
              toolCallRound,
            );
            const progressText = ToolProgressTracker.formatForInjection(progressSummary);

            context.emit('react_progress', {
              round: toolCallRound,
              totalCalls: progressSummary.totalToolCalls,
              succeeded: progressSummary.successfulCalls,
              failed: progressSummary.failedCalls,
              gathered: progressSummary.dataGathered,
              remaining: progressSummary.remainingGaps,
            });

            // CONTINUATION PROMPT: ReAct-framed from composable module system.
            // Template loaded from DB (continuation-react module), interpolated with
            // dynamic progress data. Admins can tune the template via admin console.
            if (toolCallRound < maxToolCallRounds) {
              const currentModel = (context.request.model || context.config.model || '').toLowerCase();
              const isOllamaModel = currentModel.includes('gpt-oss') || currentModel.includes('qwen') ||
                currentModel.includes('llama') || currentModel.includes('deepseek') || currentModel.includes('phi');

              // Load continuation template from composable module system (cached in-mem + Redis)
              const { PromptModuleRegistry } = await import('../../../services/prompt/PromptModuleRegistry.js');
              const registry = PromptModuleRegistry.getInstance();
              const continuationModule = await registry.getByName('continuation-react');
              const continuationTemplate = isOllamaModel
                ? (continuationModule?.variants?.local || continuationModule?.content || 'Review the tool results above. Continue if incomplete.')
                : (continuationModule?.content || 'Review the tool results above. Continue if incomplete.');

              // Build progress-aware continuation for Ollama (appends tool-specific tracking)
              let ollamaExtra = '';
              if (isOllamaModel) {
                const calledTools = (context.mcpCalls || []).map((c: any) => c.name || c.toolName || '');
                const hasAzureCost = calledTools.some((t: string) => t.includes('azure_cost'));
                const hasAwsCost = calledTools.some((t: string) => t.includes('aws_cost'));
                const hasGcpCost = calledTools.some((t: string) => t.includes('gcp_') && t.includes('cost'));
                const userMsg = context.request?.message?.toLowerCase() || '';
                const wantsAzure = userMsg.includes('azure');
                const wantsAws = userMsg.includes('aws');
                const wantsGcp = userMsg.includes('gcp');

                const missing: string[] = [];
                if (wantsAzure && !hasAzureCost) missing.push('azure_cost_by_service for Azure costs');
                if (wantsAws && !hasAwsCost) missing.push('aws_cost_by_service for AWS costs');
                if (wantsGcp && !hasGcpCost) missing.push('gcp_query_cost_usage for GCP costs');

                if (missing.length > 0) {
                  ollamaExtra = ` You still need to call: ${missing.join(', ')}. Call the next missing tool NOW.`;
                } else {
                  ollamaExtra = ' All requested data has been collected. Provide your FINAL response now. IMPORTANT: First write a brief text summary of the key findings (costs, totals, notable items). Then include the visualization as an artifact:html block. Always include both text AND artifact.';
                }
                ollamaExtra += ' Do NOT ask the user for IDs or subscriptions — the tools discover them automatically.';
              }

              context.messages.push({
                id: `continuation_prompt_${toolCallRound}`,
                role: isOllamaModel ? 'user' : 'system',
                content: progressText + '\n\n' + continuationTemplate + ollamaExtra,
                timestamp: new Date(),
                tokenUsage: null
              });
            }

            // CONTEXT MANAGEMENT: Compact context after round 10 to prevent
            // context window exhaustion during long provisioning chains (20-40 rounds).
            if (toolCallRound > 10) {
              try {
                const { ContextManagerService } = await import('../../../services/context/ContextManagerService.js');
                const contextMgr = ContextManagerService.getInstance();
                const model = context.request.model || context.config.model || '';
                const toolTokens = (context.availableTools || []).reduce((sum: number, t: any) =>
                  sum + contextMgr.getTokenCounter().countToolDefinition(t), 0);

                const sessionId = (context as any).sessionId || context.session?.id || '';
                const compacted = await contextMgr.compact(
                  context.messages, sessionId, model, 'chat', toolTokens,
                  (context as any).structuredSummary,
                );
                context.messages = compacted.messages;
                if (compacted.summary) (context as any).structuredSummary = compacted.summary;

                this.logger.info({
                  messageId: context.messageId,
                  toolCallRound,
                  droppedCount: compacted.droppedCount,
                  tokensFreed: compacted.tokensFreed,
                }, '[CONTEXT-MGR] Compacted context during tool call loop');
              } catch (err: any) {
                this.logger.warn({ error: err.message, toolCallRound }, '[CONTEXT-MGR] Fallback to simple truncation');
                // Keep existing truncation as fallback
                const toolMsgIndices = context.messages
                  .map((m: any, idx: number) => m.role === 'tool' ? idx : -1)
                  .filter((idx: number) => idx >= 0);
                const olderToolIndices = toolMsgIndices.slice(0, Math.max(0, toolMsgIndices.length - 10));
                for (const idx of olderToolIndices) {
                  const msg = context.messages[idx];
                  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                  if (content.length > 2000) {
                    context.messages[idx] = { ...msg, content: content.substring(0, 2000) + '\n[...truncated for context management]' };
                  }
                }
              }
            }

            // IMPORTANT: Do NOT set forceFinalCompletion here!
            // Let the AI decide if it needs more tools or wants to provide a final answer
            // Only force final completion when we hit max rounds (see below)

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              contextMessagesCount: context.messages.length,
              allowMoreTools: true
            }, 'Re-running completion with tools available - AI can call more tools if needed');

            // CRITICAL: Emit event that we're re-running completion
            // This keeps the SSE stream alive and informs frontend
            context.emit('completion_restart', {
              toolCallRound,
              reason: 'processing_tool_results',
              timestamp: new Date().toISOString()
            });

            // Re-run completion stage to get AI response to tool results
            // CRITICAL: Run MESSAGE-PREP first to build message array with tool results!
            // Never suppress streaming on the first tool response to maintain UX
            const originalSuppressStreaming = context.config.suppressStreaming;
            context.config.suppressStreaming = false; // Allow streaming for better UX

            // CRITICAL: Ensure availableTools persists for continuation requests
            // The MCP stage populated this, but we need to preserve it for multi-round tool calls
            const availableToolsCount = context.availableTools?.length || 0;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              suppressStreaming: context.config.suppressStreaming,
              hasStreamCallback: typeof context.emit === 'function',
              availableToolsCount,
              hasAvailableTools: availableToolsCount > 0
            }, '🔵 [MCP-STREAM-DEBUG] About to execute completion after tool results');

            // CRITICAL FIX: If availableTools got cleared, restore from saved copy
            // This happens when tiered FC strips tools, Gemini schema reduction, or other mutations
            if (availableToolsCount === 0 && savedAvailableTools.length > 0) {
              context.availableTools = [...savedAvailableTools];
              this.logger.warn({
                messageId: context.messageId,
                toolCallRound,
                restoredToolCount: savedAvailableTools.length
              }, '🔧 [TOOL-CONTINUATION] Restored availableTools from saved copy — tools were cleared during loop');
            }

            const completionStartTime = Date.now();

            // CRITICAL FIX: Run MESSAGE-PREP before completion to include tool results in context
            const messagePrepStage = this.stages.find(s => s.name === 'message-preparation');
            if (messagePrepStage) {
              context = await messagePrepStage.execute(context);
              // OPTIMIZATION: Clear the flag after message-prep processes the new tool messages
              (context as any).hasNewToolMessages = false;

              // ═══════════════════════════════════════════════════════════════════════════
              // SYNTHESIS READINESS CHECK: Ensure we have valid prepared messages
              // If message-prep stripped all messages, synthesis will fail silently
              // ═══════════════════════════════════════════════════════════════════════════
              const toolMessagesInContext = context.messages.filter((m: any) => m.role === 'tool').length;
              const toolMessagesInPrepared = context.preparedMessages?.filter((m: any) => m.role === 'tool').length || 0;
              const assistantWithToolsInPrepared = context.preparedMessages?.filter(
                (m: any) => m.role === 'assistant' && m.tool_calls?.length > 0
              ).length || 0;
              
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
                preparedMessagesCount: context.preparedMessages?.length || 0,
                toolMessagesInContext,
                toolMessagesInPrepared,
                assistantWithToolsInPrepared
              }, 'MESSAGE-PREP ran before synthesis completion - tool results included');
              
              // Warn if tool messages were stripped
              if (toolMessagesInContext > 0 && toolMessagesInPrepared === 0) {
                this.logger.error({
                  messageId: context.messageId,
                  toolCallRound,
                  toolMessagesInContext,
                  toolMessagesInPrepared,
                  preparedMessageRoles: context.preparedMessages?.map((m: any) => m.role)
                }, '🔴 [SYNTHESIS-ERROR] Tool messages were stripped from prepared messages - synthesis will fail!');
              }
            }

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              stageName: stage.name
            }, '🔵 [MCP-STREAM-DEBUG] Executing completion stage now...');

            context = await stage.execute(context);
            const completionTime = Date.now() - completionStartTime;
            metrics.stageTimings[`completion-followup-${toolCallRound}`] = completionTime;

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              completionTimeMs: completionTime
            }, '🔵 [MCP-STREAM-DEBUG] Completion stage finished');

            // Restore original streaming setting
            context.config.suppressStreaming = originalSuppressStreaming;

            // AUTO-DELEGATION: gpt-oss outputs delegation JSON as text instead of calling delegate_to_agents.
            // Detect {"agents":[...]} in the response and inject it as a tool call so the orchestrator runs.
            if (!context.request.toolCalls || context.request.toolCalls.length === 0) {
              const lastAssistant = [...context.messages].reverse().find(m => m.role === 'assistant' && m.content);
              const assistantContent = typeof lastAssistant?.content === 'string' ? lastAssistant.content : '';
              const delegationMatch = assistantContent.match(/\{"agents"\s*:\s*\[[\s\S]*?"orchestration"\s*:\s*"[^"]+"\s*\}/);
              if (delegationMatch) {
                try {
                  const parsed = JSON.parse(delegationMatch[0]);
                  if (Array.isArray(parsed.agents) && parsed.agents.length > 0) {
                    this.logger.info({
                      messageId: context.messageId,
                      agentCount: parsed.agents.length,
                      orchestration: parsed.orchestration,
                    }, '[AUTO-DELEGATION] Detected delegation JSON in gpt-oss text output — converting to tool call');

                    context.request.toolCalls = [{
                      id: `auto_delegate_${Date.now()}`,
                      type: 'function',
                      function: {
                        name: 'delegate_to_agents',
                        arguments: JSON.stringify(parsed),
                      }
                    }];
                  }
                } catch { /* invalid JSON, ignore */ }
              }
            }

            this.logger.info({
              messageId: context.messageId,
              toolCallRound,
              hasNewToolCalls: !!(context.request.toolCalls),
              newToolCallsLength: context.request.toolCalls?.length || 0
            }, `Tool call round ${toolCallRound} completed`);
          }
          
          if (toolCallRound >= maxToolCallRounds) {
            const currentModel = (context.request.model || context.config.model || '').toLowerCase();
            const isOllamaMaxRounds = currentModel.includes('gpt-oss') || currentModel.includes('qwen') ||
              currentModel.includes('llama') || currentModel.includes('deepseek');

            this.logger.warn({
              messageId: context.messageId,
              maxRounds: maxToolCallRounds,
              isOllamaModel: isOllamaMaxRounds,
            }, 'Maximum tool call rounds reached, forcing final response');

            // For Ollama models: DON'T force a final completion — it produces empty responses.
            // The finalizeResponse fallback will dump tool results as the response.
            // The user sees the tool data and can ask a followup to get the visualization.
            if (isOllamaMaxRounds) {
              this.logger.info({
                messageId: context.messageId,
                toolCallRound,
              }, '[OLLAMA] Skipping forced final completion — Ollama models return empty on synthesis. Using tool result fallback.');
              break; // Exit the tool call loop — finalizeResponse handles the output
            }

            // Cloud models: Force a final completion to get a synthesized response
            const completionStage = this.stages.find(s => s.name === 'completion' || s.name === 'multi-model-orchestration');
            if (completionStage) {
              // Clear tool calls to prevent more rounds
              context.request.toolCalls = undefined;

              // Set flag to indicate forced final completion (no tools should be included)
              context.forceFinalCompletion = true;

              // Trim context to reduce token count for synthesis —
              // keep original user message + last 3 tool results only
              const userMessages = context.messages.filter(m => m.role === 'user');
              const toolMessages = context.messages.filter(m => m.role === 'tool');
              const systemMessages = context.messages.filter(m => m.role === 'system');
              const lastToolResults = toolMessages.slice(-3);

              // Rebuild messages: system + user + last few tool results + synthesis instruction
              context.messages = [
                ...systemMessages,
                ...userMessages.slice(-1),
                ...lastToolResults,
              ];

              const toolsExecuted = context.mcpCalls?.length || 0;
              const currentModel = (context.request.model || context.config.model || '').toLowerCase();
              const isOllamaForSynthesis = currentModel.includes('gpt-oss') || currentModel.includes('qwen') ||
                currentModel.includes('llama') || currentModel.includes('deepseek');
              const synthesisInstruction = {
                id: `system_synthesis_${context.messageId}`,
                role: isOllamaForSynthesis ? 'user' as const : 'system' as const,
                content: isOllamaForSynthesis
                  ? '[System instruction] You have finished calling tools. DO NOT call any more tools. Using the data above, provide a complete answer to the user\'s original question. If they asked for a chart, diagram, or visualization, create an artifact code block (```artifact:html or ```artifact:react) with the interactive visualization using the real data from the tool results.'
                  : `Provide your final answer now. Summarize the tool results concisely and answer the user's question.`,
                timestamp: new Date(),
                tokenUsage: null
              };
              context.messages.push(synthesisInstruction);

              // For Ollama models: DON'T strip tools on forced synthesis.
              // gpt-oss hallucinates tool calls when tools are stripped, producing empty content.
              // Instead keep tools available but the strong instruction above tells it to stop.
              if (isOllamaForSynthesis) {
                context.forceFinalCompletion = false;
              }

              this.logger.info({
                messageId: context.messageId,
                toolsExecuted,
                trimmedMessages: context.messages.length,
                synthesisInstructionAdded: true
              }, 'Forcing final completion after max tool rounds - context trimmed for synthesis');

              const finalCompletionStart = Date.now();
              context = await completionStage.execute(context);
              metrics.stageTimings['completion-final-forced'] = Date.now() - finalCompletionStart;
            }
          }

          // ═══════════════════════════════════════════════════════════════════════════
          // SAFETY CHECK: Ensure a response is ALWAYS generated when tools were executed
          // BUG FIX: If MCP tools executed but no synthesis response was generated,
          // we must emit a fallback response so the user sees SOMETHING.
          // ═══════════════════════════════════════════════════════════════════════════
          if (context.mcpCalls && context.mcpCalls.length > 0) {
            // Check if we have a SYNTHESIS assistant message (content without tool calls)
            // The initial assistant message with tool_calls may have thinking content,
            // so we must exclude it — we're looking for the post-tool synthesis response
            const synthesisMessages = context.messages.filter(
              m => m.role === 'assistant' && m.content && m.content.trim().length > 0
                && (!m.toolCalls || m.toolCalls.length === 0)
            );
            const hasToolCalls = context.messages.some(
              m => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0
            );
            const toolsExecuted = context.mcpCalls.length;

            // Check if the synthesis response is meaningful (not just thinking/empty)
            const hasVisibleSynthesis = synthesisMessages.some(m => {
              const text = typeof m.content === 'string' ? m.content : '';
              // Strip thinking tags and check for actual visible content
              const visible = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
              return visible.length > 20; // More than a few words of real content
            });

            // If we have tool calls but no VISIBLE synthesis response, emit fallback with actual results
            if (hasToolCalls && !hasVisibleSynthesis) {
              this.logger.warn({
                messageId: context.messageId,
                toolsExecuted,
                mcpCalls: context.mcpCalls.map((c: any) => c.name)
              }, '⚠️ [SYNTHESIS-FIX] Tools executed but no synthesis response - generating fallback from tool results');

              // Build a real summary from tool results instead of a generic error
              const resultSections: string[] = [];
              for (const call of context.mcpCalls) {
                const c = call as any;
                const name = c.name || c.toolName;
                if (c.error) {
                  resultSections.push(`**${name}:** Error — ${c.error}`);
                } else if (c.result) {
                  // Extract meaningful content from the result
                  let resultText: string;
                  if (typeof c.result === 'string') {
                    resultText = c.result;
                  } else if (c.result.content) {
                    // MCP standard: result.content is an array of {type, text} blocks
                    const parts = Array.isArray(c.result.content)
                      ? c.result.content.map((p: any) => p.text || JSON.stringify(p)).join('\n')
                      : typeof c.result.content === 'string' ? c.result.content : JSON.stringify(c.result.content);
                    resultText = parts;
                  } else if (c.result.data) {
                    resultText = typeof c.result.data === 'string' ? c.result.data : JSON.stringify(c.result.data, null, 2);
                  } else {
                    resultText = JSON.stringify(c.result, null, 2);
                  }
                  // Truncate very long results
                  if (resultText.length > 3000) {
                    resultText = resultText.substring(0, 3000) + '\n...(truncated)';
                  }
                  resultSections.push(`**${name}:**\n${resultText}`);
                } else {
                  resultSections.push(`**${name}:** (no result data)`);
                }
              }

              const fallbackContent = `Here are the results from ${toolsExecuted} tool${toolsExecuted > 1 ? 's' : ''} I executed:\n\n${resultSections.join('\n\n')}`;

              // Emit the fallback response via SSE
              context.emit('stream', { content: fallbackContent, delta: false });
              context.emit('completion_complete', {
                content: fallbackContent,
                messageId: `fallback_${context.messageId}`,
                toolCalls: [],
                model: context.config.model,
                timestamp: Date.now(),
                fallback: true
              });

              this.logger.info({
                messageId: context.messageId,
                toolsExecuted,
                fallbackLength: fallbackContent.length
              }, '✅ [SYNTHESIS-FIX] Fallback response emitted');
            }
          }
        }
        
        const stageTime = Date.now() - stageStartTime;
        metrics.stageTimings[stage.name] = stageTime;

        this.emit('stage:complete', { 
          stage: stage.name, 
          context, 
          executionTime: stageTime 
        });

      } catch (error) {
        const stageTime = Date.now() - stageStartTime;
        metrics.stageTimings[stage.name] = stageTime;
        metrics.errors++;

        // Extract stack trace for better error location
        const stackLines = error.stack?.split('\n') || [];
        const relevantStack = stackLines.slice(0, 5).join('\n');
        const errorLocation = this.extractErrorLocation(error);

        this.logger.error({
          messageId: context.messageId,
          stage: stage.name,
          error: error instanceof Error ? error.message : String(error),
          errorType: error.constructor?.name || 'unknown',
          errorCode: error.code,
          errorLocation,
          errorStack: relevantStack,
          fullStack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          executionTime: stageTime,
          userId: context.user.id,
          sessionId: context.request.sessionId,
          stageFile: `${stage.constructor.name}.ts`,
          failedAt: `ChatPipeline.ts:${new Error().stack?.split('\n')[2]?.match(/:([0-9]+):([0-9]+)/)?.[1] || 'unknown'}`,
          requestDetails: {
            messageLength: context.request.message?.length || 0,
            hasMessages: !!(context.messages?.length),
            hasToolCalls: !!(context.request.toolCalls?.length),
            model: context.request.model,
            sessionId: context.request.sessionId
          },
          pipelineState: {
            totalErrors: context.errors.length,
            hasSystemPrompt: !!context.systemPrompt,
            mcpInstanceCount: context.mcpInstances.length,
            mcpCallCount: context.mcpCalls.length
          }
        }, `🔴 PIPELINE FAILURE [${stage.name}:${errorLocation}] ${error.message}`);

        // Add error to context
        const pipelineError: PipelineError = {
          stage: stage.name,
          code: error.code || ChatErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
          details: error.details,
          retryable: error.retryable || false,
          timestamp: new Date()
        };
        
        context.errors.push(pipelineError);

        // RECOVERY: If completion stage failed but we have tool results,
        // emit the tool results as fallback instead of showing an error
        if ((stage.name === 'completion' || stage.name === 'multi-model-orchestration')
            && context.mcpCalls && context.mcpCalls.length > 0) {
          this.logger.warn({
            messageId: context.messageId,
            stage: stage.name,
            toolsExecuted: context.mcpCalls.length,
            error: error.message
          }, '⚠️ [SYNTHESIS-RECOVERY] Completion failed after tool execution - emitting tool results as fallback');

          const resultSections: string[] = [];
          for (const call of context.mcpCalls) {
            const c = call as any;
            const name = c.name || c.toolName;
            if (c.error) {
              resultSections.push(`**${name}:** Error — ${c.error}`);
            } else if (c.result) {
              let resultText: string;
              if (typeof c.result === 'string') {
                resultText = c.result;
              } else if (c.result.content) {
                const parts = Array.isArray(c.result.content)
                  ? c.result.content.map((p: any) => p.text || JSON.stringify(p)).join('\n')
                  : typeof c.result.content === 'string' ? c.result.content : JSON.stringify(c.result.content);
                resultText = parts;
              } else if (c.result.data) {
                resultText = typeof c.result.data === 'string' ? c.result.data : JSON.stringify(c.result.data, null, 2);
              } else {
                resultText = JSON.stringify(c.result, null, 2);
              }
              if (resultText.length > 3000) {
                resultText = resultText.substring(0, 3000) + '\n...(truncated)';
              }
              resultSections.push(`**${name}:**\n${resultText}`);
            }
          }

          const recoveryContent = `Here are the results from ${context.mcpCalls.length} tool${context.mcpCalls.length > 1 ? 's' : ''} I executed:\n\n${resultSections.join('\n\n')}`;

          context.emit('stream', { content: recoveryContent, delta: false });
          context.emit('completion_complete', {
            content: recoveryContent,
            messageId: `recovery_${context.messageId}`,
            toolCalls: [],
            model: context.config.model,
            timestamp: Date.now(),
            fallback: true
          });

          // Don't abort — we recovered with a fallback response
          this.logger.info({
            messageId: context.messageId,
            recoveryContentLength: recoveryContent.length
          }, '✅ [SYNTHESIS-RECOVERY] Tool results emitted as fallback — pipeline continues');
          continue; // Skip to next stage instead of throwing
        }

        // FAIL FAST: All errors should be immediately visible and cause pipeline failure
        context.aborted = true;

        // Emit immediate error notification so user knows what's broken
        const immediateError = {
          code: error.code || 'PIPELINE_FAILURE',
          message: `⚡ INSTANT FAILURE in ${stage.name}: ${error.message}`,
          stage: stage.name,
          timestamp: new Date().toISOString(),
          critical: true,
          failFast: true
        };

        context.emit('error', immediateError);

        this.logger.error({
          CRITICAL_FAILURE: true,
          stage: stage.name,
          error: error.message,
          immediateAbort: true
        }, `💥 IMMEDIATE PIPELINE ABORT: ${stage.name} failed - ${error.message}`);

        throw error;
      }
    }

    metrics.totalTime = Date.now() - startTime;
    metrics.tokenUsage = this.extractTokenUsage(context);
    metrics.mcpCalls = context.mcpCalls?.length || 0;

    return metrics;
  }

  /**
   * Create initial pipeline context
   */
  private createContext(request: ChatRequest, user: ChatUser, streamCallback: (event: any) => void | Promise<void>): PipelineContext {
    const messageId = this.generateMessageId();
    const startTime = new Date();

    const streamContext: StreamContext = {
      sessionId: request.sessionId,
      userId: user.id,
      messageId,
      startTime,
      tokenCount: 0,
      toolCallCount: 0,
      mcpCallCount: 0
    };

    return {
      // Request data
      request,
      user,
      session: null as any, // Will be populated by stages
      
      // Processing state
      messageId,
      startTime,
      streamContext,
      
      // Accumulated data
      messages: [],
      systemPrompt: undefined,
      promptEngineering: undefined,
      mcpInstances: [],
      mcpCalls: [],
      
      // Configuration - CRITICAL: Override config model with request model if user explicitly selected one
      // This allows users to switch models on-the-fly via the toolbar
      config: {
        ...this.config,
        // User's model selection takes priority over default config
        model: request.model || this.config.model
      },

      // Services for stages to use - use getter if available to get latest service
      milvusService: this.services.getMilvus ? this.services.getMilvus() : this.services.milvus,
      redisService: this.services.redis,
      resultStorageService: this.resultStorageService,
      completionService: this.services.completion,

      // Utilities
      logger: this.logger.child({ messageId }) as Logger,
      emit: (event: string, data: any) => {
        // Map backend events to frontend-expected events
        let frontendEvent = event;
        if (event === 'content_delta') {
          frontendEvent = 'stream';
        }
        if (event === 'completion_complete') {
          frontendEvent = 'done';
        }
        if (event === 'thinking') {
          frontendEvent = 'thinking_event';
        }

        // Handle both sync and async callbacks
        const result = streamCallback({ type: frontendEvent, data, timestamp: new Date() });
        if (result instanceof Promise) {
          result.catch(error => {
            this.logger.error('Stream callback failed', { error: error instanceof Error ? error.message : String(error) });
          });
        }
        this.emit(event, { context: this, data });
      },
      
      // Error handling
      errors: [],
      aborted: false,

      // Artifact accumulator (images, HTML, etc. created during this execution)
      artifacts: []
    };
  }

  /**
   * Handle pipeline errors
   */
  private async handleError(context: PipelineContext, error: any): Promise<void> {
    const errorLocation = this.extractErrorLocation(error);
    const lastError = context.errors[context.errors.length - 1];

    this.logger.error({
      messageId: context.messageId,
      userId: context.user.id,
      sessionId: context.request.sessionId,
      error: error.message,
      errorLocation,
      failedStage: lastError?.stage || 'unknown',
      errorCode: error.code,
      errorType: error.constructor?.name,
      errors: context.errors
    }, `🔴 PIPELINE FAILED at ${errorLocation}: ${error.message}`);

    // Check if user is admin for enhanced error display
    const isAdmin = context.user?.isAdmin || false;
    const stage = lastError?.stage || 'unknown';

    // Get recommendations (Ollama-enhanced for admin, default for non-admin)
    let recommendations: string[] = [];
    if (isAdmin) {
      try {
        // Try to get Ollama-generated recommendations for admin
        const enrichedError = await enrichErrorForAdmin(
          error,
          stage,
          {
            model: context.request.model,
            userId: context.user?.id
          },
          this.logger
        );
        recommendations = enrichedError.recommendations;
      } catch (e) {
        // Fall back to default recommendations
        recommendations = getDefaultRecommendations(stage, error);
      }
    }

    // Send detailed error to client with better context
    const errorDetails = {
      code: error.code || ChatErrorCode.INTERNAL_ERROR,
      message: error.message || 'An unexpected error occurred',
      retryable: isRetryableError(error),
      stage,
      location: errorLocation,
      fallbackMode: true,
      timestamp: new Date().toISOString(),
      // Include admin-specific info
      isAdmin,
      recommendations: isAdmin ? recommendations : undefined,
      // Always include helpful debug info
      debugInfo: {
        failedAt: `${stage}:${errorLocation}`,
        errorType: error.constructor?.name || 'Error',
        model: context.request.model,
        hasToolCalls: !!(context.request.toolCalls?.length)
      },
      // Include detailed info for admin users (not just development mode)
      ...(isAdmin && {
        details: error.details,
        stack: error.stack?.split('\n').slice(0, 10).join('\n'),
        allErrors: context.errors.map(e => ({
          stage: e.stage,
          message: e.message,
          code: e.code,
          timestamp: e.timestamp
        }))
      })
    };
    
    // Also emit a special fallback mode notification
    context.emit('fallback_mode', {
      reason: `${errorDetails.stage}_failure`,
      originalError: error.message,
      capabilities: ['basic_math', 'simple_responses'],
      timestamp: new Date().toISOString()
    });
    
    context.emit('error', errorDetails);

    // Attempt rollback for stages that support it
    await this.rollbackStages(context);

    this.emit('pipeline:error', { context, error });
  }

  /**
   * Rollback stages in reverse order
   */
  private async rollbackStages(context: PipelineContext): Promise<void> {
    const reversedStages = [...this.stages].reverse();
    
    for (const stage of reversedStages) {
      if (stage.rollback) {
        try {
          await stage.rollback(context);
          this.logger.debug({ 
            messageId: context.messageId,
            stage: stage.name 
          }, 'Stage rollback completed');
        } catch (rollbackError) {
          this.logger.error({ 
            messageId: context.messageId,
            stage: stage.name,
            error: rollbackError
          }, 'Stage rollback failed');
        }
      }
    }
  }

  /**
   * Build pipeline configuration with defaults
   */
  private buildConfig(config: Partial<PipelineConfig>): PipelineConfig {
    return {
      // Model settings - Use provided model or default from environment (no hardcoded fallbacks)
      // Only use explicitly provided model - do NOT use DEFAULT_MODEL here
      // DEFAULT_MODEL fallback is handled in completion-simple.stage.ts (Priority 4)
      // Setting it here overrides slider-based intelligent routing (Priority 3)
      model: config.model || undefined,
      // LLM provider - from config, env var, or auto-detect from model. NEVER default to 'ollama'.
      provider: config.provider || process.env.DEFAULT_LLM_PROVIDER || undefined,
      temperature: config.temperature !== undefined ? config.temperature : parseFloat(process.env.DEFAULT_TEMPERATURE || '1.0'),
      maxTokens: config.maxTokens || parseInt(process.env.DEFAULT_MAX_TOKENS || '32768'), // Per-provider limits handled downstream

      // Advanced generation parameters (from per-provider/per-model settings)
      topP: config.topP,
      topK: config.topK,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,

      // Feature flags
      enableMCP: config.enableMCP !== false,
      enablePromptEngineering: config.enablePromptEngineering !== false,
      enableCoT: config.enableCoT === true, // Disabled by default
      enableRAG: config.enableRAG !== false && process.env.DISABLE_RAG !== 'true', // ENABLED by default for artifact search
      enableMemory: config.enableMemory === true || process.env.ENABLE_MEMORY === 'true', // Disabled by default
      enableCaching: config.enableCaching !== false,
      enableAnalytics: config.enableAnalytics !== false,
      
      // Timeouts and limits
      //
      // requestTimeout is the per-LLM-call deadline. 30s was too aggressive
      // for multi-tool ReAct loops where a single completion call receives
      // 80KB+ of tool_result payload (Azure ARM dumps, resource graph
      // pages, Front Door configs, etc.). Opus needs time to process
      // that context and decide the next round. Bumped to 5 min to match
      // Bedrock's timeout — any chat that takes longer has a deeper issue.
      requestTimeout: config.requestTimeout || 300000, // 5 minutes
      mcpTimeout: config.mcpTimeout || 120000, // 2 minutes for MCP tools
      maxHistoryLength: config.maxHistoryLength || 100, // Increased from 20 to 100 to preserve conversation context
      maxTokenBudget: config.maxTokenBudget || 100000,
      
      // Rate limiting
      rateLimitPerMinute: config.rateLimitPerMinute || 60,
      rateLimitPerHour: config.rateLimitPerHour || 1000
    };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Extract token usage from context
   */
  private extractTokenUsage(context: PipelineContext): any {
    // Look for token usage in the last message or completion result
    return context.messages?.[context.messages.length - 1]?.tokenUsage || null;
  }

  /**
   * Extract error location from stack trace
   */
  private extractErrorLocation(error: any): string {
    if (!error?.stack) return 'Unknown location';

    const stackLines = error.stack.split('\n');

    // Find the first meaningful stack frame (skip error message and internal node frames)
    for (const line of stackLines.slice(1)) {
      // Match file paths with line/column numbers
      const match = line.match(/at\s+(?:.*?\s+)?[\(]?(.*?):(\d+):(\d+)\)?/);
      if (match) {
        const [, filePath, lineNum, colNum] = match;

        // Skip node internals and external modules
        if (!filePath.includes('node_modules') &&
            !filePath.includes('node:') &&
            !filePath.startsWith('internal/')) {

          // Extract just the relevant part of the path
          const relevantPath = filePath.includes('services/')
            ? filePath.substring(filePath.indexOf('services/'))
            : filePath.includes('src/')
            ? filePath.substring(filePath.indexOf('src/'))
            : filePath;

          return `${relevantPath}:${lineNum}:${colNum}`;
        }
      }
    }

    // Fallback to first non-message line if no good match found
    return stackLines[1]?.trim() || 'Unknown location';
  }

  /**
   * Health check for the pipeline
   */
  isHealthy(): boolean {
    return !this.isRunning || this.activeContexts.size < 100; // Arbitrary threshold
  }

  /**
   * Get pipeline statistics
   */
  getStats(): any {
    return {
      activeContexts: this.activeContexts.size,
      stageCount: this.stages.length,
      config: this.config,
      isHealthy: this.isHealthy()
    };
  }

  /**
   * Fire-and-forget background agent triggers after main response completes.
   * Detects code blocks and architecture keywords to queue background agents.
   */
  /**
   * PHASE 1: Build a system feedback message after each tool call round.
   * Uses mcpCalls (available outside try block) instead of toolResults.
   * Summarizes errors, empty results, duplicate calls so the model self-corrects.
   */
  private buildToolRoundFeedbackFromMcp(
    recentCalls: any[],
    context: PipelineContext,
    round: number,
  ): string | null {
    const parts: string[] = [];

    // 1) Flag errors
    const errors = recentCalls.filter((c: any) => c.status === 'failed' || c.error);
    for (const e of errors) {
      const name = e.name || e.toolName || 'unknown';
      const errMsg = e.error || 'unknown error';
      parts.push(`Tool "${name}" failed: ${errMsg}. Consider an alternative tool or approach.`);
    }

    // 2) Flag empty results
    for (const c of recentCalls) {
      if (c.status !== 'failed' && !c.error) {
        const result = c.result;
        const isEmpty = result === null || result === undefined ||
          (typeof result === 'string' && result.trim().length === 0) ||
          (Array.isArray(result) && result.length === 0) ||
          (typeof result === 'object' && result !== null && !Array.isArray(result) && Object.keys(result).length === 0);
        if (isEmpty) {
          parts.push(`Tool "${c.name || c.toolName}" returned empty results. The data may not exist or different parameters may be needed.`);
        }
      }
    }

    // 3) Flag excessive duplicate calls across all rounds
    const allCalls: any[] = context.mcpCalls || [];
    const callCounts = new Map<string, number>();
    for (const c of allCalls) {
      const name = c.name || c.toolName || '';
      callCounts.set(name, (callCounts.get(name) || 0) + 1);
    }
    for (const [name, count] of callCounts) {
      if (count >= 3) {
        parts.push(`You have called "${name}" ${count} times. Use the results you already have instead of calling it again.`);
      }
    }

    // If all tools succeeded with data — no feedback needed
    if (parts.length === 0) return null;

    return `[Tool Round ${round} Feedback]\n${parts.join('\n')}`;
  }

  /**
   * Store pipeline artifacts (images, streamed HTML) in user's Milvus collection.
   * Agent HTML artifacts are already stored inline; this handles images and
   * any completion-stage artifacts (streamed artifact:html from direct LLM output).
   */
  private async storePipelineArtifacts(context: PipelineContext): Promise<void> {
    if (!context.artifacts || context.artifacts.length === 0) return;

    // Agent HTML artifacts are already stored inline during dispatch.
    // Here we store: (1) image metadata refs, (2) completion-stage HTML/SVG artifacts.
    const toStore = context.artifacts.filter(a =>
      (a.type === 'image' && a.createdBy === 'image-gen') ||
      (a.createdBy === 'completion')
    );
    if (toStore.length === 0) {
      this.logger.debug({ totalArtifacts: context.artifacts.length }, '[ARTIFACT-REGISTRY] No new artifacts to store');
      return;
    }

    try {
      const { ArtifactService } = await import('../../../services/ArtifactService.js');
      const artifactService = new ArtifactService(this.logger);

      for (const art of toStore) {
        try {
          if (art.type === 'image') {
            // Skip data URI images (storage failed) — they're too large for metadata
            if (art.url?.startsWith('data:')) {
              context.logger.warn({ artId: art.id?.substring(0, 50) }, '[ArtifactStore] Skipping data URI image (blob storage failed)');
              continue;
            }
            // Image binaries already in blob storage — store metadata ref for RAG
            const safeId = (art.id || 'unknown').substring(0, 100); // Truncate long IDs
            await artifactService.uploadArtifact(context.user.id, {
              file: Buffer.from(JSON.stringify({
                imageUrl: art.url,
                title: art.title,
                metadata: art.metadata,
              })),
              filename: `image-ref-${safeId}.json`,
              mimeType: 'application/json',
              title: art.title || 'Generated Image',
              description: `Image generated via ${art.metadata?.provider || 'unknown'}: ${art.title}`,
              tags: ['artifact', 'image', 'generated', `session:${art.sessionId || 'unknown'}`],
            });
          } else if (art.createdBy === 'completion' && art.metadata?.contentLength) {
            // Completion-stage HTML/SVG — store content extracted from response
            const responseContent = context.response || '';
            const fencePattern = /```artifact:(?:html|svg|react)\n([\s\S]*?)```/g;
            const allMatches: string[] = [];
            let m;
            while ((m = fencePattern.exec(responseContent)) !== null) {
              allMatches.push(m[1].trim());
            }
            // Store each completion artifact matched by index
            const completionIdx = toStore.filter(a => a.createdBy === 'completion').indexOf(art);
            if (completionIdx >= 0 && completionIdx < allMatches.length) {
              await artifactService.uploadArtifact(context.user.id, {
                file: Buffer.from(allMatches[completionIdx], 'utf-8'),
                filename: `artifact-${art.id}.${art.type === 'svg' ? 'svg' : 'html'}`,
                mimeType: art.mimeType || 'text/html',
                title: art.title || 'Completion Artifact',
                description: `LLM-generated ${art.type} artifact`,
                tags: ['artifact', art.type, 'completion', `session:${art.sessionId || 'unknown'}`],
              });
            }
          }
          this.logger.info({ artifactId: art.id, type: art.type, createdBy: art.createdBy },
            '[ARTIFACT-REGISTRY] Artifact stored in user Milvus collection');
        } catch (err: any) {
          this.logger.warn({ err: err.message, artifactId: art.id }, '[ARTIFACT-REGISTRY] Failed to store artifact');
        }
      }
    } catch (err: any) {
      this.logger.warn({ err: err.message }, '[ARTIFACT-REGISTRY] ArtifactService import failed');
    }
  }

  private async triggerBackgroundAgents(context: PipelineContext): Promise<void> {
    const response = context.response || '';
    if (response.length < 50) return; // too short to analyze

    const openagenticProxyUrl = (context as any).openagenticProxyUrl || process.env.OPENAGENTIC_PROXY_URL;
    if (!openagenticProxyUrl) return; // no openagentic-proxy available

    const triggers: Array<{ role: string; task: string }> = [];

    // Code blocks → artifact agent (could generate runnable artifact)
    const codeBlockCount = (response.match(/```[\s\S]*?```/g) || []).length;
    if (codeBlockCount >= 2) {
      triggers.push({
        role: 'artifact',
        task: `The user received a response with ${codeBlockCount} code blocks. Extract the primary code artifact, determine the language, and produce a clean standalone version. Response excerpt (first 2000 chars): ${response.substring(0, 2000)}`,
      });
    }

    // Architecture keywords → diagram agent
    const archKeywords = /\b(architecture|infrastructure|deploy|microservice|pipeline|workflow|system design)\b/i;
    if (archKeywords.test(context.request.message) && response.length > 500) {
      triggers.push({
        role: 'diagram',
        task: `Generate a Mermaid architecture diagram based on this response. User asked: "${context.request.message.substring(0, 200)}". Response excerpt: ${response.substring(0, 2000)}`,
      });
    }

    if (triggers.length === 0) return;

    this.logger.info({
      triggerCount: triggers.length,
      roles: triggers.map(t => t.role),
      messageId: context.messageId,
    }, '[PIPELINE] Firing background agent triggers');

    try {
      const axios = (await import('axios')).default;
      await axios.post(`${openagenticProxyUrl}/api/agents/execute`, {
        agents: triggers.map(t => ({ role: t.role, task: t.task, tools: [], maxTurns: 3 })),
        orchestration: 'parallel',
        aggregation: 'merge',
        sessionId: context.request.sessionId,
        userId: context.user.id,
        background: true,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Openagentic-Proxy': 'true',
          'Authorization': `Bearer ${process.env.OPENAGENTIC_PROXY_INTERNAL_KEY || ''}`,
        },
        timeout: 5000, // short timeout — fire and forget
      });
    } catch {
      // Silently ignore — background triggers are non-critical
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down chat pipeline...');
    
    // Wait for active contexts to complete (with timeout)
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeContexts.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Force abort remaining contexts  
    const activeContextsArray = Array.from(this.activeContexts.values());
    for (const context of activeContextsArray) {
      context.aborted = true;
    }
    
    this.activeContexts.clear();
    this.removeAllListeners();
    
    this.logger.info('Chat pipeline shutdown complete');
  }
}