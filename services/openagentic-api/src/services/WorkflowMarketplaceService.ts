/**
 * WorkflowMarketplaceService
 *
 * Provides a marketplace for workflow templates with sharing, discovery, and forking.
 *
 * Features:
 * - Template publishing and versioning
 * - Discovery with categories, tags, and search
 * - Forking with customization
 * - Usage analytics and ratings
 * - Access control (public, organization, private)
 *
 * Note: Extended metadata (stats, ratings, versions) stored in JSON columns
 * until full schema migration is applied.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { WorkflowDefinition } from './WorkflowExecutionEngine.js';
import { getPrismaVectorClient } from './database/PrismaVectorClient.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

const logger = loggers.services;

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  version: string;
  definition: WorkflowDefinition;

  // Metadata
  author: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  };
  organization?: {
    id: string;
    name: string;
  };

  // Classification
  category: string;
  subcategory?: string;
  tags: string[];
  capabilities: string[];

  // Requirements
  requiredMCPServers: string[];
  requiredLLMProviders: string[];
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;

  // Access control
  visibility: 'public' | 'organization' | 'private';
  license?: string;

  // Stats
  stats: {
    downloads: number;
    forks: number;
    stars: number;
    rating: number;
    ratingCount: number;
  };

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;

  // Versioning
  previousVersionId?: string;
  changelog?: string;
}

export interface TemplateSearchParams {
  query?: string;
  category?: string;
  tags?: string[];
  author?: string;
  organization?: string;
  visibility?: 'public' | 'organization' | 'private';
  minRating?: number;
  sortBy?: 'downloads' | 'stars' | 'rating' | 'recent' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface TemplateSearchResult {
  templates: WorkflowTemplate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ForkOptions {
  newName: string;
  description?: string;
  visibility?: 'public' | 'organization' | 'private';
  customizations?: {
    nodeOverrides?: Record<string, any>;
    parameterDefaults?: Record<string, any>;
    removeNodes?: string[];
    addNodes?: any[];
  };
}

export interface TemplateRating {
  templateId: string;
  userId: string;
  rating: number;
  review?: string;
  createdAt: Date;
}

export interface TemplateVersion {
  id: string;
  templateId: string;
  version: string;
  definition: WorkflowDefinition;
  changelog?: string;
  createdAt: Date;
}

// Extended metadata stored in JSON (until schema migration)
interface ExtendedTemplateMetadata {
  version: string;
  displayName: string;
  shortDescription?: string;
  author: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
  };
  organization?: {
    id: string;
    name: string;
  };
  subcategory?: string;
  capabilities: string[];
  requiredMCPServers: string[];
  requiredLLMProviders: string[];
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  visibility: 'public' | 'organization' | 'private';
  license?: string;
  stats: {
    downloads: number;
    forks: number;
    stars: number;
    rating: number;
    ratingCount: number;
    totalRatingSum: number;
  };
  versions: TemplateVersion[];
  ratings: TemplateRating[];
  starredBy: string[];
  forkedFrom?: string;
  publishedAt?: string;
  changelog?: string;
}

// =============================================================================
// WorkflowMarketplaceService Class
// =============================================================================

export class WorkflowMarketplaceService {
  /**
   * Publish a workflow as a template
   */
  async publishTemplate(
    workflowId: string,
    publisherId: string,
    options: {
      displayName: string;
      description: string;
      shortDescription?: string;
      category: string;
      subcategory?: string;
      tags: string[];
      visibility: 'public' | 'organization' | 'private';
      license?: string;
      version?: string;
      changelog?: string;
    }
  ): Promise<WorkflowTemplate> {
    logger.info({ workflowId, publisherId, options }, '[Marketplace] Publishing workflow as template');

    // Get workflow
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId }
    });

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Get publisher info
    const publisher = await prisma.user.findUnique({
      where: { id: publisherId },
      select: { id: true, name: true, email: true }
    });

    if (!publisher) {
      throw new Error(`Publisher ${publisherId} not found`);
    }

    // Extract requirements from workflow definition
    const workflowDef = workflow.definition as any || { nodes: [], edges: [] };
    const definition: WorkflowDefinition = {
      nodes: workflowDef.nodes || [],
      edges: workflowDef.edges || []
    };

    const requirements = this.extractRequirements(definition);

    // Create extended metadata
    const extendedMetadata: ExtendedTemplateMetadata = {
      version: options.version || '1.0.0',
      displayName: options.displayName,
      shortDescription: options.shortDescription,
      author: {
        id: publisher.id,
        name: publisher.name || 'Unknown',
        email: publisher.email
      },
      subcategory: options.subcategory,
      capabilities: this.extractCapabilities(definition),
      requiredMCPServers: requirements.mcpServers,
      requiredLLMProviders: requirements.llmProviders,
      visibility: options.visibility,
      license: options.license,
      stats: {
        downloads: 0,
        forks: 0,
        stars: 0,
        rating: 0,
        ratingCount: 0,
        totalRatingSum: 0
      },
      versions: [],
      ratings: [],
      starredBy: [],
      publishedAt: new Date().toISOString(),
      changelog: options.changelog
    };

    // Create template
    const template = await prisma.workflowTemplate.create({
      data: {
        name: this.generateUniqueName(options.displayName),
        description: options.description,
        category: options.category,
        nodes: definition.nodes as any,
        edges: definition.edges as any,
        tags: options.tags,
        is_public: options.visibility === 'public',
        is_featured: false,
        created_by: publisherId
      }
    });

    // Store extended metadata using raw SQL (using thumbnail field as JSON storage)
    await prisma.$executeRaw`
      UPDATE workflow_templates
      SET thumbnail = ${JSON.stringify(extendedMetadata)}
      WHERE id = ${template.id}::uuid
    `;

    // Generate and store embedding for semantic search (non-fatal)
    try {
      const embeddingService = new UniversalEmbeddingService();
      const textForEmbedding = `${options.displayName} ${options.description}`;
      const result = await embeddingService.generateEmbedding(textForEmbedding);
      const vectorSql = `[${result.embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE workflow_templates SET search_embedding = '${vectorSql}'::halfvec WHERE id = '${template.id}'`
      );
      logger.info({ templateId: template.id, dimensions: result.dimensions }, '[Marketplace] Template embedding stored');
    } catch (embeddingError) {
      logger.warn({ templateId: template.id, error: embeddingError }, '[Marketplace] Failed to generate/store template embedding (non-fatal)');
    }

    logger.info({ templateId: template.id }, '[Marketplace] Template published');

    return this.dbToTemplate(template, extendedMetadata);
  }

  /**
   * Search for templates
   */
  async searchTemplates(params: TemplateSearchParams): Promise<TemplateSearchResult> {
    const {
      query,
      category,
      tags,
      author,
      visibility = 'public',
      minRating,
      sortBy = 'downloads',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20
    } = params;

    logger.debug({ params }, '[Marketplace] Searching templates');

    // Try semantic search first when a text query is provided
    if (query && !category && !tags?.length && !author) {
      try {
        const semanticResults = await this.semanticSearch(query, pageSize);
        if (semanticResults.length > 0) {
          logger.info({ query, resultCount: semanticResults.length }, '[Marketplace] Using semantic search results');

          // Apply rating filter if needed
          let filtered = minRating !== undefined
            ? semanticResults.filter(t => t.stats.rating >= minRating)
            : semanticResults;

          // Strip similarity score from the returned templates
          const templates: WorkflowTemplate[] = filtered.map(({ similarity, ...template }) => template);

          return {
            templates,
            total: templates.length,
            page,
            pageSize,
            hasMore: false
          };
        }
      } catch {
        logger.debug({ query }, '[Marketplace] Semantic search unavailable, falling back to text search');
      }
    }

    // Build where clause
    const where: any = {};

    // Visibility filter
    if (visibility === 'public') {
      where.is_public = true;
    }

    // Category filter
    if (category) {
      where.category = category;
    }

    // Tags filter (any match)
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    // Author filter
    if (author) {
      where.created_by = author;
    }

    // Query search (name and description)
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const total = await prisma.workflowTemplate.count({ where });

    // Determine sort field
    let orderBy: any;
    switch (sortBy) {
      case 'recent':
        orderBy = { created_at: sortOrder };
        break;
      case 'name':
        orderBy = { name: sortOrder };
        break;
      default:
        // For stats-based sorting, we sort in memory after fetching
        orderBy = { created_at: 'desc' };
    }

    // Fetch templates
    const dbTemplates = await prisma.workflowTemplate.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize * 2 // Fetch extra for filtering
    });

    // Convert to full template objects with extended metadata
    let templates = await Promise.all(
      dbTemplates.map(async t => {
        const metadata = this.parseExtendedMetadata(t.thumbnail);
        return this.dbToTemplate(t, metadata);
      })
    );

    // Apply rating filter
    if (minRating !== undefined) {
      templates = templates.filter(t => t.stats.rating >= minRating);
    }

    // Apply stats-based sorting
    if (['downloads', 'stars', 'rating'].includes(sortBy)) {
      templates.sort((a, b) => {
        const aVal = a.stats[sortBy as keyof typeof a.stats] || 0;
        const bVal = b.stats[sortBy as keyof typeof b.stats] || 0;
        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      });
    }

    // Limit to page size
    templates = templates.slice(0, pageSize);

    return {
      templates,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total
    };
  }

  /**
   * Semantic search for templates using pgvector similarity
   */
  async semanticSearch(query: string, limit: number = 10): Promise<Array<WorkflowTemplate & { similarity: number }>> {
    logger.debug({ query, limit }, '[Marketplace] Performing semantic search');

    try {
      const embeddingService = new UniversalEmbeddingService();
      const result = await embeddingService.generateEmbedding(query);
      const queryEmbedding = result.embedding;

      const vectorClient = getPrismaVectorClient(prisma as any);
      const similarResults = await vectorClient.findSimilar({
        table: 'workflow_templates',
        embeddingColumn: 'search_embedding',
        queryEmbedding,
        limit,
        metric: 'cosine',
        additionalColumns: ['name', 'description', 'category', 'tags', 'is_public', 'is_featured', 'created_by', 'thumbnail', 'nodes', 'edges', 'created_at', 'updated_at'],
        whereClause: 'is_public = true'
      });

      if (similarResults.length === 0) {
        logger.debug('[Marketplace] Semantic search returned no results');
        return [];
      }

      // Convert results to WorkflowTemplate objects with similarity scores
      const templates = similarResults.map(r => {
        const metadata = this.parseExtendedMetadata(r.data.thumbnail as string | null);
        const dbTemplate = {
          id: r.id,
          name: r.data.name,
          description: r.data.description,
          category: r.data.category,
          tags: r.data.tags,
          is_public: r.data.is_public,
          is_featured: r.data.is_featured,
          created_by: r.data.created_by,
          thumbnail: r.data.thumbnail,
          nodes: r.data.nodes,
          edges: r.data.edges,
          created_at: r.data.created_at,
          updated_at: r.data.updated_at,
        };
        return {
          ...this.dbToTemplate(dbTemplate, metadata),
          similarity: r.similarity
        };
      });

      logger.info({ query, resultCount: templates.length }, '[Marketplace] Semantic search completed');
      return templates;
    } catch (error) {
      logger.warn({ error, query }, '[Marketplace] Semantic search failed, caller should fall back to text search');
      throw error;
    }
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<WorkflowTemplate | null> {
    const template = await prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!template) return null;

    const metadata = this.parseExtendedMetadata(template.thumbnail);
    return this.dbToTemplate(template, metadata);
  }

  /**
   * Fork a template
   */
  async forkTemplate(
    templateId: string,
    userId: string,
    options: ForkOptions
  ): Promise<{ workflow: any; template?: WorkflowTemplate }> {
    logger.info({ templateId, userId, options }, '[Marketplace] Forking template');

    // Get source template
    const sourceTemplate = await this.getTemplate(templateId);
    if (!sourceTemplate) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true }
    });

    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    // Apply customizations
    let nodes = [...sourceTemplate.definition.nodes];
    let edges = [...sourceTemplate.definition.edges];

    if (options.customizations) {
      const { nodeOverrides, parameterDefaults, removeNodes, addNodes } = options.customizations;

      // Remove nodes
      if (removeNodes && removeNodes.length > 0) {
        nodes = nodes.filter(n => !removeNodes.includes(n.id));
        edges = edges.filter(e =>
          !removeNodes.includes(e.source) && !removeNodes.includes(e.target)
        );
      }

      // Apply node overrides
      if (nodeOverrides) {
        nodes = nodes.map(node => {
          if (nodeOverrides[node.id]) {
            return { ...node, ...nodeOverrides[node.id] };
          }
          return node;
        });
      }

      // Apply parameter defaults
      if (parameterDefaults) {
        nodes = nodes.map(node => {
          if (node.data?.parameters) {
            return {
              ...node,
              data: {
                ...node.data,
                parameters: { ...node.data.parameters, ...parameterDefaults }
              }
            };
          }
          return node;
        });
      }

      // Add new nodes
      if (addNodes && addNodes.length > 0) {
        nodes = [...nodes, ...addNodes];
      }
    }

    // Create workflow from fork
    const workflow = await prisma.workflow.create({
      data: {
        name: options.newName,
        description: options.description || `Forked from ${sourceTemplate.displayName}`,
        definition: { nodes, edges } as any,
        created_by: userId
      }
    });

    // Update source template fork count
    await this.incrementStat(templateId, 'forks');

    logger.info({
      sourceTemplateId: templateId,
      newWorkflowId: workflow.id
    }, '[Marketplace] Template forked successfully');

    return { workflow };
  }

  /**
   * Rate a template
   */
  async rateTemplate(
    templateId: string,
    userId: string,
    rating: number,
    review?: string
  ): Promise<void> {
    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    logger.info({ templateId, userId, rating }, '[Marketplace] Rating template');

    // Get template
    const dbTemplate = await prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!dbTemplate) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Get extended metadata
    const metadata = this.parseExtendedMetadata(dbTemplate.thumbnail);

    // Check for existing rating
    const existingIndex = metadata.ratings.findIndex(r => r.userId === userId);

    if (existingIndex >= 0) {
      // Update existing rating
      const oldRating = metadata.ratings[existingIndex].rating;
      metadata.stats.totalRatingSum = metadata.stats.totalRatingSum - oldRating + rating;
      metadata.ratings[existingIndex] = {
        templateId,
        userId,
        rating,
        review,
        createdAt: new Date()
      };
    } else {
      // Add new rating
      metadata.ratings.push({
        templateId,
        userId,
        rating,
        review,
        createdAt: new Date()
      });
      metadata.stats.ratingCount++;
      metadata.stats.totalRatingSum = (metadata.stats.totalRatingSum || 0) + rating;
    }

    // Recalculate average
    metadata.stats.rating = metadata.stats.totalRatingSum / metadata.stats.ratingCount;

    // Save updated metadata
    await prisma.$executeRaw`
      UPDATE workflow_templates
      SET thumbnail = ${JSON.stringify(metadata)}
      WHERE id = ${templateId}::uuid
    `;

    logger.info({ templateId, newRating: metadata.stats.rating }, '[Marketplace] Template rated');
  }

  /**
   * Toggle star on a template
   */
  async toggleStar(templateId: string, userId: string): Promise<{ starred: boolean; stars: number }> {
    logger.info({ templateId, userId }, '[Marketplace] Toggling star');

    // Get template
    const dbTemplate = await prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!dbTemplate) {
      throw new Error(`Template ${templateId} not found`);
    }

    // Get extended metadata
    const metadata = this.parseExtendedMetadata(dbTemplate.thumbnail);

    const starIndex = metadata.starredBy.indexOf(userId);
    let starred: boolean;

    if (starIndex >= 0) {
      // Remove star
      metadata.starredBy.splice(starIndex, 1);
      metadata.stats.stars--;
      starred = false;
    } else {
      // Add star
      metadata.starredBy.push(userId);
      metadata.stats.stars++;
      starred = true;
    }

    // Save updated metadata
    await prisma.$executeRaw`
      UPDATE workflow_templates
      SET thumbnail = ${JSON.stringify(metadata)}
      WHERE id = ${templateId}::uuid
    `;

    return { starred, stars: metadata.stats.stars };
  }

  /**
   * Record a template download
   */
  async recordDownload(templateId: string, userId?: string): Promise<void> {
    await this.incrementStat(templateId, 'downloads');
  }

  /**
   * Get featured templates
   */
  async getFeaturedTemplates(limit = 10): Promise<WorkflowTemplate[]> {
    const dbTemplates = await prisma.workflowTemplate.findMany({
      where: {
        is_public: true,
        is_featured: true
      },
      take: limit
    });

    return Promise.all(
      dbTemplates.map(async t => {
        const metadata = this.parseExtendedMetadata(t.thumbnail);
        return this.dbToTemplate(t, metadata);
      })
    );
  }

  /**
   * Get categories with counts
   */
  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    const results = await prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
      SELECT category, COUNT(*)::int as count
      FROM workflow_templates
      WHERE is_public = true AND category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
    `;

    return results.map(r => ({ category: r.category, count: Number(r.count) }));
  }

  /**
   * Get popular tags
   */
  async getPopularTags(limit = 20): Promise<Array<{ tag: string; count: number }>> {
    const templates = await prisma.workflowTemplate.findMany({
      where: { is_public: true },
      select: { tags: true }
    });

    // Count tags
    const tagCounts = new Map<string, number>();
    for (const t of templates) {
      for (const tag of t.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Sort and limit
    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get user's starred templates
   */
  async getUserStarredTemplates(userId: string): Promise<WorkflowTemplate[]> {
    const dbTemplates = await prisma.workflowTemplate.findMany({
      where: { is_public: true }
    });

    const templates: WorkflowTemplate[] = [];

    for (const t of dbTemplates) {
      const metadata = this.parseExtendedMetadata(t.thumbnail);
      if (metadata.starredBy.includes(userId)) {
        templates.push(this.dbToTemplate(t, metadata));
      }
    }

    return templates;
  }

  /**
   * Get templates by author
   */
  async getTemplatesByAuthor(authorId: string): Promise<WorkflowTemplate[]> {
    const dbTemplates = await prisma.workflowTemplate.findMany({
      where: { created_by: authorId }
    });

    return Promise.all(
      dbTemplates.map(async t => {
        const metadata = this.parseExtendedMetadata(t.thumbnail);
        return this.dbToTemplate(t, metadata);
      })
    );
  }

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string, userId: string): Promise<void> {
    const template = await prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    if (template.created_by !== userId) {
      throw new Error('Not authorized to delete this template');
    }

    await prisma.workflowTemplate.delete({
      where: { id: templateId }
    });

    logger.info({ templateId }, '[Marketplace] Template deleted');
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Generate unique template name
   */
  private generateUniqueName(displayName: string): string {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
  }

  /**
   * Extract requirements from workflow definition
   */
  private extractRequirements(definition: WorkflowDefinition): {
    mcpServers: string[];
    llmProviders: string[];
  } {
    const mcpServers = new Set<string>();
    const llmProviders = new Set<string>();

    for (const node of definition.nodes) {
      // Extract MCP server requirements
      if (node.type === 'mcp_tool' && node.data?.server) {
        mcpServers.add(node.data.server);
      }

      // Extract LLM provider requirements
      if (['llm', 'llm_completion'].includes(node.type) && node.data?.provider) {
        llmProviders.add(node.data.provider);
      }
    }

    return {
      mcpServers: Array.from(mcpServers),
      llmProviders: Array.from(llmProviders)
    };
  }

  /**
   * Extract capabilities from workflow
   */
  private extractCapabilities(definition: WorkflowDefinition): string[] {
    const capabilities = new Set<string>();

    for (const node of definition.nodes) {
      switch (node.type) {
        case 'mcp_tool':
          capabilities.add('mcp-integration');
          break;
        case 'llm':
        case 'llm_completion':
          capabilities.add('ai-generation');
          break;
        case 'conditional':
        case 'branch':
          capabilities.add('conditional-logic');
          break;
        case 'loop':
        case 'map':
          capabilities.add('iteration');
          break;
        case 'approval':
          capabilities.add('human-in-loop');
          break;
        case 'code':
          capabilities.add('code-execution');
          break;
      }
    }

    return Array.from(capabilities);
  }

  /**
   * Parse extended metadata from thumbnail JSON
   */
  private parseExtendedMetadata(thumbnail: string | null): ExtendedTemplateMetadata {
    if (!thumbnail) {
      return this.getDefaultMetadata();
    }

    try {
      return JSON.parse(thumbnail) as ExtendedTemplateMetadata;
    } catch {
      return this.getDefaultMetadata();
    }
  }

  /**
   * Get default metadata structure
   */
  private getDefaultMetadata(): ExtendedTemplateMetadata {
    return {
      version: '1.0.0',
      displayName: '',
      author: { id: '', name: 'Unknown' },
      capabilities: [],
      requiredMCPServers: [],
      requiredLLMProviders: [],
      visibility: 'public',
      stats: {
        downloads: 0,
        forks: 0,
        stars: 0,
        rating: 0,
        ratingCount: 0,
        totalRatingSum: 0
      },
      versions: [],
      ratings: [],
      starredBy: []
    };
  }

  /**
   * Convert DB template to full template object
   */
  private dbToTemplate(
    dbTemplate: any,
    metadata: ExtendedTemplateMetadata
  ): WorkflowTemplate {
    return {
      id: dbTemplate.id,
      name: dbTemplate.name,
      displayName: metadata.displayName || dbTemplate.name,
      description: dbTemplate.description || '',
      shortDescription: metadata.shortDescription,
      version: metadata.version,
      definition: {
        nodes: (dbTemplate.nodes as any[]) || [],
        edges: (dbTemplate.edges as any[]) || []
      },
      author: metadata.author,
      organization: metadata.organization,
      category: dbTemplate.category || 'general',
      subcategory: metadata.subcategory,
      tags: dbTemplate.tags || [],
      capabilities: metadata.capabilities,
      requiredMCPServers: metadata.requiredMCPServers,
      requiredLLMProviders: metadata.requiredLLMProviders,
      inputSchema: metadata.inputSchema,
      outputSchema: metadata.outputSchema,
      visibility: metadata.visibility,
      license: metadata.license,
      stats: {
        downloads: metadata.stats.downloads,
        forks: metadata.stats.forks,
        stars: metadata.stats.stars,
        rating: metadata.stats.rating,
        ratingCount: metadata.stats.ratingCount
      },
      createdAt: dbTemplate.created_at,
      updatedAt: dbTemplate.updated_at,
      publishedAt: metadata.publishedAt ? new Date(metadata.publishedAt) : undefined,
      previousVersionId: undefined,
      changelog: metadata.changelog
    };
  }

  /**
   * Increment a stat for a template
   */
  private async incrementStat(templateId: string, stat: 'downloads' | 'forks' | 'stars'): Promise<void> {
    const dbTemplate = await prisma.workflowTemplate.findUnique({
      where: { id: templateId }
    });

    if (!dbTemplate) return;

    const metadata = this.parseExtendedMetadata(dbTemplate.thumbnail);
    metadata.stats[stat]++;

    await prisma.$executeRaw`
      UPDATE workflow_templates
      SET thumbnail = ${JSON.stringify(metadata)}
      WHERE id = ${templateId}::uuid
    `;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let marketplaceServiceInstance: WorkflowMarketplaceService | null = null;

export function getWorkflowMarketplaceService(): WorkflowMarketplaceService {
  if (!marketplaceServiceInstance) {
    marketplaceServiceInstance = new WorkflowMarketplaceService();
  }
  return marketplaceServiceInstance;
}

export default WorkflowMarketplaceService;
