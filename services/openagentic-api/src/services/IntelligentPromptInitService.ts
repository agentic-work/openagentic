/**
 * Intelligent Prompt Initialization Service
 *
 * Automatically seeds the database with intelligent prompt templates on startup.
 * Ensures prompts are always up-to-date with the latest framework.
 */

import { PROMPT_TEMPLATES, getDefaultPromptTemplate } from './prompts/PromptTemplates.js';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

export class IntelligentPromptInitService {
  constructor(private logger: Logger) {
    this.logger = logger.child({ service: 'IntelligentPromptInitService' });
  }

  /**
   * Initialize intelligent prompt system
   * Called during server startup
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('🚀 Initializing intelligent prompt system...');

      const startTime = Date.now();

      // Seed all prompt templates
      await this.seedPromptTemplates();

      // Verify default template exists
      await this.verifyDefaultTemplate();

      // Create default admin assignment if needed
      await this.ensureAdminDefaultAssignment();

      const duration = Date.now() - startTime;

      this.logger.info({
        duration,
        templateCount: PROMPT_TEMPLATES.length
      }, '✅ Intelligent prompt system initialized successfully');

    } catch (error) {
      this.logger.error({
        error: error.message,
        stack: error.stack
      }, '❌ Failed to initialize intelligent prompt system');
      throw error;
    }
  }

  /**
   * Seed all prompt templates from PromptTemplates.ts
   */
  private async seedPromptTemplates(): Promise<void> {
    this.logger.info(`📝 Seeding ${PROMPT_TEMPLATES.length} intelligent prompt templates...`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const template of PROMPT_TEMPLATES) {
      try {
        // Check if template already exists
        const existing = await prisma.promptTemplate.findUnique({
          where: { name: template.name }
        });

        if (existing) {
          // Update if content or intelligence has changed
          const contentChanged = existing.content !== template.content;
          const intelligenceChanged = JSON.stringify((existing as any).intelligence) !== JSON.stringify(template.intelligence || {});
          const preferencesChanged = JSON.stringify((existing as any).model_preferences) !== JSON.stringify(template.modelPreferences || {});

          if (contentChanged || intelligenceChanged || preferencesChanged) {
            await prisma.promptTemplate.update({
              where: { name: template.name },
              data: {
                content: template.content,
                description: template.description || '',
                category: template.category,
                tags: template.tags || [],
                model_preferences: template.modelPreferences || {},
                intelligence: (template.intelligence || {}) as any,
                is_default: template.isDefault || false,
                is_active: template.isActive !== false,
                updated_at: new Date()
              }
            });

            this.logger.info({
              template: template.name,
              category: template.category,
              reason: contentChanged ? 'content_changed' : intelligenceChanged ? 'intelligence_changed' : 'preferences_changed'
            }, '🔄 Updated template');

            updated++;
          } else {
            this.logger.debug({
              template: template.name
            }, 'Template unchanged, skipping');

            skipped++;
          }
        } else {
          // Create new template
          await prisma.promptTemplate.create({
            data: {
              name: template.name,
              content: template.content,
              description: template.description || '',
              category: template.category,
              tags: template.tags || [],
              model_preferences: template.modelPreferences || {},
              intelligence: (template.intelligence || {}) as any,
              is_default: template.isDefault || false,
              is_active: template.isActive !== false,
              created_at: new Date(),
              updated_at: new Date()
            }
          });

          this.logger.info({
            template: template.name,
            category: template.category,
            isDefault: template.isDefault
          }, '✨ Created new template');

          created++;
        }

      } catch (error) {
        this.logger.error({
          template: template.name,
          error: error.message
        }, '❌ Failed to seed template');
        // Continue with other templates
      }
    }

    this.logger.info({
      created,
      updated,
      skipped,
      total: PROMPT_TEMPLATES.length
    }, '📊 Template seeding complete');
  }

  /**
   * Verify that a default template exists
   */
  private async verifyDefaultTemplate(): Promise<void> {
    const defaultTemplate = await prisma.promptTemplate.findFirst({
      where: {
        is_default: true,
        is_active: true
      }
    });

    if (!defaultTemplate) {
      this.logger.error('❌ CRITICAL: No default prompt template found after seeding!');
      throw new Error('No default prompt template configured');
    }

    this.logger.info({
      defaultTemplate: defaultTemplate.name,
      category: defaultTemplate.category
    }, '✅ Default template verified');
  }

  /**
   * Ensure all admins have a default prompt assignment
   */
  private async ensureAdminDefaultAssignment(): Promise<void> {
    try {
      // Get the default template
      const defaultTemplate = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        }
      });

      if (!defaultTemplate) {
        this.logger.warn('No default template to assign to admins');
        return;
      }

      // Check if __all_users__ assignment exists
      const allUsersAssignment = await prisma.userPromptAssignment.findFirst({
        where: {
          user_id: '__all_users__'
        }
      });

      if (!allUsersAssignment) {
        // Create default assignment for all users
        await prisma.userPromptAssignment.create({
          data: {
            user_id: '__all_users__',
            prompt_template_id: defaultTemplate.id,
            assigned_by: 'system',
            assigned_at: new Date(),
            updated_at: new Date()
          }
        });

        this.logger.info({
          template: defaultTemplate.name,
          assignment: '__all_users__'
        }, '✅ Created default prompt assignment for all users');
      } else {
        this.logger.debug('Default user assignment already exists');
      }

    } catch (error) {
      this.logger.warn({
        error: error.message
      }, 'Failed to ensure admin default assignment (non-critical)');
      // Non-critical, don't throw
    }
  }

  /**
   * Health check for intelligent prompt system
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check that templates exist
      const templateCount = await prisma.promptTemplate.count();

      // Check that default exists
      const defaultExists = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        }
      });

      const healthy = templateCount > 0 && !!defaultExists;

      if (healthy) {
        this.logger.debug({
          templateCount,
          hasDefault: !!defaultExists
        }, 'Intelligent prompt system healthy');
      } else {
        this.logger.warn({
          templateCount,
          hasDefault: !!defaultExists
        }, 'Intelligent prompt system health check failed');
      }

      return healthy;

    } catch (error) {
      this.logger.error({
        error: error.message
      }, 'Intelligent prompt system health check error');
      return false;
    }
  }

  /**
   * Get system statistics
   */
  async getStats(): Promise<{
    totalTemplates: number;
    activeTemplates: number;
    categories: Record<string, number>;
    intelligenceEnabled: number;
  }> {
    try {
      const templates = await prisma.promptTemplate.findMany({
        select: {
          category: true,
          is_active: true,
          intelligence: true
        }
      });

      const categories: Record<string, number> = {};
      let intelligenceEnabled = 0;

      for (const template of templates) {
        const category = template.category || 'uncategorized';
        categories[category] = (categories[category] || 0) + 1;

        const intelligence = template.intelligence as any;
        if (intelligence && Object.keys(intelligence).length > 0) {
          intelligenceEnabled++;
        }
      }

      return {
        totalTemplates: templates.length,
        activeTemplates: templates.filter(t => t.is_active).length,
        categories,
        intelligenceEnabled
      };

    } catch (error) {
      this.logger.error({
        error: error.message
      }, 'Failed to get intelligent prompt stats');

      return {
        totalTemplates: 0,
        activeTemplates: 0,
        categories: {},
        intelligenceEnabled: 0
      };
    }
  }
}
