/**
 * Chat Storage Service
 * 
 * Manages persistent storage of chat sessions and messages using Prisma ORM.
 * Provides type-safe database operations with soft delete support and comprehensive
 * session management for the OpenAgentic Chat platform.
 * 
 * Features:
 * - Session lifecycle management (create, retrieve, update, soft delete)
 * - Message storage with token usage tracking and tool call support
 * - Optimized queries with proper indexing and pagination
 * - Type safety through Prisma-generated types
 * 
 * @see {@link https://docs.openagentic.io/api/services/storage | Chat Storage Documentation}
 */

import type { PrismaClient, ChatSession as PrismaChatSession, ChatMessage as PrismaChatMessage } from '@prisma/client';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import { prisma, prismaBase } from '../utils/prisma.js';
import { AITitleGenerationService } from './AITitleGenerationService.js';
import { TitleGenerationClient } from './TitleGenerationClient.js';
import { ChatSummaryService } from './ChatSummaryService.js';
// Repository pattern - gradual integration
import { SimpleChatSessionRepository } from '../repositories/SimpleChatSessionRepository.js';
import { buildSessionListWhere } from '../repositories/sessionListWhere.js';

// Define MessageRole since it's not an enum in our schema - it's a string field
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatStorageConfig {
  // Prisma doesn't need connection string here - handled by DATABASE_URL env var
  maxConnections?: number;
  providerManager?: any; // ProviderManager instance for multi-provider LLM support
  redis?: any; // Redis client for snappy caching
}

export interface SessionCreateOptions {
  title?: string;
  model?: string;
  userId?: string;
  tenantId?: string;
  settings?: Record<string, any>;
  /**
   * Sev-0 Bug A — defensive user upsert.
   * SSO tokens carry an `oid` claim that may not match a `users.id` row when
   * the user was created via a different bootstrap path (e.g. helm
   * InitializationService creates admin user with id `65e27ed0-...` but the
   * SSO token's oid is `66c199d9-...`). When the userId lookup misses but
   * userEmail is provided, fall back to email-keyed lookup, then upsert.
   */
  userEmail?: string;
  userName?: string;
  azureOid?: string;
  azureTenantId?: string;
}

export interface SessionUpdateOptions {
  title?: string;
  summary?: string;
  updatedAt?: Date;
  metadata?: Record<string, any>;
  settings?: any;
}

export interface SessionsQueryOptions {
  userId?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
  includeMessages?: boolean;
  includeDeleted?: boolean; // New option for admin queries
}

// Type aliases for backward compatibility
export interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  toolCalls?: any[];
  toolResults?: any[];
  toolCallId?: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedTokens?: number;
    reasoningTokens?: number;
  };
  metadata?: Record<string, any>;
  // Additional Prisma fields that actually exist
  parentId?: string;
  branchId?: string;
  visualizations?: any[];
  mcpCalls?: any[];
  attachments?: any[]; // Note: This is a relation in DB but we return empty array for compatibility
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null; // Added for soft delete support
  userId: string;
  tenantId?: string; // Not in schema but kept for compatibility
  messageCount?: number;
  isActive?: boolean;
  isArchived?: boolean; // Not in schema but kept for compatibility
  totalTokens?: number;
  totalCost?: number;
  model?: string;
}

export class ChatStorageService {
  private prisma: PrismaClient;
  private logger: any;
  private isInitialized = false;
  private titleGenerationService: AITitleGenerationService;
  private titleClient?: TitleGenerationClient;
  private chatSummaryService: ChatSummaryService;
  private realTimeKnowledgeService?: any;
  // Repository pattern - gradual integration
  private sessionRepo: SimpleChatSessionRepository;
  // Redis for snappy caching
  private redis: any;

