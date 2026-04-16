/**
 * AI-Powered Title Generation Handler
 * 
 * Provides endpoints for generating and regenerating chat session titles
 * using AI models through the active LLM provider
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AITitleGenerationService } from '../../../services/AITitleGenerationService.js';
import { TitleGenerationClient } from '../../../services/TitleGenerationClient.js';
import type { Logger } from 'pino';
import type { AuthenticatedRequest } from '../../../types/index.js';

interface TitleGenerateRequest extends AuthenticatedRequest {
  body: {
    sessionId: string;
    style?: 'concise' | 'descriptive' | 'creative';
    regenerate?: boolean;
  };
  params: {
    sessionId: string;
  };
}

interface TitleSuggestRequest extends AuthenticatedRequest {
  body: {
    message: string;
    count?: number;
    style?: 'concise' | 'descriptive' | 'creative';
  };
}

export class TitleGenerationHandler {
  private titleService: AITitleGenerationService;
  private titleClient: TitleGenerationClient;
  private logger: Logger;

  constructor(
    private chatStorage: any,
    logger: Logger
  ) {
    this.logger = logger.child({ handler: 'TitleGeneration' });
    this.titleClient = new TitleGenerationClient(this.logger);
    this.titleService = new AITitleGenerationService(
      this.logger,
      {
        useLLM: true,
        maxLength: 60
      },
      this.titleClient
    );
  }

  /**
   * Generate or regenerate title for an existing session
   * POST /chat/sessions/:sessionId/title
   */
  async generateTitle(request: TitleGenerateRequest, reply: FastifyReply) {
    const { sessionId, style = 'concise', regenerate = false } = request.body;
    const userId = request.user!.id;

    try {
      // Verify session ownership
      const session = await this.chatStorage.getSession(sessionId, userId);
      if (!session) {
        return reply.code(404).send({
          error: 'Session not found'
        });
      }

      // Get session messages
      const messages = await this.chatStorage.getSessionMessages(sessionId, {
        limit: 5 // Use first few messages for context
      });

      if (!messages || messages.length === 0) {
        return reply.code(400).send({
          error: 'No messages in session to generate title from'
        });
      }

      // Update title generation style
      this.titleService.updateOptions({ style });

      // Clear cache if regenerating
      if (regenerate) {
        this.titleService.clearCache();
      }

      // Generate new title
      const title = await this.titleService.generateTitle(messages);

      // Update session with new title
      await this.chatStorage.updateSession(sessionId, userId, {
        title,
        metadata: {
          ...session.metadata,
          titleGeneratedAt: new Date().toISOString(),
          titleGeneratedBy: 'ai',
          titleModel: process.env.TITLE_GENERATION_MODEL || process.env.DEFAULT_MODEL
        }
      });

      this.logger.info({
        sessionId,
        userId,
        oldTitle: session.title,
        newTitle: title,
        regenerated: regenerate
      }, 'Title generated successfully');

      return reply.send({
        title,
        sessionId,
        previousTitle: session.title,
        generatedAt: new Date().toISOString()
      });

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        sessionId,
        userId
      }, 'Failed to generate title');

      return reply.code(500).send({
        error: 'Failed to generate title',
        message: error.message
      });
    }
  }

  /**
   * Get title suggestions for a message
   * POST /chat/title/suggest
   */
  async suggestTitles(request: TitleSuggestRequest, reply: FastifyReply) {
    const { message, count = 3, style = 'concise' } = request.body;

    if (!message || message.trim().length < 3) {
      return reply.code(400).send({
        error: 'Message too short to generate title suggestions'
      });
    }

    try {
      // Generate multiple title suggestions
      const titles = await this.titleClient.generateMultipleTitles(
        message,
        count,
        style
      );

      this.logger.info({
        messageLength: message.length,
        titlesGenerated: titles.length,
        style
      }, 'Title suggestions generated');

      return reply.send({
        suggestions: titles,
        message: message.substring(0, 100),
        style,
        generatedAt: new Date().toISOString()
      });

    } catch (error: any) {
      this.logger.error({
        error: error.message
      }, 'Failed to generate title suggestions');

      // Fallback to non-AI generation
      const fallbackTitle = this.extractSimpleTitle(message);
      
      return reply.send({
        suggestions: [fallbackTitle],
        message: message.substring(0, 100),
        style,
        generatedAt: new Date().toISOString(),
        fallback: true
      });
    }
  }

  /**
   * Batch generate titles for multiple sessions
   * POST /chat/title/batch
   */
  async batchGenerateTitles(request: AuthenticatedRequest, reply: FastifyReply) {
    const userId = request.user!.id;

    try {
      // Get sessions without proper titles
      const sessions = await this.chatStorage.getSessionsForUser(userId, {
        limit: 50
      });

      const sessionsNeedingTitles = sessions.filter(
        s => !s.title || s.title === 'New Chat' || s.title.startsWith('Chat ')
      );

      const results = [];

      for (const session of sessionsNeedingTitles) {
        try {
          // Get messages for this session
          const messages = await this.chatStorage.getSessionMessages(session.id, {
            limit: 3
          });

          if (messages && messages.length > 0) {
            const title = await this.titleService.generateTitle(messages);
            
            await this.chatStorage.updateSession(session.id, userId, {
              title,
              metadata: {
                ...session.metadata,
                titleGeneratedAt: new Date().toISOString(),
                titleGeneratedBy: 'ai-batch'
              }
            });

            results.push({
              sessionId: session.id,
              oldTitle: session.title,
              newTitle: title,
              success: true
            });
          }
        } catch (error: any) {
          results.push({
            sessionId: session.id,
            oldTitle: session.title,
            error: error.message,
            success: false
          });
        }
      }

      this.logger.info({
        userId,
        processed: results.length,
        successful: results.filter(r => r.success).length
      }, 'Batch title generation completed');

      return reply.send({
        processed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      });

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        userId
      }, 'Batch title generation failed');

      return reply.code(500).send({
        error: 'Batch title generation failed',
        message: error.message
      });
    }
  }

  /**
   * Simple fallback title extraction
   */
  private extractSimpleTitle(message: string): string {
    const cleaned = message
      .replace(/^(please |can you |could you |help me |i need |i want )/gi, '')
      .trim();
    
    const words = cleaned.split(/\s+/).slice(0, 5);
    return words.map(w => 
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');
  }
}

