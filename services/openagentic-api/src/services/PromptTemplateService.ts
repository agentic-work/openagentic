/**
 * Prompt Template Service
 *
 * Manages prompt templates with:
 * - PostgreSQL storage (via Prisma)
 * - Redis caching for fast retrieval
 * - Milvus embeddings for semantic search (optional)
 *
 * Works with the existing PromptTemplate schema (admin.prompt_templates)
 */

import type { Logger } from 'pino';
import type { PrismaClient, PromptTemplate } from '@prisma/client';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Redis } from 'ioredis';

// ============================================================================
// TYPES
// ============================================================================

export interface PromptTemplateInput {
  name: string;
  category?: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  isActive?: boolean;
  tags?: string[];
  intelligence?: Record<string, any>;
  modelPreferences?: Record<string, any>;
}

export interface PromptSearchResult {
  id: number;
  name: string;
  category: string | null;
  content: string;
  score: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const REDIS_KEY_PREFIX = 'prompt_template:';
const REDIS_ALL_TEMPLATES_KEY = 'prompt_templates:all';
const REDIS_DEFAULT_TEMPLATE_KEY = 'prompt_templates:default';
const MILVUS_COLLECTION_NAME = 'prompt_templates';
const DEFAULT_CACHE_TTL = 3600; // 1 hour

// ============================================================================
// PROMPT TEMPLATE SERVICE
// ============================================================================

export class PromptTemplateService {
  private logger: Logger;
  private prisma: PrismaClient;
  private redis?: Redis;
  private milvus?: MilvusClient;
  private embeddingService?: any;
  private initialized = false;

  constructor(
    logger: Logger,
    prisma: PrismaClient,
    redis?: Redis,
    milvus?: MilvusClient,
    embeddingService?: any
  ) {
    this.logger = logger.child({ service: 'PromptTemplateService' });
    this.prisma = prisma;
    this.redis = redis;
    this.milvus = milvus;
    this.embeddingService = embeddingService;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure Milvus collection exists for prompt embeddings
      if (this.milvus) {
        await this.ensureMilvusCollection();
      }

      this.initialized = true;
      this.logger.info('PromptTemplateService initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize PromptTemplateService');
      throw error;
    }
  }

  /**
   * Ensure Milvus collection exists
   */
  private async ensureMilvusCollection(): Promise<void> {
    if (!this.milvus) return;

    try {
      const hasCollection = await this.milvus.hasCollection({
        collection_name: MILVUS_COLLECTION_NAME
      });

      if (!hasCollection.value) {
        this.logger.info(`Creating Milvus collection: ${MILVUS_COLLECTION_NAME}`);
        await this.milvus.createCollection({
          collection_name: MILVUS_COLLECTION_NAME,
          fields: [
            { name: 'id', data_type: 'Int64', is_primary_key: true },
            { name: 'name', data_type: 'VarChar', max_length: 255 },
            { name: 'category', data_type: 'VarChar', max_length: 100 },
            { name: 'embedding', data_type: 'FloatVector', dim: 768 }
          ],
          enable_dynamic_field: true
        });

        // Create index for vector search
        await this.milvus.createIndex({
          collection_name: MILVUS_COLLECTION_NAME,
          field_name: 'embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'COSINE',
          params: { nlist: 128 }
        });

        await this.milvus.loadCollection({
          collection_name: MILVUS_COLLECTION_NAME
        });
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to ensure Milvus collection');
    }
  }

  /**
   * Get template by ID
   */
  async getById(id: number): Promise<PromptTemplate | null> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(`${REDIS_KEY_PREFIX}${id}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        this.logger.warn({ error, id }, 'Failed to get template from cache');
      }
    }

    // Fetch from database
    const template = await this.prisma.promptTemplate.findUnique({
      where: { id }
    });

    // Cache the result
    if (template && this.redis) {
      await this.cacheTemplate(template);
    }

    return template;
  }

  /**
   * Get template by name
   */
  async getByName(name: string): Promise<PromptTemplate | null> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(`${REDIS_KEY_PREFIX}name:${name}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        this.logger.warn({ error, name }, 'Failed to get template from cache');
      }
    }

    // Fetch from database
    const template = await this.prisma.promptTemplate.findUnique({
      where: { name }
    });

    // Cache the result
    if (template && this.redis) {
      await this.cacheTemplate(template);
    }

