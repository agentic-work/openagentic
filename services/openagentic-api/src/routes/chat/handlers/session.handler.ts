/**
 * Session Handler for Chat API
 *
 * Handles CRUD operations for chat sessions
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../../middleware/unifiedAuth.js';
import { ChatSessionService } from '../services/ChatSessionService.js';
import { ModelConfigurationService } from '../../../services/ModelConfigurationService.js';
import { chatSessionsTotal } from '../../../metrics/index.js';

export interface CreateSessionRequest extends AuthenticatedRequest {
  body: {
    title?: string;
    model?: string;
    metadata?: Record<string, any>;
  };
}

export interface UpdateSessionRequest extends AuthenticatedRequest {
  params: {
    sessionId: string;
  };
  body: {
    title?: string;
    metadata?: Record<string, any>;
    isActive?: boolean;
  };
}

export interface SessionParamsRequest extends AuthenticatedRequest {
  params: {
    sessionId: string;
  };
}

export interface ListSessionsRequest extends AuthenticatedRequest {
  query: {
    limit?: string;
    offset?: string;
    sortBy?: 'updated_at' | 'created_at';
    sortOrder?: 'asc' | 'desc';
  };
}

export interface SearchSessionsRequest extends AuthenticatedRequest {
  query: {
    q: string;
    limit?: string;
    offset?: string;
  };
}

/**
 * Session handlers
 */
