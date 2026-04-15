/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { prisma } from '../../utils/prisma.js';
import { getRedisClient } from '../../utils/redis-client.js';

// CLI tool options
export type CodeModeCli = 'openagentic' | 'claude-code';

interface CodeModeConfig {
  defaultCli: CodeModeCli;
  allowUserOverride: boolean;
}

interface UpdateConfigBody {
  defaultCli?: CodeModeCli;
  allowUserOverride?: boolean;
}

interface UserCliUpdateBody {
  codeModeCli: CodeModeCli | null; // null = use global default
}

const CONFIG_KEY = 'code_mode_config';
const MODEL_CONFIG_KEY = 'awcode.defaultModel';

interface ModelConfig {
  defaultModel: string | null;
  availableModels?: string[];
}

interface UpdateModelConfigBody {
  defaultModel: string | null;
}

const codeModeConfigRoutes: FastifyPluginAsync = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const redis = getRedisClient();

  /**
   * Get code mode configuration from database
   */
  async function getConfig(): Promise<CodeModeConfig> {
    // Try cache first
    const cached = await redis?.get(`config:${CONFIG_KEY}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get from database
    const dbConfig = await prisma.systemConfiguration.findUnique({
      where: { key: CONFIG_KEY }
    });

    const config: CodeModeConfig = (dbConfig?.value as unknown as CodeModeConfig) || {
      defaultCli: 'openagentic',
      allowUserOverride: true,
    };

    // Cache for 5 minutes
    await redis?.set(`config:${CONFIG_KEY}`, JSON.stringify(config), 300);

    return config;
  }

  /**
   * Save code mode configuration to database
   */
  async function saveConfig(config: CodeModeConfig, updatedBy: string): Promise<CodeModeConfig> {
    await prisma.systemConfiguration.upsert({
      where: { key: CONFIG_KEY },
      create: {
        key: CONFIG_KEY,
        value: config as any,
        description: 'Code mode CLI configuration (openagentic vs claude-code)',
        is_active: true,
      },
      update: {
        value: config as any,
        updated_at: new Date(),
      }
    });

    // Invalidate cache
    await redis?.del(`config:${CONFIG_KEY}`);

    logger.info({ config, updatedBy }, 'Code mode configuration updated');

    return config;
  }

  /**
   * GET /api/admin/code-mode/config
   * Get current code mode configuration
   */
  fastify.get('/code-mode/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await getConfig();

      return reply.send({
        success: true,
        config,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get code mode configuration');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch code mode configuration',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/admin/code-mode/config
   * Update code mode configuration
   */
  fastify.put<{ Body: UpdateConfigBody }>(
    '/code-mode/config',
    async (request: FastifyRequest<{ Body: UpdateConfigBody }>, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const updatedBy = user?.email || user?.id || 'admin';

        const updates = request.body;
        const currentConfig = await getConfig();

        // Merge updates
        const newConfig: CodeModeConfig = {
          ...currentConfig,
          ...updates,
        };

        // Validate CLI option
        if (newConfig.defaultCli && !['openagentic', 'claude-code'].includes(newConfig.defaultCli)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid CLI option',
            message: 'defaultCli must be "openagentic" or "claude-code"',
          });
        }

        const savedConfig = await saveConfig(newConfig, updatedBy);

        return reply.send({
          success: true,
          config: savedConfig,
          message: 'Code mode configuration updated successfully',
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update code mode configuration');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update code mode configuration',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /api/admin/code-mode/users
   * Get list of users with their CLI preferences
   */
  fastify.get('/code-mode/users', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const users = await prisma.userPermissions.findMany({
        where: {
          can_use_awcode: true,
        },
        select: {
          user_id: true,
          code_mode_cli: true,
          can_use_awcode: true,
        },
      });

      // Get user details
      const userDetails = await Promise.all(
        users.map(async (u) => {
          const user = await prisma.user.findUnique({
            where: { id: u.user_id },
            select: { id: true, email: true, name: true },
          });
          return {
            userId: u.user_id,
            email: user?.email,
            displayName: user?.name,
            codeModeCli: u.code_mode_cli || null, // null = uses global default
            codeModeEnabled: u.can_use_awcode,
          };
        })
      );

      const globalConfig = await getConfig();

      return reply.send({
        success: true,
        globalDefault: globalConfig.defaultCli,
        allowUserOverride: globalConfig.allowUserOverride,
        users: userDetails,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get code mode users');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch users',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/admin/code-mode/users/:userId
   * Update a user's CLI preference
   */
  fastify.put<{ Params: { userId: string }; Body: UserCliUpdateBody }>(
    '/code-mode/users/:userId',
    async (
      request: FastifyRequest<{ Params: { userId: string }; Body: UserCliUpdateBody }>,
      reply: FastifyReply
    ) => {
      try {
        const { userId } = request.params;
        const { codeModeCli } = request.body;

        // Check if user overrides are allowed
        const config = await getConfig();
        if (!config.allowUserOverride && codeModeCli !== null) {
          return reply.code(400).send({
            success: false,
            error: 'User overrides disabled',
            message: 'User CLI preferences are currently disabled by admin',
          });
        }

        // Validate CLI option
        if (codeModeCli !== null && !['openagentic', 'claude-code'].includes(codeModeCli)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid CLI option',
            message: 'codeModeCli must be "openagentic", "claude-code", or null',
          });
        }

        await prisma.userPermissions.update({
          where: { user_id: userId },
          data: {
            code_mode_cli: codeModeCli,
          },
        });

        logger.info({ userId, codeModeCli }, 'User code mode preference updated');

        return reply.send({
          success: true,
          message: 'User preference updated successfully',
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update user code mode preference');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update user preference',
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /api/admin/code-mode/stats
   * Get code mode usage statistics
   */
  fastify.get('/code-mode/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [totalUsers, openagenticUsers, claudeCodeUsers] = await Promise.all([
        prisma.userPermissions.count({ where: { can_use_awcode: true } }),
        prisma.userPermissions.count({ where: { can_use_awcode: true, code_mode_cli: 'openagentic' } }),
        prisma.userPermissions.count({ where: { can_use_awcode: true, code_mode_cli: 'claude-code' } }),
      ]);

      const config = await getConfig();

      return reply.send({
        success: true,
        stats: {
          totalCodeModeUsers: totalUsers,
          explicitlyUsingOpenagentic: openagenticUsers,
          explicitlyUsingClaudeCode: claudeCodeUsers,
          usingGlobalDefault: totalUsers - openagenticUsers - claudeCodeUsers,
          globalDefault: config.defaultCli,
          allowUserOverride: config.allowUserOverride,
        },
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get code mode stats');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch statistics',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/admin/code-mode/user/:userId/effective
   * Get the effective CLI tool for a specific user (resolves global vs user preference)
   */
  fastify.get<{ Params: { userId: string } }>(
    '/code-mode/user/:userId/effective',
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      try {
        const { userId } = request.params;

        // Get global config
        const config = await getConfig();

        // Get user preference
        const userPerms = await prisma.userPermissions.findUnique({
          where: { user_id: userId },
          select: { code_mode_cli: true, can_use_awcode: true },
        });

        if (!userPerms?.can_use_awcode) {
          return reply.code(403).send({
            success: false,
            error: 'Code mode not enabled',
            message: 'User does not have code mode access',
          });
        }

        // Resolve effective CLI
        let effectiveCli: CodeModeCli = config.defaultCli;
        let source: 'global' | 'user' = 'global';

        if (config.allowUserOverride && userPerms.code_mode_cli) {
          effectiveCli = userPerms.code_mode_cli as CodeModeCli;
          source = 'user';
        }

        return reply.send({
          success: true,
          effectiveCli,
          source,
          globalDefault: config.defaultCli,
          userPreference: userPerms.code_mode_cli || null,
          allowUserOverride: config.allowUserOverride,
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get effective CLI');
        return reply.code(500).send({
          success: false,
          error: 'Failed to determine effective CLI',
          message: error.message,
        });
      }
    }
  );

  // =========================================================================
  // Model Configuration Routes
  // =========================================================================

  /**
   * GET /api/admin/code-mode/model-config
   * Get the default model configuration for Code Mode
   */
  fastify.get('/code-mode/model-config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Try cache first
      const cached = await redis?.get(`config:${MODEL_CONFIG_KEY}`);
      if (cached) {
        return reply.send({
          success: true,
          config: JSON.parse(cached),
        });
      }

      // Get from database
      const dbConfig = await prisma.systemConfiguration.findUnique({
        where: { key: MODEL_CONFIG_KEY }
      });

      let defaultModel: string | null = null;
      if (dbConfig?.value) {
        const val = dbConfig.value;
        defaultModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
      }

      const config: ModelConfig = {
        defaultModel,
      };

      // Cache for 5 minutes
      await redis?.set(`config:${MODEL_CONFIG_KEY}`, JSON.stringify(config), 300);

      return reply.send({
        success: true,
        config,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get code mode model configuration');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch model configuration',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/admin/code-mode/model-config
   * Update the default model for Code Mode
   */
  fastify.put<{ Body: UpdateModelConfigBody }>(
    '/code-mode/model-config',
    async (request: FastifyRequest<{ Body: UpdateModelConfigBody }>, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const updatedBy = user?.email || user?.id || 'admin';
        const { defaultModel } = request.body;

        // Save to database
        await prisma.systemConfiguration.upsert({
          where: { key: MODEL_CONFIG_KEY },
          create: {
            key: MODEL_CONFIG_KEY,
            value: defaultModel || '',
            description: 'Default LLM model for Code Mode sessions',
            is_active: true,
          },
          update: {
            value: defaultModel || '',
            updated_at: new Date(),
          }
        });

        // Invalidate cache
        await redis?.del(`config:${MODEL_CONFIG_KEY}`);

        logger.info({ defaultModel, updatedBy }, 'Code mode model configuration updated');

        return reply.send({
          success: true,
          config: { defaultModel },
          message: 'Code mode model configuration updated successfully',
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update code mode model configuration');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update model configuration',
          message: error.message,
        });
      }
    }
  );
};

export default codeModeConfigRoutes;
