/**
 * Chat Session Service
 * 
 * Handles session management, message storage, and session metadata
 */

import { ChatSession, ChatMessage } from '../interfaces/chat.types.js';
import type { Logger } from 'pino';

export class ChatSessionService {
  constructor(
    private chatStorage: any,
    private logger: any,
    private cacheService?: any
  ) {
    this.logger = logger.child({ service: 'ChatSessionService' }) as Logger;

    // Log initialization state
    this.logger.info({
      hasChatStorage: !!this.chatStorage,
      chatStorageType: this.chatStorage ? this.chatStorage.constructor.name : 'None',
      hasCacheService: !!this.cacheService
    }, 'ChatSessionService initialized');
  }

  /**
   * Get session by ID and user ID
   */
  async getSession(sessionId: string, userId: string): Promise<ChatSession | null> {
    const startTime = Date.now();

    this.logger.info({
      sessionId,
      userId,
      hasChatStorage: !!this.chatStorage,
      hasCacheService: !!this.cacheService
    }, 'ChatSessionService.getSession called');

    try {
      // 1. Check cache first if caching is enabled
      if (this.cacheService) {
        const cached = await this.cacheService.getCachedSession(sessionId);
        if (cached) {
          this.logger.debug({
            sessionId,
            userId,
            source: 'cache',
            executionTime: Date.now() - startTime
          }, 'Session cache hit');
          return cached;
        }
        this.logger.debug({ sessionId, userId }, 'Session cache miss');
      }

      // 2. Cache miss or no cache - get from DB
      if (!this.chatStorage) {
        throw new Error('ChatStorage is not initialized');
      }

      const session = await this.chatStorage.getSession(sessionId, userId);

      this.logger.info({
        sessionId,
        userId,
        sessionFound: !!session,
        sessionData: session ? {
          id: session.id,
          title: session.title,
          messageCount: session.messageCount
        } : null,
        executionTime: Date.now() - startTime
      }, 'Session lookup result');

      if (!session) {
        this.logger.debug({ sessionId, userId }, 'Session not found in storage');
        return null;
      }

      // 3. Store in cache for next time (1 hour TTL)
      if (this.cacheService) {
        await this.cacheService.cacheSession(sessionId, session, 3600);
        this.logger.debug({ sessionId }, 'Session cached for future requests');
      }

      return session;

    } catch (error: any) {
      this.logger.error({
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        errorCode: error.code,
        sessionId,
        userId,
        executionTime: Date.now() - startTime
      }, 'Failed to get session');

      throw error;
    }
  }