  constructor(config: ChatStorageConfig, logger: any) {
    this.logger = logger;
    this.redis = config.redis;

    // Initialize AI-powered title generation with LLM provider
    const useLLM = process.env.USE_AI_TITLE_GENERATION !== 'false'; // Default to true
    if (useLLM) {
      this.titleClient = new TitleGenerationClient(logger, {
        providerManager: config.providerManager
      });
    }

    this.titleGenerationService = new AITitleGenerationService(
      logger,
      {
        useLLM,
        maxLength: 60,
        style: 'concise'
      },
      this.titleClient
    );
    
    // #37: use the shared singleton. The singleton is now configured with
    // query event emission so the slow-query logger below still works.
    this.prisma = prisma;

    // Bug 3 (2026-05-18): chat_sessions.summary / structured_summary refresh.
    // Heuristic-only (no LLM call), runs after assistant persists.
    this.chatSummaryService = new ChatSummaryService(this.prisma as any, logger);

    // Initialize repository
    this.sessionRepo = new SimpleChatSessionRepository(this.prisma, this.logger, true);

    // Log slow queries for debugging.
    // NOTE: $on is only available on the raw PrismaClient (`prismaBase`),
    // not on the tenant-extended client (`prisma`) which is a proxy that
    // strips top-level $-methods.
    (prismaBase as any).$on('query', (e: any) => {
      if (e.duration > 1000) { // Log queries taking > 1 second
        this.logger.warn({
          query: e.query,
          duration: e.duration,
          params: e.params
        }, 'Slow database query detected');
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      this.logger.info('Connecting to PostgreSQL via Prisma...');
      
      // Test the connection — $-methods only exist on the raw PrismaClient,
      // not on the tenant-extended proxy that backs `this.prisma`.
      await (prismaBase as any).$connect();
      await (prismaBase as any).$queryRaw`SELECT 1`;
      
      this.logger.info('Prisma connection established');
      
      // Verify chat_sessions table exists and has correct schema
      const sessionCount = await this.prisma.chatSession.count();
      this.logger.info({ sessionCount }, 'Chat sessions table verified');
      
      this.isInitialized = true;
      this.logger.info('Chat storage service initialized successfully with Prisma');
    } catch (error: any) {
      this.logger.error({ 
        err: error,
        errorMessage: error.message,
        errorCode: error.code,
        errorDetail: error.detail
      }, 'Failed to initialize chat storage with Prisma');
      throw error;
    }
  }

  /**
   * Set the RealTimeKnowledgeService for chat message ingestion to Milvus
   */
  setRealTimeKnowledgeService(service: any): void {
    this.realTimeKnowledgeService = service;
    this.logger.info('RealTimeKnowledgeService attached to ChatStorageService for Milvus ingestion');
  }

  async createSession(userId: string, options: SessionCreateOptions & { sessionId?: string } = {}): Promise<string> {
    const sessionId = options.sessionId || nanoid();
    const title = options.title || `Chat ${new Date().toLocaleString()}`;

    try {
      // CRITICAL: Validate user exists before creating session
      let userExists: any = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      // Sev-0 Bug A — defensive user upsert when token-id misses but email is present.
      // The SSO token's `oid` may not match an existing `users.id` (different bootstrap
      // path created the user). Fall back to email lookup, then upsert. The token has
      // already been validated upstream by unifiedAuthHook, so this is safe.
      if (!userExists && options.userEmail) {
        try {
          userExists = await this.prisma.user.findFirst({
            where: { email: options.userEmail },
          });
          if (userExists) {
            this.logger.info({
              tokenUserId: userId,
              dbUserId: userExists.id,
              email: options.userEmail,
            }, '[ChatStorage] Sev-0 A — token userId did not match DB; recovered via email lookup. Remapping session to existing user.');
            userId = userExists.id;
          } else {
            // Upsert by email — token is already validated, user is authenticated.
            const upserted = await this.prisma.user.upsert({
              where: { email: options.userEmail },
              update: {
                ...(options.azureOid ? { azure_oid: options.azureOid } : {}),
                ...(options.userName ? { name: options.userName } : {}),
                updated_at: new Date(),
              },
              create: {
                id: userId,
                email: options.userEmail,
                name: options.userName || options.userEmail,
                ...(options.azureOid ? { azure_oid: options.azureOid } : {}),
                ...(options.azureTenantId ? { azure_tenant_id: options.azureTenantId } : {}),
                created_at: new Date(),
                updated_at: new Date(),
              },
            });
            userExists = upserted;
            userId = upserted.id;
            this.logger.info({
              userId: upserted.id,
              email: options.userEmail,
            }, '[ChatStorage] Sev-0 A — upserted authenticated user by email (first chat after SSO bootstrap).');
          }
        } catch (recoveryErr: any) {
          this.logger.warn({
            err: recoveryErr?.message,
            tokenUserId: userId,
            email: options.userEmail,
          }, '[ChatStorage] Sev-0 A — defensive email upsert failed; falling through to original error');
        }
      }

      if (!userExists) {
        // SECURITY: AUTH_MODE=local admin fallback removed in v0.5.0 FedRAMP hardening (Bolt 01)
        // All users must exist in the database before creating sessions.
        // User provisioning happens during Azure AD authentication flow.
        throw new Error(`User ${userId} not found in database. Please ensure user exists before creating sessions.`);
      }
      
      // ✅ REPOSITORY INTEGRATION: Using cached repository instead of direct Prisma
      const session = await this.sessionRepo.create({
        id: sessionId,
        title,
        userId,
        messageCount: 0,
        isActive: true,
        totalTokens: 0,
        totalCost: 0,
        model: options.model || null
      });

      this.logger.debug('Session created successfully with caching', {
        sessionId: session.id,
        userId,
        title: session.title
      });

      // Invalidate sidebar cache so new session appears immediately
      await this.invalidateSidebarCache(userId);

      return session.id;
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to create session');
      throw error;
    }
  }

  async getSession(sessionId: string, userId?: string, tenantId?: string): Promise<ChatSession | null> {
    try {
      // ✅ REPOSITORY INTEGRATION: Using cached repository instead of direct Prisma
      const session = await this.sessionRepo.findById(sessionId);

      if (!session) {
        return null;
      }

      // Validate user access if specified
      if (userId && session.user_id !== userId) {
        this.logger.warn('Session access denied', { sessionId, userId, sessionUserId: session.user_id });
        return null;
      }

      // tenantId removed - not supported in current schema
      if (tenantId) {
        this.logger.warn('tenantId filtering not supported in current schema', { tenantId });
      }

      // Get messages separately (for now, until we add message caching)
      const messages = await this.getMessages(sessionId);

      const sessionResponse = this.transformSessionToResponse(session);
      sessionResponse.messages = messages;

      return sessionResponse;
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to get session');
      throw error;
    }
  }

  async getSessions(options: SessionsQueryOptions = {}): Promise<ChatSession[]> {
    try {
      if (options.userId) {
        // ✅ REPOSITORY INTEGRATION: Using cached repository for user sessions
        const sessions = await this.sessionRepo.findByUserId(
          options.userId, 
          options.limit || 50
        );

        // Transform and optionally include messages
        const transformedSessions = sessions.map(session => this.transformSessionToResponse(session));
        
        if (options.includeMessages) {
          // Add messages to each session (for now, until we optimize this)
          for (const session of transformedSessions) {
            session.messages = await this.getMessages(session.id);
          }
        }

        return transformedSessions;
      } else {
        // Admin query - uses direct Prisma for full admin access
        const whereClause: any = {};

        if (!options.includeDeleted) {
          whereClause.deleted_at = null;
        }

        const sessions = await this.prisma.chatSession.findMany({
          where: whereClause,
          include: {
            messages: options.includeMessages ? {
              where: { deleted_at: null },
              orderBy: { created_at: 'asc' },
            } : false,
          },
          orderBy: { created_at: 'desc' },
          take: options.limit,
          skip: options.offset,
        });

        return sessions.map(session => this.transformSessionToResponse(session));
      }
    } catch (error) {
      this.logger.error({ error, options }, 'Failed to get sessions');
      throw error;
    }
  }

  // Compatibility method for routes
  async getUserSessions(userId: string, limit?: number, offset?: number): Promise<ChatSession[]> {
    return this.getSessions({ userId, limit, offset });
  }

  /**
   * Get sidebar sessions with aggressive Redis caching for instant UI render
   * This is the FASTEST path for loading the session list on every page load
   */
  async getSidebarSessions(userId: string, limit: number = 50): Promise<ChatSession[]> {
    const cacheKey = `sidebar:sessions:v2:${userId}`;

    // Try Redis cache first (instant return)
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug({ userId, count: JSON.parse(cached).length }, 'Sidebar sessions cache HIT');
          return JSON.parse(cached);
        }
      } catch (cacheError) {
        this.logger.debug({ error: cacheError }, 'Sidebar cache read failed, falling back to DB');
      }
    }

