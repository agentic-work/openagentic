/**
 * User and System Settings Routes
 * 
 * Manages user preferences, Azure OpenAI configuration, MCP functions,
 * and available AI models with connection testing capabilities.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { Settings } from '../types/index.js';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/unifiedAuth.js';

interface TestAzureResponse {
  success: boolean;
  message: string;
  details: {
    endpoint: string;
    deployment: string;
    model: string;
    apiVersion: string;
    responseTime: string;
    features: {
      chat: boolean;
      tools: boolean;
      tokenUsage: boolean;
    };
    warnings: string[];
  };
}

interface ErrorResponse {
  error: string;
  details: string;
  step: string;
}

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  
  // Using Prisma instead of Pool

  // Get user settings from database
  async function getUserSettings(userId: string): Promise<Settings | null> {
    try {
      const userSettings = await prisma.userSetting.findMany({
        where: { user_id: userId }
      });
      
      if (userSettings.length === 0) {
        return null;
      }
      
      // Convert settings array to Settings object
      const settings: any = {};
      
      for (const setting of userSettings) {
        try {
          // Parse JSON values or use string values directly
          let value = setting.setting_value;
          
          // Check if setting_value is a string that looks like JSON
          if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try {
              value = JSON.parse(value);
            } catch {
              // Keep as string if parsing fails
            }
          }
            
          // Handle nested settings (e.g., azureOpenAI.apiKey)
          const keyParts = setting.setting_key.split('.');
          let current = settings;
          
          for (let i = 0; i < keyParts.length - 1; i++) {
            if (!current[keyParts[i]]) {
              current[keyParts[i]] = {};
            }
            current = current[keyParts[i]];
          }
          
          current[keyParts[keyParts.length - 1]] = value;
        } catch (parseError) {
          logger.warn({ parseError, settingKey: setting.setting_key }, 'Failed to parse setting');
          settings[setting.setting_key] = setting.setting_value;
        }
      }
      
      return settings as Settings;
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get user settings from database');
      throw error;
    }
  }
  
  // Save user settings to database
  async function saveUserSettings(userId: string, settings: Settings): Promise<void> {
    try {
      // Convert settings object to flat key-value pairs
      const flattenSettings = (obj: any, prefix = ''): Array<{key: string, value: string}> => {
        const result: Array<{key: string, value: string}> = [];
        
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            result.push(...flattenSettings(value, fullKey));
          } else {
            result.push({
              key: fullKey,
              value: typeof value === 'object' ? JSON.stringify(value) : String(value)
            });
          }
        }
        
        return result;
      };
      
      const flatSettings = flattenSettings(settings);

      // Use transaction with individual upserts to avoid race conditions
      await prisma.$transaction(async (tx) => {
        // First, get existing settings to know which ones to delete
        const existingSettings = await tx.userSetting.findMany({
          where: { user_id: userId },
          select: { setting_key: true }
        });

        const existingKeys = new Set(existingSettings.map(s => s.setting_key));
        const newKeys = new Set(flatSettings.map(s => s.key));

        // Delete settings that are no longer present
        const keysToDelete = Array.from(existingKeys).filter(key => !newKeys.has(key));
        if (keysToDelete.length > 0) {
          await tx.userSetting.deleteMany({
            where: {
              user_id: userId,
              setting_key: { in: keysToDelete }
            }
          });
        }

        // Upsert each setting individually to handle concurrency properly
        for (const setting of flatSettings) {
          await tx.userSetting.upsert({
            where: {
              user_id_setting_key: {
                user_id: userId,
                setting_key: setting.key
              }
            },
            create: {
              user_id: userId,
              setting_key: setting.key,
              setting_value: setting.value,
              created_at: new Date(),
              updated_at: new Date()
            },
            update: {
              setting_value: setting.value,
              updated_at: new Date()
            }
          });
        }
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to save user settings to database');
      throw error;
    }
  }
  
  // Get user settings endpoint for UI (with authentication)
  fastify.get('/user/settings', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: any) => {
    // Get user from authenticated request
    const user = request.user;
    const userId = user?.id || user?.userId;
    
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    try {
      // Try to get existing settings from database
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          theme: true,
          settings: true,
          accessibility_settings: true,
          ui_preferences: true
        }
      });
      
      // Return settings from user fields or defaults
      const settings = {
        theme: userRecord?.theme || 'system',
        settings: userRecord?.settings || {},
        ui_preferences: userRecord?.ui_preferences || {
          language: 'en',
          keyboardNavigation: true,
          showTimestamps: true,
          autoScroll: true
        },
        notification_preferences: {
          inApp: true
        },
        accessibility_settings: userRecord?.accessibility_settings || {},
        privacy_settings: {},
        experimental_features: {}
      };
      
      return reply.send(settings);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), userId }, 'Failed to get user settings');
      // Return defaults on error
      return reply.send({
        theme: 'system',
        settings: {},
        ui_preferences: {
          language: 'en',
          keyboardNavigation: true,
          showTimestamps: true,
          autoScroll: true
        },
        notification_preferences: {
          inApp: true
        }
      });
    }
  });
  
  // Update user settings endpoint for UI (with authentication)
  fastify.put('/user/settings', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply: any) => {
    // Get user from authenticated request
    const user = request.user;
    const userId = user?.id || user?.userId;
    
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    try {
      const settings = request.body as any;
      
      // Update user settings fields
      const updateData: any = {};
      if (settings.theme) updateData.theme = settings.theme;
      if (settings.settings) updateData.settings = settings.settings;
      if (settings.ui_preferences) updateData.ui_preferences = settings.ui_preferences;
      if (settings.accessibility_settings) updateData.accessibility_settings = settings.accessibility_settings;
      
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          theme: true,
          settings: true,
          accessibility_settings: true,
          ui_preferences: true
        }
      });
      
      // Return updated settings
      const updatedSettings = {
        theme: updatedUser.theme || 'system',
        settings: updatedUser.settings || {},
        ui_preferences: updatedUser.ui_preferences || {
          language: 'en',
          keyboardNavigation: true,
          showTimestamps: true,
          autoScroll: true
        },
        notification_preferences: {
          inApp: true
        },
        accessibility_settings: updatedUser.accessibility_settings || {},
        privacy_settings: {},
        experimental_features: {}
      };
      
      return reply.send(updatedSettings);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), userId }, 'Failed to update user settings');
      return reply.code(500).send({ error: 'Failed to update settings' });
    }
  });

  // Get settings
    // Prisma client imported above

fastify.get('/', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest) => {
    // Get user ID from authenticated request
    const userId = request.user?.id || request.user?.userId;
    
    if (!userId) {
      logger.error('No user ID in authenticated request');
      throw new Error('User ID required');
    }
    
    logger.info(`Getting settings for user: ${userId}`);
    
    try {
      const settings = await getUserSettings(userId);
      
      if (settings) {
        // Don't send API key to frontend
        if (settings.azureOpenAI?.apiKey) {
          settings.azureOpenAI.apiKey = settings.azureOpenAI.apiKey ? '***' : '';
        }
        
        return settings;
      } else {
        // Return default settings when no settings found
        logger.info(`No settings found for user ${userId}, returning defaults`);
        return {
          theme: 'dark' as const,
          azureOpenAI: {
            apiKey: '',
            endpoint: '',
            deployment: '',
            apiVersion: '2024-08-01-preview'
          },
          tooltipsEnabled: true,
          showTokenUsage: false,
          mcpFunctions: {
            sequential_thinking: { enabled: true },
            azure: { enabled: false }
          }
        };
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get user settings');
      
      // Return default settings on error
      return {
        theme: 'dark' as const,
        azureOpenAI: {
          apiKey: '',
          endpoint: '',
          deployment: '',
          apiVersion: '2024-08-01-preview'
        },
        tooltipsEnabled: true,
        showTokenUsage: false,
        mcpFunctions: {
          sequential_thinking: { enabled: true },
          azure: { enabled: false }
        }
      };
    }
  });
  
  // Get MCP functions - now fetches from MCP Proxy directly
  fastify.get('/mcp-functions', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest) => {
    logger.info('Getting MCP functions from MCP Proxy');

    try {
      const MCP_PROXY_URL = process.env.MCP_PROXY_ENDPOINT ||
                            process.env.MCP_PROXY_URL ||
                            'http://openagentic-mcp-proxy:8080';

      // Fetch MCP tools directly from MCP Proxy
      const response = await fetch(`${MCP_PROXY_URL}/v1/mcp/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY}`,
        }
      });

      if (!response.ok) {
        logger.warn(`MCP Proxy MCP endpoint unavailable (${response.status}), returning empty tools list`);
        return {
          tools: {
            functions: [],
            toolsByServer: {
              sequential_thinking: { available: false, functions: [] },
              azure: { available: false, functions: [] }
            }
          },
          servers: []
        };
      }

      const mcpData = await response.json();

      // Group tools by MCP server
      const functionsByMCP: Record<string, any> = {};
      const allFunctions: any[] = [];
      const serversList: any[] = [];

      // Process tools from MCP Proxy
      if (mcpData.tools && Array.isArray(mcpData.tools)) {
        const serverMap = new Map<string, any[]>();

        mcpData.tools.forEach((tool: any) => {
          const serverName = tool.server || tool.serverName || 'default';
          if (!serverMap.has(serverName)) {
            serverMap.set(serverName, []);
          }

          const functionInfo = {
            name: tool.name || tool.function?.name,
            description: tool.description || tool.function?.description || 'No description available',
            serverId: serverName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            serverType: serverName,
            serverName: serverName,
            parameters: tool.parameters || tool.function?.parameters || {}
          };

          serverMap.get(serverName)!.push(functionInfo);
          allFunctions.push(functionInfo);
        });

        // Create server objects from the map
        serverMap.forEach((tools, serverName) => {
          const serverId = serverName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          functionsByMCP[serverId] = {
            available: true,
            functions: tools
          };
          serversList.push({
            id: serverId,
            name: serverName,
            serverName: serverName,
            status: 'connected',
            isConnected: true,
            tools: tools,
            toolCount: tools.length
          });
        });
      }

      // Return structure expected by the UI
      return {
        tools: {
          functions: allFunctions,
          toolsByServer: functionsByMCP
        },
        servers: serversList
      };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get MCP functions from MCP Proxy');
      return {
        tools: {
          functions: [],
          toolsByServer: {
            sequential_thinking: { available: false, functions: [] },
            azure: { available: false, functions: [] }
          }
        },
        servers: []
      };
    }
  });
  
  // Update settings - supports both POST and PUT for compatibility
  const updateSettingsHandler = async (request: AuthenticatedRequest, reply: any) => {
    // Get user ID from authenticated request
    const userId = request.user?.id || request.user?.userId;
    
    if (!userId) {
      logger.error('No user ID in authenticated request');
      return reply.code(401).send({ error: 'User ID required' });
    }
    
    logger.info(`Updating settings for user: ${userId}`);
    
    try {
      // Load existing settings
      let existingSettings: Settings = await getUserSettings(userId) || {
        theme: 'dark',
        azureOpenAI: {
          apiKey: '',
          endpoint: '',
          deployment: '',
          apiVersion: '2024-08-01-preview'
        },
        tooltipsEnabled: true,
        showTokenUsage: false
      };
      
      // Merge with new settings
      const requestBody = request.body as Partial<Settings>;
      const newSettings: Settings = {
        ...existingSettings,
        ...requestBody,
        azureOpenAI: {
          ...existingSettings.azureOpenAI,
          ...requestBody.azureOpenAI
        }
      };
      
      // Preserve actual API key if it was masked
      if (requestBody.azureOpenAI?.apiKey === '***' && existingSettings.azureOpenAI?.apiKey) {
        newSettings.azureOpenAI.apiKey = existingSettings.azureOpenAI.apiKey;
      }
      
      // Save to database
      await saveUserSettings(userId, newSettings);
      
      logger.info('Settings updated successfully in database');
      return { success: true };
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack,
        userId: userId
      }, 'Failed to save settings to database');
      return reply.status(500).send({ 
        error: 'Failed to save settings',
        details: error.message 
      });
    }
  };

  // Register both POST and PUT handlers with authentication
  fastify.post<{ Body: Partial<Settings> }>('/', {
    preHandler: authMiddleware
  }, updateSettingsHandler);
  fastify.put<{ Body: Partial<Settings> }>('/', {
    preHandler: authMiddleware
  }, updateSettingsHandler);
  
  // Get available models
  fastify.get('/available-models', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest) => {
    logger.info('Getting available models');
    
    // Get user ID from authenticated request
    const userId = request.user?.id || request.user?.userId;
    
    if (!userId) {
      logger.error('No user ID in authenticated request');
      return { models: [] };
    }
    
    try {
      const settings = await getUserSettings(userId);
      
      // If we have Azure OpenAI configured, try to get actual models from the deployment
      if (settings.azureOpenAI?.endpoint && settings.azureOpenAI?.apiKey) {
        try {
          // For now, return the configured deployment as the primary model
          // In a real implementation, we'd query Azure OpenAI Management API
          const models = [];
          
          if (settings.azureOpenAI.deployment) {
            models.push(settings.azureOpenAI.deployment);
          }
          
          // Use the existing dynamic model discovery system from chat/models.ts
          try {
            const { getModelsHandler } = await import('./chat/models.js');
            
            // Create a mock chatStorage service for the models handler
            const mockChatStorage = {
              // Add minimal interface needed by getModelsHandler if any
            };
            
            // Create a promise to capture the models response
            const modelsResponse = await new Promise((resolve, reject) => {
              const mockReply = {
                send: (data: any) => resolve(data),
                code: (status: number) => ({
                  send: (error: any) => reject(new Error(`API Error ${status}: ${JSON.stringify(error)}`))
                })
              } as any;
              
              // Call the existing models handler
              getModelsHandler(
                { user: { id: userId }, log: logger } as any,
                mockReply,
                mockChatStorage as any
              ).catch(reject);
            });
            
            // Extract model IDs from the sophisticated discovery system
            const discoveredModels = (modelsResponse as any).models || [];
            const additionalModels = discoveredModels
              .filter((model: any) => model.isAvailable)
              .map((model: any) => model.id);
            
            // Add discovered models to the list
            for (const model of additionalModels) {
              if (!models.includes(model)) {
                models.push(model);
              }
            }
            
            logger.info(`Discovered ${additionalModels.length} additional models via Azure API`);
          } catch (err) {
            logger.warn({ error: err }, 'Failed to discover models via Azure API, using configured deployment only');
          }
          
          return { models };
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch models from Azure');
        }
      }
      
      // No Azure configuration, return empty
      return { models: [] };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get available models');
      // No hardcoded models - return empty array to force proper configuration
      return { models: [] };
    }
  });
  
  // Test Azure OpenAI connection
  fastify.post('/test-azure', {
    preHandler: authMiddleware
  }, async (request: AuthenticatedRequest, reply) => {
    // Get user ID from authenticated request
    const userId = request.user?.id || request.user?.userId;
    
    if (!userId) {
      logger.error('No user ID in authenticated request');
      return reply.code(401).send({ error: 'User ID required' });
    }
    
    logger.info('Testing Azure OpenAI connection');
    
    try {
      const settings = await getUserSettings(userId);
      
      if (!settings) {
        return reply.status(400).send({ 
          error: 'No settings found',
          details: 'Please configure your settings first'
        } as ErrorResponse);
      }
      
      if (!settings.azureOpenAI?.endpoint || !settings.azureOpenAI?.deployment) {
        return reply.status(400).send({ 
          error: 'Azure OpenAI configuration incomplete',
          details: 'Please provide endpoint and deployment name'
        } as ErrorResponse);
      }
      
      // Check authentication method
      const authMethod = settings.azureOpenAI.authMethod || 'apiKey';
      
      if (authMethod === 'apiKey' && !settings.azureOpenAI.apiKey) {
        return reply.status(400).send({ 
          error: 'API key required',
          details: 'Please provide an API key for API key authentication'
        } as ErrorResponse);
      }
      
      if (authMethod === 'entraId' && (!settings.azureOpenAI.clientId || 
          !settings.azureOpenAI.tenantId || 
          !settings.azureOpenAI.clientSecret)) {
        return reply.status(400).send({ 
          error: 'Entra ID configuration incomplete',
          details: 'Please provide Client ID, Tenant ID, and Client Secret'
        } as ErrorResponse);
      }
      
      const startTime = Date.now();

      // Use MCP Proxy for testing
      const mcpProxyUrl = process.env.MCP_PROXY_ENDPOINT ||
        process.env.MCP_PROXY_URL ||
        'http://openagentic-mcp-proxy:8080';
      const mcpProxyKey = process.env.MCP_PROXY_API_KEY;

      if (!mcpProxyUrl || !mcpProxyKey) {
        return reply.status(500).send({ 
          error: 'MCP Proxy not configured',
          details: 'MCP Proxy URL and key are required',
          step: 'configuration'
        } as ErrorResponse);
      }
      
      try {
        // Test through MCP Proxy with the configured model
        const testModel = `${process.env.DEFAULT_MODEL_PREFIX || 'azure'}/${settings.azureOpenAI.deployment}`;

        const response = await fetch(`${mcpProxyUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mcpProxyKey}`
          },
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: 'user', content: 'Say "test successful" if you can read this.' }],
            max_tokens: 50,
            temperature: 0
          })
        });

        if (!response.ok) {
          throw new Error(`MCP Proxy test failed: ${response.status} ${response.statusText}`);
        }
        
        const responseData = await response.json() as any;
        
        const responseTime = Date.now() - startTime;
        const model = responseData.model || testModel;

        // Check for function calling support through MCP Proxy
        let supportsTools = false;
        try {
          const toolResponse = await fetch(`${mcpProxyUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${mcpProxyKey}`
            },
            body: JSON.stringify({
              model: testModel,
              messages: [{ role: 'user', content: 'Test' }],
              tools: [{
                type: 'function',
                function: {
                  name: 'test',
                  description: 'Test function',
                  parameters: { type: 'object', properties: {} }
                }
              }],
              max_tokens: 1
            })
          });
          supportsTools = toolResponse.ok;
        } catch {
          supportsTools = false;
        }
        
        const warnings: string[] = [];
        if (!supportsTools) {
          warnings.push('This model does not support function calling. MCP tools will not be available.');
        }
        
        const testResponse: TestAzureResponse = {
          success: true,
          message: 'Connection test successful!',
          details: {
            endpoint: settings.azureOpenAI.endpoint,
            deployment: settings.azureOpenAI.deployment,
            model,
            apiVersion: settings.azureOpenAI.apiVersion,
            responseTime: `${responseTime}ms`,
            features: {
              chat: true,
              tools: supportsTools,
              tokenUsage: !!responseData.usage
            },
            warnings
          }
        };
        
        logger.info('Azure OpenAI connection test successful');
        return testResponse;
        
      } catch (error: any) {
        logger.error({
          message: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          fullError: JSON.stringify(error)
        }, 'Azure OpenAI API error');
        
        let errorMessage = 'Connection test failed';
        let errorDetails = error.message || 'Unknown error';
        let step = 'chat_completion';
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          errorMessage = 'Cannot connect to Azure OpenAI endpoint';
          errorDetails = 'Please check your endpoint URL';
          step = 'connection';
        } else if (error.status === 401) {
          errorMessage = 'Authentication failed';
          errorDetails = 'Please check your API key';
          step = 'authentication';
        } else if (error.status === 404) {
          errorMessage = 'Deployment not found';
          errorDetails = 'Please check your deployment name';
          step = 'deployment_validation';
        }
        
        return reply.status(400).send({
          error: errorMessage,
          details: errorDetails,
          step
        } as ErrorResponse);
      }
    } catch (error: any) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to test Azure OpenAI');
      return reply.status(500).send({ 
        error: 'Failed to test connection',
        details: error.message,
        step: 'initialization'
      } as ErrorResponse);
    }
  });
};
