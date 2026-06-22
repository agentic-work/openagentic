/**
 * Prompt Service
 * 
 * Manages system and user-specific prompts including default templates, custom
 * prompts, and role-based prompt assignments. Provides centralized prompt
 * management with support for template inheritance, user customization, and
 * administrative prompt control through Prisma ORM integration.
 * 
 * Features:
 * - Comprehensive prompt template management with versioning
 * - User and group-specific prompt assignments
 * - Default system prompt with MCP tool integration instructions
 * - Dynamic prompt compilation with context awareness
 * - Template inheritance and customization hierarchy
 * - Administrative prompt control and override capabilities
 * 
 * @see {@link https://docs.openagentic.io/api/services/prompts | Prompt Management Documentation}
 */

import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { UnifiedRedisClient } from '../utils/redis-client.js';
// REMOVED: PgVectorRAGService - no longer using pgvector, consolidated to Milvus
// import { PgVectorRAGService } from './PgVectorRAGService.js';
import { MilvusVectorService } from './MilvusVectorService.js';
import {
  PROMPT_TEMPLATES,
  type PromptTemplate as ImportedPromptTemplate,
  getDefaultPromptTemplate,
  getPromptTemplateByName
} from './prompts/PromptTemplates.js';

// ============================================================================
// PROMPT DEFINITIONS - NOW FROM SINGLE SOURCE OF TRUTH
// ============================================================================

// Get prompts from our centralized templates - single source of truth
const DEFAULT_SYSTEM_PROMPT = getDefaultPromptTemplate()?.content || '';

const ADMIN_SYSTEM_PROMPT = getPromptTemplateByName('Admin Mode')?.content || '';

// System prompt templates array
// Use the templates from our single source of truth and add id field
const SYSTEM_PROMPT_TEMPLATES: PromptTemplate[] = PROMPT_TEMPLATES.map((template) => ({
  ...template,
  id: template.name.toLowerCase().replace(/\s+/g, '-')
}));

// ============================================================================
// PROMPT SERVICE CLASS
// ============================================================================

// Extend imported PromptTemplate to add id field required by database
export interface PromptTemplate extends ImportedPromptTemplate {
  id: string;
}

export interface UserPromptAssignment {
  userId: string;
  promptTemplateId: string;
  customPrompt?: string;
  assignedAt: Date;
}

export class PromptService {
  private logger: Logger;
  private defaultPrompt: string = DEFAULT_SYSTEM_PROMPT;
  private redisClient?: UnifiedRedisClient;
  private cacheTTL: number = 300; // 5 minutes TTL for prompts
  // REMOVED: pgVectorRAG - now using Milvus for all vector operations
  // private pgVectorRAG?: PgVectorRAGService;
  private milvusService?: MilvusVectorService;
  private useSemanticSearch: boolean;
  private semanticSearchInitialized: boolean = false;
  private semanticSearchInit?: Promise<void>;

  constructor(logger: Logger, redisClient?: UnifiedRedisClient, milvusService?: MilvusVectorService) {
    this.logger = logger;
    this.redisClient = redisClient;
    this.milvusService = milvusService;

    // Enable semantic search if Milvus is available
    this.useSemanticSearch = process.env.ENABLE_PROMPT_SEMANTIC_SEARCH !== 'false' && !!milvusService;

    if (this.redisClient && this.redisClient.isConnected()) {
      this.logger.info('PromptService initialized with Redis caching (TTL: 5 minutes)');
    } else {
      this.logger.warn('PromptService initialized WITHOUT caching - will hit PostgreSQL on every request');
    }

    if (this.useSemanticSearch && this.milvusService) {
      this.logger.info('PromptService initialized with Milvus semantic search for prompt templates');
      // Milvus template indexing runs lazily on first template lookup
      // (ensureSemanticSearchInit) — no async work in the constructor.
    } else {
      this.logger.info('PromptService using keyword-based search (set ENABLE_PROMPT_SEMANTIC_SEARCH=true and provide MilvusVectorService to enable)');
    }
  }

  /**
   * Index prompt templates into Milvus at most once, lazily, on first template
   * lookup. Best-effort: a failure falls back to keyword search.
   */
  private async ensureSemanticSearchInit(): Promise<void> {
    if (!this.useSemanticSearch || !this.milvusService || this.semanticSearchInitialized) return;
    if (!this.semanticSearchInit) {
      this.semanticSearchInit = this.initializePromptTemplatesInMilvus().catch(err => {
        this.logger.warn({ err }, 'Failed to initialize prompt templates in Milvus, falling back to keyword search');
        this.useSemanticSearch = false;
      });
    }
    await this.semanticSearchInit;
  }

