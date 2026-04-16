/**
 * Prompt Template Semantic Service
 *
 * Selects the best prompt template using:
 * - User intent from query
 * - User's historical memory (from Milvus user collections)
 * - Semantic similarity to template descriptions
 */

import type { Logger } from 'pino';
import { MilvusVectorService } from './MilvusVectorService.js';
import { PROMPT_TEMPLATES, type PromptTemplate } from './prompts/PromptTemplates.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';

interface TemplateScore {
  template: PromptTemplate;
  score: number;
  reason: string;
}

export class PromptTemplateSemanticService {
  private milvusService: MilvusVectorService;
  private embeddingService: UniversalEmbeddingService;
  private logger: Logger;
  private collectionName = 'prompt_templates';
  private indexed = false;
  private dbTemplates: PromptTemplate[] = [];
  private lastDbLoad: Date | null = null;
  private dbLoadInterval = 5 * 60 * 1000; // Refresh from DB every 5 minutes
  private readonly REDIS_CACHE_KEY = 'prompt_templates:all';
  private readonly REDIS_CACHE_TTL = 300; // 5 minutes

  constructor(logger: Logger, milvusService: MilvusVectorService) {
    this.logger = logger.child({ service: 'PromptTemplateSemanticService' }) as Logger;
    this.milvusService = milvusService;
    this.embeddingService = new UniversalEmbeddingService(this.logger);
  }

  /**
   * Load templates with cascade: Memory → Redis → Database → Hardcoded
   */
  private async loadTemplates(): Promise<PromptTemplate[]> {
    // 1. Check in-memory cache first
    const now = new Date();
    if (this.lastDbLoad && (now.getTime() - this.lastDbLoad.getTime()) < this.dbLoadInterval) {
      if (this.dbTemplates.length > 0) {
        this.logger.debug({ count: this.dbTemplates.length, source: 'memory' }, 'Using in-memory cached templates');
        return this.dbTemplates;
      }
    }

    // 2. Try Redis cache
    try {
      const redis = getRedisClient();
      if (redis) {
        const cached = await redis.get(this.REDIS_CACHE_KEY);
        if (cached) {
          const templates = JSON.parse(cached) as PromptTemplate[];
          this.dbTemplates = templates;
          this.lastDbLoad = now;
          this.logger.info({ count: templates.length, source: 'redis' }, 'Loaded prompt templates from Redis cache');
          return templates;
        }
      }
    } catch (error: any) {
      this.logger.debug({ error: error.message }, 'Redis cache miss or error');
    }

    // 3. Try database
    try {
      const dbTemplates = await prisma.promptTemplate.findMany({
        where: { is_active: true },
        orderBy: { name: 'asc' }
      });

      if (dbTemplates.length > 0) {
        // Convert DB format to PromptTemplate format
        this.dbTemplates = dbTemplates.map(t => ({
          name: t.name,
          category: t.category || 'general',
          content: t.content,
          description: t.description || undefined,
          tags: t.tags || [],
          intelligence: (t.intelligence as any) || {},
          modelPreferences: (t.model_preferences as any) || {},
          isDefault: t.is_default,
          isActive: t.is_active
        }));

        this.lastDbLoad = now;
        this.logger.info({ count: this.dbTemplates.length, source: 'database' }, 'Loaded prompt templates from database');

        // Store in Redis for next time
        try {
          const redis = getRedisClient();
          if (redis) {
            await redis.set(this.REDIS_CACHE_KEY, JSON.stringify(this.dbTemplates), this.REDIS_CACHE_TTL);
            this.logger.debug('Cached templates in Redis');
          }
        } catch (e) {
          // Ignore Redis errors
        }

        return this.dbTemplates;
      }
    } catch (error: any) {
      this.logger.warn({ error: error.message }, 'Failed to load templates from database');
    }

    // 4. Fallback to hardcoded templates
    this.logger.info({ count: PROMPT_TEMPLATES.length, source: 'hardcoded' }, 'Using hardcoded prompt templates');
    return PROMPT_TEMPLATES;
  }

  /**
   * Index all prompt templates in dedicated Milvus collection with tags
   */
  async indexTemplates(): Promise<void> {
    if (this.indexed) {
      this.logger.debug('Templates already indexed');
      return;
    }

    try {
      this.logger.info('Indexing prompt templates in Milvus with tags');

      // Load templates from DB or fallback to hardcoded
      const templates = await this.loadTemplates();

      for (const template of templates) {
        if (!template.isActive) continue;

        // Create rich description for embedding including tags
        const searchText = [
          template.name,
          template.description || '',
          template.category,
          ...(template.tags || [])
        ].join(' ');

        this.logger.debug({
          template: template.name,
          category: template.category,
          tags: template.tags,
          searchTextLength: searchText.length
        }, 'Indexing template with metadata');

        // Get embedding
        const embedding = await this.getEmbedding(searchText);

        // Store in Milvus with comprehensive metadata including tags
        await this.milvusService.storeConversationMessage({
          user_id: 'system', // System-level templates
          session_id: `template_${template.name}`,
          message_id: template.name,
          role: 'system',
          content: searchText,
          embedding,
          metadata: {
            type: 'prompt_template',
            template_name: template.name,
            category: template.category,
            tags: template.tags || [],
            description: template.description || '',
            // Store full template data for retrieval
            modelPreferences: template.modelPreferences || {},
            isDefault: template.isDefault || false
          }
        });

        this.logger.debug({
          template: template.name,
          tagsIndexed: template.tags?.length || 0
        }, 'Template indexed with tags');
      }

      this.indexed = true;
      this.logger.info({
        count: templates.filter(t => t.isActive).length,
        totalTags: templates.reduce((sum, t) => sum + (t.tags?.length || 0), 0)
      }, '✅ Templates indexed successfully in Milvus with tags');

    } catch (error) {
      this.logger.error({ error }, 'Failed to index templates');
      throw error;
    }
  }

