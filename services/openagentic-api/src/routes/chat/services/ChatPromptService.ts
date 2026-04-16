/**
 * Chat Prompt Service
 * 
 * Handles prompt template management, user assignments, and prompt engineering techniques
 * Now with semantic search integration for intelligent prompt selection
 */

import { PromptTemplate, UserPromptAssignment, PromptTechnique } from '../interfaces/prompt.types.js';
import { prisma } from '../../../utils/prisma.js';
import { PromptTemplateSemanticService } from '../../../services/PromptTemplateSemanticService.js';
import { MilvusVectorService } from '../../../services/MilvusVectorService.js';
import type { Logger } from 'pino';

export class ChatPromptService {
  private milvusSemanticService?: PromptTemplateSemanticService;
  private useMilvusSemanticRouting: boolean;

  constructor(
    private chatStorage: any,
    private logger: any,
    private cacheManager?: any,
    private milvusService?: MilvusVectorService
  ) {
    this.logger = logger.child({ service: 'ChatPromptService' }) as Logger;
    this.useMilvusSemanticRouting = process.env.ENABLE_MILVUS_SEMANTIC_ROUTING !== 'false'; // Default ON

    // Initialize Milvus semantic routing (uses user memory)
    if (this.useMilvusSemanticRouting && milvusService) {
      this.milvusSemanticService = new PromptTemplateSemanticService(logger, milvusService);
      this.logger.info('✅ Milvus semantic template routing enabled (with user memory integration)');
    } else {
      this.logger.info('ℹ️ Milvus semantic routing disabled - using traditional prompt assignment only');
    }
  }

  /**
   * Get user's assigned prompt template
   */
  async getUserPromptAssignment(userId: string): Promise<UserPromptAssignment | null> {
    try {
      this.logger.debug({ userId }, 'Looking up user prompt assignment');
      
      // Get user prompt assignment using Prisma
      const assignment = await prisma.userPromptAssignment.findFirst({
        where: {
          OR: [
            { user_id: userId },
            { user_id: '__all_users__' }
          ]
        },
        include: {
          template: true
        },
        orderBy: [
          { user_id: 'desc' }, // Prefer specific user assignments over __all_users__
          { assigned_at: 'desc' }
        ]
      });
      
      if (!assignment) {
        return null;
      }
      return {
        id: assignment.id,
        userId: assignment.user_id,
        promptTemplateId: String(assignment.prompt_template_id),
        assignedBy: assignment.assigned_by,
        assignedAt: assignment.assigned_at,
        isActive: true, // Default since it's not in schema
        customizations: {}, // Default since it's not in schema
        promptTemplate: {
          id: assignment.template?.id,
          name: assignment.template?.name,
          description: '', // Not in schema
          content: assignment.template?.content,
          category: assignment.template?.category,
          tags: [], // Not in schema but required by interface
          modelPreferences: {}, // Not in schema
          isDefault: assignment.template?.is_default || false,
          isActive: assignment.template?.is_active || true,
          isPublic: false, // Not in schema
          createdAt: assignment.template?.created_at,
          updatedAt: assignment.template?.updated_at
        }
      };
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to get user prompt assignment');
      
      return null;
    }
  }

