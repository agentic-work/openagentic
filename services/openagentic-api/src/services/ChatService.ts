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
 * Chat Service
 *
 * Handles chat operations including message streaming, session management,
 * and integration with MCP Proxy for model interactions.
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { TokenUsageService, TokenUsageRecord } from './TokenUsageService.js';
import { getRedisClient } from '../utils/redis-client.js';
import { createHash } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  userId: string;
  sessionId: string;
  stream: any; // Response stream
}

export class ChatService {
  private prisma: PrismaClient;
  private logger: Logger;
  private mcpProxyUrl: string;
  private tokenUsageService: TokenUsageService;
  private redisClient: any;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.mcpProxyUrl = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
    this.tokenUsageService = new TokenUsageService(logger);
    this.redisClient = getRedisClient();
  }

  async streamChat(options: StreamChatOptions): Promise<void> {
    const { messages, model, temperature = 1.0, maxTokens = 4096, userId, sessionId, stream } = options;

    try {
      // Create cache key for identical requests
      const cacheKey = this.createCacheKey(messages, model, temperature, maxTokens, userId);
      
      // Check cache for existing response (for identical prompts)
      if (this.redisClient && this.redisClient.isConnected()) {
        const cachedResponse = await this.redisClient.getCachedModelResponse(cacheKey);
        if (cachedResponse) {
          this.logger.info({ userId, sessionId, cacheKey }, 'Serving cached response');
          
          // Stream cached response
          const words = cachedResponse.content.split(' ');
          for (const word of words) {
            stream.write(`data: ${JSON.stringify({ content: word + ' ' })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 50)); // Simulate streaming
          }
          
          // Save cached response as message
          const messageId = await this.saveAssistantMessage(
            sessionId, userId, cachedResponse.content, model, cachedResponse.tokens
          );
          
          // Record token usage for cached response
          if (messageId && cachedResponse.usage) {
            await this.tokenUsageService.recordUsage({
              userId,
              sessionId,
              messageId,
              model,
              usage: cachedResponse.usage,
              metadata: {
                cached: true,
                cacheKey,
                timestamp: new Date().toISOString()
              }
            });
          }
          
          stream.write(`data: [DONE]\n\n`);
          return;
        }
      }
      // Call MCP Proxy
      const response = await axios.post(
        `${this.mcpProxyUrl}/v1/chat/completions`,
        {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: true,
          user: userId
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY}`
          },
          responseType: 'stream'
        }
      );

      let fullContent = '';
      let tokenCount = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let messageId: string | null = null;

      // Stream the response
      response.data.on('data', async (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              // Save assistant message and capture message ID for token tracking
              messageId = await this.saveAssistantMessage(sessionId, userId, fullContent, model, tokenCount);
              
              // Cache the response for future identical requests
              if (this.redisClient && this.redisClient.isConnected() && fullContent) {
                const usageData = {
                  promptTokens: promptTokens || 0,
                  completionTokens: completionTokens || tokenCount,
                  totalTokens: (promptTokens || 0) + (completionTokens || tokenCount)
                };

                await this.redisClient.cacheModelResponse(cacheKey, {
                  content: fullContent,
                  model,
                  tokens: tokenCount,
                  usage: usageData,
                  timestamp: new Date().toISOString()
                });
              }
              
              // Record token usage with proper tracking
              if (messageId && (promptTokens > 0 || completionTokens > 0 || tokenCount > 0)) {
                await this.tokenUsageService.recordUsage({
                  userId,
                  sessionId,
                  messageId,
                  model,
                  usage: {
                    promptTokens: promptTokens || 0,
                    completionTokens: completionTokens || tokenCount,
                    totalTokens: (promptTokens || 0) + (completionTokens || tokenCount)
                  },
                  metadata: {
                    streamingResponse: true,
                    contentLength: fullContent.length,
                    cached: false,
                    cacheKey,
                    timestamp: new Date().toISOString()
                  }
                });
              }
              
              stream.write(`data: [DONE]\n\n`);
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              const usage = parsed.usage;

              // Extract token usage from MCP Proxy response if available
              if (usage) {
                promptTokens = usage.prompt_tokens || 0;
                completionTokens = usage.completion_tokens || 0;
                tokenCount = usage.total_tokens || tokenCount;
              }
              
              if (content) {
                fullContent += content;
                tokenCount++;
                stream.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });

      response.data.on('end', () => {
        stream.write('data: [DONE]\n\n');
      });

      response.data.on('error', (error: any) => {
        this.logger.error({ error }, 'Stream error');
        stream.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      });

    } catch (error) {
      this.logger.error({ error, userId, sessionId }, 'Failed to stream chat');
      throw error;
    }
  }

  private async saveAssistantMessage(
    sessionId: string,
    userId: string,
    content: string,
    model: string,
    tokens: number
  ): Promise<string> {
    try {
      // Store RAW content from AI - let frontend handle all processing
      // This prevents double-processing and placeholder token issues
      
      const messageId = uuidv4();
      await this.prisma.chatMessage.create({
        data: {
          id: messageId,
          session_id: sessionId,
          user_id: userId,
          role: 'assistant',
          content: content, // Store RAW content for proper persistence and context
          model,
          tokens,
          metadata: {
            rawContent: true, // Flag that this is unprocessed AI content
            contentType: 'ai_generated',
            hasLaTeX: /\\\[|\\\(|\$\$|\$[^$]+\$/.test(content),
            hasCodeBlocks: /```/.test(content),
            hasMarkdown: /#{1,6}\s|[*_]{1,2}/.test(content)
          },
          created_at: new Date()
        }
      });

      // Update session
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          updated_at: new Date(),
          total_tokens: {
            increment: tokens
          }
        }
      });
      
      return messageId;
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to save assistant message');
      throw error;
    }
  }

  /**
   * Create a unique cache key for identical chat requests
   */
  private createCacheKey(messages: ChatMessage[], model: string, temperature: number, maxTokens: number, userId: string): string {
    // Create hash of request parameters to identify identical requests
    const requestData = {
      messages: messages.slice(-5), // Only use last 5 messages for caching context
      model,
      temperature,
      maxTokens
    };
    
    const hash = createHash('sha256')
      .update(JSON.stringify(requestData))
      .digest('hex')
      .substring(0, 16); // Use first 16 chars of hash
    
    return `chat:${hash}`;
  }

  /**
   * Preprocesses content to preserve rich formatting for persistent storage
   * Applies the same transformations as the frontend MessageContent component
   */
  private preprocessContentForStorage(content: string): string {
    if (!content || typeof content !== 'string') {
      return content || '';
    }

    // Apply LaTeX delimiter transformations (from MessageContent/index.tsx:51-91)
    let processed = content;
    
    // Convert \( ... \) to $...$
    processed = processed.replace(/\\\((.*?)\\\)/g, '$$$1$$');
    
    // Convert \[ ... \] to $$...$$
    processed = processed.replace(/\\\[(.*?)\\\]/g, '$$$$$$1$$$$');
    
    // Handle plain ( ... ) format with math detection
    processed = processed.replace(/\(\s+([^)]+?)\s+\)/g, (match, p1) => {
      const mathIndicators = ['=', '^', '_', '\\', 'frac', 'sqrt', 'sum', 'int', 'gamma', 'alpha', 'beta', 'theta', 'phi', 'pi', 'sigma', 'Delta', 'nabla', 'partial'];
      const looksLikeMath = mathIndicators.some(indicator => p1.includes(indicator));
      
      const mathPatterns = [
        /[a-zA-Z]\s*=\s*[a-zA-Z0-9]/,  // x = 5, E = mc
        /\d+\s*[\+\-\*/]\s*\d+/,       // 2 + 2
        /[a-zA-Z]+\^\d+/,               // mc^2
        /\\[a-zA-Z]+/                   // \frac, \int, etc.
      ];
      const matchesPattern = mathPatterns.some(pattern => pattern.test(p1));
      
      if (looksLikeMath || matchesPattern) {
        return `$${p1.trim()}$`;  // Inline math
      }
      return match;
    });
    
    // Handle block math with [ ... ] (with spaces)
    processed = processed.replace(/\[\s+([^[\]]+?)\s+\]/g, (match, p1) => {
      const mathIndicators = ['=', '\\', '^', '_', 'frac', 'int', 'sum', 'gamma', 'sqrt', 'lim', 'infty', 'Delta', 'nabla', 'partial'];
      const looksLikeMath = mathIndicators.some(indicator => p1.includes(indicator));
      
      if (looksLikeMath) {
        return `$$${p1.trim()}$$`;  // Display math
      }
      return match;
    });
    
    // Apply message formatting enhancements (from messageFormatter.ts)
    processed = processed
      // Add icons to common headers
      .replace(/^##\s*Summary/gim, '## 📋 Summary')
      .replace(/^##\s*Overview/gim, '## 🔍 Overview')
      .replace(/^##\s*Details?/gim, '## 📝 Details')
      .replace(/^##\s*Code/gim, '## 💻 Code')
      .replace(/^##\s*Example/gim, '## 📌 Example')
      .replace(/^##\s*Steps?/gim, '## 📋 Steps')
      .replace(/^##\s*Instructions?/gim, '## 📖 Instructions')
      .replace(/^##\s*Warning/gim, '## ⚠️ Warning')
      .replace(/^##\s*Error/gim, '## ❌ Error')
      .replace(/^##\s*Success/gim, '## ✅ Success')
      .replace(/^##\s*Notes?/gim, '## 📝 Notes')
      .replace(/^##\s*Important/gim, '## ❗ Important')
      .replace(/^##\s*Recommendations?/gim, '## 💡 Recommendations');
    
    return processed;
  }

  async generateTitle(sessionId: string, userId: string): Promise<string> {
    try {
      // Get first few messages
      const messages = await this.prisma.chatMessage.findMany({
        where: {
          session_id: sessionId,
          user_id: userId
        },
        orderBy: { created_at: 'asc' },
        take: 4
      });

      if (messages.length === 0) {
        return 'New Chat';
      }

      // Generate title using LLM
      const titleModel = process.env.TITLE_GENERATION_MODEL || process.env.DEFAULT_MODEL;
      if (!titleModel) {
        throw new Error('TITLE_GENERATION_MODEL or DEFAULT_MODEL must be set');
      }

      const response = await axios.post(
        `${this.mcpProxyUrl}/v1/chat/completions`,
        {
          model: titleModel,
          messages: [
            {
              role: 'system',
              content: 'Generate a very short (3-5 words) title for this conversation. Just return the title, nothing else.'
            },
            ...messages.slice(0, 2).map(m => ({
              role: m.role,
              content: m.content.substring(0, 500)
            }))
          ],
          temperature: 0.7,
          max_tokens: 20
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY}`
          }
        }
      );

      const title = response.data.choices[0].message.content.trim();
      
      // Update session title
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { title }
      });

      return title;
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to generate title');
      return 'New Chat';
    }
  }
}