    // Cache miss - fetch lightweight session data (NO messages, just metadata).
    // Exclude codemode-originated sessions: the v2-bespoke codemode handler
    // wrote user prompts into this same table with title="Code Session", which
    // made them appear in the chat sidebar — a real privacy bug since chatmode
    // and codemode transcripts should be siloed. CCR (task #218) persists
    // codemode transcripts to the pod's MinIO workspace instead, so new rows
    // won't show up, but legacy v2 rows need the title filter to stay hidden.
    try {
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          NOT: { title: 'Code Session' },
        },
        select: {
          id: true,
          title: true,
          created_at: true,
          updated_at: true,
          message_count: true,
          model: true,
          is_active: true,
        },
        orderBy: { updated_at: 'desc' },
        take: limit,
      });

      // Transform to response format
      const transformedSessions = sessions.map(session => ({
        id: session.id,
        title: session.title,
        messages: [], // Empty - sidebar doesn't need messages
        createdAt: session.created_at.toISOString(),
        updatedAt: session.updated_at.toISOString(),
        userId,
        messageCount: session.message_count,
        isActive: session.is_active,
        model: session.model,
      }));

      // Cache for 5 minutes
      if (this.redis) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(transformedSessions), 'EX', 300);
          this.logger.debug({ userId, count: transformedSessions.length }, 'Sidebar sessions cached');
        } catch (cacheError) {
          this.logger.debug({ error: cacheError }, 'Sidebar cache write failed');
        }
      }

      return transformedSessions;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get sidebar sessions');
      throw error;
    }
  }

  /**
   * Invalidate sidebar cache when sessions change
   */
  async invalidateSidebarCache(userId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(`sidebar:sessions:v2:${userId}`);
        this.logger.debug({ userId }, 'Sidebar cache invalidated');
      } catch (error) {
        this.logger.debug({ error }, 'Failed to invalidate sidebar cache');
      }
    }
  }

  // Method for ChatSessionService compatibility
  async listSessions(
    userId: string, 
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'updated_at' | 'created_at';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<ChatSession[]> {
    // For default sidebar query (no offset, default sort), use Redis cache
    const isDefaultSidebarQuery = !options.offset && 
      (options.sortBy === 'updated_at' || !options.sortBy) && 
      (options.sortOrder === 'desc' || !options.sortOrder);
    
    const cacheKey = `sidebar:sessions:v2:${userId}`;
    
    // Try Redis cache first for sidebar queries (instant return)
    if (isDefaultSidebarQuery && this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const cachedSessions = JSON.parse(cached);
          // Filter out flows-ai sessions from chat sidebar cache
          const filtered = cachedSessions.filter((s: any) => s.metadata?.source !== 'flows-ai');
          // Apply limit if specified
          const result = options.limit ? filtered.slice(0, options.limit) : filtered;
          this.logger.debug({ userId, count: result.length, cached: true }, 'Sessions listed from cache');
          return result;
        }
      } catch (cacheError) {
        this.logger.warn({ error: cacheError.message }, 'Redis cache read failed, falling back to DB');
      }
    }

    const orderBy: any = {};
    orderBy[options.sortBy || 'updated_at'] = options.sortOrder || 'desc';

    try {
      // Sev-0 2026-05-08 — buildSessionListWhere hides empty sessions
      // (message_count=0) older than 5 minutes so old Playwright probe
      // rows + abandoned new-chat sessions stop polluting the sidebar
      // forever. Fresh empty sessions still show inside the freshness
      // window so legit "I just opened a chat" UX is preserved.
      // Contract pinned at repositories/__tests__/sessionListWhere.test.ts.
      const sessions = await this.prisma.chatSession.findMany({
        where: buildSessionListWhere(userId),
        orderBy,
        take: options.limit || 50,
        skip: options.offset,
      });

      // Exclude flows-ai sessions in application code (see NOTE above about Prisma JSON path bug)
      const filteredSessions = sessions.filter((s: any) => {
        const meta = s.metadata as Record<string, any> | null;
        return !meta || meta.source !== 'flows-ai';
      });

      const transformedSessions = filteredSessions.map(session => this.transformSessionToResponse(session));

      // Cache result for sidebar queries (5 minute TTL)
      if (isDefaultSidebarQuery && this.redis && !options.offset) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(transformedSessions), 'EX', 300);
          this.logger.debug({ userId, count: transformedSessions.length }, 'Sessions cached to Redis');
        } catch (cacheError) {
          this.logger.warn({ error: cacheError.message }, 'Redis cache write failed');
        }
      }

      return transformedSessions;
    } catch (error) {
      this.logger.error({ error, userId, options }, 'Failed to list sessions');
      throw error;
    }
  }

  async updateSession(sessionId: string, updates: SessionUpdateOptions, userId?: string): Promise<boolean> {
    try {
      const updateData: any = {
        updated_at: new Date(),
      };

      if (updates.title !== undefined) {
        updateData.title = updates.title;
      }

      if (updates.summary !== undefined) {
        updateData.summary = updates.summary;
      }

      if (updates.metadata !== undefined) {
        updateData.metadata = updates.metadata;
      }

      if (updates.settings !== undefined) {
        this.logger.debug('settings field stored in metadata', { sessionId });
        // Merge settings into metadata since there's no separate settings column
        updateData.metadata = { ...(updateData.metadata || {}), settings: updates.settings };
      }

      const whereClause: any = {
        id: sessionId,
        deleted_at: null, // Only update non-deleted sessions
      };
      
      if (userId) {
        whereClause.user_id = userId;
      }
      
      const result = await this.prisma.chatSession.updateMany({
        where: whereClause,
        data: updateData,
      });

      // Invalidate sidebar cache so title changes appear immediately
      if (userId && result.count > 0) {
        await this.invalidateSidebarCache(userId);
      }

      return result.count > 0;
    } catch (error) {
      this.logger.error({ error, sessionId, userId, updates }, 'Failed to update session');
      throw error;
    }
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    try {
      // ✅ REPOSITORY INTEGRATION: Check session exists and validate user access with caching
      const session = await this.sessionRepo.findById(sessionId);

      if (!session) {
        this.logger.debug({ sessionId, userId }, 'Session does not exist');
        return;
      }

      // Validate user access
      if (session.user_id !== userId) {
        this.logger.warn({ sessionId, userId, sessionUserId: session.user_id }, 'Session access denied for deletion');
        return;
      }

      // SOFT DELETE: Mark as deleted but preserve in database for audit
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          deleted_at: new Date(),
          updated_at: new Date()
        }
      });
      
      // Invalidate sidebar cache so deleted session disappears immediately
      await this.invalidateSidebarCache(userId);
      
      this.logger.info({ sessionId, userId }, 'Session soft deleted - hidden from user, preserved for audit');
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to delete session');
      throw error;
    }
  }

  // HARD DELETE: Permanently remove session and messages (admin only)
  async permanentlyDeleteSession(sessionId: string, adminUserId: string): Promise<void> {
    try {
      // Log admin action for audit trail
      this.logger.warn({ 
        sessionId, 
        adminUserId, 
        action: 'PERMANENT_DELETE' 
      }, 'Admin permanently deleting session - data will be lost forever');

      // ✅ REPOSITORY INTEGRATION: Use repository's delete method for permanent removal
      await this.sessionRepo.deleteWithMessages(sessionId);
      
      this.logger.info({ sessionId, adminUserId }, 'Session and messages permanently deleted by admin');
    } catch (error) {
      this.logger.error({ error, sessionId, adminUserId }, 'Failed to permanently delete session');
      throw error;
    }
  }

  // Admin method to get all sessions including soft deleted ones
  async getAllSessionsIncludingDeleted(options: SessionsQueryOptions & { includeDeleted?: boolean } = {}): Promise<ChatSession[]> {
    return this.getSessions({ ...options, includeDeleted: true });
  }

  // Compatibility wrapper for IChatStorageService interface
  async addMessage(sessionId: string, message: any): Promise<any> {
    // Extract fields from the message object
    const { userId, role, content, ...options } = message;
    
    // Call the original addMessage with the proper signature
    return this.addMessageToSession(sessionId, userId || '', role || 'user', content || '', options);
  }

  async addMessageToSession(
    sessionId: string, 
    userId: string, 
    role: string, 
    content: string, 
    options: {
      // Model info
      model?: string;
      provider?: string;
      deploymentName?: string;
      
      // Token metrics
      tokenCount?: number;
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
        cachedTokens?: number;
        reasoningTokens?: number;
      };
      
      // Configuration
      temperature?: number;
      topP?: number;
      frequencyPenalty?: number;
      presencePenalty?: number;
      maxTokens?: number;
      seed?: number;
      stream?: boolean;
      responseFormat?: string;
      
      // Performance
      latencyMs?: number;
      timeToFirstTokenMs?: number;
      
      // Tools & MCP
      toolCalls?: any[];
      toolResults?: any[];
      toolCallId?: string;
      mcpCalls?: any[];
      toolUsageCount?: number;
      toolNamesUsed?: string[];
      
      // Errors
      errorCount?: number;
      retryCount?: number;
      
      // Other
      metadata?: Record<string, any>;
      parentId?: string;
      branchId?: string;
      visualizations?: any[];
      attachments?: any[]; // Accept attachments to pass through
      // Phase 3 persistence keystone (plan §3): canonical ContentBlock[] in
      // wire-emit order. Used on assistant messages so reload renders the
      // chronological interleave instead of falling back to flat
      // content + tool_calls reconstruction.
      contentBlocks?: any[];
    } = {}
  ): Promise<ChatMessage> {
    const messageId = nanoid();
    const timestamp = new Date();
    
    try {
      // Validate and normalize role
      const validRoles: MessageRole[] = ['user', 'assistant', 'system', 'tool'];
      const messageRole = validRoles.includes(role.toLowerCase() as MessageRole) 
        ? role.toLowerCase() as MessageRole 
        : 'user';
      
      // Build comprehensive token_usage object matching Prisma schema
      const tokenUsage = options.tokenUsage || (options.tokenCount ? { 
        totalTokens: options.tokenCount,
        promptTokens: 0,
        completionTokens: 0 
      } : null);

      // Create message using Prisma with only supported fields from schema
      const message = await this.prisma.chatMessage.create({
        data: {
          id: messageId,
          session_id: sessionId,
          role: messageRole,
          content,
          model: options.model || null,
          token_usage: tokenUsage || null,
          mcp_calls: options.mcpCalls || null,
          tool_calls: options.toolCalls || null,
          tool_results: options.toolResults || null,
          tool_call_id: options.toolCallId || null,  // Store toolCallId directly
          visualizations: options.visualizations || null,
          user_id: userId || null,
          parent_id: options.parentId || null,
          branch_id: options.branchId || null,
          // Phase 3 (plan §3): persist canonical ContentBlock[] when caller
          // supplied them (assistant turns from chatLoop finalize). Null
          // safe — column was added forward-only, existing rows render via
          // the buildFinalContentBlocks fallback.
          content_blocks: (options.contentBlocks ?? undefined) as any,
        } as any,
      });

      // Task #134 fix: persist attachments so they survive reload.
      // Pre-fix the pipeline passed the base64 through to the LLM in-memory
      // and never wrote FileAttachment rows; on reload the image thumbnail
      // vanished and users saw text-only history. We inline the base64 into
      // FileAttachment.metadata (capped at ~5MB per file — larger ones fall
      // back to "blob-pending" which a follow-up task will migrate to MinIO).
      if (Array.isArray(options.attachments) && options.attachments.length > 0) {
        try {
          const BASE64_INLINE_CAP = 5 * 1024 * 1024;
          const rows = options.attachments.map((att: any, idx: number) => {
            const b64: string | null = typeof att.base64Data === 'string' ? att.base64Data : null;
            const inlineOk = b64 !== null && b64.length <= BASE64_INLINE_CAP;
            return {
              id: (att.id as string) || `att_${messageId}_${idx}`,
              filename: (att.originalName as string) || `file-${idx}`,
              original_name: (att.originalName as string) || `file-${idx}`,
              mime_type: (att.mimeType as string) || 'application/octet-stream',
              size: typeof att.size === 'number' ? att.size : 0,
              file_size: typeof att.size === 'number' ? att.size : 0,
              upload_path: `inline://${messageId}/${idx}`,
              file_path: `inline://${messageId}/${idx}`,
              user_id: userId || '',
              session_id: sessionId,
              message_id: messageId,
              upload_status: 'completed',
              metadata: inlineOk
                ? { base64Data: b64 }
                : { base64Data: null, pending: 'blob-storage', size: att.size ?? 0 },
            };
          });
          await (this.prisma as any).fileAttachment.createMany({
            data: rows,
            skipDuplicates: true,
          });
        } catch (attErr: any) {
          this.logger.warn(
            { err: { message: attErr?.message, name: attErr?.name }, messageId },
            '[ChatStorage] Failed to persist attachments — message saved without them',
          );
        }
      }

      // If we have comprehensive metrics, save to chat_metrics table
      if (messageRole === 'assistant' && (options.model || tokenUsage)) {
        await this.saveMetrics({
          messageId,
          sessionId,
          model: options.model,
          tokenUsage,
          latencyMs: options.latencyMs
        });
      }

      // Update session timestamp and message count
      const session = await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          updated_at: new Date(),
          message_count: {
            increment: 1,
          },
        },
      });

      // Generate title after first user message if still "New Chat"
      if (messageRole === 'user' && 
          session.message_count === 1 && 
          (session.title === 'New Chat' || session.title === 'New Session' || !session.title)) {
        try {
          // Get the message for title generation
          const messages = await this.prisma.chatMessage.findMany({
            where: { session_id: sessionId },
            orderBy: { created_at: 'asc' },
            take: 2, // Get first user message and any assistant response
          });

          // Generate title from the message content
          const generatedTitle = await this.titleGenerationService.generateTitle(
            messages
          );

          // Update session with generated title
          if (generatedTitle && generatedTitle !== 'New Chat') {
            await this.prisma.chatSession.update({
              where: { id: sessionId },
              data: { title: generatedTitle },
            });
            
            this.logger.info({ 
              sessionId, 
              oldTitle: session.title, 
              newTitle: generatedTitle 
            }, 'Updated session title from first message');
          }
        } catch (error) {
          // Don't fail the message save if title generation fails
          this.logger.warn({ error, sessionId }, 'Failed to generate title for session');
        }
      }

      // Bug 3 (2026-05-18): refresh chat_sessions.summary + structured_summary
      // after assistant writes once the session has enough turns. Heuristic
      // engine — no LLM call. Non-blocking on failure (the service catches
      // and warns internally; we still .catch() here for belt-and-braces).
      if (messageRole === 'assistant') {
        this.chatSummaryService
          .maybeRefreshSummary(sessionId)
          .catch(() => { /* already logged inside the service */ });
      }

      // Index significant messages into unified context layer (Phase 16)
      try {
        if ((messageRole === 'user' || messageRole === 'assistant') && content && content.length > 20) {
          const { userContextService } = await import('./UserContextService.js');
          // Fire and forget - don't block message save
          userContextService.indexUserData(userId, {
            source: 'chat',
            sourceId: sessionId,
            content: typeof content === 'string' ? content.substring(0, 2000) : JSON.stringify(content).substring(0, 2000),
            metadata: { role: messageRole, sessionId },
          }).catch(() => {}); // Silently ignore - indexing is non-critical
        }
      } catch {
        // Non-critical - unified context indexing failure shouldn't block chat
      }

      // Adaptive Memory: ingest user/assistant messages for personalized context
      try {
        if ((messageRole === 'user' || messageRole === 'assistant') && content && content.length >= 30) {
          const { getUserMemoryService } = await import('./UserMemoryService.js');
          const memService = getUserMemoryService();
          const importance = messageRole === 'user' ? 0.6 : 0.4;
          memService.ingest(userId || 'anonymous', 'chat', sessionId, content.substring(0, 2000), importance).catch(() => {});
        }
      } catch {
        // Non-critical — adaptive memory not available
      }

      // Ingest message to Milvus for RAG if service is available
      if (this.realTimeKnowledgeService && (messageRole === 'user' || messageRole === 'assistant')) {
        try {
          await this.realTimeKnowledgeService.ingestChatMessage({
            id: message.id,
            sessionId: sessionId,
            userId: userId || 'anonymous',
            role: messageRole as 'user' | 'assistant',
            content: content,
            timestamp: timestamp
          });
          
          this.logger.debug({ 
            messageId: message.id, 
            sessionId, 
            role: messageRole 
          }, 'Chat message queued for Milvus ingestion');
        } catch (ingestionError) {
          // Don't fail the message save if ingestion fails
          this.logger.warn({ 
            error: ingestionError, 
            messageId: message.id 
          }, 'Failed to queue message for Milvus ingestion');
        }
      }

      return {
        id: message.id,
        role: role as any,
        content: message.content,
        timestamp: timestamp.toISOString(),
        toolCalls: options.toolCalls,
        toolResults: options.toolResults,
        toolCallId: options.toolCallId,
        tokenUsage: options.tokenCount ? {
          totalTokens: options.tokenCount,
          promptTokens: 0,
          completionTokens: 0
        } : undefined,
        metadata: options.metadata,
        attachments: options.attachments || [] // Pass through attachments from input
      };
    } catch (error) {
      this.logger.error({ error, sessionId, userId, messageId }, 'Failed to add message');
      throw error;
    }
  }

  private async saveMetrics(metrics: any): Promise<void> {
    try {
      // Save to chat_metrics table using Prisma (only supported fields)
      await this.prisma.chatMetrics.create({
        data: {
          id: nanoid(),
          session_id: metrics.sessionId,
          response_time: metrics.latencyMs || 0,
          token_count: metrics.tokenUsage?.totalTokens || 0,
          model_used: metrics.model || 'unknown',
        },
      });
    } catch (error) {
      // Log error but don't fail the message save
      this.logger.error({ error }, 'Failed to save chat metrics');
    }
  }

  async clearMessages(sessionId: string): Promise<void> {
    try {
      // Soft delete all messages in the session
      await this.prisma.chatMessage.updateMany({
        where: {
          session_id: sessionId,
          deleted_at: null,
        },
        data: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Update session timestamp and reset message count
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          updated_at: new Date(),
          message_count: 0,
        },
      });
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to clear messages');
      throw error;
    }
  }

  async removeMessage(sessionId: string, messageId: string): Promise<void> {
    try {
      // Soft delete the specific message
      await this.prisma.chatMessage.updateMany({
        where: {
          id: messageId,
          session_id: sessionId,
          deleted_at: null,
        },
        data: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Update session timestamp and decrement message count
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          updated_at: new Date(),
          message_count: {
            decrement: 1,
          },
        },
      });
    } catch (error) {
      this.logger.error({ error, sessionId, messageId }, 'Failed to remove message');
      throw error;
    }
  }

  // New methods required by IChatStorageService interface
  // PERFORMANCE: Default limit of 100 messages, with cursor pagination support
  async getMessages(sessionId: string, options?: {
    limit?: number;
    offset?: number;
    cursor?: string;  // Message ID for cursor-based pagination
    includeAttachments?: boolean;  // Lazy load attachments (default: true after task #134)
  }): Promise<ChatMessage[]> {
    try {
      // Default to 100 messages max per request for performance
      const limit = options?.limit ?? 100;
      // Task #134: default includeAttachments=true so chat history preserves
      // image thumbnails on reload. Was false which left users seeing text-
      // only history for the image-aware turns they had earlier.
      const includeAttachments = options?.includeAttachments ?? true;

      const messages = await this.prisma.chatMessage.findMany({
        where: {
          session_id: sessionId,
          deleted_at: null,
          // Cursor-based pagination for efficiency
          ...(options?.cursor ? { created_at: { gt: new Date(options.cursor) } } : {}),
        },
        // Only include attachments when explicitly requested (lazy loading)
        include: includeAttachments ? { attachments: true } : undefined,
        orderBy: {
          created_at: 'asc',
        },
        take: limit,
        skip: options?.offset,
      });

      // CRITICAL FIX: Deduplicate messages by ID before returning
      // This handles duplicates that may exist in the database from before deduplication was added
      const seenIds = new Set<string>();
      const uniqueMessages = messages.filter(msg => {
        if (seenIds.has(msg.id)) {
          this.logger.warn({ messageId: msg.id, sessionId }, 'Duplicate message found in database - filtering out');
          return false;
        }
        seenIds.add(msg.id);
        return true;
      });

      return uniqueMessages.map((msg: any) => ({
        id: msg.id,
        role: msg.role.toLowerCase(),
        content: msg.content || '',
        timestamp: msg.created_at.toISOString(), // Standardized to ISO string for consistency
        model: msg.model || undefined, // Include model for UI badge display
        // CRITICAL: MUST preserve tool_calls from database for OpenAI-compatible provider compatibility
        // Tool calls are required to correlate tool responses via tool_call_id in follow-up conversations
        toolCalls: (msg.tool_calls as any) || [],
        toolResults: (msg.tool_results as any) || [],
        toolCallId: msg.tool_call_id || null,
        tokenUsage: msg.token_usage as any,
        visualizations: (msg.visualizations as any) || [],
        // Sev-0 #924/#925/#926 — canonical content_blocks chronology. Read
        // back on session reload so MessageBubble renders byte-identical
        // DOM to the live stream. Null/undefined falls through to the
        // legacy reconstruction path for messages persisted before Phase 3.
        content_blocks: (msg.content_blocks as any) || undefined,
        mcpCalls: (msg.mcp_calls as any) || [],
        // PERFORMANCE: Only map attachments if they were loaded (lazy loading)
        // When not loaded, return empty array - client can fetch via separate API call
        attachments: includeAttachments && msg.attachments ? (msg.attachments || []).map((att: any) => ({
          id: att.id,
          originalName: att.original_name || att.filename,
          mimeType: att.mime_type,
          size: att.file_size || att.size,
          // Task #134: rehydrate base64 from metadata when inline-stored.
          // Falls back to download URL for migrated blob-storage attachments.
          base64Data: (att.metadata as any)?.base64Data ?? null,
          url: att.upload_path && !(att.metadata as any)?.base64Data
            ? `/api/files/${att.id}/download`
            : undefined,
          metadata: att.metadata as any
        })) : [],
        parentId: msg.parent_id,
        branchId: msg.branch_id,
        metadata: (msg.metadata as any) || undefined
      }));
    } catch (error) {
      this.logger.error({ error, sessionId, options }, 'Failed to get messages');
      throw error;
    }
  }

  async updateMessage(messageId: string, updates: any): Promise<ChatMessage> {
    try {
      const updateData: any = {
        updated_at: new Date(),
      };

      // Only update supported fields
      if (updates.content !== undefined) {
        updateData.content = updates.content;
      }
      if (updates.toolCalls !== undefined) {
        updateData.tool_calls = updates.toolCalls;
      }
      if (updates.toolResults !== undefined) {
        updateData.tool_results = updates.toolResults;
      }
      if (updates.model !== undefined) {
        updateData.model = updates.model;
      }
      if (updates.tokenUsage !== undefined && updates.tokenUsage !== null) {
        updateData.token_usage = updates.tokenUsage;
        // Also populate the dedicated token columns for analytics queries
        // Handle both OpenAI format (prompt_tokens/completion_tokens) and internal format
        const promptTokens = updates.tokenUsage?.prompt_tokens || updates.tokenUsage?.promptTokens || 0;
        const completionTokens = updates.tokenUsage?.completion_tokens || updates.tokenUsage?.completionTokens || 0;
        updateData.tokens_input = promptTokens;
        updateData.tokens_output = completionTokens;
        updateData.tokens = promptTokens + completionTokens;
        // Cost should be provided by LLMMetricsService - don't estimate here
      }
      if (updates.cost !== undefined) {
        updateData.cost = updates.cost;
      }
      if (updates.mcpCalls !== undefined) {
        updateData.mcp_calls = updates.mcpCalls;
      }
      if (updates.visualizations !== undefined) {
        updateData.visualizations = updates.visualizations;
      }

      const message = await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: updateData,
      });

      return {
        id: message.id,
        role: message.role.toLowerCase(),
        content: message.content || '',
        timestamp: message.created_at.toISOString(),
        // CRITICAL: MUST preserve tool_calls from database for OpenAI-compatible provider compatibility
        toolCalls: (message.tool_calls as any) || [],
        toolResults: (message.tool_results as any) || [],
        toolCallId: message.tool_call_id || null,
        tokenUsage: message.token_usage as any,
        visualizations: (message.visualizations as any) || [],
        mcpCalls: (message.mcp_calls as any) || [],
        attachments: [],
        parentId: message.parent_id || undefined,
        branchId: message.branch_id || undefined,
        metadata: (message.visualizations as any)?.[0] || undefined
      };
    } catch (error) {
      this.logger.error({ error, messageId, updates }, 'Failed to update message');
      throw error;
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    try {
      // Soft delete the message
      await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Note: We don't update session message count here since we don't have session_id
      // The caller should handle session updates if needed
    } catch (error) {
      this.logger.error({ error, messageId }, 'Failed to delete message');
      throw error;
    }
  }

  async updateSessionMetadata(sessionId: string, metadata: Record<string, any>): Promise<void> {
    try {
      // Extract context window metrics to save to dedicated columns
      const {
        contextTokensInput,
        contextTokensOutput,
        contextTokensTotal,
        contextWindowSize,
        contextUtilizationPct,
        ...otherMetadata
      } = metadata;

      // Build update data with context window fields mapped to actual columns
      const updateData: any = {
        updated_at: new Date(),
      };

      // Save context window metrics to dedicated columns (not JSON metadata)
      if (contextTokensInput !== undefined) {
        updateData.context_tokens_input = contextTokensInput;
      }
      if (contextTokensOutput !== undefined) {
        updateData.context_tokens_output = contextTokensOutput;
      }
      if (contextTokensTotal !== undefined) {
        updateData.context_tokens_total = contextTokensTotal;
      }
      if (contextWindowSize !== undefined) {
        updateData.context_window_size = contextWindowSize;
      }
      if (contextUtilizationPct !== undefined) {
        // Clamp to Decimal(5,2) range: max 999.99, min 0
        updateData.context_utilization_pct = Math.min(999.99, Math.max(0, contextUtilizationPct));
      }

      // Store remaining metadata in the JSON field
      if (Object.keys(otherMetadata).length > 0) {
        updateData.metadata = otherMetadata as any;
      }

      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: updateData,
      });

      this.logger.debug({
        sessionId,
        contextTokensTotal,
        contextUtilizationPct,
        metadataKeys: Object.keys(otherMetadata)
      }, 'Session metadata and context metrics updated');
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to update session metadata');
      throw error;
    }
  }

  async searchSessions(
    userId: string,
    query: string,
    options: {
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<ChatSession[]> {
    try {
      // Use Prisma's full-text search capabilities
      const sessions = await this.prisma.chatSession.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          OR: [
            {
              title: {
                contains: query,
                mode: 'insensitive',
              },
            },
            {
              messages: {
                some: {
                  content: {
                    contains: query,
                    mode: 'insensitive',
                  },
                  deleted_at: null,
                },
              },
            },
          ],
        },
        orderBy: {
          updated_at: 'desc',
        },
        take: options.limit,
        skip: options.offset,
      });

      return sessions.map(session => this.transformSessionToResponse(session));
    } catch (error) {
      this.logger.error({ error, userId, query, options }, 'Failed to search sessions');
      throw error;
    }
  }

  // Helper method to transform Prisma session to response format
  private transformSessionToResponse(session: any): ChatSession {
    return {
      id: session.id,
      title: session.title,
      messages: (session.messages || []).map((msg: any) => ({
        id: msg.id,
        role: msg.role.toLowerCase(), // Convert back to lowercase for frontend compatibility
        content: msg.content || '',
        timestamp: msg.created_at.toISOString(),
        // CRITICAL: MUST preserve tool_calls from database for OpenAI-compatible provider compatibility
        // Tool calls are required to correlate tool responses via tool_call_id in follow-up conversations
        toolCalls: (msg.tool_calls as any) || [],
        toolResults: (msg.tool_results as any) || [],
        toolCallId: msg.tool_call_id || null,
        tokenUsage: msg.token_usage as any,
        visualizations: (msg.visualizations as any) || [],
        mcpCalls: (msg.mcp_calls as any) || [],
        attachments: [],
        parentId: msg.parent_id || undefined,
        branchId: msg.branch_id || undefined,
        metadata: msg.visualizations?.[0] || null
      })),
      createdAt: session.created_at.toISOString(),
      updatedAt: session.updated_at.toISOString(),
      deletedAt: session.deleted_at ? session.deleted_at.toISOString() : null,
      userId: session.user_id,
      tenantId: null, // tenant_id field removed from schema
      messageCount: session.message_count || 0,
      isActive: session.is_active !== false,
      isArchived: false, // is_archived field doesn't exist in schema
      totalTokens: session.total_tokens || 0,
      totalCost: session.total_cost || 0,
      model: session.model,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Health check failed', error);
      return false;
    }
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.info('Chat storage service closed (Prisma disconnected)');
  }

  // Getter for compatibility (though Prisma doesn't expose raw pool)
  getPool() {
    this.logger.warn('getPool() called - this service now uses Prisma instead of raw Pool');
    return null;
  }
}