  /**
   * Initialize prompt templates in Milvus for semantic search
   * Stores all active templates from database in Milvus with embeddings
   */
  private async initializePromptTemplatesInMilvus(): Promise<void> {
    if (!this.milvusService) {
      throw new Error('MilvusVectorService not available');
    }

    try {
      this.logger.info('Initializing prompt templates in Milvus...');

      // Get all active templates from database
      const templates = await prisma.promptTemplate.findMany({
        where: { is_active: true }
      });

      this.logger.info(`Found ${templates.length} active prompt templates to index`);

      // Store each template in Milvus as a "knowledge" artifact
      // We use the knowledge type because prompt templates are reusable knowledge
      let indexed = 0;
      for (const template of templates) {
        try {
          await this.milvusService.storeArtifact('system', {
            type: 'knowledge' as any, // Cast to ArtifactType - prompt templates are knowledge artifacts
            title: `[PROMPT_TEMPLATE] ${template.name}`,
            content: `${template.name}\n\nCategory: ${template.category}\n\n${template.content}`,
            metadata: {
              templateId: template.id,
              templateName: template.name,
              category: template.category || 'general',
              isDefault: template.is_default,
              artifactSubtype: 'prompt_template', // Use artifactSubtype instead of type to avoid conflict
              description: `Prompt template: ${template.name}`
            } as any // Cast to any to allow custom metadata fields
          });
          indexed++;
          this.logger.debug({ templateId: template.id, name: template.name }, 'Indexed prompt template in Milvus');
        } catch (error) {
          this.logger.warn({ templateId: template.id, error }, 'Failed to index prompt template in Milvus');
        }
      }

      this.semanticSearchInitialized = true;
      this.logger.info(`Successfully indexed ${indexed}/${templates.length} prompt templates in Milvus`);
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize prompt templates in Milvus');
      throw error;
    }
  }

  /**
   * Search for best matching prompt template using Milvus semantic search
   */
  private async searchPromptTemplatesMilvus(query: string, limit: number = 3): Promise<PromptTemplate[]> {
    if (!this.milvusService) {
      return [];
    }

    try {
      // Search for semantically similar prompt templates in Milvus
      const results = await this.milvusService.searchArtifacts('system', query, {
        limit,
        threshold: 0.6, // 60% similarity threshold
        types: ['knowledge' as any],
        includeShared: true
      });

      // Filter to only prompt template artifacts and map to PromptTemplate format
      const templates: PromptTemplate[] = [];
      for (const result of results) {
        const metadata = result.metadata;
        if (metadata?.artifactSubtype === 'prompt_template') {
          // Fetch full template from database
          const template = await prisma.promptTemplate.findUnique({
            where: { id: metadata.templateId }
          });

          if (template) {
            templates.push({
              id: template.id.toString(),
              name: template.name,
              content: template.content,
              category: template.category || 'general',
              isActive: template.is_active,
              isDefault: template.is_default
            });
          }
        }
      }

      this.logger.info({
        query: query.substring(0, 100),
        resultsCount: templates.length,
        topMatch: templates[0]?.name
      }, '🔍 Milvus semantic search for prompt templates completed');

      return templates;
    } catch (error) {
      this.logger.error({ error, query }, 'Failed to search prompt templates in Milvus');
      return [];
    }
  }

