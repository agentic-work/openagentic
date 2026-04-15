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
 * Response Processing Pipeline Stage
 * 
 * Responsibilities:
 * - Save messages to session storage
 * - Format final response for client
 * - Handle Chain of Thought (CoT) processing
 * - Process and store attachments
 * - Apply response filters and validation
 * - Update session metadata
 * - Generate AI-powered session titles
 */

import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { ChatErrorCode, ChatMessage } from '../interfaces/chat.types.js';
import { TitleGenerationService } from '../../../services/TitleGenerationService.js';
import { getModelCapabilityRegistry } from '../../../services/ModelCapabilityRegistry.js';
import { getFabricationDetectionService, type ToolCallRecord } from '../../../services/FabricationDetectionService.js';
// DiagramEnhancementService removed - diagrams now use React Flow client-side via system MCP
import type { Logger } from 'pino';

export class ResponseStage implements PipelineStage {
  name = 'response';
  private titleService: TitleGenerationService;

  constructor(
    private sessionService: any,
    private logger: any,
    titleService?: TitleGenerationService
  ) {
    this.logger = logger.child({ stage: this.name }) as Logger;
    this.titleService = titleService || new TitleGenerationService({
      maxLength: 60,
      includeContext: true
    });
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    
    try {
      // Process and render diagrams/math in the response
      await this.processVisualizationsInResponse(context);
      
      // Process Chain of Thought if enabled
      if (context.config.enableCoT) {
        await this.processChainOfThought(context);
      }
      
      // Save messages to session storage
      await this.saveMessagesToSession(context);

      // Update Redis SessionCache for fast retrieval (critical for Redis-first architecture)
      try {
        await this.updateRedisSessionCache(context);
      } catch (cacheError) {
        // Log but don't fail the pipeline
        this.logger.error({
          error: cacheError.message,
          sessionId: context.session?.id,
          userId: context.user?.id
        }, 'Failed to update Redis SessionCache - next request will hit PostgreSQL');
      }

      // Index conversation for memory system - await to ensure it happens
      try {
        await this.indexConversationForMemory(context);
      } catch (indexError) {
        // Log but don't fail the pipeline
        this.logger.error({
          error: indexError.message,
          stack: indexError.stack,
          sessionId: context.session?.id,
          userId: context.user?.id
        }, 'Failed to index conversation in Milvus - semantic search will not include this conversation');
      }
      
      // Emit event for real-time knowledge building (async processing)
      try {
        await this.emitKnowledgeEvent(context);
      } catch (knowledgeError) {
        // Log but don't fail the pipeline
        this.logger.error({ 
          error: knowledgeError.message,
          sessionId: context.session?.id,
          userId: context.user?.id
        }, 'Failed to emit knowledge event');
      }
      
      // Process and store any attachments in responses
      await this.processResponseAttachments(context);
      
      // Apply response filters and validation
      await this.validateAndFilterResponse(context);
      
      // Update session metadata
      await this.updateSessionMetadata(context);
      
      // Generate final response summary
      const responseSummary = this.generateResponseSummary(context);
      
      // Send final response event
      context.emit('response_complete', {
        messageId: context.messageId,
        sessionId: context.session.id,
        messageCount: context.messages.length,
        tokenUsage: this.extractTokenUsage(context),
      });
      
      this.logger.info({ 
        userId: context.user.id,
        sessionId: context.request.sessionId,
        messageCount: context.messages.length,
        responseLength: this.getResponseLength(context),
        executionTime: Date.now() - startTime
      }, 'Response stage completed');

      return context;

    } catch (error) {
      this.logger.error({ 
        error: error.message,
        executionTime: Date.now() - startTime
      }, 'Response stage failed');

      throw {
        ...error,
        code: error.code || ChatErrorCode.INTERNAL_ERROR,
        retryable: false, // Response stage failures are typically not retryable
        stage: this.name
      };
    }
  }

  private async processChainOfThought(context: PipelineContext): Promise<void> {
    try {
      // Look for CoT markers in the assistant's response
      const lastAssistantMessage = this.getLastAssistantMessage(context);
      
      if (!lastAssistantMessage || !lastAssistantMessage.content) {
        return;
      }
      
      const cotSteps = this.extractCoTSteps(lastAssistantMessage.content);
      
      if (cotSteps.length > 0) {
        // Save CoT steps to message metadata
        lastAssistantMessage.metadata = {
          ...lastAssistantMessage.metadata,
          cotSteps,
          hasCoT: true
        };
        
        // Emit CoT event for UI
        context.emit('cot_processed', {
          messageId: lastAssistantMessage.id,
          steps: cotSteps,
          totalSteps: cotSteps.length
        });
        
        this.logger.debug({ 
          messageId: lastAssistantMessage.id,
          stepCount: cotSteps.length 
        }, 'Chain of Thought processed');
      }
      
    } catch (error) {
      this.logger.warn({ 
        error: error.message 
      }, 'Failed to process Chain of Thought');
    }
  }

