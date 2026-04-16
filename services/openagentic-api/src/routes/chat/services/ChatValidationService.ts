/**
 * Chat Validation Service
 * 
 * Handles input validation, content filtering, and session validation
 */

import { ChatSession } from '../interfaces/chat.types.js';
import type { Logger } from 'pino';

export class ChatValidationService {
  constructor(
    private logger: any,
    private chatStorage?: any
  ) {
    this.logger = logger.child({ service: 'ChatValidationService' }) as Logger;
    
    // Log initialization state
    this.logger.info({ 
      hasChatStorage: !!this.chatStorage,
      chatStorageType: this.chatStorage ? 'PostgreSQL' : 'None/Mock'
    }, 'ChatValidationService initialized');
  }

  /**
   * Get session (delegates to storage)
   */
  async getSession(sessionId: string, userId: string): Promise<ChatSession | null> {
    const startTime = Date.now();
    
    this.logger.info({ 
      sessionId,
      userId,
      hasChatStorage: !!this.chatStorage
    }, 'getSession called');
    
    try {
      if (!this.chatStorage) {
        const error = new Error('ChatStorage is not available - database connection required');
        this.logger.error({ 
          sessionId,
          userId,
          error: error.message
        }, 'No chat storage available for session lookup');
        throw error;
      }
      
      this.logger.debug({ sessionId, userId }, 'Looking up session in storage');
      
      // Check if storage connection is healthy
      try {
        if (this.chatStorage.healthCheck) {
          const isHealthy = await this.chatStorage.healthCheck();
          this.logger.info({ 
            storageHealthy: isHealthy
          }, 'Storage health check result');
        }
      } catch (healthError: any) {
        this.logger.warn({ 
          err: healthError,
          errorMessage: healthError.message
        }, 'Storage health check failed');
      }
      
      // Delegate to storage service
      const session = await this.chatStorage.getSession(sessionId, userId);
      
      this.logger.info({ 
        sessionId,
        userId,
        sessionFound: !!session,
        sessionData: session ? {
          id: session.id,
          title: session.title,
          messageCount: session.messageCount,
          createdAt: session.createdAt
        } : null,
        executionTime: Date.now() - startTime
      }, 'Session lookup completed');
      
      if (!session) {
        this.logger.debug({ sessionId, userId }, 'Session not found in storage');
        return null;
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
      }, 'Session lookup failed with error');
      
      throw error;
    }
  }

  /**
   * Create new session (delegates to storage)
   */
  async createSession(
    userId: string, 
    options: {
      sessionId: string;
      title: string;
      model: string;
    }
  ): Promise<string> {
    const startTime = Date.now();
    
    this.logger.info({ 
      userId,
      sessionId: options.sessionId,
      title: options.title,
      model: options.model,
      hasChatStorage: !!this.chatStorage
    }, 'createSession called');
    
    try {
      if (!this.chatStorage) {
        const error = new Error('ChatStorage is not available - database connection required');
        this.logger.error({ 
          userId,
          sessionId: options.sessionId,
          error: error.message
        }, 'No chat storage available for session creation');
        throw error;
      }
      
      this.logger.debug({ 
        userId,
        sessionId: options.sessionId,
        options
      }, 'Creating new session in storage');
      
      // Check storage connection before creating
      try {
        if (this.chatStorage.pool) {
          const client = await this.chatStorage.pool.connect();
          client.release();
          this.logger.info('Database connection verified before session creation');
        }
      } catch (connError: any) {
        this.logger.error({ 
          err: connError,
          errorMessage: connError.message
        }, 'Database connection check failed');
      }
      
      // Delegate to storage service
      const createdSessionId = await this.chatStorage.createSession(userId, {
        sessionId: options.sessionId,
        title: options.title,
        model: options.model,
        metadata: {},
        settings: { model: options.model }
      });
      
      this.logger.info({ 
        userId,
        requestedId: options.sessionId,
        createdId: createdSessionId,
        idsMatch: createdSessionId === options.sessionId,
        executionTime: Date.now() - startTime
      }, 'Session created successfully');
      
      return createdSessionId;
      
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
      }, 'Session creation failed with error');
      
      throw error;
    }
  }

  /**
   * Check content filters
   */
  async checkContentFilters(
    content: string, 
    userId: string
  ): Promise<{
    blocked: boolean;
    flagged: boolean;
    reason?: string;
  }> {
    try {
      // Basic content filtering
      const result = {
        blocked: false,
        flagged: false,
        reason: undefined as string | undefined
      };

      // Check for obviously harmful content
      const blockedPatterns = [
        /\b(password|secret|key|token)\s*[:=]\s*[a-zA-Z0-9+/=]{20,}/i,
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi
      ];

      for (const pattern of blockedPatterns) {
        if (pattern.test(content)) {
          result.blocked = true;
          result.reason = 'Contains potentially harmful content';
          break;
        }
      }

      // Check for flagged content
      if (!result.blocked) {
        const flaggedPatterns = [
          /\b(hack|exploit|vulnerability)\b/gi,
          /\b(ddos|attack|breach)\b/gi
        ];

        for (const pattern of flaggedPatterns) {
          if (pattern.test(content)) {
            result.flagged = true;
            result.reason = 'Contains security-related terms';
            break;
          }
        }
      }

      this.logger.debug({ 
        userId,
        contentLength: content.length,
        blocked: result.blocked,
        flagged: result.flagged 
      }, 'Content filter check completed');

      return result;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Content filter check failed');
      
      // If filtering fails, allow content through but log the error
      return {
        blocked: false,
        flagged: false
      };
    }
  }

  /**
   * Validate message content
   */
  validateMessageContent(content: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check length
    if (!content || content.trim().length === 0) {
      errors.push('Message cannot be empty');
    }

    if (content.length > 50000) {
      errors.push('Message too long (maximum 50,000 characters)');
    }

    // Check for null bytes or control characters
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content)) {
      errors.push('Message contains invalid characters');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate session ID format
   */
  validateSessionId(sessionId: string): boolean {
    // Session ID should be alphanumeric with dashes and underscores
    return /^[a-zA-Z0-9_-]+$/.test(sessionId) && sessionId.length >= 3 && sessionId.length <= 100;
  }

  /**
   * Validate user ID format
   */
  validateUserId(userId: string): boolean {
    // User ID should be a valid format (UUID, email, etc.)
    return typeof userId === 'string' && userId.length > 0 && userId.length <= 255;
  }

  /**
   * Sanitize user input
   */
  sanitizeInput(input: string): string {
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();
  }

  /**
   * Validate file attachment
   */
  validateAttachment(attachment: {
    originalName: string;
    mimeType: string;
    size: number;
  }): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check file size (50MB limit)
    if (attachment.size > 50 * 1024 * 1024) {
      errors.push('File too large (maximum 50MB)');
    }

    // Check file type
    const allowedTypes = [
      'text/plain',
      'text/markdown', 
      'text/csv',
      'application/json',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (!allowedTypes.includes(attachment.mimeType)) {
      errors.push(`File type not allowed: ${attachment.mimeType}`);
    }

    // Check filename
    if (!attachment.originalName || attachment.originalName.length === 0) {
      errors.push('Filename is required');
    }

    if (attachment.originalName.length > 255) {
      errors.push('Filename too long');
    }

    // Check for dangerous file extensions
    const dangerousExtensions = ['.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.jar'];
    const filename = attachment.originalName.toLowerCase();
    
    for (const ext of dangerousExtensions) {
      if (filename.endsWith(ext)) {
        errors.push('File type not allowed');
        break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Health check for validation service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic validation functionality
      const testResult = this.validateMessageContent('test message');
      return testResult.isValid;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Validation service health check failed');
      
      return false;
    }
  }
}