    return template;
  }

  /**
   * Get the default template
   */
  async getDefault(): Promise<PromptTemplate | null> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(REDIS_DEFAULT_TEMPLATE_KEY);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to get default template from cache');
      }
    }

    // Fetch from database
    const template = await this.prisma.promptTemplate.findFirst({
      where: {
        is_default: true,
        is_active: true
      }
    });

    // Cache the result
    if (template && this.redis) {
      await this.redis.setex(
        REDIS_DEFAULT_TEMPLATE_KEY,
        DEFAULT_CACHE_TTL,
        JSON.stringify(template)
      );
    }

    return template;
  }

  /**
   * Get all active templates
   */
  async getAllActive(): Promise<PromptTemplate[]> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(REDIS_ALL_TEMPLATES_KEY);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to get templates from cache');
      }
    }

    // Fetch from database
    const templates = await this.prisma.promptTemplate.findMany({
      where: { is_active: true },
      orderBy: [
        { is_default: 'desc' },
        { name: 'asc' }
      ]
    });

    // Cache the result
    if (this.redis) {
      await this.redis.setex(
        REDIS_ALL_TEMPLATES_KEY,
        DEFAULT_CACHE_TTL,
        JSON.stringify(templates)
      );
    }

    return templates;
  }

  /**
   * Get templates by category
   */
  async getByCategory(category: string): Promise<PromptTemplate[]> {
    return this.prisma.promptTemplate.findMany({
      where: {
        category,
        is_active: true
      },
      orderBy: { name: 'asc' }
    });
  }

  /**
   * Create a new template
   */
  async create(input: PromptTemplateInput, userId?: string): Promise<PromptTemplate> {
    const template = await this.prisma.promptTemplate.create({
      data: {
        name: input.name,
        category: input.category,
        description: input.description,
        content: input.content,
        is_default: input.isDefault ?? false,
        is_active: input.isActive ?? true,
        tags: input.tags ?? [],
        intelligence: input.intelligence ?? {},
        model_preferences: input.modelPreferences ?? {}
      }
    });

    // Invalidate cache
    await this.invalidateCache();

    // Index in Milvus
    await this.indexTemplate(template);

    this.logger.info({ templateId: template.id, name: template.name }, 'Created prompt template');
    return template;
  }

  /**
   * Update a template
   */
  async update(id: number, input: Partial<PromptTemplateInput>): Promise<PromptTemplate> {
    const template = await this.prisma.promptTemplate.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.content && { content: input.content }),
        ...(input.isDefault !== undefined && { is_default: input.isDefault }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        ...(input.tags && { tags: input.tags }),
        ...(input.intelligence && { intelligence: input.intelligence }),
        ...(input.modelPreferences && { model_preferences: input.modelPreferences })
      }
    });

    // Invalidate cache
    await this.invalidateCache();

    // Re-index in Milvus if content changed
    if (input.content) {
      await this.indexTemplate(template);
    }

    this.logger.info({ templateId: template.id, name: template.name }, 'Updated prompt template');
    return template;
  }

  /**
   * Delete a template (soft delete by setting is_active = false)
   */
  async delete(id: number): Promise<void> {
    await this.prisma.promptTemplate.update({
      where: { id },
      data: { is_active: false }
    });

    // Invalidate cache
    await this.invalidateCache();

    this.logger.info({ templateId: id }, 'Deleted prompt template');
  }

  /**
   * Semantic search for templates
   */
  async semanticSearch(query: string, limit = 5): Promise<PromptSearchResult[]> {
    // If no Milvus/embedding service, fall back to text search
    if (!this.milvus || !this.embeddingService) {
      return this.textSearch(query, limit);
    }

    try {
      // Generate embedding for query
      const embedding = await this.embeddingService.generateEmbedding(query);

      // Search in Milvus
      const results = await this.milvus.search({
        collection_name: MILVUS_COLLECTION_NAME,
        data: [embedding],
        limit,
        output_fields: ['id', 'name', 'category']
      });

      // Get full templates from database
      const templateIds = results.results.map(r => Number(r.id));
      const templates = await this.prisma.promptTemplate.findMany({
        where: { id: { in: templateIds } }
      });

      // Map results with scores
      return results.results.map(r => {
        const resultId = Number(r.id);
        const template = templates.find(t => t.id === resultId);
        return {
          id: resultId,
          name: template?.name || '',
          category: template?.category || null,
          content: template?.content || '',
          score: r.score
        };
      });
    } catch (error) {
      this.logger.error({ error, query }, 'Semantic search failed, falling back to text search');
      return this.textSearch(query, limit);
    }
  }

  /**
   * Simple text search fallback
   */
  private async textSearch(query: string, limit: number): Promise<PromptSearchResult[]> {
    const templates = await this.prisma.promptTemplate.findMany({
      where: {
        is_active: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { tags: { has: query } }
        ]
      },
      take: limit
    });

    return templates.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      content: t.content,
      score: 1.0 // Text search doesn't have scores
    }));
  }

  /**
   * Cache a template in Redis
   */
  private async cacheTemplate(template: PromptTemplate): Promise<void> {
    if (!this.redis) return;

    try {
      const json = JSON.stringify(template);
      await Promise.all([
        this.redis.setex(`${REDIS_KEY_PREFIX}${template.id}`, DEFAULT_CACHE_TTL, json),
        this.redis.setex(`${REDIS_KEY_PREFIX}name:${template.name}`, DEFAULT_CACHE_TTL, json)
      ]);
    } catch (error) {
      this.logger.warn({ error, templateId: template.id }, 'Failed to cache template');
    }
  }

  /**
   * Invalidate all template caches
   */
  private async invalidateCache(): Promise<void> {
    if (!this.redis) return;

    try {
      // Get all template keys
      const keys = await this.redis.keys(`${REDIS_KEY_PREFIX}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.del(REDIS_ALL_TEMPLATES_KEY);
      await this.redis.del(REDIS_DEFAULT_TEMPLATE_KEY);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to invalidate cache');
    }
  }

  /**
   * Index a template in Milvus
   */
  private async indexTemplate(template: PromptTemplate): Promise<void> {
    if (!this.milvus || !this.embeddingService) return;

    try {
      // Generate embedding from template content and metadata
      const textToEmbed = [
        template.name,
        template.category || '',
        template.description || '',
        template.content.substring(0, 1000), // Limit content for embedding
        ...(template.tags || [])
      ].join(' ');

      const embedding = await this.embeddingService.generateEmbedding(textToEmbed);

      // Upsert into Milvus
      await this.milvus.upsert({
        collection_name: MILVUS_COLLECTION_NAME,
        data: [{
          id: template.id,
          name: template.name,
          category: template.category || 'general',
          embedding
        }]
      });

      this.logger.debug({ templateId: template.id }, 'Indexed template in Milvus');
    } catch (error) {
      this.logger.error({ error, templateId: template.id }, 'Failed to index template');
    }
  }

  /**
   * Seed default templates if none exist
   */
  async seedDefaultTemplates(): Promise<void> {
    const existing = await this.prisma.promptTemplate.count();
    if (existing > 0) {
      this.logger.info({ count: existing }, 'Templates already exist, skipping seed');
      return;
    }

    const defaultTemplates: PromptTemplateInput[] = [
      {
        name: 'general',
        category: 'general',
        description: 'Default general-purpose assistant prompt',
        content: `You are a helpful AI assistant focused on cloud infrastructure and enterprise software development.

Your capabilities include:
- Answering questions about cloud services (AWS, Azure, GCP)
- Helping with DevOps and infrastructure tasks
- Code review and development assistance
- Technical documentation and explanations

Always provide accurate, helpful responses. If you're unsure about something, say so.`,
        isDefault: true,
        isActive: true,
        tags: ['general', 'default', 'assistant']
      },
      {
        name: 'admin',
        category: 'admin',
        description: 'System administration prompt with elevated capabilities',
        content: `You are an administrative AI assistant with access to system management tools.

You can help with:
- System monitoring and diagnostics
- User management
- Configuration changes
- Security audits
- Performance optimization

Always verify administrative actions before executing them.`,
        isActive: true,
        tags: ['admin', 'system', 'management']
      }
    ];

    for (const template of defaultTemplates) {
      await this.create(template);
    }

    this.logger.info({ count: defaultTemplates.length }, 'Seeded default templates');
  }
}

// Singleton instance
let serviceInstance: PromptTemplateService | null = null;

export function getPromptTemplateService(): PromptTemplateService | null {
  return serviceInstance;
}

export function setPromptTemplateService(service: PromptTemplateService): void {
  serviceInstance = service;
}

export default PromptTemplateService;