  private extractCoTSteps(content: string): any[] {
    const steps: any[] = [];
    
    // Look for various CoT patterns
    const patterns = [
      // "Let me think step by step:"
      /let me think[\s\S]*?step by step:?\s*([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
      // "Step 1:", "Step 2:", etc.
      /step \d+:?\s*([\s\S]*?)(?=step \d+|$)/gi,
      // Numbered lists "1. ", "2. ", etc.
      /^\d+\.\s+(.*?)(?=^\d+\.|$)/gm,
      // Thinking process markers
      /(?:thinking|reasoning|analysis):?\s*([\s\S]*?)(?=\n\n|conclusion|answer|$)/gi
    ];
    
    for (const pattern of patterns) {
      const matchesArray = Array.from(content.matchAll(pattern));
      for (const match of matchesArray) {
        if (match[1] && match[1].trim()) {
          steps.push({
            type: 'reasoning',
            content: match[1].trim(),
            order: steps.length + 1
          });
        }
      }
    }
    
    return steps;
  }

  private async saveMessagesToSession(context: PipelineContext): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info({
        sessionId: context.session.id,
        totalMessages: context.messages.length,
        messageRoles: context.messages.map(m => m.role)
      }, '╔═══════════════════════════════════════════════════════════════');
      this.logger.info('║ [SAVE] 💾 Saving Messages to PostgreSQL');
      this.logger.info('╚═══════════════════════════════════════════════════════════════');

      // Step 1: Deduplicate messages by ID (critical for tool calling rounds)
      const seenMessageIds = new Set<string>();
      const deduplicated = context.messages.filter(msg => {
        if (seenMessageIds.has(msg.id)) {
          this.logger.debug({
            messageId: msg.id,
            role: msg.role
          }, '│ [SAVE] 🔄 SKIPPING duplicate message (already seen)');
          return false;
        }
        seenMessageIds.add(msg.id);
        return true;
      });

      this.logger.info({
        originalCount: context.messages.length,
        deduplicatedCount: deduplicated.length,
        duplicatesRemoved: context.messages.length - deduplicated.length
      }, '│ [SAVE] 🔄 Deduplication complete');

      // Step 2: Filter messages that need to be saved
      // DATABASE-FIRST: Skip messages already saved by ValidationStage or CompletionStage
      const messagesToSave = deduplicated.filter(msg => {
        // Skip if already saved to database (Database-First pattern)
        if (msg.metadata?.savedToDb) {
          this.logger.info({
            messageId: msg.id,
            role: msg.role,
            alreadySaved: true
          }, '│ [SAVE] ⏭️  SKIPPING message already saved by Database-First pattern');
          return false;
        }

        // Exclude system messages
        if (msg.role === 'system' || msg.id.startsWith('system_')) {
          return false;
        }

        // CRITICAL FIX: MUST save assistant messages with tool_calls/mcpCalls even if content is empty
        // OpenAI-compatible providers require these messages to correlate tool responses via tool_call_id
        // Follow-up questions fail without these messages because tool responses have no matching assistant message
        if (msg.role === 'assistant' && (!msg.content || msg.content.trim() === '')) {
          const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
          const hasMcpCalls = msg.mcpCalls && msg.mcpCalls.length > 0;

          if (hasToolCalls || hasMcpCalls) {
            // SAVE this message - it's required for tool call correlation
            this.logger.info({
              messageId: msg.id,
              role: msg.role,
              hasToolCalls,
              toolCallsCount: msg.toolCalls?.length || 0,
              hasMcpCalls,
              mcpCallsCount: msg.mcpCalls?.length || 0
            }, '│ [SAVE] ✅ SAVING empty assistant message with tool/mcp calls (required for UI consistency)');
            return true;
          } else {
            // Skip empty assistant messages with no tool calls or mcp calls
            this.logger.warn({
              messageId: msg.id,
              role: msg.role,
              hasToolCalls: false,
              hasMcpCalls: false
            }, '│ [SAVE] ⚠️  SKIPPING empty assistant message with no tool/mcp calls');
            return false;
          }
        }

        return true;
      });

      this.logger.info({
        sessionId: context.session.id,
        messagesToSaveCount: messagesToSave.length,
        messagesToSave: messagesToSave.map(m => ({
          id: m.id,
          role: m.role,
          contentLength: m.content?.length,
          hasToolCalls: !!m.toolCalls,
          hasToolCallId: !!m.toolCallId
        }))
      }, '│ [SAVE] 📊 Messages prepared for saving');
      
      // Save each message to the session
      for (const message of messagesToSave) {
        // Validate message before saving
        if (!message.role) {
          this.logger.error({ 
            messageId: message.id,
            messageKeys: Object.keys(message),
            message: JSON.stringify(message)
          }, 'Message missing required role field');
          continue; // Skip this message
        }
        
        // Validate message has required properties
        if (!message || !message.id || !message.role) {
          this.logger.error({ 
            messageObject: !!message,
            messageId: message?.id,
            messageRole: message?.role,
            messageContent: message?.content?.length || 0,
            hasSession: !!context.session,
            hasUser: !!context.user
          }, 'Invalid message object - missing required properties');
          continue; // Skip this invalid message
        }
        
        // For assistant messages, include MCP calls from context
        const messageData = {
          id: message.id,
          role: message.role,
          content: message.content || '',
          timestamp: message.timestamp || new Date(),
          tokenUsage: message.tokenUsage,
          model: message.model, // Include the actual model used
          toolCalls: message.toolCalls, // CRITICAL: Must save for context preservation
          toolCallId: message.toolCallId,
          attachments: message.attachments,
          metadata: message.metadata
        };

        // Add MCP calls to assistant messages
        // CRITICAL FIX: Use message's own mcpCalls if available (for messages loaded from DB),
        // otherwise use context.mcpCalls (for newly created messages in this request)
        if (message.role === 'assistant') {
          const mcpCallsToSave = (message as any).mcpCalls || context.mcpCalls;
          if (mcpCallsToSave && mcpCallsToSave.length > 0) {
            (messageData as any).mcpCalls = mcpCallsToSave;
            this.logger.debug({
              messageId: message.id,
              mcpCallsCount: mcpCallsToSave.length,
              source: (message as any).mcpCalls ? 'message' : 'context'
            }, 'Adding MCP calls to assistant message');
          }
        }

        // Add CoT steps if available
        if (message.role === 'assistant' && (message as any).cotSteps) {
          (messageData as any).cotSteps = (message as any).cotSteps;
        }

        if (!context.session?.id || !context.user?.id) {
          this.logger.error({ 
            messageId: message.id,
            hasSession: !!context.session,
            sessionId: context.session?.id,
            hasUser: !!context.user,
            userId: context.user?.id
          }, 'Missing session or user context for message save');
          continue; // Skip this message
        }

        const saveStartTime = Date.now();
        await this.sessionService.addMessage(
          context.session.id,
          context.user.id,
          messageData
        );
        const saveTime = Date.now() - saveStartTime;

        this.logger.info({
          messageId: message.id,
          role: message.role,
          sessionId: context.session.id,
          saveTimeMs: saveTime,
          savedFields: {
            hasContent: !!messageData.content,
            hasToolCalls: !!messageData.toolCalls,
            toolCallsCount: messageData.toolCalls?.length || 0,
            hasToolCallId: !!messageData.toolCallId,
            hasModel: !!messageData.model,
            hasTokenUsage: !!messageData.tokenUsage
          }
        }, `│ [SAVE] ✅ Message saved (${message.role})`);

        // Special logging for assistant messages with tool calls
        if (message.role === 'assistant' && messageData.toolCalls && messageData.toolCalls.length > 0) {
          this.logger.info({
            messageId: message.id,
            toolCallsCount: messageData.toolCalls.length,
            toolCallIds: messageData.toolCalls.map(tc => tc.id),
            toolNames: messageData.toolCalls.map(tc => tc.function?.name)
          }, '│ [SAVE] 🔧 CRITICAL: Saved assistant message WITH tool_calls');
        }

        // Track prompt usage for assistant messages
        if (message.role === 'assistant' && context.promptUsageData) {
          await this.trackPromptUsage(context, message.id);
        }

        // Special logging for tool response messages
        if (message.role === 'tool' && messageData.toolCallId) {
          this.logger.info({
            messageId: message.id,
            toolCallId: messageData.toolCallId,
            resultLength: messageData.content?.length || 0
          }, '│ [SAVE] 🔧 Saved tool response message');
        }
      }

      const totalTime = Date.now() - startTime;

      this.logger.info({
        sessionId: context.session.id,
        messageCount: messagesToSave.length,
        totalTimeMs: totalTime,
        avgTimePerMessage: Math.round(totalTime / messagesToSave.length),
        performance: totalTime < 100 ? '🚀 FAST' : totalTime < 500 ? '✅ OK' : '⚠️  SLOW'
      }, '┌─────────────────────────────────────────────────────────────');
      this.logger.info({
        saved: messagesToSave.length,
        withToolCalls: messagesToSave.filter(m => m.toolCalls).length,
        toolResponses: messagesToSave.filter(m => m.role === 'tool').length
      }, '│ [SAVE] ✅ All messages saved to PostgreSQL');
      this.logger.info('└─────────────────────────────────────────────────────────────');
      
    } catch (error) {
      this.logger.error({ 
        sessionId: context.session.id,
        error: error.message 
      }, 'Failed to save messages to session');
      
      throw {
        code: ChatErrorCode.STORAGE_ERROR,
        message: 'Failed to save conversation messages'
      };
    }
  }

