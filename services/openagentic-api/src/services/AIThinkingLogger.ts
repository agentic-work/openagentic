/**
 * AI Thinking Logger Service
 *
 * Captures and streams the AI's internal reasoning process, including:
 * - Semantic search operations
 * - Tool selection decisions
 * - Embedding generation
 * - Internal reasoning steps
 *
 * This provides transparency into what the AI is "thinking" during request processing,
 * similar to Claude's thinking blocks.
 */

import { EventEmitter } from 'events';
import type { Logger } from 'pino';

export interface ThinkingEvent {
  type: 'semantic_search' | 'tool_selection' | 'embedding' | 'reasoning' | 'mcp_routing' | 'memory_lookup' | 'cost_calculation';
  timestamp: Date;
  operation: string;
  details: any;
  tokens?: {
    used: number;
    cost?: number;
  };
  duration?: number;
}

export class AIThinkingLogger extends EventEmitter {
  private logger: Logger;
  private events: ThinkingEvent[] = [];
  private sessionId?: string;
  private userId?: string;
  private isRecording: boolean = false;

  constructor(logger: Logger) {
    super();
    this.logger = logger.child({ component: 'AIThinkingLogger' });
  }

  /**
   * Start recording thinking events for a session
   */
  startSession(sessionId: string, userId: string) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.events = [];
    this.isRecording = true;

