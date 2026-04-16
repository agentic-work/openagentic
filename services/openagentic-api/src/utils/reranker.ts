/**
 * LLM-Based Reranker
 *
 * Provides cross-encoder style reranking using LLM to improve search accuracy.
 * Takes initial search results and reorders them based on semantic relevance.
 *
 * This is a simpler alternative to using dedicated cross-encoder models like
 * cross-encoder/ms-marco-MiniLM-L-6-v2, avoiding additional dependencies.
 */

import { loggers } from './logger.js';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';

const logger = loggers.services.child({ component: 'reranker' });

/**
 * Tool representation for reranking
 */
export interface RerankableTool {
  name: string;
  description: string;
  inputSchema?: any;
  server_name?: string;
  [key: string]: any; // Allow additional fields to pass through
}

/**
 * Reranking result with score
 */
export interface RerankedTool extends RerankableTool {
  rerankScore?: number;
  rerankReason?: string;
}

/**
 * Rerank tools using LLM
 *
 * @param query - The user's search query
 * @param tools - Array of tools to rerank
 * @param topK - Number of top results to return
 * @param providerManager - Provider manager for LLM access
 * @returns Reranked tools (limited to topK)
 */
export async function rerankWithLLM(
  query: string,
  tools: RerankableTool[],
  topK: number = 10,
  providerManager?: ProviderManager
): Promise<RerankableTool[]> {
  const startTime = Date.now();

  try {
    // Validate inputs
    if (!query || tools.length === 0) {
      logger.warn({ query, toolCount: tools.length }, 'Invalid reranking input');
      return tools.slice(0, topK);
    }

    // If no provider manager, return original results
    if (!providerManager) {
      logger.warn('No ProviderManager available for reranking, returning original results');
      return tools.slice(0, topK);
    }

    // Limit tools to rerank (max 20 to control cost)
    const toolsToRerank = tools.slice(0, 20);

    logger.info({
      query,
      originalCount: tools.length,
      rerankingCount: toolsToRerank.length,
      topK
    }, '🔄 Starting LLM reranking');

    // Build reranking prompt
    const prompt = buildRerankingPrompt(query, toolsToRerank);

    // Call LLM for reranking
    const providerNames = providerManager.getProviderNames();
    if (providerNames.length === 0) {
      logger.warn('No LLM providers available for reranking');
      return tools.slice(0, topK);
    }

    const providerName = providerNames[0];
    const provider = providerManager.getProvider(providerName);

    if (!provider) {
      logger.warn({ provider: providerName }, 'Provider not found for reranking');
      return tools.slice(0, topK);
    }

    // Generate completion
    const response = await provider.createCompletion({
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.0, // Deterministic for ranking
      stream: false
    }) as import('../services/llm-providers/ILLMProvider.js').CompletionResponse;

    // Parse ranking from response
    const content = response.choices[0]?.message?.content || '';
    const rerankedTools = parseRankingResponse(content, toolsToRerank);

    const duration = Date.now() - startTime;

    logger.info({
      query,
      originalOrder: toolsToRerank.slice(0, 5).map(t => t.name),
      rerankedOrder: rerankedTools.slice(0, 5).map(t => t.name),
      duration: `${duration}ms`,
      topK
    }, '✅ LLM reranking complete');

    // Return top K results
    return rerankedTools.slice(0, topK);

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      query,
      toolCount: tools.length,
      duration: `${duration}ms`
    }, '❌ LLM reranking failed, returning original results');

    // Fallback to original results
    return tools.slice(0, topK);
  }
}

/**
 * Build prompt for LLM reranking
 */
function buildRerankingPrompt(query: string, tools: RerankableTool[]): string {
  // Create numbered list of tools with descriptions
  const toolList = tools.map((tool, index) => {
    const description = tool.description || 'No description';
    return `${index + 1}. ${tool.name}\n   Description: ${description}`;
  }).join('\n\n');

  return `You are a search ranking expert. Your task is to rank the following tools by their relevance to the user's query.

User Query: "${query}"

Tools to rank:
${toolList}

CRITICAL Instructions:
1. Analyze each tool's name and description
2. Determine how well each tool matches the user's query
3. **MULTI-PART QUERIES**: If the query asks for MULTIPLE things (e.g., "Azure X AND AWS Y"), you MUST rank tools for BOTH parts highly
   - Tools for Azure should be at the top if Azure is mentioned
   - Tools for AWS should also be at the top if AWS is mentioned
   - Do NOT favor one cloud provider over another - include BOTH
4. Rank ALL tools from most relevant (1) to least relevant (${tools.length})
5. Return ONLY the ranked tool numbers, one per line, starting with the most relevant

Example: For query "show Azure subscriptions and AWS IAM users":
- subscription_list (Azure) should be near top
- call_aws (AWS) should be near top
- Both cloud providers' tools should appear before unrelated tools

Your ranking (tool numbers only):`;
}

/**
 * Parse LLM response to extract ranked tool order
 */
function parseRankingResponse(
  response: string,
  originalTools: RerankableTool[]
): RerankableTool[] {
  try {
    // Extract numbers from response
    const lines = response.trim().split('\n');
    const rankedIndices: number[] = [];

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)/);
      if (match) {
        const index = parseInt(match[1]) - 1; // Convert to 0-based index
        if (index >= 0 && index < originalTools.length) {
          rankedIndices.push(index);
        }
      }
    }

    // If we got valid rankings, reorder tools
    if (rankedIndices.length > 0) {
      const rerankedTools: RerankableTool[] = [];

      // Add ranked tools first
      for (const index of rankedIndices) {
        if (!rerankedTools.includes(originalTools[index])) {
          rerankedTools.push(originalTools[index]);
        }
      }

      // Add any missing tools at the end (preserve original order)
      for (const tool of originalTools) {
        if (!rerankedTools.includes(tool)) {
          rerankedTools.push(tool);
        }
      }

      logger.info({
        parsedCount: rankedIndices.length,
        totalCount: originalTools.length,
        coverage: `${((rankedIndices.length / originalTools.length) * 100).toFixed(1)}%`
      }, 'Parsed LLM ranking response');

      return rerankedTools;
    }

    // Fallback: return original order if parsing failed
    logger.warn({
      response: response.substring(0, 200),
      parsedCount: rankedIndices.length
    }, 'Failed to parse LLM ranking response, using original order');

    return originalTools;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      response: response.substring(0, 200)
    }, 'Error parsing ranking response');

    return originalTools;
  }
}

/**
 * Simple fallback reranking using exact keyword matching
 * Used when LLM reranking is disabled or fails
 */
export function rerankWithKeywords(
  query: string,
  tools: RerankableTool[],
  topK: number = 10
): RerankableTool[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  // Score each tool based on keyword matches
  const scoredTools = tools.map(tool => {
    let score = 0;
    const nameLower = tool.name.toLowerCase();
    const descLower = (tool.description || '').toLowerCase();

    // Exact name match = highest score
    if (nameLower === queryLower || nameLower.includes(queryLower)) {
      score += 100;
    }

    // Keyword matches in name
    queryWords.forEach(word => {
      if (nameLower.includes(word)) {
        score += 10;
      }
      if (descLower.includes(word)) {
        score += 2;
      }
    });

    return { tool, score };
  });

  // Sort by score (descending) and return top K
  scoredTools.sort((a, b) => b.score - a.score);
  return scoredTools.slice(0, topK).map(s => s.tool);
}