  private async processResponseAttachments(context: PipelineContext): Promise<void> {
    try {
      const lastAssistantMessage = this.getLastAssistantMessage(context);
      
      if (!lastAssistantMessage) {
        return;
      }
      
      // Look for generated images, files, or other attachments in tool call results
      if (context.mcpCalls) {
        const attachments: any[] = [];
        
        for (const mcpCall of context.mcpCalls) {
          if (mcpCall.result.success && mcpCall.result.data) {
            const attachment = this.extractAttachmentFromMCPResult(mcpCall);
            if (attachment) {
              attachments.push(attachment);
            }
          }
        }
        
        if (attachments.length > 0) {
          lastAssistantMessage.attachments = attachments;
          
          context.emit('attachments_processed', {
            messageId: lastAssistantMessage.id,
            attachments: attachments.map(att => ({
              type: att.type,
              name: att.name,
              size: att.size
            }))
          });
        }
      }
      
    } catch (error) {
      this.logger.warn({ 
        error: error.message 
      }, 'Failed to process response attachments');
    }
  }

  private extractAttachmentFromMCPResult(mcpCall: any): any | null {
    const result = mcpCall.result.data;
    
    // Check for image generation results
    if (mcpCall.name.includes('image') || mcpCall.name.includes('generate')) {
      if (result.image_url || result.url) {
        return {
          type: 'image',
          name: `Generated Image`,
          url: result.image_url || result.url,
          mimeType: 'image/png',
          source: 'mcp_generated'
        };
      }
    }
    
    // Check for file outputs
    if (result.file_path || result.filename) {
      return {
        type: 'file',
        name: result.filename || 'Generated File',
        path: result.file_path,
        mimeType: result.mime_type || 'application/octet-stream',
        source: 'mcp_generated'
      };
    }
    
    return null;
  }