export const sessionHandler = {
  /**
   * Create new session
   */
  create: (sessionService: ChatSessionService) => {
    return async (request: CreateSessionRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
            }
          });
        }

        const requestedTitle = request.body.title || 'New Chat';
        
        // Check for existing empty "New Chat" sessions created in the last 5 seconds
        // This prevents rapid duplicate creation from UI race conditions
        if (requestedTitle === 'New Chat') {
          try {
            const recentSessions = await sessionService.listSessions(request.user.id, {
              limit: 10,
              offset: 0,
              sortBy: 'created_at',
              sortOrder: 'desc'
            });
            
            // Find an empty New Chat session created in last 5 seconds
            const now = Date.now();
            const existingEmptySession = recentSessions.find(s => {
              if (s.title !== 'New Chat' || s.messageCount > 0) return false;
              const createdTime = new Date(s.createdAt).getTime();
              const ageMs = now - createdTime;
              return ageMs < 5000; // 5 seconds
            });
            
            if (existingEmptySession) {
              request.log.info({ 
                sessionId: existingEmptySession.id,
                age: now - new Date(existingEmptySession.createdAt).getTime()
              }, 'Reusing recent empty session instead of creating duplicate');
              
              return reply.code(201).send({
                session: existingEmptySession,
                success: true,
                reused: true
              });
            }
          } catch (listError) {
            // Non-critical error, proceed with creation
            request.log.warn({ error: listError.message }, 'Could not check for existing sessions');
          }
        }

        // Generate session ID
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Get default model from centralized ModelConfigurationService
        // Priority: user request → database LLM provider config → env var → fallback
        const defaultModel = request.body.model || await ModelConfigurationService.getDefaultChatModel();

        // Create session
        const createdSessionId = await sessionService.createSession(request.user.id, {
          sessionId,
          title: requestedTitle,
          model: defaultModel,
          metadata: request.body.metadata || {}
        });

        // Increment session counter for Grafana dashboards
        chatSessionsTotal.inc({ user_id: request.user.id });

        // Get the created session
        const session = await sessionService.getSession(createdSessionId, request.user.id);

        // Track this as user's last active session for quick resume
        await sessionService.setLastActiveSession(request.user.id, createdSessionId);

        return reply.code(201).send({
          session,
          success: true
        });

      } catch (error) {
        request.log.error({ error: error.message }, 'Failed to create session');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_CREATION_FAILED',
            message: 'Failed to create session'
          }
        });
      }
    };
  },

  /**
   * List user sessions
   */
  list: (sessionService: ChatSessionService) => {
    return async (request: ListSessionsRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
            }
          });
        }

        const options = {
          limit: request.query.limit ? parseInt(request.query.limit, 10) : 50,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : 0,
          sortBy: request.query.sortBy || 'updated_at',
          sortOrder: request.query.sortOrder || 'desc'
        };

        // Validate pagination parameters
        if (options.limit > 100) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_LIMIT',
              message: 'Limit cannot exceed 100'
            }
          });
        }

        const sessions = await sessionService.listSessions(request.user.id, options);
        
        // Get last active session - try Redis cache first for instant resume
        let lastActiveSessionId = await sessionService.getLastActiveSession(request.user.id);
        
        // Fall back to most recent session if no cached value
        if (!lastActiveSessionId && sessions.length > 0) {
          lastActiveSessionId = sessions[0].id;
        }
        
        // Validate that the last active session still exists in the list
        if (lastActiveSessionId && !sessions.find(s => s.id === lastActiveSessionId)) {
          // Cached session was deleted, use most recent instead
          lastActiveSessionId = sessions.length > 0 ? sessions[0].id : null;
        }

        return reply.send({
          sessions,
          lastActiveSessionId,
          pagination: {
            limit: options.limit,
            offset: options.offset,
            hasMore: sessions.length === options.limit
          },
          success: true
        });

      } catch (error) {
        request.log.error({ error: error.message }, 'Failed to list sessions');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_LIST_FAILED',
            message: 'Failed to list sessions'
          }
        });
      }
    };
  },

  /**
   * Get specific session
   */
  get: (sessionService: ChatSessionService) => {
    return async (request: SessionParamsRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
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

        const session = await sessionService.getSession(sessionId, request.user.id);

        if (!session) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        // Track this as user's last active session for quick resume
        await sessionService.setLastActiveSession(request.user.id, sessionId);

        return reply.send({
          session,
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          error: error.message 
        }, 'Failed to get session');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_GET_FAILED',
            message: 'Failed to get session'
          }
        });
      }
    };
  },

  /**
   * Update session
   */
  update: (sessionService: ChatSessionService) => {
    return async (request: UpdateSessionRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
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

        // Check if session exists
        const existingSession = await sessionService.getSession(sessionId, request.user.id);
        if (!existingSession) {
          return reply.code(404).send({
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Session not found'
            }
          });
        }

        // Update session metadata
        const updateData: Record<string, any> = {};
        
        if (request.body.title !== undefined) {
          updateData.title = request.body.title;
        }
        
        if (request.body.metadata !== undefined) {
          updateData.metadata = {
            ...existingSession.metadata,
            ...request.body.metadata
          };
        }
        
        if (request.body.isActive !== undefined) {
          updateData.isActive = request.body.isActive;
        }

        await sessionService.updateSessionMetadata(sessionId, updateData);

        // Get updated session
        const updatedSession = await sessionService.getSession(sessionId, request.user.id);

        return reply.send({
          session: updatedSession,
          success: true
        });

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          error: error.message 
        }, 'Failed to update session');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_UPDATE_FAILED',
            message: 'Failed to update session'
          }
        });
      }
    };
  },

  /**
   * Delete session
   */
  delete: (sessionService: ChatSessionService) => {
    return async (request: SessionParamsRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
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

        // Try to delete the session
        // Note: We don't check if it exists first because it might already be soft-deleted
        // The deleteSession method will handle this gracefully
        try {
          await sessionService.deleteSession(sessionId, request.user.id);
          
          return reply.send({
            success: true,
            message: 'Session deleted successfully'
          });
        } catch (deleteError) {
          // If delete fails, check if session exists to provide better error message
          const existingSession = await sessionService.getSession(sessionId, request.user.id);
          if (!existingSession) {
            // Session doesn't exist or is already deleted - return success
            // This handles the case where the UI tries to delete an already deleted session
            return reply.send({
              success: true,
              message: 'Session already deleted or does not exist'
            });
          }
          
          // If session exists but delete failed, throw the original error
          throw deleteError;
        }

      } catch (error) {
        request.log.error({ 
          sessionId: request.params.sessionId,
          error: error.message 
        }, 'Failed to delete session');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_DELETE_FAILED',
            message: 'Failed to delete session'
          }
        });
      }
    };
  },

  /**
   * Search sessions
   */
  search: (sessionService: ChatSessionService) => {
    return async (request: SearchSessionsRequest, reply: FastifyReply) => {
      try {
        // Ensure user is authenticated
        if (!request.user) {
          return reply.code(401).send({
            error: {
              code: 'AUTHENTICATION_REQUIRED',
              message: 'User authentication required'
            }
          });
        }

        const query = request.query.q;
        if (!query || query.trim().length === 0) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_QUERY',
              message: 'Search query is required'
            }
          });
        }

        const options = {
          limit: request.query.limit ? parseInt(request.query.limit, 10) : 20,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : 0
        };

        // Validate pagination parameters
        if (options.limit > 50) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_LIMIT',
              message: 'Search limit cannot exceed 50'
            }
          });
        }

        const sessions = await sessionService.searchSessions(
          request.user.id,
          query.trim(),
          options
        );

        return reply.send({
          sessions,
          query: query.trim(),
          pagination: {
            limit: options.limit,
            offset: options.offset,
            hasMore: sessions.length === options.limit
          },
          success: true
        });

      } catch (error) {
        request.log.error({ 
          query: request.query.q,
          error: error.message 
        }, 'Failed to search sessions');
        
        return reply.code(500).send({
          error: {
            code: 'SESSION_SEARCH_FAILED',
            message: 'Failed to search sessions'
          }
        });
      }
    };
  }
};