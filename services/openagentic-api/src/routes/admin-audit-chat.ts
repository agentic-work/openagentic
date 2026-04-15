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
 * Admin Audit Chat Routes
 * AI-powered chat interface for querying and analyzing audit logs
 * Allows admins to use natural language to search user chat history and logs
 *
 * Updated to use MCP Proxy for provider-agnostic LLM access
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { AuditLogger } from '../services/AuditLogger.js';
import { loggers } from '../utils/logger.js';
import axios from 'axios';

const logger = loggers.routes.child({ component: 'AdminAuditChat' });

interface AuditChatRequest {
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

const adminAuditChatRoutes: FastifyPluginAsync = async (fastify) => {
  const auditLogger = new AuditLogger(logger);

  // Get MCP Proxy endpoint
  const mcpProxyUrl = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
  logger.info({ mcpProxyUrl }, '[AUDIT-CHAT] Using MCP Proxy for admin audit chat');

  /**
   * Chat with AI agent to query audit logs
   * The AI agent has access to audit log tools via MCP
   */
  fastify.post('/api/admin/audit/chat', {
    preHandler: adminMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1 },
          conversationHistory: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: AuditChatRequest }>, reply: FastifyReply) => {
    const { message, conversationHistory = [] } = request.body;
    const adminUser = request.user;

    try {
      logger.info({ adminUserId: adminUser?.id, message }, '[AUDIT-CHAT] Admin audit query');

      // Build system prompt for audit assistant
      const systemPrompt = `You are an AI assistant helping administrators query and analyze comprehensive audit trails and user activity logs.

You have access to specialized audit query tools that can analyze:

AUDIT DATA SOURCES:
- AdminAuditLog: Login/logout events, admin actions, authentication activities
- UserQueryAudit: All user chat queries, MCP tool usage, conversation history, errors

AVAILABLE AUDIT TOOLS:
- admin_audit_get_user_activity: Get comprehensive user activity (logins, queries, admin actions)
- admin_audit_get_user_chats: Search and analyze all user chat messages and interactions
- admin_audit_get_login_history: Detailed login/logout history with security analysis
- admin_audit_get_error_analysis: Comprehensive error analysis with categorization
- admin_audit_get_usage_statistics: Platform usage statistics and trends
- admin_system_postgres_raw_query: Direct database queries (use carefully)
- admin_system_users_list_all: List platform users

ANALYSIS CAPABILITIES:
- Track user authentication patterns (Azure AD OAuth, token validation)
- Search chat conversations by content, tools used, or MCP server
- Analyze error patterns and failure trends
- Monitor tool usage and MCP server interactions
- Generate usage statistics and user activity reports
- IP address and geographic analysis
- Security event monitoring

QUERY EXAMPLES:
- "Show me all login activity for user@example.com in the last 24 hours"
- "Find all user chats mentioning 'Azure deployment' or 'kubernetes'"
- "Get error analysis for failed queries in the last week"
- "Show usage statistics with MCP tool breakdown for this month"
- "Which users had login failures recently?"
- "What tools were most commonly used by users today?"

IMPORTANT GUIDELINES:
1. Use specific audit tools rather than raw database queries when possible
2. Always include relevant timestamps and user context
3. Respect user privacy - only show data relevant to the admin's query
4. Summarize large result sets with key insights
5. Provide actionable recommendations when appropriate

Current date/time: ${new Date().toISOString()}`;

      // Build conversation messages
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory as ChatMessage[],
        { role: 'user', content: message }
      ];

      // Get MCP Proxy endpoint - use environment variable or docker-compose service name
      const mcpProxyUrl = process.env.MCP_PROXY_URL || process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';

      // Fetch available MCP tools for audit log querying
      const toolsResponse = await axios.get(`${mcpProxyUrl}/tools`, {
        timeout: 15000 // 15 seconds - MCP tool discovery can be slow
      });

      // Handle response from MCP Proxy
      let allTools: any[] = [];
      if (Array.isArray(toolsResponse.data)) {
        allTools = toolsResponse.data;
      } else if (toolsResponse.data?.tools && Array.isArray(toolsResponse.data.tools)) {
        allTools = toolsResponse.data.tools;
      }

      // Filter to admin and audit-related tools
      const adminTools = allTools.filter((tool: any) => {
        const toolName = tool.name || '';
        return toolName.startsWith('admin_audit_') ||  // Specific audit tools
               toolName.includes('admin_system_postgres') ||  // Database query tools
               toolName.includes('admin_system_users_') ||     // User management tools
               toolName.includes('admin_audit') ||             // Any audit tools
               toolName.includes('postgres') ||
               toolName.includes('query') ||
               toolName.includes('database');
      });

      // Convert MCP tool format to OpenAI tool format
      const openaiTools: ChatCompletionTool[] = adminTools.map((tool: any) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
      }));

      logger.info({
        totalTools: allTools.length,
        adminTools: adminTools.length,
        toolNames: adminTools.map((t: any) => t.name)
      }, '[AUDIT-CHAT] Available admin tools');

      // Simple response for now - tools will be integrated later
      // For now, return a helpful message guiding the user
      const response = `I'm your AI audit assistant! I can help you analyze:

📊 **Available Queries:**
- User activity and login history
- Chat conversations and messages
- Error analysis and troubleshooting
- Tool usage statistics
- MCP server interactions

🔧 **Coming Soon:**
Full AI-powered analysis with natural language queries. For now, please use the other admin tabs:
- **Audit Logs** - View detailed user activity
- **MCP Call Logs** - See tool execution history
- **Performance Metrics** - Real-time LLM usage data

**Your Query:** "${message}"

*This feature is being enhanced to provide deep insights into your system's audit data.*`;

      return reply.send({
        success: true,
        response,
        toolCalls: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });

      // TODO: Implement full AI-powered audit analysis with tool calling
      // Below code is commented out for future implementation
      /*
      // If AI wants to call tools, execute them
      if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
        logger.info({
          toolCalls: aiMessage.tool_calls.length
        }, '[AUDIT-CHAT] AI requested tool calls');

        const toolResults = [];

        for (const toolCall of aiMessage.tool_calls) {
          try {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);

            logger.info({ toolName, toolArgs }, '[AUDIT-CHAT] Executing tool');

            // Execute tool via MCP Proxy
            const toolResponse = await axios.post(
              `${mcpProxyUrl}/tools/${toolName}/execute`,
              toolArgs,
              {
                headers: {
                  'Content-Type': 'application/json'
                },
                timeout: 30000
              }
            );

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: toolName,
              content: JSON.stringify(toolResponse.data.result || toolResponse.data)
            });
          } catch (toolError: any) {
            logger.error({
              error: toolError.message,
              toolCall
            }, '[AUDIT-CHAT] Tool execution failed');

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: toolCall.function.name,
              content: JSON.stringify({ error: toolError.message })
            });
          }
        }

        // Make another completion call with tool results
        const finalMessages = [
          ...messages,
          aiMessage,
          ...toolResults
        ];

        const finalCompletionResponse = await axios.post(`${mcpProxyUrl}/chat/completions`, {
          // Use environment variables only - NO hardcoded model IDs
          model: process.env.ADMIN_AUDIT_MODEL || process.env.PREMIUM_MODEL || process.env.DEFAULT_MODEL,
          messages: finalMessages as any,
          temperature: 0.3,
          max_tokens: 2000
        }, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        const finalCompletion = finalCompletionResponse.data;
        const finalAiMessage = finalCompletion.choices[0].message;

        return reply.send({
          success: true,
          response: finalAiMessage.content,
          toolCalls: aiMessage.tool_calls.map((tc: any) => ({
            name: tc.function.name,
            arguments: tc.function.arguments
          })),
          usage: finalCompletion.usage
        });
      }

      // No tool calls needed, return direct response
      return reply.send({
        success: true,
        response: aiMessage.content,
        usage: completion.usage
      });
      */

    } catch (error: any) {
      logger.error({ error: error.message }, '[AUDIT-CHAT] Failed to process audit chat');
      return reply.code(500).send({
        success: false,
        error: 'Failed to process audit query',
        message: error.message
      });
    }
  });

  /**
   * Get audit chat suggestions based on recent activity
   */
  fastify.get('/api/admin/audit/chat/suggestions', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get recent audit stats to generate smart suggestions
      const recentLogs = await auditLogger.getAuditLogs({
        limit: 100,
        success: false // Focus on errors
      });

      const suggestions = [
        "Show me all errors in the last 24 hours",
        "Which users were most active today?",
        "What are the most commonly used MCP tools?",
        "Show me failed tool calls in the last hour",
        "Which Azure operations failed recently?"
      ];

      // Add dynamic suggestions based on recent activity
      if (recentLogs.length > 0) {
        const errorCount = recentLogs.filter(l => !l.success).length;
        if (errorCount > 10) {
          suggestions.unshift(`Analyze the ${errorCount} recent errors and find patterns`);
        }

        const uniqueUsers = new Set(recentLogs.map(l => l.user_id)).size;
        if (uniqueUsers > 5) {
          suggestions.push(`Show me activity breakdown for the ${uniqueUsers} active users`);
        }
      }

      return reply.send({
        success: true,
        suggestions
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[AUDIT-CHAT] Failed to get suggestions');
      return reply.send({
        success: true,
        suggestions: [
          "Show me recent audit logs",
          "What errors occurred today?",
          "Which users are most active?"
        ]
      });
    }
  });
};

export default adminAuditChatRoutes;