  private async validateAndFilterResponse(context: PipelineContext): Promise<void> {
    try {
      const lastMessage = this.getLastAssistantMessage(context);

      if (!lastMessage || !lastMessage.content) {
        return;
      }

      // Filter out Google Gemini's internal TOOL_CODE blocks
      // These are Python-style tool calls that should not be shown to users
      // Pattern: TOOL_CODE\nprint(default_api.function_name(...))
      const toolCodePattern = /TOOL_CODE\s*\n\s*print\s*\(\s*default_api\.[^)]+\([^)]*\)\s*\)\s*/gi;
      if (toolCodePattern.test(lastMessage.content)) {
        const originalLength = lastMessage.content.length;
        lastMessage.content = lastMessage.content.replace(toolCodePattern, '');

        this.logger.warn({
          messageId: lastMessage.id,
          originalLength,
          newLength: lastMessage.content.length,
          bytesRemoved: originalLength - lastMessage.content.length
        }, 'Filtered TOOL_CODE blocks from Gemini response');

        // If the entire response was just TOOL_CODE, add a fallback message
        if (!lastMessage.content.trim()) {
          lastMessage.content = 'I apologize, but I encountered an issue processing your request. Please try again.';
          this.logger.warn({
            messageId: lastMessage.id
          }, 'Response was entirely TOOL_CODE - added fallback message');
        }
      }

      // Also filter out any stray TOOL_CODE markers without the full pattern
      // This catches edge cases where the pattern is malformed
      const strayToolCodePattern = /TOOL_CODE\s*\n?/gi;
      if (strayToolCodePattern.test(lastMessage.content)) {
        lastMessage.content = lastMessage.content.replace(strayToolCodePattern, '');
        this.logger.debug({
          messageId: lastMessage.id
        }, 'Filtered stray TOOL_CODE markers from response');
      }

      // Basic content validation
      if (lastMessage.content.length > 100000) { // 100KB limit
        this.logger.warn({
          messageId: lastMessage.id,
          contentLength: lastMessage.content.length
        }, 'Response content exceeds size limit');

        // Truncate if too long
        lastMessage.content = lastMessage.content.substring(0, 100000) + '\n\n[Response truncated due to length]';
      }

