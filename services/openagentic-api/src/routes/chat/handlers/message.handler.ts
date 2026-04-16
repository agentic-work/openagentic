/**
 * Message Handler for Chat API
 * 
 * Handles message retrieval and management within sessions
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../../middleware/unifiedAuth.js';
import { ChatSessionService } from '../services/ChatSessionService.js';

export interface MessageParamsRequest extends AuthenticatedRequest {
  params: {
    sessionId: string;
    messageId?: string;
  };
}

export interface ListMessagesRequest extends AuthenticatedRequest {
  params: {
    sessionId: string;
  };
  query: {
    limit?: string;
    offset?: string;
    before?: string; // Message ID to get messages before
    after?: string;  // Message ID to get messages after
    includeSystem?: string; // Include system messages
  };
}

/**
 * Message handlers
 */
export const messageHandler = {
  /**
   * List messages in a session
   */
  list: (sessionService: ChatSessionService) => {
    return async (request: ListMessagesRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required'
            }
          });
        }

        const { sessionId } = request.params;

        if (!sessionId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_SESSION_ID',
              message: 'Session ID is required'
            }
          });
        }

        // Check if session exists and user has access
        const session = await sessionService.getSession(sessionId, request.user.id);
        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        // Parse query parameters
        const options = {
          limit: request.query.limit ? parseInt(request.query.limit, 10) : 1000, // Default to 1000 messages
          offset: request.query.offset ? parseInt(request.query.offset, 10) : 0,
          before: request.query.before,
          after: request.query.after,
          includeSystem: request.query.includeSystem === 'true'
        };

        // Validate pagination parameters
        if (options.limit > 1000) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_LIMIT',
              message: 'Limit cannot exceed 1000'
            }
          });
        }

        // Get messages from session
        let messages = session.messages || [];

        // Filter system messages if not requested
        if (!options.includeSystem) {
          messages = messages.filter(msg => msg.role !== 'system');
        }

        // Apply cursor-based pagination
        if (options.before) {
          const beforeIndex = messages.findIndex(msg => msg.id === options.before);
          if (beforeIndex > 0) {
            messages = messages.slice(0, beforeIndex);
          }
        }

        if (options.after) {
          const afterIndex = messages.findIndex(msg => msg.id === options.after);
          if (afterIndex >= 0 && afterIndex < messages.length - 1) {
            messages = messages.slice(afterIndex + 1);
          }
        }

        // Apply offset and limit
        const paginatedMessages = messages
          .slice(options.offset)
          .slice(0, options.limit);

        return reply.send({
          messages: paginatedMessages,
          session: {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt
          },
          pagination: {
            limit: options.limit,
            offset: options.offset,
            total: messages.length,
            hasMore: options.offset + options.limit < messages.length
          },
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          error: error.message 
        }, 'Failed to list messages');
        
        return reply.code(500).send({
          error: {
            code: 'MESSAGE_LIST_FAILED',
            message: 'Failed to list messages'
          }
        });
      }
    };
  },

  /**
   * Get specific message
   */
  get: (sessionService: ChatSessionService) => {
    return async (request: MessageParamsRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required'
            }
          });
        }

        const { sessionId, messageId } = request.params;

        if (!sessionId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_SESSION_ID',
              message: 'Session ID is required'
            }
          });
        }

        if (!messageId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_MESSAGE_ID',
              message: 'Message ID is required'
            }
          });
        }

        // Check if session exists and user has access
        const session = await sessionService.getSession(sessionId, request.user.id);
        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        // Find the specific message
        const message = session.messages?.find(msg => msg.id === messageId);
        if (!message) {
          return reply.code(404).send({
            error: {
              code: 'MESSAGE_NOT_FOUND',
              message: 'Message not found'
            }
          });
        }

        return reply.send({
          message,
          session: {
            id: session.id,
            title: session.title
          },
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          messageId: request.params.messageId,
          error: error.message 
        }, 'Failed to get message');
        
        return reply.code(500).send({
          error: {
            code: 'MESSAGE_GET_FAILED',
            message: 'Failed to get message'
          }
        });
      }
    };
  },

  /**
   * Delete specific message
   */
  delete: (sessionService: ChatSessionService) => {
    return async (request: MessageParamsRequest, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required'
            }
          });
        }

        const { sessionId, messageId } = request.params;

        if (!sessionId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_SESSION_ID',
              message: 'Session ID is required'
            }
          });
        }

        if (!messageId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_MESSAGE_ID',
              message: 'Message ID is required'
            }
          });
        }

        // Check if session exists and user has access
        const session = await sessionService.getSession(sessionId, request.user.id);
        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        // Check if message exists
        const messageExists = session.messages?.some(msg => msg.id === messageId);
        if (!messageExists) {
          return reply.code(404).send({
            error: {
              code: 'MESSAGE_NOT_FOUND',
              message: 'Message not found'
            }
          });
        }

        // Delete the message
        await sessionService.removeMessage(sessionId, messageId);

        return reply.send({
          success: true,
          message: 'Message deleted successfully'
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          messageId: request.params.messageId,
          error: error.message 
        }, 'Failed to delete message');
        
        return reply.code(500).send({
          error: {
            code: 'MESSAGE_DELETE_FAILED',
            message: 'Failed to delete message'
          }
        });
      }
    };
  },

  /**
   * Get message context (surrounding messages)
   */
  getContext: (sessionService: ChatSessionService) => {
    return async (request: MessageParamsRequest & {
      query: {
        contextSize?: string; // Number of messages before and after
      };
    }, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required'
            }
          });
        }

        const { sessionId, messageId } = request.params;
        const contextSize = request.query.contextSize ? parseInt(request.query.contextSize, 10) : 5;

        if (!sessionId || !messageId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_PARAMETERS',
              message: 'Session ID and Message ID are required'
            }
          });
        }

        // Check if session exists and user has access
        const session = await sessionService.getSession(sessionId, request.user.id);
        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        const messages = session.messages || [];
        const messageIndex = messages.findIndex(msg => msg.id === messageId);
        
        if (messageIndex === -1) {
          return reply.code(404).send({
            error: {
              code: 'MESSAGE_NOT_FOUND',
              message: 'Message not found'
            }
          });
        }

        // Get context messages
        const start = Math.max(0, messageIndex - contextSize);
        const end = Math.min(messages.length, messageIndex + contextSize + 1);
        const contextMessages = messages.slice(start, end);

        return reply.send({
          targetMessage: messages[messageIndex],
          contextMessages,
          contextInfo: {
            totalMessages: messages.length,
            messageIndex,
            contextStart: start,
            contextEnd: end - 1
          },
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          messageId: request.params.messageId,
          error: error.message 
        }, 'Failed to get message context');
        
        return reply.code(500).send({
          error: {
            code: 'MESSAGE_CONTEXT_FAILED',
            message: 'Failed to get message context'
          }
        });
      }
    };
  },

  /**
   * Search messages within a session
   */
  search: (sessionService: ChatSessionService) => {
    return async (request: MessageParamsRequest & {
      query: {
        q: string;
        limit?: string;
        role?: 'user' | 'assistant' | 'system';
      };
    }, reply: FastifyReply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required'
            }
          });
        }

        const { sessionId } = request.params;
        const { q: query, role } = request.query;
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;

        if (!sessionId) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_SESSION_ID',
              message: 'Session ID is required'
            }
          });
        }

        if (!query || query.trim().length === 0) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_QUERY',
              message: 'Search query is required'
            }
          });
        }

        // Check if session exists and user has access
        const session = await sessionService.getSession(sessionId, request.user.id);
        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        let messages = session.messages || [];

        // Filter by role if specified
        if (role) {
          messages = messages.filter(msg => msg.role === role);
        }

        // Simple text search (case-insensitive)
        const searchTerm = query.trim().toLowerCase();
        const matchingMessages = messages
          .filter(msg => 
            msg.content && 
            msg.content.toLowerCase().includes(searchTerm)
          )
          .slice(0, limit);

        return reply.send({
          messages: matchingMessages,
          query: query.trim(),
          filters: { role },
          results: {
            total: matchingMessages.length,
            limit
          },
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          query: request.query.q,
          error: error.message 
        }, 'Failed to search messages');
        
        return reply.code(500).send({
          error: {
            code: 'MESSAGE_SEARCH_FAILED',
            message: 'Failed to search messages'
          }
        });
      }
    };
  }
};