    this.emit('thinking:start', {
      sessionId,
      userId,
      timestamp: new Date()
    });
  }

  /**
   * Log a semantic search operation
   */
  logSemanticSearch(query: string, results: any[], similarityScores: number[], tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'semantic_search',
      timestamp: new Date(),
      operation: 'Searching for semantically similar content',
      details: {
        query,
        resultsFound: results.length,
        topScores: similarityScores.slice(0, 3),
        reasoning: `Searching for content similar to "${query.substring(0, 50)}..."`,
        process: [
          `Generated embedding vector (1536 dimensions)`,
          `Queried Milvus vector database`,
          `Found ${results.length} matches with similarity > 0.7`
        ]
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log tool selection process
   */
  logToolSelection(userQuery: string, availableTools: string[], selectedTools: string[], reasoning: string, tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'tool_selection',
      timestamp: new Date(),
      operation: 'Selecting appropriate tools for the task',
      details: {
        userQuery,
        availableTools,
        selectedTools,
        reasoning,
        process: [
          `Analyzed user intent: "${userQuery.substring(0, 50)}..."`,
          `Evaluated ${availableTools.length} available tools`,
          `Selected ${selectedTools.length} relevant tools based on semantic similarity`,
          ...selectedTools.map(tool => `✓ Selected: ${tool}`)
        ]
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log embedding generation
   */
  logEmbeddingGeneration(text: string, dimension: number, provider: string, tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'embedding',
      timestamp: new Date(),
      operation: 'Generating text embeddings',
      details: {
        textLength: text.length,
        dimension,
        provider,
        reasoning: `Converting text to ${dimension}-dimensional vector for semantic matching`,
        process: [
          `Using ${provider} embedding model`,
          `Processing ${text.length} characters`,
          `Generated ${dimension}-dimensional vector`
        ]
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log internal reasoning steps
   */
  logReasoning(step: string, details: any, tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'reasoning',
      timestamp: new Date(),
      operation: step,
      details: {
        ...details,
        process: [
          `Analyzing: ${step}`,
          ...(details.considerations || []),
          details.decision ? `Decision: ${details.decision}` : null
        ].filter(Boolean)
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log MCP routing decisions
   */
  logMCPRouting(toolCall: string, targetMCP: string, reasoning: string, tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'mcp_routing',
      timestamp: new Date(),
      operation: 'Routing tool call to MCP server',
      details: {
        toolCall,
        targetMCP,
        reasoning,
        process: [
          `Tool requested: ${toolCall}`,
          `Checking MCP registry for handler`,
          `Routing to: ${targetMCP}`,
          `Reason: ${reasoning}`
        ]
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log memory lookup operations
   */
  logMemoryLookup(query: string, memories: any[], relevanceScores: number[], tokensUsed: number = 0) {
    const event: ThinkingEvent = {
      type: 'memory_lookup',
      timestamp: new Date(),
      operation: 'Searching conversation memory',
      details: {
        query,
        memoriesFound: memories.length,
        topRelevance: relevanceScores[0] || 0,
        reasoning: `Looking for relevant context from past conversations`,
        process: [
          `Query: "${query.substring(0, 50)}..."`,
          `Found ${memories.length} relevant memories`,
          memories.length > 0 ? `Most relevant: ${(relevanceScores[0] * 100).toFixed(1)}% similarity` : 'No relevant memories found'
        ]
      },
      tokens: { used: tokensUsed }
    };

    this.recordEvent(event);
  }

  /**
   * Log cost calculations
   */
  logCostCalculation(model: string, tokens: number, cost: number) {
    const event: ThinkingEvent = {
      type: 'cost_calculation',
      timestamp: new Date(),
      operation: 'Calculating token usage cost',
      details: {
        model,
        tokens,
        cost,
        costPerThousand: (cost / tokens * 1000).toFixed(4),
        process: [
          `Model: ${model}`,
          `Tokens used: ${tokens}`,
          `Cost: $${cost.toFixed(6)}`
        ]
      },
      tokens: { used: tokens, cost }
    };

    this.recordEvent(event);
  }

  /**
   * Record an event and emit it for streaming
   */
  private recordEvent(event: ThinkingEvent) {
    if (!this.isRecording) return;

    this.events.push(event);

    // Emit for real-time streaming to UI
    this.emit('thinking:event', {
      sessionId: this.sessionId,
      userId: this.userId,
      event
    });

    // Log for debugging
    this.logger.debug({
      type: event.type,
      operation: event.operation,
      tokens: event.tokens
    }, 'AI thinking event');
  }

  /**
   * Get all thinking events for current session
   */
  getSessionThinking(): ThinkingEvent[] {
    return this.events;
  }

  /**
   * Get thinking summary with total tokens and cost
   */
  getThinkingSummary(): {
    totalEvents: number;
    totalTokens: number;
    totalCost: number;
    breakdown: Record<string, { count: number; tokens: number; cost: number }>;
  } {
    const summary = {
      totalEvents: this.events.length,
      totalTokens: 0,
      totalCost: 0,
      breakdown: {} as Record<string, { count: number; tokens: number; cost: number }>
    };

    for (const event of this.events) {
      const tokens = event.tokens?.used || 0;
      const cost = event.tokens?.cost || 0;

      summary.totalTokens += tokens;
      summary.totalCost += cost;

      if (!summary.breakdown[event.type]) {
        summary.breakdown[event.type] = { count: 0, tokens: 0, cost: 0 };
      }

      summary.breakdown[event.type].count++;
      summary.breakdown[event.type].tokens += tokens;
      summary.breakdown[event.type].cost += cost;
    }

    return summary;
  }

  /**
   * End the current thinking session
   */
  endSession() {
    if (!this.isRecording) return;

    const summary = this.getThinkingSummary();

    this.emit('thinking:end', {
      sessionId: this.sessionId,
      userId: this.userId,
      summary,
      timestamp: new Date()
    });

    this.logger.info({
      sessionId: this.sessionId,
      userId: this.userId,
      ...summary
    }, 'AI thinking session ended');

    this.isRecording = false;
  }

  /**
   * Stream thinking events via Server-Sent Events
   */
  streamToSSE(res: any) {
    const listener = (data: any) => {
      res.write(`data: ${JSON.stringify({
        type: 'thinking',
        ...data
      })}\n\n`);
    };

    this.on('thinking:event', listener);

    // Cleanup on disconnect
    res.on('close', () => {
      this.off('thinking:event', listener);
    });
  }
}