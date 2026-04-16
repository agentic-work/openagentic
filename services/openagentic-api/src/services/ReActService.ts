/**

 * ReAct (Reasoning + Acting) Pattern Service
 * Implements systematic tool usage with explicit reasoning steps
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

export interface ReActStep {
  id: string;
  thought: string;
  action: {
    tool: string;
    params: any;
  };
  observation?: string;
  reflection?: string;
  timestamp: Date;
}

export interface ReActHistory {
  sessionId: string;
  steps: ReActStep[];
  summary?: string;
}

export class ReActService {
  private logger: any;
  private histories: Map<string, ReActHistory> = new Map();

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Enhance system prompt with ReAct pattern instructions
   */
  enhancePromptWithReAct(basePrompt: string): string {
    const reactInstructions = `

When you need to use tools or gather information, follow the ReAct (Reasoning + Acting) pattern:

1. THOUGHT: First, explain what you need to find out and why
2. ACTION: Specify which tool to use and with what parameters
3. OBSERVATION: After receiving the tool's response, describe what you learned
4. REFLECTION: Consider if you need more information or if you can answer the user

Example:
THOUGHT: I need to check the user's Azure VM costs to help them optimize spending
ACTION: Use azure_cost_analysis tool for all VM resources
OBSERVATION: Found 15 VMs with total monthly cost of $5,234. The largest costs are from 3 VMs in the production environment
REFLECTION: I have enough information about costs. Now I should analyze which VMs might be oversized

Always use this systematic approach when using tools. Be explicit about your reasoning at each step.`;

    return basePrompt + reactInstructions;
  }

  /**
   * Generate a ReAct step based on user message and available tools
   */
  async generateReActStep(
    userMessage: string,
    availableTools: string[],
    context?: any
  ): Promise<Omit<ReActStep, 'id' | 'timestamp' | 'observation' | 'reflection'>> {
    // Analyze the user message to determine what information is needed
    const analysis = this.analyzeUserIntent(userMessage);
    
    // Generate thought based on analysis
    const thought = this.generateThought(analysis, context);
    
    // Select appropriate tool and parameters
    const action = this.selectAction(analysis, availableTools, context);

    return {
      thought,
      action
    };
  }

  /**
   * Process tool observation and generate reflection
   */
  async processObservation(
    toolResult: any
  ): Promise<{ observation: string; reflection: string }> {
    // Convert tool result to human-readable observation
    const observation = this.formatObservation(toolResult);
    
    // Generate reflection on what was learned
    const reflection = this.generateReflection(toolResult, observation);

    return { observation, reflection };
  }

  /**
   * Create and manage ReAct conversation history
   */
  createReActHistory(sessionId?: string): {
    addStep: (step: ReActStep) => void;
    getSteps: () => ReActStep[];
    getSummary: () => string;
    clear: () => void;
  } {
    const id = sessionId || `session-${Date.now()}`;
    const history: ReActHistory = {
      sessionId: id,
      steps: []
    };
    
    this.histories.set(id, history);

    return {
      addStep: (step: ReActStep) => {
        history.steps.push(step);
        this.updateHistorySummary(history);
      },
      getSteps: () => history.steps,
      getSummary: () => history.summary || this.generateHistorySummary(history),
      clear: () => {
        history.steps = [];
        history.summary = undefined;
      }
    };
  }

  /**
   * Store ReAct history in database
   */
  async storeReActHistory(
    sessionId: string,
    messageId: string,
    steps: ReActStep[]
  ): Promise<void> {
    try {
      // Store ReAct history in database using Prisma
      // Since there's no specific table for ReAct history in our schema,
      // we'll store it as JSON metadata in chat messages
      
      // Find the message to attach the ReAct history to
      const message = await prisma.chatMessage.findUnique({
        where: { id: messageId }
      });
      
      if (message) {
        await prisma.chatMessage.update({
          where: { id: messageId },
          data: {
            mcp_calls: {
              react_history: steps.map(step => ({
                id: step.id,
                thought: step.thought,
                action: step.action,
                observation: step.observation,
                reflection: step.reflection,
                timestamp: step.timestamp.toISOString()
              }))
            }
          }
        });
        
        this.logger.info({ sessionId, messageId, steps: steps.length }, 'Stored ReAct history');
      } else {
        this.logger.warn({ sessionId, messageId }, 'Message not found for ReAct history storage');
      }
    } catch (error) {
      this.logger.error('Failed to store ReAct history:', error);
    }
  }

  /**
   * Format ReAct steps for display in UI
   */
  formatReActStepsForDisplay(steps: ReActStep[]): string {
    return steps.map((step, index) => `
**Step ${index + 1}**
🤔 **Thought**: ${step.thought}
🔧 **Action**: \`${step.action.tool}\` ${JSON.stringify(step.action.params)}
${step.observation ? `👁️ **Observation**: ${step.observation}` : ''}
${step.reflection ? `💭 **Reflection**: ${step.reflection}` : ''}
`).join('\n---\n');
  }

  /**
   * Analyze user intent to determine what information is needed
   */
  private analyzeUserIntent(message: string): {
    intent: string;
    entities: string[];
    requiredInfo: string[];
  } {
    // Simple intent analysis - in production, use NLP
    const intents: Record<string, string[]> = {
      cost_analysis: ['cost', 'spend', 'expensive', 'bill', 'pricing', 'budget'],
      resource_info: ['list', 'show', 'what', 'resources', 'vms', 'databases'],
      optimization: ['optimize', 'reduce', 'improve', 'efficiency', 'save'],
      troubleshooting: ['error', 'issue', 'problem', 'broken', 'fix', 'debug'],
      deployment: ['deploy', 'create', 'launch', 'provision', 'setup']
    };

    const messageLower = message.toLowerCase();
    let detectedIntent = 'general';
    let maxMatches = 0;

    for (const [intent, keywords] of Object.entries(intents)) {
      const matches = keywords.filter(kw => messageLower.includes(kw)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedIntent = intent;
      }
    }

    // Extract entities (simple approach)
    const entities = this.extractEntities(message);
    
    // Determine required information based on intent
    const requiredInfo = this.getRequiredInfoForIntent(detectedIntent);

    return { intent: detectedIntent, entities, requiredInfo };
  }

  /**
   * Generate thought based on analysis
   */
  private generateThought(
    analysis: { intent: string; entities: string[]; requiredInfo: string[] },
    context?: any
  ): string {
    const thoughtTemplates: Record<string, string> = {
      cost_analysis: "I need to analyze the costs to understand where money is being spent",
      resource_info: "I need to get information about the current resources",
      optimization: "I need to identify optimization opportunities",
      troubleshooting: "I need to investigate the issue and find the root cause",
      deployment: "I need to check prerequisites and deploy the requested resources",
      general: "I need to gather more information to answer this question"
    };

    let thought = thoughtTemplates[analysis.intent] || thoughtTemplates.general;
    
    if (analysis.entities.length > 0) {
      thought += ` specifically for ${analysis.entities.join(', ')}`;
    }

    return thought;
  }

  /**
   * Select appropriate action based on analysis
   */
  private selectAction(
    analysis: { intent: string; entities: string[]; requiredInfo: string[] },
    availableTools: string[],
    context?: any
  ): { tool: string; params: any } {
    // Map intents to preferred tools
    const intentToTools: Record<string, string[]> = {
      cost_analysis: ['azure_cost_analysis', 'azure_consumption_usage'],
      resource_info: ['azure_list_resources', 'azure_get_resource'],
      optimization: ['azure_advisor_recommendations', 'azure_metrics'],
      troubleshooting: ['azure_activity_logs', 'azure_diagnostics'],
      deployment: ['azure_create_resource', 'azure_check_quota']
    };

    const preferredTools = intentToTools[analysis.intent] || [];
    
    // Find first available tool from preferred list
    let selectedTool = preferredTools.find(tool => availableTools.includes(tool));
    
    if (!selectedTool && availableTools.length > 0) {
      // Fallback to first available tool
      selectedTool = availableTools[0];
    }

    // Generate parameters based on entities and context
    const params = this.generateToolParams(selectedTool || '', analysis.entities, context);

    return {
      tool: selectedTool || 'none',
      params
    };
  }

  /**
   * Format tool observation for human readability
   */
  private formatObservation(toolResult: any): string {
    if (typeof toolResult === 'string') {
      return toolResult;
    }

    if (toolResult.error) {
      return `Error: ${toolResult.error}`;
    }

    // Format based on common result patterns
    if (toolResult.tool === 'azure_list_resources' && toolResult.result) {
      const resources = toolResult.result;
      if (Array.isArray(resources)) {
        return `Found ${resources.length} resources`;
      } else if (resources.vms !== undefined) {
        return `Found ${resources.vms || 0} VMs, ${resources.databases || 0} databases, ${resources.storage || 0} storage accounts`;
      }
    }

    if (toolResult.tool === 'azure_cost_analysis' && toolResult.result) {
      const cost = toolResult.result;
      return `Total spend: $${cost.total || 0}, with breakdown: ${JSON.stringify(cost.breakdown || {})}`;
    }

    // Generic formatting
    return `Tool returned: ${JSON.stringify(toolResult.result || toolResult, null, 2)}`;
  }

  /**
   * Generate reflection based on observation
   */
  private generateReflection(toolResult: any, observation: string): string {
    // Analyze if more information is needed
    if (toolResult.error) {
      return "I encountered an error and may need to try a different approach";
    }

    if (this.isInsufficientData(toolResult)) {
      return "The data seems incomplete. I should gather more information";
    }

    if (this.hasActionableInsights(toolResult)) {
      return "I have found actionable insights that I can use to help the user";
    }

    return "I have gathered useful information and can proceed with the analysis";
  }

  /**
   * Helper methods
   */
  private extractEntities(message: string): string[] {
    // Simple entity extraction - in production, use NER
    const patterns = [
      /vm[s]?/gi,
      /database[s]?/gi,
      /storage/gi,
      /network/gi,
      /[A-Z][a-z]+(?:[A-Z][a-z]+)*/g // CamelCase words
    ];

    const entities = new Set<string>();
    
    patterns.forEach(pattern => {
      const matches = message.match(pattern);
      if (matches) {
        matches.forEach(m => entities.add(m.toLowerCase()));
      }
    });

    return Array.from(entities);
  }

  private getRequiredInfoForIntent(intent: string): string[] {
    const requirements: Record<string, string[]> = {
      cost_analysis: ['current_costs', 'cost_breakdown', 'trends'],
      resource_info: ['resource_list', 'resource_details', 'configuration'],
      optimization: ['current_usage', 'recommendations', 'potential_savings'],
      troubleshooting: ['error_logs', 'metrics', 'recent_changes'],
      deployment: ['quotas', 'dependencies', 'configuration']
    };

    return requirements[intent] || ['general_information'];
  }

  private generateToolParams(tool: string, entities: string[], context?: any): any {
    // Generate appropriate parameters based on tool and entities
    const params: any = {};

    if (entities.includes('vm') || entities.includes('vms')) {
      params.resourceType = 'Microsoft.Compute/virtualMachines';
    }

    if (entities.includes('database') || entities.includes('databases')) {
      params.resourceType = 'Microsoft.Sql/servers/databases';
    }

    if (context?.timeRange) {
      params.timeRange = context.timeRange;
    }

    return params;
  }

  private isInsufficientData(result: any): boolean {
    if (!result || !result.result) return true;
    if (Array.isArray(result.result) && result.result.length === 0) return true;
    if (typeof result.result === 'object' && Object.keys(result.result).length === 0) return true;
    return false;
  }

  private hasActionableInsights(result: any): boolean {
    if (!result || !result.result) return false;
    
    // Check for specific actionable data
    if (result.tool === 'azure_advisor_recommendations') return true;
    if (result.tool === 'azure_cost_analysis' && result.result.recommendations) return true;
    
    return false;
  }

  private updateHistorySummary(history: ReActHistory): void {
    history.summary = this.generateHistorySummary(history);
  }

  private generateHistorySummary(history: ReActHistory): string {
    if (history.steps.length === 0) return "No steps taken yet";
    
    const thoughts = history.steps.map(s => s.thought).join('; ');
    const tools = [...new Set(history.steps.map(s => s.action.tool))].join(', ');
    
    return `Analyzed: ${thoughts}. Used tools: ${tools}`;
  }
}