  /**
   * Select the best template for a user query using semantic routing
   * @param userId - User ID
   * @param query - User's query
   * @param conversationContext - Optional conversation history
   * @param isAdmin - Whether user is admin (determines if admin templates are available)
   */
  async selectTemplateForQuery(
    userId: string,
    query: string,
    conversationContext?: string[],
    isAdmin: boolean = false
  ): Promise<PromptTemplate> {
    try {
      // Ensure templates are indexed
      if (!this.indexed) {
        await this.indexTemplates();
      }

      this.logger.debug({ userId, query: query.substring(0, 100) }, 'Selecting template via semantic routing');

      // 1. Get query embedding
      const queryEmbedding = await this.getEmbedding(query);

      // 2. Search for matching template
      const templateMatches = await this.milvusService.searchSimilarConversations(
        'system', // Search system templates
        queryEmbedding,
        5 // Top 5 candidates
      );

      // Filter for prompt_template type
      const templateResults = templateMatches
        .filter(m => m.metadata?.type === 'prompt_template')
        .map(m => ({
          name: m.metadata?.template_name,
          score: m.score,
          category: m.metadata?.category
        }));

      this.logger.debug({ templateResults }, 'Template search results');

      // 3. Search user's memory to understand their preferences and context
      let userPreference: string | null = null;
      try {
        const userMemories = await this.milvusService.searchMemoriesByEmbedding(userId, queryEmbedding, 3);

        if (userMemories && userMemories.length > 0) {
          // Analyze user's past interactions
          const memoryText = userMemories.map(m => m.content).join(' ');

          // Check for patterns
          if (memoryText.toLowerCase().includes('brief') || memoryText.toLowerCase().includes('concise')) {
            userPreference = 'concise';
          } else if (memoryText.toLowerCase().includes('infrastructure') || memoryText.toLowerCase().includes('devops')) {
            userPreference = 'infrastructure';
          }
        }
      } catch (error) {
        this.logger.debug({ error }, 'No user memory found, using query-only routing');
      }

      // 4. Load templates from DB (with fallback to hardcoded)
      const templates = await this.loadTemplates();

      // 5. Score templates - FILTER OUT ADMIN TEMPLATES FOR NON-ADMIN USERS
      const scores: TemplateScore[] = [];

      // Filter templates based on admin status
      const availableTemplates = templates.filter(t => {
        if (!t.isActive) return false;
        // Non-admin users cannot access admin category templates
        if (!isAdmin && (t.category === 'admin' || t.tags?.includes('admin') || t.tags?.includes('privileged'))) {
          return false;
        }
        return true;
      });

      this.logger.debug({
        isAdmin,
        totalTemplates: templates.length,
        availableTemplates: availableTemplates.length,
        filteredOut: templates.length - availableTemplates.length
      }, 'Template filtering for user');

      for (const template of availableTemplates) {
        let score = 0;
        let reason = '';

        // Match from semantic search
        const searchMatch = templateResults.find(r => r.name === template.name);
        if (searchMatch && searchMatch.score > 0.7) {
          score += searchMatch.score * 0.5; // 50% weight
          reason = `Semantic match (${(searchMatch.score * 100).toFixed(1)}%)`;
        }

        // User preference from memory
        if (userPreference) {
          if (template.category === userPreference || template.tags?.includes(userPreference)) {
            score += 0.3; // 30% weight
            reason += `, User history (${userPreference})`;
          }
        }

        // Keyword matching as fallback
        const queryLower = query.toLowerCase();
        for (const tag of template.tags || []) {
          if (queryLower.includes(tag.toLowerCase())) {
            score += 0.2; // 20% weight
            reason += `, Keyword: ${tag}`;
            break;
          }
        }

        if (score > 0) {
          scores.push({ template, score, reason });
        }
      }

      // Sort by score
      scores.sort((a, b) => b.score - a.score);

      this.logger.info({
        topScores: scores.slice(0, 3).map(s => ({ name: s.template.name, score: s.score.toFixed(2), reason: s.reason }))
      }, 'Template scoring results');

      // 6. Return best match or default
      if (scores.length > 0 && scores[0].score > 0.5) {
        this.logger.info({
          selected: scores[0].template.name,
          score: scores[0].score.toFixed(2),
          reason: scores[0].reason
        }, 'Selected template via semantic routing');
        return scores[0].template;
      }

      // Fallback to default - USE FILTERED TEMPLATES
      this.logger.debug('No strong match, using default template');
      return availableTemplates.find(t => t.tags?.includes('default')) || availableTemplates[0];

    } catch (error) {
      this.logger.error({ error, userId, query, isAdmin }, 'Error in semantic template selection, falling back to default');
      // Load templates one more time for fallback
      const templates = await this.loadTemplates();

      // CRITICAL: Filter out admin templates for non-admin users in fallback
      const availableTemplates = templates.filter(t => {
        if (!t.isActive) return false;
        if (!isAdmin && (t.category === 'admin' || t.tags?.includes('admin') || t.tags?.includes('privileged'))) {
          this.logger.warn({ templateName: t.name, category: t.category }, '🔒 SECURITY: Blocked non-admin from accessing admin template in error fallback');
          return false;
        }
        return true;
      });

      return availableTemplates.find(t => t.tags?.includes('default')) || availableTemplates[0];
    }
  }

  /**
   * Get embedding for text using UniversalEmbeddingService
   */
  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get embedding');
      throw error;
    }
  }
}