      // Check for potential security issues
      const securityIssues = this.checkResponseSecurity(lastMessage.content);
      if (securityIssues.length > 0) {
        this.logger.warn({
          messageId: lastMessage.id,
          issues: securityIssues
        }, 'Response contains potential security issues');

        context.emit('security_warning', {
          messageId: lastMessage.id,
          issues: securityIssues
        });
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // FABRICATION DETECTION - Prevent LLM from generating fake data
      // This addresses the critical issue where LLMs fabricate JSON responses
      // instead of actually calling available tools (e.g., Azure AppGW deception)
      // ═══════════════════════════════════════════════════════════════════════════
      try {
        const fabricationService = getFabricationDetectionService();

        // Build tool call records from context
        const toolCallsMade: ToolCallRecord[] = (context.mcpCalls || []).map((call: any) => ({
          name: call.name || call.toolName,
          arguments: JSON.stringify(call.arguments || call.input || {}),
          wasExecuted: !call.error
        }));

        // Get available tools (MCP tools provided to LLM)
        const availableTools = (context.availableTools || []).map((tool: any) => ({
          name: tool.function?.name || tool.name,
          description: tool.function?.description || tool.description
        }));

        // Extract original user query
        const userMessages = context.messages.filter((m: any) => m.role === 'user');
        const userQuery = userMessages.length > 0
          ? userMessages[userMessages.length - 1].content
          : context.request.message;

        // Run fabrication detection
        const fabricationResult = await fabricationService.detectFabrication(
          lastMessage.content,
          availableTools,
          toolCallsMade,
          userQuery
        );

        if (fabricationResult.isFabricated) {
          this.logger.error({
            messageId: lastMessage.id,
            confidence: fabricationResult.confidence,
            reasons: fabricationResult.reasons,
            suggestedAction: fabricationResult.suggestedAction,
            toolsAvailable: availableTools.length,
            toolsCalled: toolCallsMade.length,
            detectionDurationMs: fabricationResult.detectionDurationMs
          }, '🚨 [FABRICATION DETECTED] LLM produced fabricated data without calling tools');

          context.emit('fabrication_detected', {
            messageId: lastMessage.id,
            confidence: fabricationResult.confidence,
            reasons: fabricationResult.reasons,
            blocked: fabricationResult.blockedResponse
          });

          // If blocking is enabled, replace the fabricated response
          if (fabricationResult.blockedResponse) {
            const blockedMessage = fabricationService.generateBlockedMessage(fabricationResult);

            this.logger.warn({
              messageId: lastMessage.id,
              originalLength: lastMessage.content.length,
              blockedMessageLength: blockedMessage.length
            }, '🛑 [FABRICATION BLOCKED] Replacing fabricated response with blocked message');

            // Store original for audit
            (context as any).blockedFabricatedResponse = lastMessage.content;

            // Replace with blocked message
            lastMessage.content = blockedMessage;

            // Emit event for frontend to show explanation
            context.emit('response_blocked', {
              messageId: lastMessage.id,
              reason: 'fabrication_detected',
              confidence: fabricationResult.confidence,
              userMessage: blockedMessage
            });
          }
        }
      } catch (fabricationError: any) {
        // Don't fail the pipeline on fabrication detection errors
        this.logger.warn({
          error: fabricationError.message,
          messageId: lastMessage.id
        }, 'Fabrication detection failed - allowing response through');
      }

    } catch (error) {
      this.logger.warn({
        error: error.message
      }, 'Failed to validate response');
    }
  }

  private checkResponseSecurity(content: string): string[] {
    const issues: string[] = [];
    
    // Check for potential code injection
    if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(content)) {
      issues.push('script_tag_detected');
    }
    
    // Check for potential credential exposure
    if (/(?:password|secret|key|token)[\s=:]+[a-zA-Z0-9+/=]{20,}/i.test(content)) {
      issues.push('potential_credential_exposure');
    }
    
    // Check for SQL injection patterns
    if (/(?:DROP|DELETE|INSERT|UPDATE)\s+(?:TABLE|DATABASE|FROM)/i.test(content)) {
      issues.push('sql_injection_pattern');
    }
    
    return issues;
  }

  private async updateSessionMetadata(context: PipelineContext): Promise<void> {
    try {
      this.logger.info({ 
        sessionId: context.session.id,
        currentTitle: context.session.title,
        messageCount: context.messages.length
      }, 'Starting updateSessionMetadata');
      
      // Generate AI-powered title if session title is still "New Chat"
      if (context.session.title === 'New Chat' || !context.session.title) {
        this.logger.info({ sessionId: context.session.id }, 'Title needs generation - calling titleService');
        try {
          const title = await this.titleService.generateTitle(context.messages as any);
          this.logger.info({ 
            sessionId: context.session.id,
            generatedTitle: title
          }, 'Title generation result');
          
          if (title && title !== 'New Chat') {
            await this.sessionService.updateSessionTitle(
              context.session.id, 
              context.user.id,
              title
            );
            context.session.title = title;
            
            // Emit title update event for UI
            context.emit('session_title', { 
              sessionId: context.session.id, 
              title 
            });
            
            this.logger.info({ 
              sessionId: context.session.id,
              newTitle: title 
            }, 'Generated AI-powered session title');
          }
        } catch (titleError) {
          this.logger.warn({ 
            sessionId: context.session.id,
            error: titleError.message 
          }, 'Failed to generate session title');
        }
      }
      
      // Calculate context window metrics
      const contextMetrics = this.calculateContextWindowMetrics(context);

      const metadata = {
        lastActivity: new Date(),
        messageCount: context.messages.length,
        totalTokens: this.calculateTotalTokens(context),
        lastModel: context.request.model || context.config.model,
        mcpCallsCount: context.mcpCalls?.length || 0,
        hasCoT: context.messages.some(msg => msg.metadata?.hasCoT),
        systemPrompt: context.systemPrompt || null,
        promptEngineering: context.promptEngineering ? {
          appliedTechniques: context.promptEngineering.appliedTechniques,
          tokensAdded: context.promptEngineering.tokensAdded,
          systemPrompt: context.promptEngineering.systemPrompt,
          metadata: context.promptEngineering.metadata
        } : null,
        // Context Window Metrics
        contextTokensInput: contextMetrics.inputTokens,
        contextTokensOutput: contextMetrics.outputTokens,
        contextTokensTotal: contextMetrics.totalTokens,
        contextWindowSize: contextMetrics.contextWindowSize,
        contextUtilizationPct: contextMetrics.utilizationPercentage
      };

      await this.sessionService.updateSessionMetadata(context.session.id, metadata);
      
    } catch (error) {
      this.logger.warn({ 
        sessionId: context.session.id,
        error: error.message 
      }, 'Failed to update session metadata');
    }
  }

  private generateResponseSummary(context: PipelineContext): any {
    const lastMessage = this.getLastAssistantMessage(context);
    
    return {
      hasResponse: !!lastMessage,
      responseLength: lastMessage?.content?.length || 0,
      hasToolCalls: !!(lastMessage?.toolCalls?.length),
      toolCallCount: lastMessage?.toolCalls?.length || 0,
      hasAttachments: !!(lastMessage?.attachments?.length),
      attachmentCount: lastMessage?.attachments?.length || 0,
      hasCoT: !!(lastMessage?.metadata?.hasCoT),
      cotSteps: lastMessage?.metadata?.cotSteps?.length || 0,
      tokenUsage: this.extractTokenUsage(context),
      processingTime: Date.now() - context.startTime.getTime()
    };
  }

  private getLastAssistantMessage(context: PipelineContext): ChatMessage | null {
    for (let i = context.messages.length - 1; i >= 0; i--) {
      if (context.messages[i].role === 'assistant') {
        return context.messages[i];
      }
    }
    return null;
  }

  private getResponseLength(context: PipelineContext): number {
    const lastMessage = this.getLastAssistantMessage(context);
    return lastMessage?.content?.length || 0;
  }

  private extractTokenUsage(context: PipelineContext): any {
    const lastMessage = this.getLastAssistantMessage(context);
    return lastMessage?.tokenUsage || null;
  }

  private calculateTotalTokens(context: PipelineContext): number {
    return context.messages.reduce((total, msg) => {
      const usage = msg.tokenUsage;
      if (usage && usage.total_tokens) {
        return total + usage.total_tokens;
      }
      return total;
    }, 0);
  }

  /**
   * Calculate context window metrics for the session
   * Tracks token usage and context window utilization
   */
  private calculateContextWindowMetrics(context: PipelineContext): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextWindowSize: number | null;
    utilizationPercentage: number | null;
  } {
    let inputTokens = 0;
    let outputTokens = 0;

    // Sum up tokens from all messages in the session
    context.messages.forEach(msg => {
      const usage = msg.tokenUsage;
      if (usage) {
        // Handle different token usage formats
        if (usage.prompt_tokens !== undefined) {
          inputTokens += usage.prompt_tokens || 0;
        }
        if (usage.completion_tokens !== undefined) {
          outputTokens += usage.completion_tokens || 0;
        }
      }
    });

    const totalTokens = inputTokens + outputTokens;

    // Get context window size based on the model
    const model = context.request.model || context.config.model || '';
    const contextWindowSize = this.getModelContextWindowSize(model);

    // Calculate utilization percentage
    let utilizationPercentage: number | null = null;
    if (contextWindowSize && totalTokens > 0) {
      utilizationPercentage = Math.round((totalTokens / contextWindowSize) * 100 * 100) / 100; // Round to 2 decimal places
    }

    this.logger.debug({
      sessionId: context.session?.id,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      contextWindowSize,
      utilizationPercentage
    }, 'Calculated context window metrics');

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      contextWindowSize,
      utilizationPercentage
    };
  }

  /**
   * Get the maximum context window size for a given model
   * Returns the model's token limit
   */
  private getModelContextWindowSize(model: string): number | null {
    // Safety guard for undefined/null model
    if (!model) {
      return null;
    }

    // Use centralized ModelCapabilityRegistry for context window lookup
    const registry = getModelCapabilityRegistry();
    if (registry) {
      const contextWindow = registry.getContextWindow(model);
      if (contextWindow > 0) {
        return contextWindow;
      }
    }

    // Fallback: basic estimates if registry not initialized
    const modelLower = model.toLowerCase();
    if (modelLower.includes('gemini')) return 1000000;
    if (modelLower.includes('claude')) return 200000;
    if (modelLower.includes('gpt-4-turbo') || modelLower.includes('o1')) return 128000;
    if (modelLower.includes('gpt-4')) return 8192;

    // Default fallback
    this.logger.warn({ model }, 'Unknown model for context window size calculation - using default 8192');
    return 8192;
  }

  /**
   * Process and render visualizations (math) in the response
   * - LaTeX math (inline and block)
   * NOTE: Charts are rendered client-side from ```chart-json code blocks
   * NOTE: Diagrams use React Flow client-side from ```diagram code blocks
   */
  private async processVisualizationsInResponse(context: PipelineContext): Promise<void> {
    try {
      const lastMessage = this.getLastAssistantMessage(context);
      if (!lastMessage || !lastMessage.content) {
        return;
      }

      let content = lastMessage.content;
      const visualizations: any[] = [];

      // Process LaTeX math (both inline and block)
      // Block math: $$...$$
      const blockMathRegex = /\$\$([\s\S]*?)\$\$/g;
      let blockMathMatch;
      while ((blockMathMatch = blockMathRegex.exec(content)) !== null) {
        visualizations.push({
          type: 'math_block',
          original: blockMathMatch[0],
          latex: blockMathMatch[1],
          display: true
        });
        
        content = content.replace(
          blockMathMatch[0],
          `[MATH:BLOCK:${visualizations.length - 1}]`
        );
      }

      // Inline math: $...$
      const inlineMathRegex = /\$([^\$\n]+)\$/g;
      let inlineMathMatch;
      while ((inlineMathMatch = inlineMathRegex.exec(content)) !== null) {
        visualizations.push({
          type: 'math_inline',
          original: inlineMathMatch[0],
          latex: inlineMathMatch[1],
          display: false
        });
        
        content = content.replace(
          inlineMathMatch[0],
          `[MATH:INLINE:${visualizations.length - 1}]`
        );
      }

      // Update message if we found any math visualizations
      if (visualizations.length > 0) {
        lastMessage.content = content;
        lastMessage.visualizations = visualizations;

        // Add metadata for UI rendering
        lastMessage.metadata = {
          ...lastMessage.metadata,
          hasVisualizations: true,
          visualizationCount: visualizations.length,
          visualizationTypes: [...new Set(visualizations.map(v => v.type))]
        };

        this.logger.info({
          messageId: lastMessage.id,
          visualizationCount: visualizations.length,
          types: lastMessage.metadata.visualizationTypes
        }, 'Processed visualizations in response');
      }

    } catch (error) {
      this.logger.error({ error }, 'Failed to process visualizations');
    }
  }

  async rollback(context: PipelineContext): Promise<void> {
    try {
      // CRITICAL FIX: Only remove messages created during THIS failed pipeline execution
      // Don't remove messages from previous successful interactions
      const messagesToRemove = context.messages.filter(msg => {
        // Only remove messages that match the CURRENT messageId
        // This preserves all previous messages in the conversation
        return (
          msg.id === context.messageId ||
          msg.id === `assistant_${context.messageId}` ||
          msg.id === `system_${context.messageId}` ||
          // Only remove tool messages that are part of the current request
          (msg.id.startsWith(`tool_`) && msg.id.includes(context.messageId))
        );
      });

      // Batch remove messages to avoid N+1 queries
      if (messagesToRemove.length > 0) {
        const messageIds = messagesToRemove.map(msg => msg.id);

        this.logger.info({
          messageId: context.messageId,
          messagesToRemove: messageIds,
          totalMessages: context.messages.length,
          preservedMessages: context.messages.length - messagesToRemove.length
        }, 'Rolling back only current failed messages, preserving conversation history');

        await this.sessionService.removeMessages(context.session.id, messageIds);
      } else {
        this.logger.debug({
          messageId: context.messageId,
          totalMessages: context.messages.length
        }, 'No messages to remove during rollback - conversation history preserved');
      }

      this.logger.debug({
        messageId: context.messageId,
        removedCount: messagesToRemove.length,
        preservedCount: context.messages.length - messagesToRemove.length
      }, 'Response stage rollback completed - previous messages preserved');

    } catch (error) {
      this.logger.error({
        messageId: context.messageId,
        error: error.message
      }, 'Response stage rollback failed');
    }
  }

  /**
   * Emit knowledge event for async processing
   */
  private async emitKnowledgeEvent(context: PipelineContext): Promise<void> {
    try {
      // Only emit for conversations with meaningful exchanges
      const messageCount = context.messages.filter(m => m.role !== 'system').length;
      if (messageCount < 2) {
        return;
      }
      
      // Get Redis client from context
      const redis = (context as any).redis;
      if (!redis) {
        this.logger.debug('Redis not available for knowledge event emission');
        return;
      }
      
      // Prepare event data
      const event = {
        sessionId: context.session.id,
        userId: context.user.id,
        messages: context.messages,
        timestamp: new Date(),
        metadata: {
          model: (context as any).modelConfig?.model || 'unknown',
          temperature: (context as any).modelConfig?.temperature || 1.0,
          toolsUsed: (context as any).toolCalls?.length > 0 || false
        }
      };
      
      // Publish event to Redis
      await redis.publish('conversation:completed', JSON.stringify(event));
      
      this.logger.debug({ 
        sessionId: context.session.id,
        userId: context.user.id,
        messageCount 
      }, 'Knowledge event emitted for async processing');
      
    } catch (error) {
      // Don't throw - this is a background task
      this.logger.error({ 
        error: error.message,
        sessionId: context.session?.id 
      }, 'Failed to emit knowledge event');
    }
  }

  /**
   * Update Redis SessionCache with current conversation
   * Critical for Redis-first architecture - enables fast retrieval on next request
   */
  private async updateRedisSessionCache(context: PipelineContext): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info({
        sessionId: context.session.id,
        userId: context.user.id
      }, '╔═══════════════════════════════════════════════════════════════');
      this.logger.info('║ [CACHE-UPDATE] 💾 Updating Redis SessionCache');
      this.logger.info('╚═══════════════════════════════════════════════════════════════');

      // Get MemoryContextService from context
      const memoryContextService = (context as any).memoryContextService;
      if (!memoryContextService) {
        this.logger.warn('│ [REDIS] ⚠️  UNAVAILABLE: MemoryContextService not available for cache update');
        return;
      }

      // Filter out system messages
      const conversationMessages = context.messages.filter(m => m.role !== 'system');

      if (conversationMessages.length === 0) {
        this.logger.warn('│ [REDIS] ⚠️  SKIP: No messages to cache');
        return;
      }

      this.logger.info({
        totalMessages: conversationMessages.length,
        roles: conversationMessages.map(m => m.role).join(' → '),
        lastThreeMessages: conversationMessages.slice(-3).map(m => ({
          role: m.role,
          hasContent: !!m.content,
          hasToolCalls: !!m.toolCalls,
          hasToolCallId: !!m.toolCallId
        }))
      }, '│ [REDIS] 📊 Preparing messages for cache');

      // Calculate context tokens
      const contextTokens = conversationMessages.reduce((total, msg) => {
        return total + (msg.tokenUsage?.total_tokens || 0);
      }, 0);

      // Extract entities from recent messages
      const recentContent = conversationMessages
        .slice(-3) // Last 3 messages
        .map(m => m.content || '')
        .join(' ');

      const entities = this.extractEntitiesFromText(recentContent);
      const topic = this.inferTopicFromMessages(conversationMessages);

      this.logger.info({
        contextTokens,
        topic,
        entities: entities.length,
        entityList: entities.slice(0, 5)
      }, '│ [REDIS] 🏷️  Extracted metadata');

      // Prepare session cache data
      const sessionCache = {
        userId: context.user.id,
        sessionId: context.session.id,
        messages: conversationMessages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content || '',
          toolCalls: m.toolCalls,
          toolCallId: m.toolCallId,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          model: m.model,
          tokenUsage: m.tokenUsage
        })),
        contextTokens,
        lastTopic: topic,
        activeEntities: entities,
        lastActivity: Date.now(),
        metadata: {
          messageCount: conversationMessages.length,
          averageResponseTime: 0,
          topicChanges: 0
        }
      };

      this.logger.info({
        cacheSize: JSON.stringify(sessionCache).length,
        messageCount: sessionCache.messages.length,
        compress: true,
        ttl: 3600
      }, '│ [REDIS] 💾 Writing to Redis cache...');

      // Update Redis cache via MemoryContextService
      const cacheStartTime = Date.now();
      await memoryContextService.getCache().setSessionCache(
        context.user.id,
        context.session.id,
        sessionCache as any,
        { ttl: 3600, compress: true } // 1 hour TTL, compress for large conversations
      );
      const cacheTime = Date.now() - cacheStartTime;

      const totalTime = Date.now() - startTime;

      this.logger.info({
        userId: context.user.id,
        sessionId: context.session.id,
        messageCount: conversationMessages.length,
        contextTokens,
        topic,
        cacheTimeMs: cacheTime,
        totalTimeMs: totalTime,
        performance: cacheTime < 50 ? '🚀 FAST' : cacheTime < 200 ? '✅ OK' : '⚠️  SLOW'
      }, '┌─────────────────────────────────────────────────────────────');
      this.logger.info({
        nextRequest: 'Will load from Redis cache (fast!)',
        ttl: '1 hour',
        sliding: 'Yes (extends on each access)'
      }, '│ [REDIS] ✅ SUCCESS: SessionCache updated');
      this.logger.info('└─────────────────────────────────────────────────────────────');

    } catch (error) {
      const totalTime = Date.now() - startTime;
      // Don't throw - this is a background optimization
      this.logger.error({
        error: error.message,
        errorStack: error.stack,
        sessionId: context.session?.id,
        userId: context.user?.id,
        totalTimeMs: totalTime
      }, '│ [REDIS] ❌ ERROR: Failed to update SessionCache');
      this.logger.warn('│ [REDIS] ⚠️  IMPACT: Next request will load from PostgreSQL (slower)');
    }
  }

  /**
   * Extract entities from text (simple keyword extraction)
   */
  private extractEntitiesFromText(text: string): string[] {
    const entities: string[] = [];

    // Common tech/business terms
    const keywords = ['azure', 'aws', 'kubernetes', 'docker', 'api', 'database', 'deploy', 'production', 'testing'];
    keywords.forEach(keyword => {
      if (text.toLowerCase().includes(keyword)) {
        entities.push(keyword);
      }
    });

    // Capitalized words (likely proper nouns)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+\b/g) || [];
    entities.push(...capitalizedWords.slice(0, 5));

    return [...new Set(entities)]; // Deduplicate
  }

  /**
   * Infer topic from conversation messages
   */
  private inferTopicFromMessages(messages: any[]): string {
    const content = messages
      .map(m => m.content || '')
      .join(' ')
      .toLowerCase();

    if (content.includes('azure') || content.includes('cloud')) return 'cloud_infrastructure';
    if (content.includes('code') || content.includes('programming')) return 'programming';
    if (content.includes('deploy') || content.includes('kubernetes')) return 'deployment';
    if (content.includes('error') || content.includes('debug')) return 'troubleshooting';
    if (content.includes('meeting') || content.includes('schedule')) return 'meetings';

    return 'general';
  }

  /**
   * Index conversation for the tiered memory system
   * This runs asynchronously to not block the response
   */
  private async indexConversationForMemory(context: PipelineContext): Promise<void> {
    try {
      // Index even with 2 messages (1 user + 1 assistant) to capture all conversations
      const messageCount = context.messages.filter(m => m.role !== 'system').length;
      if (messageCount < 2) {
        return; // Need at least one exchange
      }

      // Check if enough time has passed since last indexing (avoid over-indexing)
      const sessionId = context.session.id;
      const userId = context.user.id;
      const now = Date.now();

      // Use context metadata to track last index time
      const lastIndexTime = (context as any).lastIndexTime || 0;
      const minIndexInterval = 30 * 1000; // 30 seconds minimum between indexes (was 5 minutes)

      if (now - lastIndexTime < minIndexInterval) {
        this.logger.debug('Skipping indexing - too soon since last index');
        return;
      }

      // Get Milvus service instance from context
      const milvusService = (context as any).milvusService;
      if (!milvusService) {
        this.logger.warn('MilvusVectorService not available in context for indexing');
        return;
      }

      // Index the conversation
      await milvusService.indexConversation(userId, sessionId, context.messages);
      this.logger.info({
        userId,
        sessionId,
        messageCount,
        indexed: true
      }, 'Conversation successfully indexed in Milvus for semantic search');

      // Update last index time
      (context as any).lastIndexTime = now;

    } catch (error) {
      // Don't throw - this is a background task
      this.logger.error({
        error: error.message,
        sessionId: context.session?.id,
        userId: context.user?.id
      }, 'Failed to index conversation for memory');
    }
  }

  /**
   * Track prompt usage for this request/response
   */
  private async trackPromptUsage(context: PipelineContext, messageId: string): Promise<void> {
    try {
      if (!context.promptUsageData) {
        this.logger.debug('No prompt usage data to track');
        return;
      }

      const { PromptUsageTrackingService } = await import('../../../services/PromptUsageTrackingService.js');
      const trackingService = new PromptUsageTrackingService(this.logger);

      // Add message ID to the tracking data
      const trackingData = {
        ...context.promptUsageData,
        messageId
      };

      await trackingService.trackPromptUsage(trackingData);

      this.logger.info({
        messageId,
        sessionId: context.request.sessionId,
        userId: context.user.id,
        baseTemplate: trackingData.baseTemplateName,
        domainTemplate: trackingData.domainTemplateName,
        techniquesCount: trackingData.techniquesApplied?.length || 0,
        hasRag: trackingData.hasRagContext,
        hasMemory: trackingData.hasMemoryContext
      }, '│ [SAVE] 📊 Prompt usage tracked');

    } catch (error) {
      // Don't throw - tracking failures shouldn't break the chat flow
      this.logger.error({
        error: error.message,
        messageId,
        sessionId: context.request.sessionId
      }, 'Failed to track prompt usage');
    }
  }
}