/**
 * Register title generation routes
 */
export async function registerTitleRoutes(
  fastify: any,
  options: { 
    chatStorage: any;
    logger: Logger;
  }
) {
  const handler = new TitleGenerationHandler(options.chatStorage, options.logger);

  // Generate/regenerate title for a session
  fastify.post('/chat/sessions/:sessionId/title', {
    schema: {
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          style: { 
            type: 'string', 
            enum: ['concise', 'descriptive', 'creative'] 
          },
          regenerate: { type: 'boolean' }
        },
        required: ['sessionId']
      },
      response: {
        200: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            sessionId: { type: 'string' },
            previousTitle: { type: 'string' },
            generatedAt: { type: 'string' }
          }
        }
      }
    }
  }, (req: TitleGenerateRequest, reply: FastifyReply) => 
    handler.generateTitle(req, reply)
  );

  // Get title suggestions
  fastify.post('/chat/title/suggest', {
    schema: {
      body: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          count: { type: 'number', minimum: 1, maximum: 10 },
          style: { 
            type: 'string', 
            enum: ['concise', 'descriptive', 'creative'] 
          }
        },
        required: ['message']
      }
    }
  }, (req: TitleSuggestRequest, reply: FastifyReply) => 
    handler.suggestTitles(req, reply)
  );

  // Batch generate titles
  fastify.post('/chat/title/batch', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            processed: { type: 'number' },
            successful: { type: 'number' },
            failed: { type: 'number' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  oldTitle: { type: 'string' },
                  newTitle: { type: 'string' },
                  success: { type: 'boolean' },
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, (req: AuthenticatedRequest, reply: FastifyReply) => 
    handler.batchGenerateTitles(req, reply)
  );

  options.logger.info('Title generation routes registered');
}