  /**
   * Get the active system prompt for a user, with intelligent routing based on message content
   */
  async getSystemPromptForUser(
    userId: string,
    userMessage?: string,
    userGroups?: string[]
  ): Promise<{
    content: string;
    promptTemplate?: PromptTemplate;
  }> {
    try {
      // 🔥 PRIORITY 1: Use semantic search if message provided and Milvus available
      // This allows dynamic template selection based on query + context/memories
      if (userMessage && this.useSemanticSearch) {
        this.logger.info({ userId, message: userMessage.substring(0, 100) }, 'Using semantic search for dynamic template selection');

        const bestTemplate = await this.findBestTemplateForMessage(userMessage, userId, userGroups);
        if (bestTemplate) {
          const result = {
            content: bestTemplate.content,
            promptTemplate: bestTemplate
          };

          this.logger.info({
            templateName: bestTemplate.name,
            category: bestTemplate.category,
            selectionMethod: 'semantic-search'
          }, '✅ Selected template via semantic search based on query+context');

          return result;
        }

        this.logger.debug('No strong semantic match found, falling back to user assignments');
      }

      // 🔥 PRIORITY 2: Check user/group assignments as fallback
      // First, check if user has a specific prompt assignment
      const assignmentResult = await prisma.userPromptAssignment.findFirst({
        where: { user_id: userId },
        include: {
          template: true
        }
      });

      if (assignmentResult && assignmentResult.template) {
        const assignment = assignmentResult;
        const content = assignment.template.content;

        const result = {
          content,
          promptTemplate: {
            id: assignment.template.id.toString(),
            name: assignment.template.name,
            content: content,
            category: assignment.template.category || 'user-assigned',
            isActive: assignment.template.is_active || true,
            isDefault: assignment.template.is_default || false
          }
        };

        this.logger.info({
          userId,
          templateName: assignment.template.name,
          selectionMethod: 'user-assignment'
        }, '📌 Using user-assigned template (no semantic match found)');

        return result;
      }

      // Check for group assignments if user has groups
      if (userGroups && userGroups.length > 0) {
        const groupAssignmentResult = await prisma.userPromptAssignment.findFirst({
          where: {
            group_id: {
              in: userGroups
            }
          },
          include: {
            template: true
          }
        });

        if (groupAssignmentResult && groupAssignmentResult.template) {
          const content = groupAssignmentResult.template.content;

          const result = {
            content,
            promptTemplate: {
              id: groupAssignmentResult.template.id.toString(),
              name: groupAssignmentResult.template.name,
              content: content,
              category: groupAssignmentResult.template.category || 'group',
              isActive: true,
              isDefault: groupAssignmentResult.template.is_default || false
            }
          };

          this.logger.info({
            userId,
            templateName: groupAssignmentResult.template.name,
            selectionMethod: 'group-assignment'
          }, '👥 Using group-assigned template');

          return result;
        }
      }

      // Fall back to default template
      const defaultResult = await prisma.promptTemplate.findFirst({
        where: { 
          is_default: true,
          is_active: true
        }
      });

      if (defaultResult) {
        const template = defaultResult;
        const result = {
          content: template.content,
          promptTemplate: {
            id: template.id.toString(),
            name: template.name,
            content: template.content,
            category: template.category || 'default',
            isActive: template.is_active,
            isDefault: template.is_default
          }
        };
        
        // Cache the result
        if (this.redisClient && this.redisClient.isConnected()) {
          await this.redisClient.set(`prompt:user:${userId}`, result, this.cacheTTL);
          this.logger.debug({ userId }, 'Cached default template prompt');
        }
        
        return result;
      }

      // Ultimate fallback
      const fallbackResult = {
        content: this.defaultPrompt
      };
      
      // Even cache the fallback
      if (this.redisClient && this.redisClient.isConnected()) {
        await this.redisClient.set(`prompt:user:${userId}`, fallbackResult, this.cacheTTL);
        this.logger.debug({ userId }, 'Cached fallback prompt');
      }
      
      return fallbackResult;
    } catch (error) {
      this.logger.error({ msg: 'Error fetching system prompt:', err: error });
      return {
        content: this.defaultPrompt
      };
    }
  }

  /**
   * Get the default prompt template
   */
  async getDefaultPromptTemplate(): Promise<PromptTemplate | null> {
    try {
      // Get default from database or use fallback
      const template = await prisma.promptTemplate.findFirst({
        where: { 
          is_default: true,
          is_active: true
        }
      });
      
      if (template) {
        return {
          id: template.id.toString(),
          name: template.name,
          content: template.content,
          category: template.category || 'default',
          isActive: template.is_active,
          isDefault: template.is_default
        };
      }

      return null;
    } catch (error) {
      this.logger.error({ msg: 'Error fetching default prompt template:', err: error });
      return null;
    }
  }

  /**
   * Find the best template based on message content analysis
   * Uses Milvus semantic search when available, falls back to keyword matching
   */
  private async findBestTemplateForMessage(message: string, userId?: string, userGroups?: string[]): Promise<PromptTemplate | null> {
    try {
      // Check if user is admin
      const isAdmin = await this.isUserAdmin(userId, userGroups);

      // Lazily index templates into Milvus on first lookup.
      await this.ensureSemanticSearchInit();

      // Use Milvus semantic search if available and initialized
      if (this.useSemanticSearch && this.milvusService && this.semanticSearchInitialized) {
        this.logger.debug({ message: message.substring(0, 100), userId, isAdmin }, 'Using Milvus semantic search for prompt selection');

        const templates = await this.searchPromptTemplatesMilvus(message, 3);

        if (templates.length > 0) {
          // 🔒 SECURITY: Filter out admin templates for non-admin users
          const filteredTemplates = isAdmin
            ? templates
            : templates.filter(t => t.category !== 'admin');

          if (filteredTemplates.length > 0) {
            const best = filteredTemplates[0];
            this.logger.info({
              templateId: best.id,
              name: best.name,
              category: best.category,
              searchType: 'milvus-semantic',
              adminFiltered: !isAdmin && templates.length !== filteredTemplates.length
            }, '✅ Found best template via Milvus semantic search');

            return best;
          } else if (!isAdmin && templates.length > 0) {
            this.logger.warn({
              userId,
              attemptedTemplate: templates[0].name,
              category: templates[0].category
            }, '🔒 SECURITY: Blocked non-admin user from accessing admin template via semantic search');
          }
        }

        this.logger.debug('No semantic matches found in Milvus, falling back to keyword search');
      }

      // Fallback to keyword matching (also filtered)
      return await this.findBestTemplateKeywordSearch(message, isAdmin);
    } catch (error) {
      this.logger.error({ error }, 'Error in findBestTemplateForMessage');
      return null;
    }
  }

