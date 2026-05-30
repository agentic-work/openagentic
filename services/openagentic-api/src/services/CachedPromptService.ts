/**
 * Cached Prompt Service - Enhanced PromptService with Redis caching
 * 
 * Wraps the original PromptService with intelligent caching to:
 * - Reduce database load for frequently accessed prompts
 * - Improve response times for prompt lookups
 * - Cache user-specific prompt assignments
 * - Invalidate cache when prompts are modified
 */

import type { Logger } from 'pino';
import { PromptService } from './PromptService.js';
import { MilvusVectorService } from './MilvusVectorService.js';
import { PromptTemplateSemanticService } from './PromptTemplateSemanticService.js';
import { getRedisClient, UnifiedRedisClient } from '../utils/redis-client.js';
import { prisma } from '../utils/prisma.js';

export interface CachedPromptOptions {
  enableCache?: boolean;
  cacheTTL?: number;
  cacheUserAssignments?: boolean;
  cacheTemplates?: boolean;
  enableSemanticRouting?: boolean;
  milvusService?: MilvusVectorService;
}

export class CachedPromptService {
  private promptService: PromptService;
  private semanticService?: PromptTemplateSemanticService;
  private redisClient: UnifiedRedisClient;
  private logger: Logger;
  private options: Required<CachedPromptOptions>;

  constructor(logger: Logger, options: CachedPromptOptions = {}) {
    this.redisClient = getRedisClient();
    // PromptService now has built-in caching and Milvus semantic search
    this.promptService = new PromptService(logger, this.redisClient, options.milvusService);
    this.logger = logger.child({ service: 'CachedPromptService' }) as Logger;

    this.options = {
      enableCache: true,
      cacheTTL: 1800, // 30 minutes
      cacheUserAssignments: true,
      cacheTemplates: true,
      enableSemanticRouting: true, // Enable by default
      milvusService: undefined,
      ...options
    } as Required<CachedPromptOptions>;

    // Initialize semantic routing if enabled and Milvus is available
    if (this.options.enableSemanticRouting && options.milvusService) {
      this.semanticService = new PromptTemplateSemanticService(logger, options.milvusService);
      this.logger.info('Semantic template routing enabled');
    } else {
      this.logger.info('Semantic template routing disabled - using default template only');
    }

    if (!this.redisClient || !this.redisClient.isConnected()) {
      this.logger.warn('Cache manager not available, falling back to direct database access');
      this.options.enableCache = false;
    }
  }