  /**
   * Get default prompt template
   */
  async getDefaultPromptTemplate(): Promise<PromptTemplate | null> {
    try {
      this.logger.debug('Looking up default prompt template');
      
      // Get default prompt template using Prisma
      const defaultTemplate = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        }
      });
      
      if (!defaultTemplate) {
        // CONFIGURATION ERROR: Admin portal MUST have a default prompt
        this.logger.error('CONFIGURATION ERROR: No default prompt template in admin portal');
        throw new Error('DEFAULT_PROMPT_NOT_CONFIGURED: Admin portal must have a default prompt template');
      }
      
      return {
        id: defaultTemplate.id,
        name: defaultTemplate.name,
        description: '', // Not in schema
        content: defaultTemplate.content,
        category: defaultTemplate.category || 'general',
        tags: [], // Not in schema but required by interface
        modelPreferences: {}, // Not in schema
        isDefault: defaultTemplate.is_default,
        isActive: defaultTemplate.is_active,
        isPublic: false, // Not in schema
        createdAt: defaultTemplate.created_at,
        updatedAt: defaultTemplate.updated_at
      };
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Failed to get default prompt template');
      
      return null;
    }
  }

  /**
   * Get user's prompt techniques configuration
   */
  async getUserPromptTechniques(userId: string): Promise<PromptTechnique[]> {
    try {
      this.logger.debug({ userId }, 'Looking up user prompt techniques');
      
      // First check if user has custom prompting settings
      const settings = await prisma.promptingSettings.findFirst({
        where: { user_id: userId }
      });
      
      if (settings) {
        const techniques: PromptTechnique[] = [];
        
        // Parse settings from JSON value
        const settingsData = settings.setting_value as any || {};
        
        // Convert settings to techniques
        if (settingsData.few_shot_enabled) {
          techniques.push({
            id: 'few-shot',
            name: 'Few-Shot Learning',
            description: 'Provide examples to guide responses',
            category: 'reasoning',
            enabled: true,
            configuration: {
              examples: [],
              parameters: {
                maxExamples: settingsData.few_shot_max_examples || 3,
                format: settingsData.few_shot_format || 'json'
              },
              placement: 'before_content'
            }
          });
        }
        
        if (settingsData.react_enabled) {
          techniques.push({
            id: 'react',
            name: 'ReAct (Reasoning + Acting)',
            description: 'Think step-by-step before acting',
            category: 'reasoning',
            enabled: true,
            configuration: {
              parameters: {
                showSteps: settingsData.react_show_steps || true
              },
              // Feature flag: No hardcoded prompts - disabled
              instruction: null,
              placement: 'before_content'
            }
          });
        }
        
        if (settingsData.self_consistency_enabled) {
          techniques.push({
            id: 'self-consistency',
            name: 'Self-Consistency',
            description: 'Generate multiple solutions and select the best',
            category: 'reasoning',
            enabled: true,
            configuration: {
              parameters: {
                samples: settingsData.self_consistency_samples || 3,
                temperature: settingsData.self_consistency_temp || 0.7
              },
              placement: 'system_prompt'
            }
          });
        }
        
        return techniques;
      }
      
      // Feature flag: Prompt techniques disabled - no defaults
      // TODO: Re-enable when PromptTechniqueService is ready
      return [];
      
      // Original code disabled:
      /*return [{
        id: 'default-thinking',
        name: 'Clear Thinking',
        description: 'Think step by step before responding',
        category: 'reasoning',
        enabled: true,
        configuration: {
          instruction: 'Think through this step by step before providing your answer.',
          placement: 'before_content'
        }
      }];*/
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to get user prompt techniques');
      
      return [];
    }
  }

  /**
   * Get available MCP servers for user
   */
  async getAvailableMCPServers(userId: string): Promise<any[]> {
    try {
      this.logger.debug({ userId }, 'Looking up available MCP servers');
      
      // Get user's groups and roles for permission checking
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          is_admin: true,
          groups: true
        }
      });
      
      if (!user) {
        this.logger.warn({ userId }, 'User not found for MCP server lookup');
        return [];
      }
      
      // Query MCP server configurations based on permissions
      const servers = await prisma.mCPServerConfig.findMany({
        where: {
          enabled: true,
          OR: [
            // Admin can see all servers
            ...(user.is_admin ? [{ id: { not: '' } }] : []),
            // User-isolated servers (default case for now)
            { user_isolated: false }
          ]
        },
        select: {
          id: true,
          name: true,
          description: true,
          capabilities: true,
          require_obo: true,
          user_isolated: true
        }
      });
      
      this.logger.info({ 
        userId,
        serverCount: servers.length 
      }, 'Found available MCP servers for user');
      
      return servers;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to get available MCP servers');
      
      return [];
    }
  }

  /**
   * Get system prompt for user with intelligent routing
   * - Admin users: ALWAYS use "Admin Mode" prompt (has tools)
   * - Regular users: Use Milvus semantic routing
   * - NO database prompt assignments - EVER
   */
  async getSystemPromptForUser(
    userId: string,
    message?: string,
    groups?: string[]
  ): Promise<{
    content: string;
    promptTemplate?: PromptTemplate;
    recommendedModel?: string;
    source?: 'milvus_semantic' | 'user' | 'group' | 'default' | 'admin';
  }> {
    try {
      this.logger.debug({
        userId,
        groups,
        useMilvusSemanticRouting: this.useMilvusSemanticRouting
      }, 'Getting system prompt for user');

      // Check if user is admin FIRST (before semantic routing)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { is_admin: true }
      });

      // ADMIN USERS: Always use "Admin Mode" prompt (has tools)
      if (user?.is_admin) {
        const adminPrompt = await prisma.promptTemplate.findFirst({
          where: {
            name: 'Admin Mode',
            is_active: true
          }
        });

        if (adminPrompt) {
          this.logger.info({
            userId,
            promptName: 'Admin Mode',
            category: 'admin',
            source: 'admin'
          }, '👑 Admin user - using Admin Mode prompt with full tool access');

          return {
            content: adminPrompt.content,
            promptTemplate: {
              id: adminPrompt.id,
              name: adminPrompt.name,
              description: adminPrompt.description || '',
              content: adminPrompt.content,
              category: adminPrompt.category || 'admin',
              tags: (adminPrompt.tags as string[]) || [],
              modelPreferences: (adminPrompt.model_preferences as any) || {},
              isDefault: adminPrompt.is_default,
              isActive: adminPrompt.is_active,
              isPublic: false, // Not in schema
              createdAt: adminPrompt.created_at,
              updatedAt: adminPrompt.updated_at
            },
            recommendedModel: (adminPrompt.model_preferences as any)?.preferredModels?.[0],
            source: 'admin'
          };
        }
      }

      // REGULAR USERS: Use Milvus semantic routing (non-admin)
      if (this.useMilvusSemanticRouting && this.milvusSemanticService && message) {
        try {
          // Pass isAdmin=false explicitly for regular users - admin templates will be filtered out
          const template = await this.milvusSemanticService.selectTemplateForQuery(userId, message, undefined, false);
          if (template) {
            this.logger.info({
              userId,
              promptName: template.name,
              category: template.category,
              source: 'milvus_semantic'
            }, '🎯 Using Milvus semantic routing for regular user');

            return {
              content: template.content,
              promptTemplate: {
                id: template.name as any,
                name: template.name,
                description: template.description || '',
                content: template.content,
                category: template.category,
                tags: template.tags || [],
                modelPreferences: template.modelPreferences || {},
                isDefault: template.isDefault || false,
                isActive: template.isActive !== false,
                isPublic: false,
                createdAt: new Date(),
                updatedAt: new Date()
              },
              recommendedModel: (template.modelPreferences as any)?.preferredModels?.[0],
              source: 'milvus_semantic'
            };
          }
        } catch (error) {
          this.logger.error({ error, userId }, 'Milvus semantic routing failed - NO FALLBACK');
          throw new Error('PROMPT_ROUTING_FAILED: Milvus semantic routing is required but failed');
        }
      }

      // If we reach here, semantic routing is disabled or no message provided
      this.logger.error({
        userId,
        useMilvusSemanticRouting: this.useMilvusSemanticRouting,
        hasMessage: !!message,
        hasMilvusService: !!this.milvusSemanticService
      }, 'CONFIGURATION ERROR: Milvus semantic routing is required but not available');

      throw new Error('PROMPT_NOT_CONFIGURED: Milvus semantic routing must be enabled - no database prompts allowed');

    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'Failed to get system prompt for user');

      // Re-throw the error - no emergency fallbacks allowed
      throw error;
    }
  }

  /**
   * Get group-based prompt assignment
   */
  private async getGroupPromptAssignment(groups: string[]): Promise<any> {
    try {
      // Query for group-based prompt assignments using Prisma
      const assignment = await prisma.userPromptAssignment.findFirst({
        where: {
          group_id: {
            in: groups
          }
        },
        include: {
          template: true
        },
        orderBy: [
          { assigned_at: 'desc' }
        ]
      });
      
      if (!assignment?.template) {
        return null;
      }
      
      return {
        promptTemplate: {
          id: assignment.template.id,
          name: assignment.template.name,
          description: '',
          content: assignment.template.content,
          category: assignment.template.category,
          tags: [], // Not in schema but required by interface
          modelPreferences: {},
          isDefault: false,
          isActive: true,
          isPublic: false,
          createdAt: assignment.template.created_at,
          updatedAt: assignment.template.updated_at
        }
      };
      
    } catch (error) {
      this.logger.debug({ 
        groups,
        error: error.message 
      }, 'No group prompt assignments found (table may not exist)');
      
      return null;
    }
  }

  /**
   * Create new prompt template
   */
  async createPromptTemplate(
    template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    try {
      // Create prompt template using Prisma
      const result = await prisma.promptTemplate.create({
        data: {
          name: template.name,
          content: template.content,
          category: template.category,
          is_default: template.isDefault || false,
          is_active: template.isActive !== false,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      
      this.logger.info({ 
        templateId: result.id,
        name: template.name,
        category: template.category 
      }, 'Prompt template created');
      
      return result.id.toString();
      
    } catch (error) {
      this.logger.error({ 
        templateName: template.name,
        error: error.message 
      }, 'Failed to create prompt template');
      
      throw error;
    }
  }

  /**
   * Assign prompt template to user
   */
  async assignPromptToUser(
    userId: string,
    promptTemplateId: string,
    assignedBy: string
  ): Promise<void> {
    try {
      // First, delete any existing assignments for this user
      await prisma.userPromptAssignment.deleteMany({
        where: {
          user_id: userId
        }
      });
      
      // Create new user prompt assignment
      await prisma.userPromptAssignment.create({
        data: {
          user_id: userId,
          prompt_template_id: parseInt(promptTemplateId),
          assigned_by: assignedBy,
          assigned_at: new Date(),
          updated_at: new Date()
        }
      });
      
      this.logger.info({ 
        userId,
        promptTemplateId,
        assignedBy 
      }, 'Prompt template assigned to user successfully');
      
    } catch (error) {
      this.logger.error({ 
        userId,
        promptTemplateId,
        error: error.message 
      }, 'Failed to assign prompt to user');
      
      throw error;
    }
  }

  /**
   * Update user's prompt techniques configuration
   */
  async updateUserPromptTechniques(
    userId: string,
    techniques: Array<{
      techniqueId: string;
      enabled: boolean;
      customConfiguration?: Record<string, any>;
    }>
  ): Promise<void> {
    try {
      // Build settings object from techniques
      const settingsData: Record<string, any> = {};
      
      for (const technique of techniques) {
        switch (technique.techniqueId) {
          case 'few-shot':
            settingsData.few_shot_enabled = technique.enabled;
            if (technique.customConfiguration) {
              settingsData.few_shot_max_examples = technique.customConfiguration.maxExamples;
              settingsData.few_shot_format = technique.customConfiguration.format;
            }
            break;
          case 'react':
            settingsData.react_enabled = technique.enabled;
            if (technique.customConfiguration) {
              settingsData.react_show_steps = technique.customConfiguration.showSteps;
            }
            break;
          case 'self-consistency':
            settingsData.self_consistency_enabled = technique.enabled;
            if (technique.customConfiguration) {
              settingsData.self_consistency_samples = technique.customConfiguration.samples;
              settingsData.self_consistency_temp = technique.customConfiguration.temperature;
            }
            break;
          default:
            // Store custom techniques
            settingsData[`${technique.techniqueId}_enabled`] = technique.enabled;
            if (technique.customConfiguration) {
              settingsData[`${technique.techniqueId}_config`] = technique.customConfiguration;
            }
        }
      }
      
      // Upsert user's prompting settings
      await prisma.promptingSettings.upsert({
        where: {
          user_id_setting_key: {
            user_id: userId,
            setting_key: 'prompt_techniques'
          }
        },
        create: {
          user_id: userId,
          setting_key: 'prompt_techniques',
          setting_value: settingsData,
          created_at: new Date(),
          updated_at: new Date()
        },
        update: {
          setting_value: settingsData,
          updated_at: new Date()
        }
      });
      
      this.logger.info({ 
        userId,
        techniqueCount: techniques.length 
      }, 'User prompt techniques configuration updated successfully');
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to update user prompt techniques');
      
      throw error;
    }
  }

  /**
   * List all prompt templates
   */
  async listPromptTemplates(options: {
    category?: string;
    isActive?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<PromptTemplate[]> {
    try {
      this.logger.debug({ options }, 'Listing prompt templates');
      
      // Build query filters
      const where: any = {};
      if (options.category) {
        where.category = options.category;
      }
      if (options.isActive !== undefined) {
        where.is_active = options.isActive;
      }
      
      // Query prompt templates with filters
      const templates = await prisma.promptTemplate.findMany({
        where,
        take: options.limit || 100,
        skip: options.offset || 0,
        orderBy: [
          { is_default: 'desc' },
          { name: 'asc' }
        ]
      });
      
      // Transform to PromptTemplate format
      const promptTemplates: PromptTemplate[] = templates.map(template => ({
        id: template.id,
        name: template.name,
        description: '', // Not in schema
        content: template.content,
        category: template.category || 'general',
        tags: [], // Not in schema but required by interface
        modelPreferences: {}, // Not in schema
        isDefault: template.is_default,
        isActive: template.is_active,
        isPublic: false, // Not in schema
        createdAt: template.created_at,
        updatedAt: template.updated_at
      }));
      
      this.logger.info({ 
        templateCount: promptTemplates.length,
        options 
      }, 'Listed prompt templates successfully');
      
      return promptTemplates;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Failed to list prompt templates');
      
      throw error;
    }
  }

  /**
   * List all prompt techniques
   */
  async listPromptTechniques(options: {
    category?: string;
    enabled?: boolean;
  } = {}): Promise<PromptTechnique[]> {
    try {
      this.logger.debug({ options }, 'Listing prompt techniques');
      
      // Define available prompt techniques (these are system-defined, not from database)
      const allTechniques: PromptTechnique[] = [
        {
          id: 'few-shot',
          name: 'Few-Shot Learning',
          description: 'Provide examples to guide AI responses',
          category: 'reasoning',
          enabled: true,
          configuration: {
            examples: [],
            parameters: {
              maxExamples: 3,
              format: 'json'
            },
            placement: 'before_content'
          }
        },
        {
          id: 'react',
          name: 'ReAct (Reasoning + Acting)',
          description: 'Think step-by-step before taking actions',
          category: 'reasoning',
          enabled: true,
          configuration: {
            parameters: {
              showSteps: true
            },
            instruction: 'Let me reason through this step by step:',
            placement: 'before_content'
          }
        },
        {
          id: 'self-consistency',
          name: 'Self-Consistency',
          description: 'Generate multiple solutions and select the best',
          category: 'reasoning',
          enabled: true,
          configuration: {
            parameters: {
              samples: 3,
              temperature: 0.7
            },
            placement: 'system_prompt'
          }
        },
        {
          id: 'chain-of-thought',
          name: 'Chain of Thought',
          description: 'Break down complex problems into smaller steps',
          category: 'reasoning',
          enabled: true,
          configuration: {
            instruction: 'Let me break this down step by step:',
            placement: 'before_content'
          }
        },
        {
          id: 'tree-of-thought',
          name: 'Tree of Thought',
          description: 'Explore multiple reasoning paths',
          category: 'reasoning',
          enabled: true,
          configuration: {
            parameters: {
              branches: 3,
              depth: 2
            },
            placement: 'system_prompt'
          }
        },
        {
          id: 'role-prompting',
          name: 'Role Prompting',
          description: 'Assign specific role or expertise',
          category: 'behavior',
          enabled: true,
          configuration: {
            instruction: 'You are an expert in the requested domain.',
            placement: 'system_prompt'
          }
        },
        {
          id: 'structured-output',
          name: 'Structured Output',
          description: 'Format responses in structured format',
          category: 'formatting',
          enabled: true,
          configuration: {
            parameters: {
              format: 'json',
              schema: {}
            },
            placement: 'after_content'
          }
        }
      ];
      
      // Filter techniques based on options
      let techniques = allTechniques;
      
      if (options.category) {
        techniques = techniques.filter(t => t.category === options.category);
      }
      
      if (options.enabled !== undefined) {
        techniques = techniques.filter(t => t.enabled === options.enabled);
      }
      
      this.logger.info({ 
        techniqueCount: techniques.length,
        options 
      }, 'Listed prompt techniques successfully');
      
      return techniques;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Failed to list prompt techniques');
      
      throw error;
    }
  }

  /**
   * DEPRECATED: Find best prompt using semantic search
   * Now handled by PromptTemplateSemanticService in getSystemPromptForUser()
   */
  private async findBestPromptWithSemanticSearch(
    message: string,
    userId: string,
    groups?: string[]
  ): Promise<{
    content: string;
    promptTemplate?: PromptTemplate;
    recommendedModel?: string;
    similarity?: number;
  } | null> {
    // This method is deprecated - semantic routing now happens in getSystemPromptForUser()
    // via PromptTemplateSemanticService (Milvus-based)
    this.logger.debug('Semantic search method deprecated - using Milvus routing instead');
    return null;
  }

  /**
   * DEPRECATED METHOD (kept for backwards compatibility - will be removed)
   */
  private async _oldFindBestPromptWithSemanticSearch_deprecated(
    message: string,
    userId: string,
    groups?: string[]
  ): Promise<{
    content: string;
    promptTemplate?: PromptTemplate;
    recommendedModel?: string;
    similarity?: number;
  } | null> {
    // This entire method has been replaced by PromptTemplateSemanticService (Milvus-based)
    this.logger.debug('Semantic search method deprecated - using Milvus routing instead');
    return null;
  }

  /**
   * Health check for prompt service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic prompt service functionality
      const defaultPrompt = await this.getDefaultPromptTemplate();

      // Semantic search is now handled by PromptTemplateSemanticService (Milvus-based)
      // Health checked via RAGInitService instead

      return !!defaultPrompt;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Prompt service health check failed');
      
      return false;
    }
  }
}