  /**
   * Check if a user is an admin
   */
  private async isUserAdmin(userId?: string, userGroups?: string[]): Promise<boolean> {
    if (!userId) return false;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { is_admin: true, groups: true }
      });

      if (!user) return false;

      // Check is_admin flag
      if (user.is_admin) return true;

      // Check if in admin groups
      const adminGroups = ['admin', 'administrators', 'platform-admin', 'system-admin'];
      const userGroupsList = user.groups || userGroups || [];
      return adminGroups.some(ag => userGroupsList.includes(ag));
    } catch (error) {
      this.logger.error({ error, userId }, 'Error checking admin status');
      return false;
    }
  }

  /**
   * REMOVED: pgvector semantic search for templates
   * Semantic search now consolidated to Milvus for all vector operations
   *
   * Note: If needed in the future, this can be re-implemented using MilvusVectorService
   * instead of PgVectorRAGService to keep all vector operations in one place.
   */
  // private async findBestTemplateSemanticSearch(...): Promise<PromptTemplate | null> {
  //   Removed - pgvector no longer used, consolidated to Milvus
  // }

  /**
   * Legacy keyword matching for template selection
   */
  private async findBestTemplateKeywordSearch(message: string, isAdmin: boolean = false): Promise<PromptTemplate | null> {
    try {
      this.logger.debug({ isAdmin }, 'Using legacy keyword search for prompt selection');

      // Get all active templates, filtering admin templates for non-admins
      const templatesResult = await prisma.promptTemplate.findMany({
        where: {
          is_active: true,
          // 🔒 SECURITY: Non-admins cannot access admin category templates
          ...(isAdmin ? {} : { category: { not: 'admin' } })
        }
      });

      const templates = templatesResult.map(t => ({
        id: t.id.toString(),
        name: t.name,
        content: t.content,
        category: t.category || 'default',
        isActive: t.is_active,
        isDefault: t.is_default
      }));

      let bestMatch: { template: PromptTemplate; score: number } | null = null;

      // Score each template based on keyword matches
      for (const template of templates) {
        let score = 0;
        
        // Simple content-based scoring
        if (template.category && message.toLowerCase().includes(template.category.toLowerCase())) {
          score += 2;
        }
        
        if (template.name && message.toLowerCase().includes(template.name.toLowerCase())) {
          score += 1;
        }

        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { template, score };
        }
      }

      // Hardcoded category patterns (legacy approach)
      const categoryPatterns = {
        'engineering': [
          'code', 'programming', 'debug', 'function', 'class', 'api', 'deploy',
          'infrastructure', 'azure', 'aws', 'docker', 'kubernetes', 'ci/cd'
        ],
        'business': [
          'report', 'analysis', 'metrics', 'cost', 'budget', 'performance',
          'dashboard', 'kpi', 'roi', 'forecast', 'revenue'
        ],
        'creative': [
          'write', 'create', 'design', 'imagine', 'story', 'poem', 'art',
          'generate image', 'draw', 'visualize', 'illustrate'
        ],
        'support': [
          'help', 'issue', 'problem', 'error', 'fix', 'troubleshoot',
          'not working', 'broken', 'bug'
        ]
      };

      // If no keyword match, try category patterns
      if (!bestMatch) {
        for (const [category, patterns] of Object.entries(categoryPatterns)) {
          for (const pattern of patterns) {
            if (message.toLowerCase().includes(pattern)) {
              const categoryTemplate = templates.find(t => t.category === category);
              if (categoryTemplate) {
                this.logger.debug({ category, pattern }, 'Found template via category pattern');
                return categoryTemplate;
              }
            }
          }
        }
      }

      return bestMatch?.template || null;
    } catch (error) {
      this.logger.error({ msg: 'Error finding best template:', err: error });
      return null;
    }
  }

  /**
   * Get all available prompt templates
   */
  async getAllTemplates(): Promise<PromptTemplate[]> {
    try {
      const templates = await prisma.promptTemplate.findMany({
        where: { 
          is_active: true
        },
        orderBy: [
          { is_default: 'desc' },
          { name: 'asc' }
        ]
      });
      
      return templates.map(t => ({
        id: t.id.toString(),
        name: t.name,
        content: t.content,
        category: t.category || 'default',
        isActive: t.is_active,
        isDefault: t.is_default
      }));
    } catch (error) {
      this.logger.error({ msg: 'Error fetching all templates:', err: error });
      return [];
    }
  }

  /**
   * Ensure all default templates exist in the system
   */
  async ensureDefaultTemplates(): Promise<void> {
    try {
      // First, ensure system prompts exist
      this.logger.info('Ensuring system prompts exist...');
      
      // Create default system prompt
      await prisma.systemPrompt.upsert({
        where: { id: 'default' },
        update: {
          name: 'Default System Prompt',
          content: DEFAULT_SYSTEM_PROMPT,
          is_active: true,
          is_default: true,
          updated_at: new Date()
        },
        create: {
          id: 'default',
          name: 'Default System Prompt',
          content: DEFAULT_SYSTEM_PROMPT,
          is_active: true,
          is_default: true
        }
      });
      this.logger.info('Created/updated default system prompt');

      // Create additional system prompts
      const additionalSystemPrompts = [
        {
          id: 'admin',
          name: 'Admin System Prompt',
          content: ADMIN_SYSTEM_PROMPT,
          is_active: true,
          is_default: false
        }
      ];

      for (const prompt of additionalSystemPrompts) {
        await prisma.systemPrompt.upsert({
          where: { id: prompt.id },
          update: {
            name: prompt.name,
            content: prompt.content,
            is_active: prompt.is_active,
            is_default: prompt.is_default,
            updated_at: new Date()
          },
          create: prompt
        });
        this.logger.info(`Created/updated system prompt: ${prompt.name}`);
      }

      // Now create prompt templates from our comprehensive list
      const systemTemplates = PROMPT_TEMPLATES;
      
      this.logger.info(`Creating ${systemTemplates.length} prompt templates from source code...`);

      // Create all templates with detailed error logging
      for (const template of systemTemplates) {
        try {
          this.logger.info(`Creating/updating prompt template: ${template.name}...`);
          
          // Only create in prompt_templates table - this is the main table
          await prisma.promptTemplate.upsert({
            where: { name: template.name },
            create: {
              name: template.name,
              content: template.content,
              category: template.category,
              is_default: template.isDefault || false,
              is_active: template.isActive !== false // Default to true if not specified
            },
            update: {
              content: template.content,
              category: template.category,
              is_default: template.isDefault || false,
              is_active: template.isActive !== false
            }
          });
          
          this.logger.info(`Successfully created/updated prompt template: ${template.name}`);
        } catch (templateError) {
          this.logger.error({
            err: templateError,
            templateName: template.name,
            category: template.category,
            contentLength: template.content?.length || 0,
            isDefault: template.isDefault
          }, `❌ FAILED to create/update prompt template: ${template.name}`);
          
          // Re-throw to stop the process - templates are CRITICAL
          throw new Error(`Failed to create prompt template '${template.name}': ${templateError.message}`);
        }
      }

      this.logger.info('All system prompts and templates are now in the database');
      
      // Create global assignment for all users to use default template
      // Use the admin user defined in environment variables as the owner of global settings
      try {
        const adminEmail = process.env.ADMIN_USER_EMAIL || process.env.LOCAL_ADMIN_EMAIL;
        
        if (!adminEmail) {
          this.logger.warn('No admin email configured - skipping global assignment');
          return;
        }
        
        // Find the admin user - they should already exist from InitializationService
        const adminUser = await prisma.user.findUnique({
          where: { email: adminEmail }
        });
        
        if (!adminUser) {
          this.logger.warn(`Admin user ${adminEmail} not found - global assignment will be created when admin is initialized`);
          return;
        }
        
        // Assign Admin Mode template to admin users
        const adminTemplate = await prisma.promptTemplate.findFirst({
          where: { category: 'admin', is_active: true }
        });

        if (adminTemplate) {
          // Create assignment for the admin user with the Admin Mode template
          try {
            await prisma.userPromptAssignment.upsert({
              where: {
                user_id_prompt_template_id: {
                  user_id: adminUser.id,
                  prompt_template_id: adminTemplate.id
                }
              },
              create: {
                user_id: adminUser.id,
                prompt_template_id: adminTemplate.id,
                assigned_by: 'system',
                assigned_at: new Date()
              },
              update: {
                prompt_template_id: adminTemplate.id,
                assigned_by: 'system',
                assigned_at: new Date()
              }
            });
            this.logger.info(`Assigned Admin Mode template to admin user ${adminUser.email}`);
          } catch (err) {
            this.logger.warn({ err }, 'Failed to create prompt assignment for admin user - continuing');
            // Don't throw - continue with initialization even if assignment fails
          }
          this.logger.info('Created global prompt assignment for all users');
        } else {
          this.logger.warn('No default template found for global assignment');
        }
      } catch (assignmentError) {
        // Log but don't fail - fallback logic will handle this
        this.logger.warn({ err: assignmentError }, 'Could not create global assignment - using fallback logic');
        this.logger.info('Default prompts will be resolved dynamically per user via fallback mechanism');
      }
    } catch (error) {
      this.logger.error({ message: { err: error }, error: 'CRITICAL ERROR ensuring default templates - re-throwing' });
      throw error; // Re-throw so server.ts can handle it properly
    }
  }

  /**
   * Health check for system prompt templates
   */
  async validateSystemPrompts(): Promise<{
    healthy: boolean;
    details: {
      defaultPrompt: boolean;
      adminPrompt: boolean;
      totalCount: number;
    },
    missing: string[];
  }> {
    try {
      // Check for all three required templates
      const templates = await prisma.promptTemplate.findMany({
        where: { 
          is_active: true
        }
      });

      const defaultPrompt = templates.some(t => t.name === 'Default Assistant' && t.is_default);
      const adminPrompt = templates.some(t => t.name === 'Admin Mode');

      const missing = [];
      if (!defaultPrompt) missing.push('Default Assistant');
      if (!adminPrompt) missing.push('Admin Mode');

      const healthy = defaultPrompt && adminPrompt;

      return {
        healthy,
        details: {
          defaultPrompt,
          adminPrompt,
          totalCount: templates.length
        },
        missing
      };
    } catch (error) {
      this.logger.error({ msg: 'Error validating system prompts:', err: error });
      return {
        healthy: false,
        details: {
          defaultPrompt: false,
          adminPrompt: false,
          totalCount: 0
        },
        missing: ['Default Assistant', 'Admin Mode']
      };
    }
  }

  // ============================================================================
  // ADMIN MANAGEMENT METHODS
  // ============================================================================

  /**
   * Get all templates with assignment details (for admin portal)
   */
  async getAllTemplatesWithAssignments() {
    try {
      const templates = await prisma.promptTemplate.findMany({
        include: {
          assignments: {
            include: {
              user: {
                select: { id: true, email: true, name: true }
              }
            }
          }
        },
        orderBy: [
          { is_default: 'desc' },
          { name: 'asc' }
        ]
      });

      return templates.map(template => ({
        id: template.id,
        name: template.name,
        category: template.category,
        content: template.content,
        isDefault: template.is_default,
        isActive: template.is_active,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
        assignmentCount: template.assignments.length,
        assignments: template.assignments.map(assignment => ({
          id: assignment.id,
          userId: assignment.user_id,
          groupId: assignment.group_id,
          assignedBy: assignment.assigned_by,
          assignedAt: assignment.assigned_at,
          user: assignment.user
        }))
      }));
    } catch (error) {
      this.logger.error({ msg: 'Error fetching templates with assignments:', err: error });
      throw error;
    }
  }
  /**
   * Get single template by ID
   */
  async getTemplateById(id: number) {
    try {
      const template = await prisma.promptTemplate.findUnique({
        where: { id },
        include: {
          assignments: {
            include: {
              user: {
                select: { id: true, email: true, name: true }
              }
            }
          }
        }
      });

      if (!template) return null;

      return {
        id: template.id,
        name: template.name,
        category: template.category,
        content: template.content,
        isDefault: template.is_default,
        isActive: template.is_active,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
        assignments: template.assignments
      };
    } catch (error) {
      this.logger.error({ msg: 'Error fetching template by ID:', err: error });
      throw error;
    }
  }
  /**
   * Create new prompt template
   */
  async createTemplate(data: {
    name: string;
    category?: string;
    content: string;
    isDefault?: boolean;
    isActive?: boolean;
  }) {
    try {
      // If making this the default, unset other defaults first
      if (data.isDefault) {
        await prisma.promptTemplate.updateMany({
          where: { is_default: true },
          data: { is_default: false }
        });
      }

      const template = await prisma.promptTemplate.create({
        data: {
          name: data.name,
          category: data.category || 'general',
          content: data.content,
          is_default: data.isDefault || false,
          is_active: data.isActive !== undefined ? data.isActive : true
        }
      });

      this.logger.info(`Created prompt template: ${template.name}`);
      return template;
    } catch (error) {
      if (error.code === 'P2002') {
        throw new Error('Template name already exists');
      }
      this.logger.error({ msg: 'Error creating template:', err: error });
      throw error;
    }
  }
  /**
   * Update prompt template
   */
  async updateTemplate(id: number, data: {
    name?: string;
    category?: string;
    content?: string;
    isDefault?: boolean;
    isActive?: boolean;
  }) {
    try {
      // If making this the default, unset other defaults first
      if (data.isDefault) {
        await prisma.promptTemplate.updateMany({
          where: { 
            is_default: true,
            id: { not: id }
          },
          data: { is_default: false }
        });
      }

      const template = await prisma.promptTemplate.update({
        where: { id },
        data: {
          name: data.name,
          category: data.category,
          content: data.content,
          is_default: data.isDefault,
          is_active: data.isActive,
          updated_at: new Date()
        }
      });

      // Invalidate ALL user caches when a template is updated
      // This is important because users might be using this template
      if (this.redisClient && this.redisClient.isConnected()) {
        // Get all users who are using this template
        const assignments = await prisma.userPromptAssignment.findMany({
          where: { prompt_template_id: id },
          select: { user_id: true }
        });
        
        // Invalidate cache for each affected user
        for (const assignment of assignments) {
          await this.redisClient.del(`prompt:user:${assignment.user_id}`);
        }
        
        // If this is the default template, we need to invalidate ALL user caches
        // since users without assignments use the default
        if (data.isDefault || template.is_default) {
          // Get all users to invalidate their caches
          const allUsers = await prisma.user.findMany({
            select: { id: true }
          });
          
          for (const user of allUsers) {
            await this.redisClient.del(`prompt:user:${user.id}`);
          }
          
          this.logger.info(`Invalidated ${allUsers.length} user prompt caches (default template updated)`);
        } else {
          this.logger.info(`Invalidated ${assignments.length} user prompt caches for template ${id}`);
        }
      }

      this.logger.info(`Updated prompt template: ${template.name}`);
      return template;
    } catch (error) {
      if (error.code === 'P2025') {
        throw new Error('Template not found');
      }
      this.logger.error({ msg: 'Error updating template:', err: error });
      throw error;
    }
  }
  /**
   * Delete prompt template
   */
  async deleteTemplate(id: number) {
    try {
      // First check if it's a system template
      const template = await prisma.promptTemplate.findUnique({
        where: { id }
      });

      if (!template) {
        throw new Error('Template not found');
      }

      // Don't allow deletion of system templates
      const systemTemplateNames = ['Default Assistant', 'Admin Mode'];
      if (systemTemplateNames.includes(template.name)) {
        throw new Error('Cannot delete system template');
      }

      // Get affected users before deleting assignments
      let affectedUsers: string[] = [];
      if (this.redisClient && this.redisClient.isConnected()) {
        const assignments = await prisma.userPromptAssignment.findMany({
          where: { prompt_template_id: id },
          select: { user_id: true }
        });
        affectedUsers = assignments.map(a => a.user_id);
      }

      // Delete associated assignments first
      await prisma.userPromptAssignment.deleteMany({
        where: { prompt_template_id: id }
      });

      // Delete the template
      await prisma.promptTemplate.delete({
        where: { id }
      });

      // Invalidate caches for affected users
      if (this.redisClient && affectedUsers.length > 0) {
        for (const userId of affectedUsers) {
          await this.redisClient.del(`prompt:user:${userId}`);
        }
        this.logger.info(`Invalidated ${affectedUsers.length} user prompt caches after deleting template ${id}`);
      }

      this.logger.info(`Deleted prompt template: ${template.name}`);
      return { success: true };
    } catch (error) {
      this.logger.error({ msg: 'Error deleting template:', err: error });
      throw error;
    }
  }
  // ============================================================================
  // USER ASSIGNMENT METHODS
  // ============================================================================

  /**
   * Assign prompt template to user
   */
  async assignTemplateToUser(data: {
    userId: string;
    templateId: number;
    assignedBy: string;
}) {
    try {
      // Remove existing assignment for this user
      await prisma.userPromptAssignment.deleteMany({
        where: { 
          user_id: data.userId,
          group_id: null
        }
      });

      // Create new assignment
      const assignment = await prisma.userPromptAssignment.create({
        data: {
          user_id: data.userId,
          prompt_template_id: data.templateId,
          assigned_by: data.assignedBy,
          assigned_at: new Date()
        }
      });

      // Invalidate cache for this user
      if (this.redisClient && this.redisClient.isConnected()) {
        await this.redisClient.del(`prompt:user:${data.userId}`);
        this.logger.debug({ userId: data.userId }, 'Invalidated prompt cache after assignment');
      }

      this.logger.info(`Assigned template ${data.templateId} to user ${data.userId}`);
      return assignment;
    } catch (error) {
      this.logger.error({ msg: 'Error assigning template to user:', err: error });
      throw error;
    }
  }
  /**
   * Assign prompt template to group
   */
  async assignTemplateToGroup(data: {
    groupId: string;
    templateId: number;
    assignedBy: string;
}) {
    try {
      // Remove existing assignment for this group
      await prisma.userPromptAssignment.deleteMany({
        where: { 
          group_id: data.groupId,
          user_id: null
        }
      });

      // Create new assignment - for group assignments, we need an actual user
      // Use the system admin as the user_id for group assignments
      const adminUser = await prisma.user.findFirst({
        where: { is_admin: true },
        select: { id: true }
      });
      
      if (!adminUser) {
        throw new Error('No admin user found for group assignment');
      }
      
      const assignment = await prisma.userPromptAssignment.create({
        data: {
          user_id: adminUser.id,  // Use admin user ID instead of placeholder
          group_id: data.groupId,
          prompt_template_id: data.templateId,
          assigned_by: data.assignedBy,
          assigned_at: new Date()
        }
      });

      this.logger.info(`Assigned template ${data.templateId} to group ${data.groupId}`);
      return assignment;
    } catch (error) {
      this.logger.error({ msg: 'Error assigning template to group:', err: error });
      throw error;
    }
  }
  /**
   * Set global default template for all users
   */
  async setGlobalTemplate(templateId: number, assignedBy: string) {
    try {
      // Instead of creating a fake user assignment, mark the template as default
      // First, unset any existing default
      await prisma.promptTemplate.updateMany({
        where: { is_default: true },
        data: { is_default: false }
      });
      
      // Then set the new default
      const template = await prisma.promptTemplate.update({
        where: { id: templateId },
        data: { 
          is_default: true,
          updated_at: new Date()
        }
      });
      
      this.logger.info(`Set template ${templateId} as global default for all users`);
      return template;
    } catch (error) {
      this.logger.error({ msg: 'Error setting global template:', err: error });
      throw error;
    }
  }
  /**
   * Remove user's prompt assignment
   */
  async removeUserAssignment(userId: string) {
    try {
      await prisma.userPromptAssignment.deleteMany({
        where: { 
          user_id: userId,
          group_id: null
        }
      });

      this.logger.info(`Removed prompt assignment for user ${userId}`);
      return { success: true };
    } catch (error) {
      this.logger.error({ msg: 'Error removing user assignment:', err: error });
      throw error;
    }
  }
  /**
   * Get all assignments
   */
  async getAllAssignments() {
    try {
      const assignments = await prisma.userPromptAssignment.findMany({
        include: {
          template: true,
          user: {
            select: { id: true, email: true, name: true }
          }
        },
        orderBy: { assigned_at: 'desc' }
      });

      return assignments;
    } catch (error) {
      this.logger.error({ msg: 'Error fetching assignments:', err: error });
      throw error;
    }
  }

  /**
   * REMOVED: pgvector migration (no longer needed)
   * All prompt templates now managed directly in PostgreSQL admin.prompt_templates table
   * Milvus can be used for semantic search if needed in the future, but pgvector is deprecated
   */
  // async migrateTemplatesToPgVector(): Promise<{ migrated: number; errors: number }> {
  //   Removed - pgvector no longer used, consolidated to Milvus
  // }

  /**
   * Get semantic search statistics (updated for Milvus-only architecture)
   */
  async getSemanticSearchStats(): Promise<{
    enabled: boolean;
    templatesInDB: number;
    searchMethod: string;
  }> {
    try {
      const templatesInDB = await prisma.promptTemplate.count({
        where: { is_active: true }
      });

      return {
        enabled: false, // pgvector disabled, using keyword search
        templatesInDB,
        searchMethod: 'keyword-based (pgvector removed, Milvus used for other vector operations)'
      };

    } catch (error) {
      this.logger.error({ error }, 'Failed to get semantic search stats');
      return {
        enabled: false,
        templatesInDB: 0,
        searchMethod: 'error'
      };
    }
  }

}

// ============================================================================
// EXPORTS FOR BACKWARD COMPATIBILITY
// ============================================================================

// Export the prompt constants for files that import from systemPrompt.ts
export {
  DEFAULT_SYSTEM_PROMPT,
  ADMIN_SYSTEM_PROMPT,
  SYSTEM_PROMPT_TEMPLATES
};
