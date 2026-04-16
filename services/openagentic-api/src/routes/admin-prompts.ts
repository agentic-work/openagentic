/**
 * Admin Prompts & Templates Management Routes
 * Backend endpoints for Admin Portal to manage system prompts and templates
 * Provides full CRUD operations with user assignment tracking
 */

import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

export const adminPromptsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  /**
   * Get all system prompts with user assignments
   */
  fastify.get('/system-prompts', async (request, reply) => {
    try {
      const prompts = await prisma.systemPrompt.findMany({
        orderBy: [
          { is_default: 'desc' },
          { name: 'asc' }
        ]
      });

      return reply.send({
        prompts: prompts.map(p => ({
          ...p,
          // Add missing fields with defaults for frontend compatibility
          description: null,
          category: null,
          tags: [],
          version: 1,
          assignedUsersCount: 0 // SystemPrompt has no user assignments in schema
        })),
        total: prompts.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch system prompts');
      return reply.code(500).send({
        error: 'Failed to fetch system prompts',
        details: error.message
      });
    }
  });

  /**
   * Get single system prompt by ID
   */
  fastify.get('/system-prompts/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;

      const prompt = await prisma.systemPrompt.findUnique({
        where: { id: String(id) }
      });

      if (!prompt) {
        return reply.code(404).send({ error: 'System prompt not found' });
      }

      return reply.send({
        ...prompt,
        description: null,
        category: null,
        tags: [],
        version: 1
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch system prompt');
      return reply.code(500).send({
        error: 'Failed to fetch system prompt',
        details: error.message
      });
    }
  });

  /**
   * Create new system prompt
   */
  fastify.post('/system-prompts', async (request: any, reply) => {
    try {
      const { name, content, is_default, is_active } = request.body;

      // If setting as default, unset other defaults
      if (is_default) {
        await prisma.systemPrompt.updateMany({
          where: { is_default: true },
          data: { is_default: false }
        });
      }

      const prompt = await prisma.systemPrompt.create({
        data: {
          id: `sp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          name,
          content,
          is_default: is_default || false,
          is_active: is_active !== undefined ? is_active : true
        }
      });

      logger.info({ promptId: prompt.id, name: prompt.name }, 'System prompt created');

      return reply.code(201).send({
        ...prompt,
        description: null,
        category: null,
        tags: [],
        version: 1
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create system prompt');
      return reply.code(500).send({
        error: 'Failed to create system prompt',
        details: error.message
      });
    }
  });

  /**
   * Update system prompt
   */
  fastify.put('/system-prompts/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;
      const { name, content, is_default, is_active } = request.body;

      // If setting as default, unset other defaults
      if (is_default) {
        await prisma.systemPrompt.updateMany({
          where: {
            is_default: true,
            id: { not: String(id) }
          },
          data: { is_default: false }
        });
      }

      const prompt = await prisma.systemPrompt.update({
        where: { id: String(id) },
        data: {
          name,
          content,
          is_default,
          is_active
        }
      });

      logger.info({ promptId: prompt.id, name: prompt.name }, 'System prompt updated');

      return reply.send({
        ...prompt,
        description: null,
        category: null,
        tags: [],
        version: 1
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update system prompt');
      return reply.code(500).send({
        error: 'Failed to update system prompt',
        details: error.message
      });
    }
  });

  /**
   * Delete system prompt
   */
  fastify.delete('/system-prompts/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;

      // Check if it's the default prompt
      const prompt = await prisma.systemPrompt.findUnique({
        where: { id: String(id) }
      });

      if (prompt?.is_default) {
        return reply.code(400).send({
          error: 'Cannot delete default system prompt',
          details: 'Please set another prompt as default before deleting this one'
        });
      }

      await prisma.systemPrompt.delete({
        where: { id: String(id) }
      });

      logger.info({ promptId: id }, 'System prompt deleted');

      return reply.code(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to delete system prompt');
      return reply.code(500).send({
        error: 'Failed to delete system prompt',
        details: error.message
      });
    }
  });

  /**
   * Get all prompt templates with user assignments
   */
  fastify.get('/templates', async (request, reply) => {
    try {
      const templates = await prisma.promptTemplate.findMany({
        orderBy: [
          { is_default: 'desc' },
          { name: 'asc' }
        ],
        select: {
          id: true,
          name: true,
          content: true,
          category: true,
          is_default: true,
          is_active: true,
          created_at: true,
          updated_at: true,
          assignments: {
            select: {
              id: true,
              user_id: true,
              group_id: true
            }
          }
        }
      });

      return reply.send({
        templates: templates.map(t => ({
          ...t,
          // Add missing fields with defaults for frontend compatibility
          description: null,
          tags: [],
          version: 1,
          is_public: true,
          model_specific: false,
          target_model: null,
          temperature: null,
          max_tokens: null,
          assignedUsersCount: t.assignments.length, // Actual count of assignments
          assignments: undefined // Don't send full assignments in list view
        })),
        total: templates.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch templates');
      return reply.code(500).send({
        error: 'Failed to fetch templates',
        details: error.message
      });
    }
  });

  /**
   * Get single template by ID
   */
  fastify.get('/templates/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;

      const template = await prisma.promptTemplate.findUnique({
        where: { id: parseInt(id) },
        include: {
          assignments: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  name: true
                }
              }
            }
          }
        }
      });

      if (!template) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      // Add missing fields with defaults for frontend compatibility
      return reply.send({
        ...template,
        description: null,
        tags: [],
        version: 1,
        is_public: true,
        model_specific: false,
        target_model: null,
        temperature: null,
        max_tokens: null
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch template');
      return reply.code(500).send({
        error: 'Failed to fetch template',
        details: error.message
      });
    }
  });

  /**
   * Create new template
   */
  fastify.post('/templates', async (request: any, reply) => {
    try {
      const {
        name,
        content,
        category,
        is_default,
        is_active
      } = request.body;

      // If setting as default, unset other defaults
      if (is_default) {
        await prisma.promptTemplate.updateMany({
          where: { is_default: true },
          data: { is_default: false }
        });
      }

      const template = await prisma.promptTemplate.create({
        data: {
          name,
          content,
          category: category || 'general',
          is_default: is_default || false,
          is_active: is_active !== undefined ? is_active : true
        }
      });

      logger.info({ templateId: template.id, name: template.name }, 'Template created');

      // Add missing fields with defaults for frontend compatibility
      return reply.code(201).send({
        ...template,
        description: null,
        tags: [],
        version: 1,
        is_public: true,
        model_specific: false,
        target_model: null,
        temperature: null,
        max_tokens: null
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create template');
      return reply.code(500).send({
        error: 'Failed to create template',
        details: error.message
      });
    }
  });

  /**
   * Update template
   */
  fastify.put('/templates/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;
      const {
        name,
        content,
        category,
        is_default,
        is_active
      } = request.body;

      // If setting as default, unset other defaults
      if (is_default) {
        await prisma.promptTemplate.updateMany({
          where: {
            is_default: true,
            id: { not: parseInt(id) }
          },
          data: { is_default: false }
        });
      }

      const template = await prisma.promptTemplate.update({
        where: { id: parseInt(id) },
        data: {
          name,
          content,
          category,
          is_default,
          is_active,
          updated_at: new Date()
        }
      });

      logger.info({ templateId: template.id, name: template.name }, 'Template updated');

      // Add missing fields with defaults for frontend compatibility
      return reply.send({
        ...template,
        description: null,
        tags: [],
        version: 1,
        is_public: true,
        model_specific: false,
        target_model: null,
        temperature: null,
        max_tokens: null
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update template');
      return reply.code(500).send({
        error: 'Failed to update template',
        details: error.message
      });
    }
  });

  /**
   * Delete template
   */
  fastify.delete('/templates/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;

      // Check if it's the default template
      const template = await prisma.promptTemplate.findUnique({
        where: { id: parseInt(id) }
      });

      if (template?.is_default) {
        return reply.code(400).send({
          error: 'Cannot delete default template',
          details: 'Please set another template as default before deleting this one'
        });
      }

      await prisma.promptTemplate.delete({
        where: { id: parseInt(id) }
      });

      logger.info({ templateId: id }, 'Template deleted');

      return reply.code(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to delete template');
      return reply.code(500).send({
        error: 'Failed to delete template',
        details: error.message
      });
    }
  });

  /**
   * Get template categories
   */
  fastify.get('/categories', async (request, reply) => {
    try {
      const categories = [
        'general',
        'development',
        'writing',
        'analysis',
        'creative',
        'business',
        'education',
        'technical',
        'research',
        'other'
      ];

      return reply.send({ categories });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch categories');
      return reply.code(500).send({
        error: 'Failed to fetch categories',
        details: error.message
      });
    }
  });

  /**
   * Get all users for assignment dropdown
   */
  fastify.get('/users', async (request, reply) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true
        },
        orderBy: { email: 'asc' }
      });

      return reply.send({ users });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch users');
      return reply.code(500).send({
        error: 'Failed to fetch users',
        details: error.message
      });
    }
  });

  /**
   * Set a template as the default template
   */
  fastify.post('/templates/:id/set-default', async (request: any, reply) => {
    try {
      const { id } = request.params;

      // Unset all other defaults
      await prisma.promptTemplate.updateMany({
        where: { is_default: true },
        data: { is_default: false }
      });

      // Set this template as default
      const template = await prisma.promptTemplate.update({
        where: { id: parseInt(id) },
        data: { is_default: true }
      });

      logger.info({ templateId: template.id, name: template.name }, 'Template set as default');

      return reply.send({
        success: true,
        message: `Template "${template.name}" set as default`,
        template: {
          ...template,
          description: null,
          tags: [],
          version: 1,
          is_public: true,
          model_specific: false,
          target_model: null,
          temperature: null,
          max_tokens: null
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to set default template');
      return reply.code(500).send({
        error: 'Failed to set default template',
        details: error.message
      });
    }
  });

  /**
   * Assign template to user
   */
  fastify.post('/templates/:id/assign', async (request: any, reply) => {
    try {
      const { id } = request.params;
      const { user_id, assigned_by } = request.body;

      if (!user_id || !assigned_by) {
        return reply.code(400).send({
          error: 'Missing required fields: user_id, assigned_by'
        });
      }

      // Check if template exists
      const template = await prisma.promptTemplate.findUnique({
        where: { id: parseInt(id) }
      });

      if (!template) {
        return reply.code(404).send({ error: 'Template not found' });
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: user_id }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Create or update assignment
      const assignment = await prisma.userPromptAssignment.upsert({
        where: {
          user_id_prompt_template_id: {
            user_id,
            prompt_template_id: parseInt(id)
          }
        },
        create: {
          user_id,
          prompt_template_id: parseInt(id),
          assigned_by
        },
        update: {
          assigned_by,
          updated_at: new Date()
        },
        include: {
          template: true,
          user: {
            select: { id: true, email: true, name: true }
          }
        }
      });

      logger.info({
        assignmentId: assignment.id,
        templateId: template.id,
        userId: user_id
      }, 'Template assigned to user');

      return reply.send({
        success: true,
        message: `Template "${template.name}" assigned to user`,
        assignment
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to assign template');
      return reply.code(500).send({
        error: 'Failed to assign template',
        details: error.message
      });
    }
  });

  /**
   * Unassign template from user
   */
  fastify.delete('/templates/:id/assign/:userId', async (request: any, reply) => {
    try {
      const { id, userId } = request.params;

      await prisma.userPromptAssignment.delete({
        where: {
          user_id_prompt_template_id: {
            user_id: userId,
            prompt_template_id: parseInt(id)
          }
        }
      });

      logger.info({ templateId: id, userId }, 'Template unassigned from user');

      return reply.code(204).send();
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'Assignment not found' });
      }
      logger.error({ error: error.message }, 'Failed to unassign template');
      return reply.code(500).send({
        error: 'Failed to unassign template',
        details: error.message
      });
    }
  });

  /**
   * Get template assignments for a specific template
   */
  fastify.get('/templates/:id/assignments', async (request: any, reply) => {
    try {
      const { id } = request.params;

      const assignments = await prisma.userPromptAssignment.findMany({
        where: { prompt_template_id: parseInt(id) },
        include: {
          user: {
            select: { id: true, email: true, name: true, is_admin: true }
          },
          template: {
            select: { id: true, name: true, category: true }
          }
        },
        orderBy: { assigned_at: 'desc' }
      });

      return reply.send({
        assignments,
        total: assignments.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch template assignments');
      return reply.code(500).send({
        error: 'Failed to fetch template assignments',
        details: error.message
      });
    }
  });

  /**
   * Get user's assigned templates
   */
  fastify.get('/users/:userId/templates', async (request: any, reply) => {
    try {
      const { userId } = request.params;

      const assignments = await prisma.userPromptAssignment.findMany({
        where: { user_id: userId },
        include: {
          template: true
        },
        orderBy: { assigned_at: 'desc' }
      });

      const templates = assignments.map(a => ({
        ...a.template,
        description: null,
        tags: [],
        version: 1,
        is_public: true,
        model_specific: false,
        target_model: null,
        temperature: null,
        max_tokens: null,
        assigned_at: a.assigned_at,
        assigned_by: a.assigned_by
      }));

      return reply.send({
        templates,
        total: templates.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch user templates');
      return reply.code(500).send({
        error: 'Failed to fetch user templates',
        details: error.message
      });
    }
  });

  /**
   * Get current user's assigned prompt template (for non-admin users)
   * This endpoint allows regular users to see which template is assigned to them
   */
  fastify.get('/my-template', async (request: any, reply) => {
    try {
      const userId = request.user?.userId || request.user?.id || request.headers['x-user-id'] as string;

      if (!userId) {
        return reply.code(401).send({ error: 'User not authenticated' });
      }

      // Get user's groups for group-based assignments
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { groups: true, is_admin: true }
      });

      // First check for user-specific assignment
      const userAssignment = await prisma.userPromptAssignment.findFirst({
        where: {
          user_id: userId,
          group_id: null
        },
        include: {
          template: true
        }
      });

      if (userAssignment && userAssignment.template) {
        return reply.send({
          template: {
            id: userAssignment.template.id,
            name: userAssignment.template.name,
            category: userAssignment.template.category,
            content: userAssignment.template.content,
            is_default: userAssignment.template.is_default,
            is_active: userAssignment.template.is_active,
            assigned_at: userAssignment.assigned_at,
            assigned_by: userAssignment.assigned_by,
            assignment_type: 'user'
          }
        });
      }

      // Check for group-based assignment
      if (user?.groups && user.groups.length > 0) {
        const groupAssignment = await prisma.userPromptAssignment.findFirst({
          where: {
            group_id: {
              in: user.groups
            }
          },
          include: {
            template: true
          }
        });

        if (groupAssignment && groupAssignment.template) {
          return reply.send({
            template: {
              id: groupAssignment.template.id,
              name: groupAssignment.template.name,
              category: groupAssignment.template.category,
              content: groupAssignment.template.content,
              is_default: groupAssignment.template.is_default,
              is_active: groupAssignment.template.is_active,
              assigned_at: groupAssignment.assigned_at,
              assigned_by: groupAssignment.assigned_by,
              assignment_type: 'group',
              group_id: groupAssignment.group_id
            }
          });
        }
      }

      // Fall back to default template
      const defaultTemplate = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        }
      });

      if (defaultTemplate) {
        return reply.send({
          template: {
            id: defaultTemplate.id,
            name: defaultTemplate.name,
            category: defaultTemplate.category,
            content: defaultTemplate.content,
            is_default: defaultTemplate.is_default,
            is_active: defaultTemplate.is_active,
            assignment_type: 'default'
          }
        });
      }

      // No template found at all
      return reply.code(404).send({
        error: 'No prompt template assigned',
        message: 'No prompt template has been assigned to you and no default template is available'
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch current user template');
      return reply.code(500).send({
        error: 'Failed to fetch current user template',
        details: error.message
      });
    }
  });

  /**
   * Sync templates from code to database
   * Re-runs the ensureDefaultTemplates() function to update templates from source code
   */
  fastify.post('/templates/sync', async (request, reply) => {
    try {
      logger.info('Starting template sync from code to database...');

      // Import and run the PromptService sync
      const { PromptService } = await import('../services/PromptService.js');
      const promptService = new PromptService(logger as any);

      await promptService.ensureDefaultTemplates();

      const validation = await promptService.validateSystemPrompts();

      logger.info({ validation }, 'Template sync completed');

      return reply.send({
        success: true,
        message: 'Templates synced successfully from code to database',
        validation
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to sync templates');
      return reply.code(500).send({
        error: 'Failed to sync templates',
        details: error.message
      });
    }
  });
};