  /**
   * Create a new session
   */
  async createSession(
    userId: string,
    options: {
      sessionId: string;
      title: string;
      model: string;
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const startTime = Date.now();

    this.logger.info({
      userId,
      sessionId: options.sessionId,
      title: options.title,
      model: options.model,
      hasChatStorage: !!this.chatStorage,
      hasCacheService: !!this.cacheService
    }, 'ChatSessionService.createSession called');

    try {
      if (!this.chatStorage) {
        throw new Error('ChatStorage is not initialized');
      }

      const sessionId = await this.chatStorage.createSession(userId, {
        sessionId: options.sessionId,
        title: options.title,
        model: options.model,
        metadata: options.metadata || {},
        settings: { model: options.model }
      });

      this.logger.info({
        sessionId,
        userId,
        title: options.title,
        requestedId: options.sessionId,
        returnedId: sessionId,
        idsMatch: sessionId === options.sessionId,
        executionTime: Date.now() - startTime
      }, 'Session created successfully');

      // Cache the newly created session
      if (this.cacheService) {
        // Get the full session object to cache it
        const session = await this.chatStorage.getSession(sessionId, userId);
        if (session) {
          await this.cacheService.cacheSession(sessionId, session, 3600);
          this.logger.debug({ sessionId }, 'New session cached');
        }
      }

      return sessionId;

    } catch (error: any) {
      this.logger.error({
        err: error,
        errorMessage: error.message,
        errorStack: error.stack,
        errorCode: error.code,
        userId,
        sessionId: options.sessionId,
        options,
        executionTime: Date.now() - startTime
      }, 'Failed to create session');

      throw error;
    }
  }

  /**
   * Add message to session
   * Note: This method now requires userId to be passed separately
   */
  async addMessage(sessionId: string, userId: string, message: Omit<ChatMessage, 'id'> & { id?: string }): Promise<void> {
    const messageWithId: ChatMessage = {
      id: message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...message,
      timestamp: message.timestamp || new Date()
    };

    try {
      // Call chatStorage.addMessageToSession with the correct signature
      await this.chatStorage.addMessageToSession(
        sessionId,
        userId, // Pass the userId from the caller
        message.role, // This is where the role was getting lost!
        message.content || '',
        {
          model: (message as any).model || process.env.DEFAULT_MODEL,
          tokenCount: message.tokenUsage?.total_tokens,
          toolCalls: message.toolCalls,
          toolResults: (message as any).toolResults,
          metadata: message.metadata,
          toolCallId: (message as any).toolCallId, // Pass toolCallId for tool messages
          mcpCalls: (message as any).mcpCalls, // Pass MCP calls from message
          cotSteps: (message as any).cotSteps // Pass CoT steps from message
        }
      );

      // Invalidate session cache after adding message
      if (this.cacheService) {
        await this.cacheService.invalidateSession(sessionId);
        this.logger.debug({ sessionId }, 'Session cache invalidated after adding message');
      }

      this.logger.debug({
        sessionId,
        messageRole: message.role,
        messageId: messageWithId.id
      }, 'Message added to session');

    } catch (error: any) {
      this.logger.error({
        err: error,
        errorMessage: error.message,
        sessionId,
        messageId: messageWithId.id,
        messageRole: message.role,
        error: error.message
      }, 'Failed to add message to session');

      throw error;
    }
  }

  /**
   * Remove message from session
   */
  async removeMessage(sessionId: string, messageId: string): Promise<void> {
    try {
      await this.chatStorage.removeMessage(sessionId, messageId);
      
      this.logger.debug({ 
        sessionId,
        messageId 
      }, 'Message removed from session');
      
    } catch (error) {
      this.logger.error({ 
        sessionId,
        messageId,
        error: error.message 
      }, 'Failed to remove message from session');
      
      throw error;
    }
  }

  /**
   * Remove multiple messages from session in batch
   */
  async removeMessages(sessionId: string, messageIds: string[]): Promise<void> {
    try {
      if (messageIds.length === 0) return;
      
      // Get session from storage to get userId
      const sessionData = await this.chatStorage.getSession(sessionId);
      if (!sessionData) {
        throw new Error(`Session ${sessionId} not found`);
      }
      
      // Now get the full session with messages
      const session = await this.getSession(sessionId, sessionData.userId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      
      // Filter out messages to be removed
      const updatedMessages = session.messages.filter(
        msg => !messageIds.includes(msg.id)
      );
      
      // Update session with filtered messages
      await this.chatStorage.updateSession(sessionId, { 
        messages: updatedMessages 
      }, sessionData.userId);
      
      this.logger.debug({ 
        sessionId,
        removedCount: messageIds.length 
      }, 'Batch removed messages from session');
      
    } catch (error) {
      this.logger.error({ 
        sessionId,
        messageCount: messageIds.length,
        error: error.message 
      }, 'Failed to batch remove messages from session');
      
      throw error;
    }
  }

  /**
   * Update session metadata
   */
  async updateSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
    try {
      await this.chatStorage.updateSessionMetadata(sessionId, {
        ...metadata,
        updatedAt: new Date()
      });
      
      this.logger.debug({ 
        sessionId,
        metadataKeys: Object.keys(metadata)
      }, 'Session metadata updated');
      
    } catch (error) {
      this.logger.error({ 
        sessionId,
        error: error.message 
      }, 'Failed to update session metadata');
      
      throw error;
    }
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId: string, userId: string, title: string): Promise<void> {
    try {
      await this.chatStorage.updateSession(sessionId, { title }, userId);

      // Invalidate cache after update
      if (this.cacheService) {
        await this.cacheService.invalidateSession(sessionId);
        this.logger.debug({ sessionId }, 'Session cache invalidated after title update');
      }

      this.logger.debug({
        sessionId,
        userId,
        newTitle: title
      }, 'Session title updated');

    } catch (error) {
      this.logger.error({
        sessionId,
        userId,
        title,
        error: error.message
      }, 'Failed to update session title');

      throw error;
    }
  }

  /**
   * List sessions for user
   */
  async listSessions(
    userId: string, 
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'updated_at' | 'created_at';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<ChatSession[]> {
    try {
      const sessions = await this.chatStorage.listSessions(userId, options);
      
      this.logger.debug({ 
        userId,
        sessionCount: sessions.length 
      }, 'Sessions listed');
      
      return sessions;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to list sessions');
      
      throw error;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    try {
      await this.chatStorage.deleteSession(sessionId, userId);

      // Remove from cache after deletion
      if (this.cacheService) {
        await this.cacheService.invalidateSession(sessionId);
        this.logger.debug({ sessionId }, 'Session removed from cache');
      }

      this.logger.info({
        sessionId,
        userId
      }, 'Session deleted');

    } catch (error) {
      this.logger.error({
        sessionId,
        userId,
        error: error.message
      }, 'Failed to delete session');

      throw error;
    }
  }

  /**
   * Search sessions
   */
  async searchSessions(
    userId: string,
    query: string,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ChatSession[]> {
    try {
      const sessions = await this.chatStorage.searchSessions(userId, query, options);
      
      this.logger.debug({ 
        userId,
        query,
        resultCount: sessions.length 
      }, 'Sessions searched');
      
      return sessions;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        query,
        error: error.message 
      }, 'Failed to search sessions');
      
      throw error;
    }
  }


  /**
   * Get user's last active session from Redis cache
   * Returns the session ID they were last interacting with
   */
  async getLastActiveSession(userId: string): Promise<string | null> {
    try {
      if (!this.cacheService) {
        return null;
      }
      return await this.cacheService.getLastActiveSession(userId);
    } catch (error) {
      this.logger.warn({ userId, error: error.message }, 'Failed to get last active session');
      return null;
    }
  }

  /**
   * Set user's last active session in Redis cache
   * Called when user sends a message or opens a session
   */
  async setLastActiveSession(userId: string, sessionId: string): Promise<void> {
    try {
      if (!this.cacheService) {
        return;
      }
      await this.cacheService.setLastActiveSession(userId, sessionId);
      this.logger.debug({ userId, sessionId }, 'Set last active session');
    } catch (error) {
      this.logger.warn({ userId, sessionId, error: error.message }, 'Failed to set last active session');
    }
  }

  /**
   * Health check for session service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic storage connectivity
      await this.chatStorage.healthCheck();
      return true;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Session service health check failed');
      
      return false;
    }
  }
}