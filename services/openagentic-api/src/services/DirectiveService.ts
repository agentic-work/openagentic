/**

 * Directive Prompting Service
 * Enhances prompts with specific directives based on context and category
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

export interface DirectiveConfig {
  category?: string;
  style?: 'concise' | 'detailed' | 'technical' | 'conversational';
  format?: 'plain' | 'markdown' | 'structured' | 'code';
  includeExamples?: boolean;
  includeReferences?: boolean;
  language?: string;
  audience?: 'technical' | 'executive' | 'general';
}

export interface ContextualDirectives {
  userRole?: string;
  taskType?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  environment?: 'development' | 'staging' | 'production';
  constraints?: string[];
}

export class DirectiveService {
  private logger: Logger;

  // Category-specific directive templates
  private categoryDirectives: Record<string, string> = {
    engineering: `
Always:
- Include relevant code examples when applicable
- Consider security implications and best practices
- Suggest performance optimizations where relevant
- Follow industry standards and conventions
- Provide error handling recommendations
- Include testing considerations`,

    business: `
Always:
- Provide data-driven insights and metrics
- Include cost implications and ROI analysis
- Suggest KPIs and measurement strategies
- Consider stakeholder impact
- Present information in executive-friendly format
- Include actionable recommendations`,

    creative: `
Always:
- Think outside the box and provide multiple creative options
- Explain creative choices and their impact
- Consider brand alignment and consistency
- Suggest variations and alternatives
- Include visual or conceptual descriptions
- Balance creativity with practicality`,

    support: `
Always:
- Provide step-by-step troubleshooting guides
- Include common causes and solutions
- Suggest preventive measures
- Be empathetic and patient in explanations
- Provide escalation paths if needed
- Include relevant documentation links`,

    analysis: `
Always:
- Use data visualization descriptions when helpful
- Identify patterns and trends
- Provide statistical context
- Include confidence levels for predictions
- Suggest further areas of investigation
- Present findings in a clear, structured format`
  };

  // Style-specific directives
  private styleDirectives: Record<string, string> = {
    concise: 'Be brief and to the point. Use bullet points where appropriate. Avoid unnecessary elaboration.',
    detailed: 'Provide comprehensive explanations with context. Include background information and thorough analysis.',
    technical: 'Use precise technical terminology. Include implementation details and technical specifications.',
    conversational: 'Use a friendly, approachable tone. Explain complex concepts in simple terms.'
  };

  // Format-specific directives
  private formatDirectives: Record<string, string> = {
    markdown: 'Format your response using clean Markdown. Use **bold headers** (not "Step 1:", "Step 2:", etc). For sections use format like **The Formula**, **The Proof**, **Summary**. Keep formatting minimal and clean.',
    structured: 'Organize your response with clear **bold headers** for sections. Avoid numbered steps unless specifically requested. Use clean, simple formatting like Gemini.',
    code: 'Focus on code examples. Use proper syntax highlighting and include comments.',
    plain: 'Use plain text without special formatting. Focus on clarity and readability.'
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Enhance prompt with category-specific directives
   */
  enhanceWithDirectives(
    basePrompt: string,
    category: string
  ): string {
    const directive = this.categoryDirectives[category];
    
    if (!directive) {
      return basePrompt;
    }

    return `${basePrompt}\n\n${directive}`;
  }

  /**
   * Add contextual directives based on user context
   */
  addContextualDirectives(
    prompt: string,
    context: ContextualDirectives
  ): string {
    const directives: string[] = [];

    // Role-based directives
    if (context.userRole) {
      directives.push(this.getRoleDirective(context.userRole));
    }

    // Task-based directives
    if (context.taskType) {
      directives.push(this.getTaskDirective(context.taskType));
    }

    // Priority-based directives
    if (context.priority === 'urgent' || context.priority === 'high') {
      directives.push('This is a high-priority request. Focus on immediate actionable solutions.');
    }

    // Environment-based directives
    if (context.environment === 'production') {
      directives.push('This is for a production environment. Emphasize stability, safety, and rollback strategies.');
    }

    // Constraint-based directives
    if (context.constraints && context.constraints.length > 0) {
      directives.push(`Consider these constraints: ${context.constraints.join(', ')}`);
    }

    if (directives.length === 0) {
      return prompt;
    }

    return `${prompt}\n\nContext-specific guidance:\n${directives.join('\n')}`;
  }

  /**
   * Enhance with multiple directive types
   */
  enhanceWithMultipleDirectives(
    basePrompt: string,
    config: DirectiveConfig & { context?: ContextualDirectives }
  ): string {
    let enhanced = basePrompt;

    // Add category directives
    if (config.category) {
      enhanced = this.enhanceWithDirectives(enhanced, config.category);
    }

    // Add style directives
    if (config.style) {
      enhanced += `\n\nStyle: ${this.styleDirectives[config.style]}`;
    }

    // Add format directives
    if (config.format) {
      enhanced += `\n\nFormat: ${this.formatDirectives[config.format]}`;
    }

    // Add specific instructions
    const additionalInstructions: string[] = [];
    
    if (config.includeExamples) {
      additionalInstructions.push('Include relevant examples to illustrate your points');
    }
    
    if (config.includeReferences) {
      additionalInstructions.push('Include references to documentation or best practices');
    }
    
    if (config.language && config.language !== 'en') {
      additionalInstructions.push(`Respond in ${config.language}`);
    }
    
    if (config.audience) {
      additionalInstructions.push(this.getAudienceDirective(config.audience));
    }

    if (additionalInstructions.length > 0) {
      enhanced += `\n\nAdditional instructions:\n- ${additionalInstructions.join('\n- ')}`;
    }

    // Add contextual directives
    if (config.context) {
      enhanced = this.addContextualDirectives(enhanced, config.context);
    }

    return enhanced;
  }

  /**
   * Generate dynamic directives based on message analysis
   */
  generateDynamicDirectives(
    message: string,
    analysis: {
      sentiment?: 'positive' | 'negative' | 'neutral';
      complexity?: 'simple' | 'moderate' | 'complex';
      urgency?: boolean;
      technical_level?: 'beginner' | 'intermediate' | 'advanced';
    }
  ): string[] {
    const directives: string[] = [];

    // Sentiment-based directives
    if (analysis.sentiment === 'negative') {
      directives.push('Be especially helpful and empathetic. Address concerns proactively.');
    }

    // Complexity-based directives
    if (analysis.complexity === 'complex') {
      directives.push('Break down the solution into manageable steps. Use diagrams or examples if helpful.');
    } else if (analysis.complexity === 'simple') {
      directives.push('Provide a direct, straightforward answer without over-explaining.');
    }

    // Urgency-based directives
    if (analysis.urgency) {
      directives.push('Prioritize immediate solutions. Mention quick fixes before comprehensive solutions.');
    }

    // Technical level directives
    switch (analysis.technical_level) {
      case 'beginner':
        directives.push('Explain technical concepts in simple terms. Avoid jargon.');
        break;
      case 'advanced':
        directives.push('Use technical terminology freely. Focus on advanced concepts and optimizations.');
        break;
    }

    return directives;
  }

  /**
   * Store custom directives for users or organizations
   */
  async storeCustomDirectives(
    entityId: string,
    entityType: 'user' | 'organization',
    directives: string[]
  ): Promise<void> {
    try {
      // Store directives using UserSetting model for users
      if (entityType === 'user') {
        await prisma.userSetting.upsert({
          where: {
            user_id_setting_key: {
              user_id: entityId,
              setting_key: 'custom_directives'
            }
          },
          update: {
            setting_value: directives,
            updated_at: new Date()
          },
          create: {
            user_id: entityId,
            setting_key: 'custom_directives',
            setting_value: directives
          }
        });
      }
      // Note: Organization directives would need separate table/model
      this.logger.info({ entityId, entityType, directiveCount: directives.length }, 'Custom directives stored');
    } catch (error) {
      this.logger.error({ error, entityId, entityType }, 'Failed to store custom directives');
      throw error;
    }
  }

  /**
   * Load custom directives
   */
  async loadCustomDirectives(
    entityId: string,
    entityType: 'user' | 'organization'
  ): Promise<string[]> {
    try {
      if (entityType === 'user') {
        const setting = await prisma.userSetting.findUnique({
          where: {
            user_id_setting_key: {
              user_id: entityId,
              setting_key: 'custom_directives'
            }
          }
        });
        
        if (setting && Array.isArray(setting.setting_value)) {
          return setting.setting_value as string[];
        }
      }
      
      return [];
    } catch (error) {
      this.logger.error({ error, entityId, entityType }, 'Failed to load custom directives');
      return [];
    }
  }

  /**
   * Private helper methods
   */
  private getRoleDirective(role: string): string {
    const roleDirectives: Record<string, string> = {
      developer: 'Assume technical proficiency. Include code examples and technical details.',
      manager: 'Focus on project impact, timelines, and team considerations.',
      executive: 'Emphasize strategic value, ROI, and high-level implications.',
      analyst: 'Provide data-driven insights with supporting metrics.',
      designer: 'Consider user experience, visual aspects, and design principles.'
    };

    return roleDirectives[role] || 'Tailor the response to a professional audience.';
  }

  private getTaskDirective(taskType: string): string {
    const taskDirectives: Record<string, string> = {
      debugging: 'Focus on identifying root causes. Provide step-by-step debugging approach.',
      planning: 'Structure the response as a clear plan with phases and milestones.',
      review: 'Provide balanced analysis with pros, cons, and recommendations.',
      implementation: 'Focus on practical implementation steps and code examples.',
      optimization: 'Identify bottlenecks and provide specific optimization strategies.'
    };

    return taskDirectives[taskType] || 'Provide a comprehensive response to the task.';
  }

  private getAudienceDirective(audience: string): string {
    const audienceDirectives: Record<string, string> = {
      technical: 'Assume technical knowledge. Use precise terminology and include implementation details.',
      executive: 'Focus on business value and strategic implications. Avoid technical jargon.',
      general: 'Explain concepts clearly. Balance technical accuracy with accessibility.'
    };

    return audienceDirectives[audience] || '';
  }
}