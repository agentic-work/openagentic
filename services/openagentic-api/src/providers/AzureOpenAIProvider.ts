/**
 * Azure OpenAI Capability Provider
 * Implements ICapabilityProvider for Azure OpenAI models
 */

import type { ICapabilityProvider } from '../services/ModelCapabilitiesService.js';
import type { DynamicModelSelector } from '../services/DynamicModelSelector.js';
import type { Logger } from 'pino';

export class AzureOpenAIProvider implements ICapabilityProvider {
  public name = 'azure-openai';
  private logger?: Logger;

  constructor(
    private dynamicSelector: DynamicModelSelector,
    private orchestratorClient?: any,
    logger?: Logger
  ) {
    this.logger = logger;
  }

  /**
   * List all available models with their capabilities
   */
  async listModels(): Promise<any[]> {
    try {
      // Discover available models using DynamicModelSelector
      const modelNames = await this.dynamicSelector.discoverAvailableModels();
      
      if (!modelNames || modelNames.length === 0) {
        this.logger?.warn('No models discovered from Azure OpenAI');
        return [];
      }

      // Get capabilities for each model
      const models = await Promise.all(modelNames.map(async (modelInfo) => {
        const modelName = typeof modelInfo === 'string' ? modelInfo : modelInfo.id;
        const capabilities = await this.dynamicSelector.getModelFullCapabilities(modelName);
        
        // Determine model type based on name and capabilities
        let type: string = 'language';
        
        if (modelName.toLowerCase().includes('dall-e') || 
            modelName.toLowerCase().includes('dalle')) {
          type = 'image_generation';
        } else if (capabilities?.supportsVision && capabilities?.supportsTools) {
          type = 'multimodal';
        } else if (capabilities?.supportsVision) {
          type = 'vision';
        }

        return {
          id: modelName,
          name: modelName,
          type,
          supportsTools: capabilities?.supportsTools ?? false,
          supportsVision: capabilities?.supportsVision ?? false,
          supportsStreaming: capabilities?.supportsStreaming ?? false,
          supportsJsonMode: capabilities?.supportsJsonMode ?? false,
          maxTokens: capabilities?.maxTokens ?? null,
          responseTime: capabilities?.responseTime ?? 1000,
          priorityScore: capabilities?.priorityScore ?? 1000
        };
      }));

      this.logger?.info(`Discovered ${models.length} Azure OpenAI models`);
      return models;
    } catch (error) {
      this.logger?.error({ err: error }, 'Failed to list Azure OpenAI models');
      return [];
    }
  }

  /**
   * List available MCP tools
   */
  async listMCPTools(): Promise<any[]> {
    if (!this.orchestratorClient) {
      this.logger?.warn('No orchestrator client available for MCP tools');
      return [];
    }

    try {
      // Get list of MCP servers
      const servers = await this.orchestratorClient.listServers();
      
      const allTools: any[] = [];

      // Get tools from each server
      for (const server of servers) {
        try {
          const tools = await this.orchestratorClient.getServerTools(server.id);
          
          for (const tool of tools) {
            // Categorize tool operation
            const category = this.categorizeToolOperation(tool);
            
            allTools.push({
              id: `${server.id}.${tool.name}`,
              name: tool.name,
              provider: server.id,
              connectionType: 'stdio',
              authentication: {
                type: 'none',
                required: false
              },
              operations: [{
                id: tool.name,
                name: tool.name,
                description: tool.description || '',
                category,
                parameters: this.extractParameters(tool.inputSchema),
                returns: {
                  type: 'structured_data',
                  format: 'json'
                },
                examples: []
              }]
            });
          }
        } catch (toolError) {
          this.logger?.warn({ 
            serverId: server.id, 
            error: toolError 
          }, 'Failed to get tools from MCP server');
        }
      }

      this.logger?.info(`Discovered ${allTools.length} MCP tools from ${servers.length} servers`);
      return allTools;
    } catch (error) {
      this.logger?.error({ err: error }, 'Failed to list MCP tools');
      return [];
    }
  }

  /**
   * Test a specific model's capabilities
   */
  async testModel(modelId: string, test: any): Promise<any> {
    try {
      // Run comprehensive capability test
      const capabilities = await this.dynamicSelector.testAllCapabilities(modelId);
      
      // Check if model passes the specific test type
      let passed = false;
      let details: any = {};

      switch (test.type) {
        case 'vision':
          passed = capabilities.supportsVision === true;
          if (!passed) {
            details.reason = 'Model does not support vision';
          }
          break;
        
        case 'tools':
          passed = capabilities.supportsTools === true;
          if (!passed) {
            details.reason = 'Model does not support tools';
          }
          break;
        
        case 'streaming':
          passed = capabilities.supportsStreaming === true;
          if (!passed) {
            details.reason = 'Model does not support streaming';
          }
          break;
        
        case 'json':
          passed = capabilities.supportsJsonMode === true;
          if (!passed) {
            details.reason = 'Model does not support JSON mode';
          }
          break;
        
        default:
          // General capability test
          passed = true;
          details = capabilities;
      }

      return {
        modelId,
        testType: test.type,
        passed,
        capabilities,
        details
      };
    } catch (error) {
      this.logger?.error({ modelId, test, error }, 'Failed to test model');
      return {
        modelId,
        testType: test.type,
        passed: false,
        error: error instanceof Error ? error.message : 'Test failed'
      };
    }
  }

  /**
   * Execute a tool operation
   */
  async executeToolOperation(toolId: string, operation: string, params: any): Promise<any> {
    if (!this.orchestratorClient) {
      throw new Error('No orchestrator client available');
    }

    // Extract server ID from tool ID (format: serverId.toolName)
    const [serverId] = toolId.split('.');
    
    if (!serverId) {
      throw new Error(`Invalid tool ID format: ${toolId}`);
    }

    try {
      // Execute through orchestrator
      const result = await this.orchestratorClient.executeTool(
        serverId,
        operation,
        params
      );
      
      return result;
    } catch (error) {
      this.logger?.error({ 
        toolId, 
        operation, 
        params, 
        error 
      }, 'Failed to execute tool operation');
      throw error;
    }
  }

  /**
   * Categorize tool operation based on name and description
   */
  private categorizeToolOperation(tool: any): string {
    const name = tool.name?.toLowerCase() || '';
    const desc = tool.description?.toLowerCase() || '';
    
    // Check for Azure/external API first (higher priority)
    if (name.includes('subscription') || name.includes('resource') || desc.includes('azure')) {
      return 'external_api';
    }
    if (name.includes('search') || name.includes('list') || desc.includes('retriev')) {
      return 'data_retrieval';
    }
    if (name.includes('create') || name.includes('update') || name.includes('delete')) {
      return 'data_manipulation';
    }
    if (name.includes('calc') || desc.includes('comput')) {
      return 'computation';
    }
    if (name.includes('file') || desc.includes('storage')) {
      return 'file_operations';
    }
    if (name.includes('memory') || name.includes('entity')) {
      return 'memory_management';
    }
    
    return 'general';
  }

  /**
   * Extract parameters from tool input schema
   */
  private extractParameters(inputSchema: any): any[] {
    if (!inputSchema || !inputSchema.properties) {
      return [];
    }

    const required = inputSchema.required || [];
    
    return Object.entries(inputSchema.properties).map(([name, schema]: [string, any]) => ({
      name,
      type: schema.type || 'string',
      required: required.includes(name),
      description: schema.description || '',
      default: schema.default,
      validation: {
        pattern: schema.pattern,
        min: schema.minimum,
        max: schema.maximum,
        enum: schema.enum
      }
    }));
  }
}