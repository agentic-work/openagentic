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

/**
 * Swagger/OpenAPI Configuration
 *
 * Provides API documentation through Swagger UI and OpenAPI spec
 * Accessible at /api/swagger (no auth required for now)
 */

import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import type { FastifySwaggerUiOptions } from '@fastify/swagger-ui';

export const swaggerOptions: FastifyDynamicSwaggerOptions = {
  mode: 'dynamic',
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'OpenAgentic Chat API',
      description: `
# OpenAgentic Chat API Documentation

A comprehensive enterprise-grade conversational AI platform API with advanced Model Context Protocol (MCP) orchestration.

## API Versioning

All new API endpoints are under the **/api/v1/** namespace:
- \`/api/v1/mcp/*\` - MCP server and tool management
- \`/api/v1/models/*\` - Available LLM models
- \`/api/v1/status\` - API v1 health status

Legacy routes are supported with 301 redirects to their v1 equivalents.

## Authentication

Most endpoints require authentication via one of:
- **Bearer Token**: Include \`Authorization: Bearer <token>\` header
- **API Key**: Include \`X-API-Key: <key>\` header

## Key Features

- **Chat Completions**: Real-time AI chat with streaming support
- **MCP Tools**: Execute Model Context Protocol tools
- **RAG (Retrieval Augmented Generation)**: Knowledge base search and document indexing
- **User Management**: Admin controls for users and permissions
- **Prompt Templates**: Reusable prompt configurations
- **Azure Integrations**: Microsoft Entra ID, Azure OpenAI, and more

## Rate Limits

Default rate limits are applied per user:
- Standard endpoints: 100 requests/minute
- Chat completions: 30 requests/minute
- File uploads: 10 requests/minute
      `,
      version: '1.0.0',
      contact: {
        name: 'OpenAgentic Support',
        email: 'support@openagentic.com'
      },
      license: {
        name: 'Proprietary',
        url: 'https://openagentic.com/license'
      }
    },
    externalDocs: {
      url: 'https://docs.openagentic.com',
      description: 'Full Documentation'
    },
    servers: [
      {
        url: '/',
        description: 'Current Server'
      }
    ],
    tags: [
      { name: 'Health', description: 'Health check and status endpoints' },
      { name: 'Auth', description: 'Authentication and authorization' },
      { name: 'Chat', description: 'Chat completions and conversations' },
      { name: 'MCP', description: 'Model Context Protocol tools and management (/api/v1/mcp/*)' },
      { name: 'Models', description: 'Available LLM models and capabilities (/api/v1/models/*)' },
      { name: 'RAG', description: 'Retrieval Augmented Generation and knowledge base' },
      { name: 'Files', description: 'File uploads and attachments' },
      { name: 'Users', description: 'User management (Admin only)' },
      { name: 'Settings', description: 'User and system settings' },
      { name: 'Prompts', description: 'Prompt templates and configurations' },
      { name: 'Admin', description: 'Administrative operations' },
      { name: 'Azure', description: 'Azure service integrations' },
      { name: 'Monitoring', description: 'System monitoring and metrics' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from authentication flow'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for programmatic access'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', description: 'Error type or code' },
            message: { type: 'string', description: 'Human-readable error message' },
            statusCode: { type: 'number', description: 'HTTP status code' }
          },
          required: ['error', 'message']
        },
        ChatMessage: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['user', 'assistant', 'system'],
              description: 'Message role'
            },
            content: { type: 'string', description: 'Message content' }
          },
          required: ['role', 'content']
        },
        ChatCompletionRequest: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', description: 'Conversation ID' },
            messages: {
              type: 'array',
              items: { '$ref': '#/components/schemas/ChatMessage' },
              description: 'Array of chat messages'
            },
            model: { type: 'string', description: 'Model to use for completion' },
            stream: { type: 'boolean', description: 'Whether to stream the response' },
            temperature: { type: 'number', description: 'Sampling temperature (0-2)' },
            maxTokens: { type: 'number', description: 'Maximum tokens in response' }
          },
          required: ['conversationId', 'messages']
        },
        MCPToolCall: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['tools/list', 'tools/call'],
              description: 'MCP method to invoke'
            },
            params: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Tool name for tools/call' },
                arguments: { type: 'object', description: 'Tool arguments' }
              }
            },
            server: { type: 'string', description: 'Target MCP server (optional)' },
            id: { type: 'string', description: 'Request ID for correlation' }
          },
          required: ['method']
        },
        MCPServer: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Server unique identifier' },
            name: { type: 'string', description: 'Server display name' },
            status: {
              type: 'string',
              enum: ['running', 'stopped', 'error', 'starting', 'stopping', 'unknown'],
              description: 'Server status'
            },
            enabled: { type: 'boolean', description: 'Whether server is enabled' },
            toolCount: { type: 'number', description: 'Number of tools available' },
            tools: {
              type: 'array',
              items: { '$ref': '#/components/schemas/MCPTool' }
            }
          }
        },
        MCPTool: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tool name' },
            description: { type: 'string', description: 'Tool description' },
            inputSchema: {
              type: 'object',
              description: 'JSON Schema for tool parameters'
            }
          }
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User ID' },
            email: { type: 'string', description: 'User email' },
            displayName: { type: 'string', description: 'Display name' },
            role: {
              type: 'string',
              enum: ['user', 'admin', 'super_admin'],
              description: 'User role'
            },
            isActive: { type: 'boolean', description: 'Account active status' },
            createdAt: { type: 'string', format: 'date-time' },
            lastLoginAt: { type: 'string', format: 'date-time' }
          }
        },
        Conversation: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Conversation ID' },
            title: { type: 'string', description: 'Conversation title' },
            userId: { type: 'string', description: 'Owner user ID' },
            messageCount: { type: 'number', description: 'Number of messages' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        PromptTemplate: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Template ID' },
            name: { type: 'string', description: 'Template name' },
            description: { type: 'string', description: 'Template description' },
            systemPrompt: { type: 'string', description: 'System prompt content' },
            isDefault: { type: 'boolean', description: 'Whether this is the default template' },
            isGlobal: { type: 'boolean', description: 'Whether template is globally available' }
          }
        },
        StreamChatRequest: {
          type: 'object',
          required: ['message', 'sessionId'],
          properties: {
            message: { type: 'string', description: 'User message content' },
            sessionId: { type: 'string', description: 'Chat session ID' },
            model: { type: 'string', description: 'Model identifier (e.g., gpt-4, claude-3-opus)' },
            promptTechniques: {
              type: 'array',
              items: { type: 'string' },
              description: 'Prompt engineering techniques to apply'
            },
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  originalName: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'number' },
                  data: { type: 'string', description: 'Base64 encoded file data' }
                }
              }
            },
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  content: { type: 'string' },
                  type: { type: 'string' }
                }
              }
            }
          }
        },
        StreamEvent: {
          type: 'object',
          description: 'Server-Sent Event for streaming chat responses',
          properties: {
            event: {
              type: 'string',
              enum: ['message', 'tool_call', 'tool_result', 'done', 'error', 'thinking', 'metadata'],
              description: 'Event type'
            },
            data: {
              type: 'object',
              description: 'Event payload (varies by event type)'
            }
          }
        },
        ModelInfo: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Model identifier' },
            name: { type: 'string', description: 'Display name' },
            provider: { type: 'string', description: 'Provider (azure, openai, anthropic, google, etc.)' },
            contextWindow: { type: 'number', description: 'Maximum context window in tokens' },
            maxOutputTokens: { type: 'number', description: 'Maximum output tokens' },
            inputCostPer1M: { type: 'number', description: 'Cost per 1M input tokens in USD' },
            outputCostPer1M: { type: 'number', description: 'Cost per 1M output tokens in USD' },
            capabilities: {
              type: 'object',
              properties: {
                vision: { type: 'boolean' },
                functionCalling: { type: 'boolean' },
                streaming: { type: 'boolean' },
                jsonMode: { type: 'boolean' }
              }
            },
            available: { type: 'boolean', description: 'Whether model is currently available' }
          }
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            database: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                method: { type: 'string' }
              }
            },
            users: {
              type: 'object',
              properties: {
                count: { type: 'number' }
              }
            }
          }
        },
        ComprehensiveHealth: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            overall_healthy: { type: 'boolean' },
            checks: {
              type: 'object',
              properties: {
                database: { '$ref': '#/components/schemas/HealthCheckItem' },
                chat_model: { '$ref': '#/components/schemas/HealthCheckItem' },
                embedding_model: { '$ref': '#/components/schemas/HealthCheckItem' },
                mcp_orchestrator: { '$ref': '#/components/schemas/HealthCheckItem' },
                vector_backup: { '$ref': '#/components/schemas/HealthCheckItem' }
              }
            }
          }
        },
        HealthCheckItem: {
          type: 'object',
          properties: {
            healthy: { type: 'boolean' },
            details: { type: 'object', additionalProperties: true }
          }
        },
        MCPServerStatus: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string', enum: ['running', 'stopped', 'error'] },
            enabled: { type: 'boolean' },
            toolCount: { type: 'number' },
            synced_to_proxy: { type: 'boolean' },
            instance_count: { type: 'number' }
          }
        },
        MCPToolExecutionRequest: {
          type: 'object',
          required: ['method'],
          properties: {
            method: {
              type: 'string',
              enum: ['tools/list', 'tools/call'],
              description: 'MCP JSON-RPC method'
            },
            params: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Tool name (for tools/call)' },
                arguments: { type: 'object', description: 'Tool arguments' }
              }
            },
            server: { type: 'string', description: 'Target MCP server ID' },
            id: { type: 'string', description: 'Request correlation ID' }
          }
        },
        MCPToolExecutionResponse: {
          type: 'object',
          properties: {
            jsonrpc: { type: 'string', const: '2.0' },
            id: { type: 'string' },
            result: { type: 'object', additionalProperties: true },
            error: {
              type: 'object',
              properties: {
                code: { type: 'number' },
                message: { type: 'string' },
                data: { type: 'object', additionalProperties: true }
              }
            }
          }
        },
        ChatSession: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            userId: { type: 'string' },
            model: { type: 'string' },
            systemPrompt: { type: 'string' },
            messageCount: { type: 'number' },
            lastMessageAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    security: [
      { bearerAuth: [] },
      { apiKey: [] }
    ]
  }
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
  routePrefix: '/api/swagger',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 3,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    syntaxHighlight: {
      activate: true,
      theme: 'monokai'
    },
    tryItOutEnabled: true,
    persistAuthorization: true
  },
  // No authentication required - Swagger docs are public
  uiHooks: {
    onRequest: function (request, reply, next) { next(); },
    preHandler: function (request, reply, next) { next(); }
  },
  staticCSP: false,  // Disable default restrictive CSP to allow iframing
  transformSpecification: (swaggerObject, request, reply) => {
    return swaggerObject;
  },
  transformSpecificationClone: true
};
