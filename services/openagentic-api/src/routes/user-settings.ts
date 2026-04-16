/**
 * User Preference Management Routes
 * 
 * Handles individual user preferences including themes, accessibility settings,
 * UI customizations, and personal configuration management.
 * 
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UserSettingsService, UserSettingsUpdate, Theme } from '../services/UserSettingsService.js';
import { loggers } from '../utils/logger.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/unifiedAuth.js';

// JSON Schema definitions
const UserSettingsUpdateSchema = {
  type: 'object',
  properties: {
    theme: { 
      type: 'string',
      enum: ['light', 'dark', 'system']
    },
    settings: { 
      type: 'object',
      additionalProperties: true
    },
    accessibility_settings: {
      type: 'object',
      properties: {
        fontSize: { 
          type: 'string',
          enum: ['small', 'medium', 'large', 'extra-large']
        },
        contrast: {
          type: 'string',
          enum: ['normal', 'high']
        },
        motion: {
          type: 'string',
          enum: ['full', 'reduced']
        },
        screenReader: { type: 'boolean' },
        keyboardNavigation: { type: 'boolean' },
        colorBlindness: {
          type: 'string',
          enum: ['none', 'protanopia', 'deuteranopia', 'tritanopia']
        }
      }
    },
    ui_preferences: {
      type: 'object',
      properties: {
        sidebarWidth: { type: 'number', minimum: 200, maximum: 500 },
        compactMode: { type: 'boolean' },
        showTimestamps: { type: 'boolean' },
        messageGrouping: { type: 'boolean' },
        autoScroll: { type: 'boolean' },
        syntaxHighlighting: { type: 'boolean' },
        codeTheme: { type: 'string' },
        language: { type: 'string' },
        timezone: { type: 'string' }
      }
    },
    notification_preferences: {
      type: 'object',
      additionalProperties: true
    },
    privacy_settings: {
      type: 'object',
      additionalProperties: true
    },
    experimental_features: {
      type: 'object',
      additionalProperties: { type: 'boolean' }
    }
  }
};

const ThemeUpdateSchema = {
  type: 'object',
  required: ['theme'],
  properties: {
    theme: { 
      type: 'string',
      enum: ['light', 'dark', 'system']
    }
  }
};

export const userSettingsRoutes = async (fastify: FastifyInstance) => {
  // Initialize User Settings Service
  const userSettingsService = new UserSettingsService(loggers.services);

  // Helper to get user ID from authenticated request
  const getUserId = (request: AuthenticatedRequest): string => {
    return request.user?.userId || request.user?.id || '';
  };

  // Get user settings
  fastify.get('/api/user/settings', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const settings = await userSettingsService.getUserSettings(userId);
      return reply.send(settings);
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch user settings');
      return reply.status(500).send({
        error: 'Failed to fetch settings',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update user settings (partial update)
  fastify.patch('/api/user/settings', {
    schema: {
      body: UserSettingsUpdateSchema
    },
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest & { Body: UserSettingsUpdate }, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const updatedSettings = await userSettingsService.updateUserSettings(userId, request.body);
      return reply.send(updatedSettings);
    } catch (error) {
      request.log.error({ error }, 'Failed to update user settings');
      
      if (error instanceof Error && error.message.includes('Invalid')) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.message
        });
      }
      
      return reply.status(500).send({
        error: 'Failed to update settings',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Update theme specifically
  fastify.put('/api/user/settings/theme', {
    schema: {
      body: ThemeUpdateSchema
    },
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest & { Body: { theme: Theme } }, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const result = await userSettingsService.updateTheme(userId, (request.body as { theme: Theme }).theme);
      return reply.send(result);
    } catch (error) {
      request.log.error({ error }, 'Failed to update theme');
      
      if (error instanceof Error && error.message.includes('Invalid')) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.message
        });
      }
      
      return reply.status(500).send({
        error: 'Failed to update theme',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Reset settings to defaults
  fastify.post('/api/user/settings/reset', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const resetSettings = await userSettingsService.resetSettings(userId);
      return reply.send(resetSettings);
    } catch (error) {
      request.log.error({ error }, 'Failed to reset settings');
      return reply.status(500).send({
        error: 'Failed to reset settings',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get settings schema/defaults
  fastify.get('/api/user/settings/schema', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const schema = userSettingsService.getSettingsSchema();
      return reply.send(schema);
    } catch (error) {
      request.log.error({ error }, 'Failed to get settings schema');
      return reply.status(500).send({ error: 'Failed to get settings schema' });
    }
  });

  // Export settings
  fastify.get('/api/user/settings/export', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const exportData = await userSettingsService.exportSettings(userId);
      return reply.send(exportData);
    } catch (error) {
      request.log.error({ error }, 'Failed to export settings');
      return reply.status(500).send({
        error: 'Failed to export settings',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Import settings
  fastify.post('/api/user/settings/import', {
    schema: {
      body: UserSettingsUpdateSchema
    },
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest & { Body: UserSettingsUpdate }, reply: FastifyReply) => {
    
    try {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: 'User authentication required' });
      }

      const importedSettings = await userSettingsService.importSettings(userId, request.body);
      return reply.send(importedSettings);
    } catch (error) {
      request.log.error({ error }, 'Failed to import settings');
      
      if (error instanceof Error && error.message.includes('Invalid')) {
        return reply.status(400).send({
          error: 'Validation error',
          details: error.message
        });
      }
      
      return reply.status(500).send({
        error: 'Failed to import settings',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Health check endpoint
  fastify.get('/api/user/settings/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await userSettingsService.healthCheck();
      return reply.send(health);
    } catch (error) {
      request.log.error({ error }, 'User settings health check failed');
      return reply.status(500).send({ 
        healthy: false,
        error: 'Health check failed' 
      });
    }
  });
};

export default userSettingsRoutes;