  /**
   * Get user's assigned prompt template with caching
   * @deprecated Use selectTemplateForQuery for semantic routing
   */
  async getUserPromptTemplate(userId: string): Promise<any> {
    if (!this.options.enableCache || !this.options.cacheUserAssignments) {
      return this.promptService.getDefaultPromptTemplate();
    }

    const cacheKey = `prompt:user:${userId}`;

    try {
      // Try cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug({ userId }, 'Prompt template cache hit');
        return cached;
      }

      // Cache miss - get from database
      this.logger.debug({ userId }, 'Prompt template cache miss, fetching from database');
      const template = await this.promptService.getDefaultPromptTemplate();

      // Cache the result
      if (template) {
        await this.redisClient.set(cacheKey, template, this.options.cacheTTL);
      }

      return template;

    } catch (error) {
      this.logger.error({ error, userId }, 'Error in cached prompt template lookup');
      // Fallback to direct database access
      return this.promptService.getDefaultPromptTemplate();
    }
  }

  /**
   * Select template using semantic routing based on user query and memory
   * This is the NEW way to get templates - uses intent detection and user context
   */
  async selectTemplateForQuery(
    userId: string,
    query: string,
    conversationContext?: string[]
  ): Promise<any> {
    // If semantic routing is disabled, return default
    if (!this.semanticService) {
      this.logger.debug('Semantic routing disabled, using default template');
      return this.getDefaultPromptTemplate();
    }

    try {
      // Use semantic service to select best template
      const template = await this.semanticService.selectTemplateForQuery(
        userId,
        query,
        conversationContext
      );

      this.logger.info({
        userId,
        query: query.substring(0, 100),
        selectedTemplate: template.name
      }, 'Template selected via semantic routing');

      return template;

    } catch (error) {
      this.logger.error({ error, userId }, 'Error in semantic template selection, falling back to default');
      return this.getDefaultPromptTemplate();
    }
  }

  /**
   * Get default prompt template with caching
   */
  async getDefaultPromptTemplate(): Promise<any> {
    if (!this.options.enableCache || !this.options.cacheTemplates) {
      return this.promptService.getDefaultPromptTemplate();
    }

    const cacheKey = 'prompt:default';
    
    try {
      // Try cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug('Default prompt template cache hit');
        return cached;
      }

      // Cache miss - get from database
      this.logger.debug('Default prompt template cache miss, fetching from database');
      const template = await this.promptService.getDefaultPromptTemplate();
      
      // Cache the result with longer TTL since default template changes rarely
      if (template) {
        await this.redisClient.set(cacheKey, template, this.options.cacheTTL * 2);
      }
      
      return template;

    } catch (error) {
      this.logger.error({ error }, 'Error in cached default prompt template lookup');
      // Fallback to direct database access
      return this.promptService.getDefaultPromptTemplate();
    }
  }

  /**
   * Get all active prompt templates with caching
   */
  async getActiveTemplates(): Promise<any[]> {
    if (!this.options.enableCache || !this.options.cacheTemplates) {
      return this.promptService.getAllTemplates();
    }

    const cacheKey = 'prompt:templates:active';
    
    try {
      // Try cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug('Active templates cache hit');
        return cached;
      }

      // Cache miss - get from database
      this.logger.debug('Active templates cache miss, fetching from database');
      const templates = await this.promptService.getAllTemplates();
      
      // Cache the result
      if (templates && templates.length > 0) {
        await this.redisClient.set(cacheKey, templates, this.options.cacheTTL);
      }
      
      return templates;

    } catch (error) {
      this.logger.error({ error }, 'Error in cached active templates lookup');
      // Fallback to direct database access
      return this.promptService.getAllTemplates();
    }
  }

  /**
   * Get template by ID with caching
   */
  async getTemplateById(templateId: string): Promise<any> {
    if (!this.options.enableCache || !this.options.cacheTemplates) {
      return this.promptService.getTemplateById(parseInt(templateId));
    }

    const cacheKey = `prompt:template:${templateId}`;
    
    try {
      // Try cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug({ templateId }, 'Template by ID cache hit');
        return cached;
      }

      // Cache miss - get from database
      this.logger.debug({ templateId }, 'Template by ID cache miss, fetching from database');
      const template = await this.promptService.getTemplateById(parseInt(templateId));
      
      // Cache the result
      if (template) {
        await this.redisClient.set(cacheKey, template, this.options.cacheTTL);
      }
      
      return template;

    } catch (error) {
      this.logger.error({ error, templateId }, 'Error in cached template by ID lookup');
      // Fallback to direct database access
      return this.promptService.getTemplateById(parseInt(templateId));
    }
  }

  /**
   * Assign prompt to user and invalidate cache
   */
  async assignPromptToUser(userId: string, templateId: string, assignedBy: string): Promise<any> {
    try {
      // Perform the assignment
      const result = await this.promptService.assignTemplateToUser({
        userId, 
        templateId: parseInt(templateId), 
        assignedBy
      });
      
      // Invalidate related caches
      if (this.options.enableCache) {
        await this.invalidateUserCache(userId);
        this.logger.debug({ userId, templateId }, 'Invalidated user prompt cache after assignment');
      }
      
      return result;

    } catch (error) {
      this.logger.error({ error, userId, templateId }, 'Error assigning prompt to user');
      throw error;
    }
  }

  /**
   * Create new template and invalidate relevant caches
   */
  async createTemplate(templateData: any): Promise<any> {
    try {
      const result = await this.promptService.createTemplate(templateData);
      
      // Invalidate template caches
      if (this.options.enableCache) {
        await this.invalidateTemplateCaches();
        this.logger.debug({ templateId: result.id }, 'Invalidated template caches after creation');
      }
      
      return result;

    } catch (error) {
      this.logger.error({ error }, 'Error creating template');
      throw error;
    }
  }

  /**
   * Update template and invalidate relevant caches
   */
  async updateTemplate(templateId: string, updates: any): Promise<any> {
    try {
      const result = await this.promptService.updateTemplate(parseInt(templateId), updates);
      
      // Invalidate template caches
      if (this.options.enableCache) {
        await this.invalidateTemplateCaches();
        await this.invalidateTemplateCache(templateId);
        
        // If this template is assigned to users, invalidate their caches too
        if (updates.isDefault || updates.isActive !== undefined) {
          await this.invalidateAllUserCaches();
        }
        
        this.logger.debug({ templateId }, 'Invalidated template caches after update');
      }
      
      return result;

    } catch (error) {
      this.logger.error({ error, templateId }, 'Error updating template');
      throw error;
    }
  }

  /**
   * Delete template and invalidate relevant caches
   */
  async deleteTemplate(templateId: string): Promise<void> {
    try {
      await this.promptService.deleteTemplate(parseInt(templateId));
      
      // Invalidate template caches
      if (this.options.enableCache) {
        await this.invalidateTemplateCaches();
        await this.invalidateTemplateCache(templateId);
        await this.invalidateAllUserCaches(); // Users might have been using this template
        
        this.logger.debug({ templateId }, 'Invalidated template caches after deletion');
      }

    } catch (error) {
      this.logger.error({ error, templateId }, 'Error deleting template');
      throw error;
    }
  }

  /**
   * Ensure default templates (bypass cache for admin operations)
   */
  async ensureDefaultTemplates(): Promise<void> {
    return this.promptService.ensureDefaultTemplates();
  }

  /**
   * Get prompt statistics with caching
   */
  async getPromptStatistics(): Promise<any> {
    if (!this.options.enableCache) {
      // Since getPromptStatistics doesn't exist, return basic stats
      const templates = await this.promptService.getAllTemplates();
      return {
        totalTemplates: templates.length,
        activeTemplates: templates.filter((t: any) => t.isActive).length,
        defaultTemplate: templates.find((t: any) => t.isDefault)?.name || 'None'
      };
    }

    const cacheKey = 'prompt:statistics';
    
    try {
      // Try cache first
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        this.logger.debug('Prompt statistics cache hit');
        return cached;
      }

      // Cache miss - get from database
      this.logger.debug('Prompt statistics cache miss, fetching from database');
      const templates = await this.promptService.getAllTemplates();
      const stats = {
        totalTemplates: templates.length,
        activeTemplates: templates.filter((t: any) => t.isActive).length,
        defaultTemplate: templates.find((t: any) => t.isDefault)?.name || 'None'
      };
      
      // Cache with shorter TTL since stats change more frequently
      if (stats) {
        await this.redisClient.set(cacheKey, stats, 300); // 5 minutes
      }
      
      return stats;

    } catch (error) {
      this.logger.error({ error }, 'Error in cached prompt statistics lookup');
      // Fallback: return basic stats on error
      const templates = await this.promptService.getAllTemplates();
      return {
        totalTemplates: templates.length,
        activeTemplates: templates.filter((t: any) => t.isActive).length,
        defaultTemplate: templates.find((t: any) => t.isDefault)?.name || 'None'
      };
    }
  }

  // Cache invalidation methods

  /**
   * Invalidate cache for a specific user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    if (!this.options.enableCache || !this.redisClient) return;

    try {
      const cacheKey = `prompt:user:${userId}`;
      await this.redisClient.del(cacheKey);
      this.logger.debug({ userId }, 'Invalidated user prompt cache');
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to invalidate user cache');
    }
  }

  /**
   * Invalidate cache for a specific template
   */
  async invalidateTemplateCache(templateId: string): Promise<void> {
    if (!this.options.enableCache || !this.redisClient) return;

    try {
      const cacheKey = `prompt:template:${templateId}`;
      await this.redisClient.del(cacheKey);
      this.logger.debug({ templateId }, 'Invalidated template cache');
    } catch (error) {
      this.logger.warn({ error, templateId }, 'Failed to invalidate template cache');
    }
  }

  /**
   * Invalidate all template-related caches
   */
  async invalidateTemplateCaches(): Promise<void> {
    if (!this.options.enableCache || !this.redisClient) return;

    try {
      const cacheKeys = [
        'prompt:default',
        'prompt:templates:active',
        'prompt:statistics'
      ];

      for (const key of cacheKeys) {
        await this.redisClient.del(key);
      }

      this.logger.debug('Invalidated all template caches');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to invalidate template caches');
    }
  }

  /**
   * Invalidate all user caches (expensive operation - use sparingly)
   */
  async invalidateAllUserCaches(): Promise<void> {
    if (!this.options.enableCache || !this.redisClient) return;

    this.logger.warn('Invalidating all user prompt caches - this is an expensive operation');
    
    // Note: This is a simplified approach. In production, you might want to:
    // 1. Keep track of cached user keys
    // 2. Use Redis pattern matching to delete keys
    // 3. Use cache versioning instead of deletion
    
    // For now, we'll just log the action since we don't have a key tracking mechanism
    this.logger.debug('All user caches invalidation requested');
  }

  /**
   * Get cache statistics
   */
  async getCacheStatistics(): Promise<{
    connected: boolean;
    stats?: any;
  }> {
    if (!this.redisClient) {
      return { connected: false };
    }

    try {
      const connected = this.redisClient?.isConnected() || false;
      const stats = connected ? {
        enabled: this.options.enableCache,
        cacheTTL: this.options.cacheTTL,
        userAssignmentCaching: this.options.cacheUserAssignments,
        templateCaching: this.options.cacheTemplates
      } : undefined;

      return { connected, stats };

    } catch (error) {
      this.logger.error({ error }, 'Error getting cache statistics');
      return { connected: false };
    }
  }

  /**
   * Health check for cached prompt service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test the underlying prompt service by calling a basic method
      await this.promptService.getAllTemplates();
      const promptServiceHealth = true;

      // Test cache connectivity (optional - service should work without cache)
      let cacheHealth = true;
      if (this.options.enableCache && this.redisClient) {
        cacheHealth = this.redisClient ? await this.redisClient.ping() : false;
      }

      this.logger.debug({
        promptServiceHealth,
        cacheHealth,
        cacheEnabled: this.options.enableCache
      }, 'Cached prompt service health check');

      // Service is healthy if prompt service works (cache is optional)
      return promptServiceHealth;

    } catch (error) {
      this.logger.error({ error }, 'Cached prompt service health check failed');
      return false;
    }
  }

  /**
   * Get system prompt for user (delegates to PromptService)
   */
  async getSystemPromptForUser(
    userId: string,
    userMessage?: string,
    userGroups?: string[]
  ): Promise<{
    content: string;
    promptTemplate?: any;
  }> {
    return this.promptService.getSystemPromptForUser(userId, userMessage, userGroups);
  }

  /**
   * Validate system prompts (delegates to PromptService)
   */
  async validateSystemPrompts(): Promise<{
    healthy: boolean;
    details: {
      defaultPrompt: boolean;
      adminPrompt: boolean;
      totalCount: number;
    };
    missing: string[];
  }> {
    return this.promptService.validateSystemPrompts();
  }

  /**
   * REMOVED: pgvector migration - no longer supported
   * Milvus handles all vector operations now
   */
  // async migrateTemplatesToPgVector(): Promise<{ migrated: number; errors: number }> {
  //   Removed - pgvector deprecated, using Milvus
  // }

  /**
   * Get semantic search statistics (delegates to PromptService)
   */
  async getSemanticSearchStats(): Promise<{
    enabled: boolean;
    templatesInDB: number;
    searchMethod: string;
  }> {
    return this.promptService.getSemanticSearchStats();
  }
}