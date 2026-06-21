/**
 * Prompt Version Management Service
 * Handles versioning, testing, and rollback of prompts
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import type { Prisma } from '@prisma/client';

const logger = loggers.services;

export interface PromptVersionCreateInput {
  templateId: string;
  content: string;
  variables?: Record<string, any>;
  createdBy: string;
}

export interface PromptTestResult {
  testName: string;
  passed: boolean;
  score?: number;
  details?: any;
}

export class PromptVersionService {
  /**
   * Create a new version of a prompt template
   */
  async createVersion(input: PromptVersionCreateInput) {
    try {
      // Get the latest version number
      const latestVersion = await prisma.promptVersion.findFirst({
        where: { template_id: input.templateId },
        orderBy: { version_number: 'desc' }
      });

      const versionNumber = (latestVersion?.version_number || 0) + 1;

      // Create the new version
      const version = await prisma.promptVersion.create({
        data: {
          template_id: input.templateId,
          version_number: versionNumber,
          content: input.content,
          variables: input.variables || {},
          created_by: input.createdBy,
          is_active: false // New versions start as inactive
        }
      });

      logger.info('Created prompt version', {
        templateId: input.templateId,
        versionNumber,
        versionId: version.id
      });

      return version;
    } catch (error) {
      logger.error('Failed to create prompt version', { error, input });
      throw error;
    }
  }

  /**
   * Test a prompt version with sample data.
   *
   * Not implemented: real testing would run each test case through the LLM and
   * score the output. The previous implementation fabricated passed:true with
   * Math.random() scores and persisted them as effectiveness data, which is
   * dishonest. It has no callers, so throwing here breaks nothing on the OSS
   * happy path.
   */
  async testVersion(_versionId: string, _testCases: any[]): Promise<{
    versionId: string;
    results: PromptTestResult[];
    effectivenessScore: number;
  }> {
    throw new Error('Prompt version testing is not implemented');
  }

  /**
   * Activate a prompt version (deactivate others for the same template)
   */
  async activateVersion(versionId: string) {
    try {
      const version = await prisma.promptVersion.findUnique({
        where: { id: versionId }
      });

      if (!version) {
        throw new Error('Prompt version not found');
      }

      // Use a transaction to ensure atomicity
      await prisma.$transaction(async (tx) => {
        // Deactivate all other versions for this template
        await tx.promptVersion.updateMany({
          where: {
            template_id: version.template_id,
            id: { not: versionId }
          },
          data: { is_active: false }
        });

        // Activate this version
        await tx.promptVersion.update({
          where: { id: versionId },
          data: { is_active: true }
        });

        // Update the main template with the new content
        await tx.promptTemplate.update({
          where: { id: Number(version.template_id) },
          data: { content: version.content }
        });
      });

      logger.info('Activated prompt version', {
        versionId,
        templateId: version.template_id
      });

      return version;
    } catch (error) {
      logger.error('Failed to activate prompt version', { error, versionId });
      throw error;
    }
  }

  /**
   * Rollback to a previous version
   */
  async rollbackVersion(templateId: string, targetVersionNumber: number) {
    try {
      const targetVersion = await prisma.promptVersion.findFirst({
        where: {
          template_id: templateId,
          version_number: targetVersionNumber
        }
      });

      if (!targetVersion) {
        throw new Error('Target version not found');
      }

      return await this.activateVersion(targetVersion.id);
    } catch (error) {
      logger.error('Failed to rollback prompt version', { 
        error, 
        templateId, 
        targetVersionNumber 
      });
      throw error;
    }
  }

  /**
   * Get version history for a template
   */
  async getVersionHistory(templateId: string) {
    try {
      const versions = await prisma.promptVersion.findMany({
        where: { template_id: templateId },
        orderBy: { version_number: 'desc' },
        take: 20 // Limit to last 20 versions
      });

      return versions;
    } catch (error) {
      logger.error('Failed to get version history', { error, templateId });
      throw error;
    }
  }

  /**
   * Compare two versions
   */
  async compareVersions(versionId1: string, versionId2: string) {
    try {
      const [version1, version2] = await Promise.all([
        prisma.promptVersion.findUnique({ where: { id: versionId1 } }),
        prisma.promptVersion.findUnique({ where: { id: versionId2 } })
      ]);

      if (!version1 || !version2) {
        throw new Error('One or both versions not found');
      }

      // Calculate diff (simplified - in production, use a proper diff library)
      const differences = {
        contentChanged: version1.content !== version2.content,
        variablesChanged: JSON.stringify(version1.variables) !== JSON.stringify(version2.variables),
        effectivenessChange: (version2.effectiveness_score?.toNumber() || 0) - 
                            (version1.effectiveness_score?.toNumber() || 0),
        version1,
        version2
      };

      return differences;
    } catch (error) {
      logger.error('Failed to compare versions', { error, versionId1, versionId2 });
      throw error;
    }
  }

  /**
   * Get performance metrics for versions
   */
  async getVersionMetrics(templateId: string, days: number = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const versions = await prisma.promptVersion.findMany({
        where: {
          template_id: templateId,
          created_at: { gte: startDate }
        },
        orderBy: { created_at: 'asc' }
      });

      const metrics = versions.map(v => ({
        versionNumber: v.version_number,
        effectivenessScore: v.effectiveness_score?.toNumber() || 0,
        usageCount: v.usage_count,
        createdAt: v.created_at,
        isActive: v.is_active
      }));

      return metrics;
    } catch (error) {
      logger.error('Failed to get version metrics', { error, templateId });
      throw error;
    }
  }
}

export const promptVersionService = new PromptVersionService();