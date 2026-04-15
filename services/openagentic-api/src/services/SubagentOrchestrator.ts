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
 * @deprecated Use openagentic-proxy /api/orchestrate instead.
 * This class duplicates openagentic-proxy functionality without security,
 * cost tracking, or loop detection. Retained for reference only.
 */

/**
 * Subagent Orchestrator Service
 *
 * Enables concurrent execution of subtasks for complex requests.
 * Each subagent has its own LLM reasoning loop (ReAct pattern).
 *
 * Use Cases:
 * 1. M&A Due Diligence - Parallel analysis across financial, legal, technical domains
 * 2. Multi-Cloud Deployments - Concurrent AWS/Azure/GCP operations
 * 3. Research Tasks - Parallel web searches and document analysis
 *
 * Architecture:
 * - Detects parallelizable subtasks from user request
 * - Each subagent gets its own LLM + tools (ReAct loop)
 * - Spawns concurrent subagent executions
 * - Synthesizes results into unified response
 *
 * THE BRAIN: Each subagent runs its own LLM loop:
 *   1. LLM receives domain-specific system prompt + task
 *   2. LLM decides which tools to call
 *   3. Tools execute via MCP Proxy
 *   4. Results fed back to LLM
 *   5. LLM continues or completes
 */

import type { Logger } from 'pino';
import { executeParallel, type ParallelTask } from '../utils/parallel-executor.js';
import type { CompletionRequest, CompletionResponse } from './llm-providers/ILLMProvider.js';

// ============================================================================
// Types
// ============================================================================

export interface SubagentTask {
  id: string;
  name: string;
  description: string;
  domain: string;           // e.g., 'aws', 'azure', 'financial', 'legal'
  mcpServer?: string;       // MCP server to use (if any)
  tools: string[];          // Tools required for this subtask
  toolDefinitions?: any[];  // Full tool definitions for LLM
  prompt: string;           // Subtask-specific prompt
  dependsOn?: string[];     // IDs of tasks this depends on
  priority: number;         // 1=highest, lower runs first if dependencies exist
  timeoutMs?: number;       // Optional timeout
  maxIterations?: number;   // Max ReAct loops (default: 5)
}

export interface SubagentResult {
  taskId: string;
  taskName: string;
  domain: string;
  success: boolean;
  result?: any;
  error?: string;
  toolsUsed: string[];
  iterations: number;       // How many ReAct loops
  durationMs: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  reasoning?: string[];     // Chain of thought from the subagent
}

export interface OrchestrationPlan {
  originalRequest: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  parallelizable: boolean;
  subtasks: SubagentTask[];
  executionGroups: SubagentTask[][]; // Tasks grouped by dependency level
  estimatedDurationMs: number;
  estimatedCost: number;
}

export interface OrchestrationResult {
  plan: OrchestrationPlan;
  results: SubagentResult[];
  synthesis: string;
  totalDurationMs: number;
  parallelSpeedup: number;
}

// SSE Event types for real-time UI updates
export type OrchestratorEventType =
  | 'orchestration_started'
  | 'subagent_started'
  | 'subagent_tool_call'
  | 'subagent_reasoning'
  | 'subagent_completed'
  | 'orchestration_synthesizing'
  | 'orchestration_completed';

export interface OrchestratorEvent {
  type: OrchestratorEventType;
  timestamp: string;
  data: any;
}

// Callback for emitting SSE events
export type EventEmitter = (event: OrchestratorEvent) => void;

// MCP Proxy interface
export interface MCPProxyClient {
  callTool(server: string, tool: string, args: Record<string, any>): Promise<any>;
  getAvailableTools(server?: string): Promise<string[]>;
}

// LLM Provider interface (simplified for subagent use)
// Note: createCompletion may return AsyncGenerator for streaming, but subagents use non-streaming mode
export interface LLMClient {
  createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>>;
}

// ============================================================================
// Domain Configurations
// ============================================================================

const DOMAIN_CONFIGS: Record<string, {
  mcpServer: string;
  defaultTools: string[];
  keywords: string[];
  systemPrompt: string;
  model?: string;  // Preferred model for this domain
}> = {
  aws: {
    mcpServer: 'oap-aws-mcp',
    defaultTools: ['aws_list_ec2', 'aws_describe_instance', 'aws_create_instance', 'aws_get_costs'],
    keywords: ['aws', 'amazon', 'ec2', 's3', 'lambda', 'dynamodb', 'cloudformation'],
    systemPrompt: `You are an AWS infrastructure specialist subagent. Your role is to:
- Analyze AWS resources, costs, and configurations
- Execute AWS operations when requested
- Provide recommendations based on AWS best practices
- Focus ONLY on AWS-specific aspects of the request

Use the available AWS MCP tools to gather information and perform actions.
Be concise and factual. Complete your analysis in 2-3 tool calls if possible.`
  },
  azure: {
    mcpServer: 'oap-azure-mcp',
    defaultTools: ['azure_list_resources', 'azure_create_vm', 'azure_cost_analysis', 'azure_advisor_recommendations'],
    keywords: ['azure', 'microsoft', 'arm', 'blob', 'cosmos', 'aks'],
    systemPrompt: `You are an Azure infrastructure specialist subagent. Your role is to:
- Analyze Azure resources, costs, and configurations
- Execute Azure operations when requested
- Provide recommendations based on Azure best practices
- Focus ONLY on Azure-specific aspects of the request

Use the available Azure MCP tools to gather information and perform actions.
Be concise and factual. Complete your analysis in 2-3 tool calls if possible.`
  },
  gcp: {
    mcpServer: 'oap-gcp-mcp',
    defaultTools: ['gcp_list_instances', 'gcp_create_instance', 'gcp_get_billing'],
    keywords: ['gcp', 'google cloud', 'gce', 'gcs', 'bigquery', 'gke'],
    systemPrompt: `You are a Google Cloud Platform specialist subagent. Your role is to:
- Analyze GCP resources, billing, and configurations
- Execute GCP operations when requested
- Provide recommendations based on GCP best practices
- Focus ONLY on GCP-specific aspects of the request

Use the available GCP MCP tools to gather information and perform actions.
Be concise and factual. Complete your analysis in 2-3 tool calls if possible.`
  },
  github: {
    mcpServer: 'oap-github-mcp',
    defaultTools: ['github_search_repos', 'github_get_file', 'github_create_pr'],
    keywords: ['github', 'repository', 'commit', 'pull request', 'pr', 'code review'],
    systemPrompt: `You are a GitHub specialist subagent. Your role is to:
- Search and analyze repositories
- Review code and pull requests
- Create or update pull requests
- Focus ONLY on GitHub-related aspects of the request

Use the available GitHub MCP tools to gather information and perform actions.
Be concise and factual.`
  },
  financial: {
    mcpServer: 'oap-financial-mcp',
    defaultTools: ['analyze_financials', 'get_market_data', 'calculate_ratios'],
    keywords: ['financial', 'revenue', 'profit', 'valuation', 'ebitda', 'cash flow', 'balance sheet'],
    systemPrompt: `You are a financial analysis specialist subagent. Your role is to:
- Analyze financial statements and metrics
- Calculate valuation ratios and financial health indicators
- Identify financial risks and opportunities
- Focus ONLY on financial aspects of the request

Provide quantitative analysis with specific numbers when available.
Be concise and factual.`
  },
  legal: {
    mcpServer: 'oap-legal-mcp',
    defaultTools: ['analyze_contracts', 'check_compliance', 'review_terms'],
    keywords: ['legal', 'contract', 'compliance', 'liability', 'terms', 'agreement', 'lawsuit'],
    systemPrompt: `You are a legal analysis specialist subagent. Your role is to:
- Review contracts and legal documents
- Identify compliance requirements and risks
- Highlight liability concerns
- Focus ONLY on legal aspects of the request

Flag any critical legal issues that require attention.
Be concise and factual.`
  },
  technical: {
    mcpServer: 'oap-openagentic-mcp',
    defaultTools: ['analyze_code', 'security_scan', 'dependency_check'],
    keywords: ['technical', 'code', 'architecture', 'security', 'vulnerability', 'tech stack'],
    systemPrompt: `You are a technical analysis specialist subagent. Your role is to:
- Analyze code quality and architecture
- Identify security vulnerabilities
- Review technical debt and dependencies
- Focus ONLY on technical aspects of the request

Flag any critical technical issues.
Be concise and factual.`
  },
  research: {
    mcpServer: 'oap-research-mcp',
    defaultTools: ['web_search', 'analyze_document', 'summarize'],
    keywords: ['research', 'search', 'find', 'investigate', 'analyze', 'compare'],
    systemPrompt: `You are a research specialist subagent. Your role is to:
- Search for relevant information
- Analyze and compare options
- Summarize findings
- Focus on gathering factual information

Be thorough but concise. Cite sources when possible.`
  }
};

// Patterns that indicate parallelizable requests
const PARALLEL_PATTERNS = [
  /(?:aws|azure|gcp).*(?:and|,|&).*(?:aws|azure|gcp)/i,
  /deploy.*(?:to|on|across).*(?:multiple|all|both)/i,
  /compare.*(?:across|between)/i,
  /benchmark.*(?:all|multiple)/i,
  /(?:financial|legal|technical).*(?:and|,|&).*(?:financial|legal|technical)/i,
  /due diligence/i,
  /comprehensive.*(?:analysis|review|audit)/i,
  /holistic.*(?:view|assessment)/i,
  /simultaneously/i,
  /in parallel/i,
  /at the same time/i,
  /concurrently/i
];

// ============================================================================
// Main Service
// ============================================================================

export class SubagentOrchestrator {
  private logger: Logger;
  private mcpProxy?: MCPProxyClient;
  private llmClient?: LLMClient;
  private defaultModel: string;
  private emitEvent?: EventEmitter;

  constructor(
    logger: Logger,
    mcpProxy?: MCPProxyClient,
    llmClient?: LLMClient,
    emitEvent?: EventEmitter
  ) {
    this.logger = logger;
    this.mcpProxy = mcpProxy;
    this.llmClient = llmClient;
    this.emitEvent = emitEvent;
    // Model must be configured via environment - no hardcoded fallbacks
    this.defaultModel = process.env.VERTEX_AI_CHAT_MODEL || process.env.DEFAULT_MODEL || process.env.VERTEX_DEFAULT_MODEL;
    if (!this.defaultModel) {
      throw new Error('No default model configured. Set VERTEX_AI_CHAT_MODEL, DEFAULT_MODEL, or VERTEX_DEFAULT_MODEL in environment.');
    }
  }

  /**
   * Emit an SSE event for UI updates
   */
  private emit(type: OrchestratorEventType, data: any): void {
    if (this.emitEvent) {
      this.emitEvent({
        type,
        timestamp: new Date().toISOString(),
        data
      });
    }
  }

  /**
   * Analyze a request and create an execution plan
   */
  async createPlan(userRequest: string, availableTools?: string[]): Promise<OrchestrationPlan> {
    const startTime = Date.now();

    this.logger.info({ request: userRequest.substring(0, 100) }, '[Orchestrator] Creating execution plan');

    const detectedDomains = this.detectDomains(userRequest);
    const parallelizable = this.isParallelizable(userRequest, detectedDomains);
    const subtasks = await this.decomposeIntoSubtasks(userRequest, detectedDomains, availableTools);
    const executionGroups = this.groupByDependencies(subtasks);
    const complexity = this.estimateComplexity(subtasks);
    const estimatedDurationMs = this.estimateParallelDuration(executionGroups);

    const plan: OrchestrationPlan = {
      originalRequest: userRequest,
      complexity,
      parallelizable,
      subtasks,
      executionGroups,
      estimatedDurationMs,
      estimatedCost: this.estimateCost(subtasks)
    };

    this.logger.info({
      domains: detectedDomains,
      subtaskCount: subtasks.length,
      parallelizable,
      complexity,
      planningDurationMs: Date.now() - startTime
    }, '[Orchestrator] Plan created');

    return plan;
  }

  /**
   * Execute an orchestration plan with concurrent subagents
   * Each subagent runs its own LLM ReAct loop
   */
  async execute(plan: OrchestrationPlan): Promise<OrchestrationResult> {
    const startTime = Date.now();

    this.logger.info({
      subtasks: plan.subtasks.length,
      groups: plan.executionGroups.length,
      parallelizable: plan.parallelizable
    }, '[Orchestrator] Starting execution with LLM subagents');

    // Emit orchestration started event
    this.emit('orchestration_started', {
      subtaskCount: plan.subtasks.length,
      domains: [...new Set(plan.subtasks.map(t => t.domain))],
      parallelizable: plan.parallelizable,
      complexity: plan.complexity,
      estimatedDurationMs: plan.estimatedDurationMs
    });

    let results: SubagentResult[] = [];

    if (plan.parallelizable && plan.executionGroups.length > 0) {
      results = await this.executeWithDependencyGroups(plan.executionGroups);
    } else {
      results = await this.executeSequentially(plan.subtasks);
    }

    const totalDurationMs = Date.now() - startTime;
    const sequentialDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
    const parallelSpeedup = sequentialDuration / Math.max(totalDurationMs, 1);

    // Emit synthesizing event
    this.emit('orchestration_synthesizing', {
      completedSubagents: results.length,
      successCount: results.filter(r => r.success).length
    });

    // Synthesize using LLM
    const synthesis = await this.synthesizeResults(plan.originalRequest, results);

    const orchestrationResult: OrchestrationResult = {
      plan,
      results,
      synthesis,
      totalDurationMs,
      parallelSpeedup
    };

    this.logger.info({
      totalDurationMs,
      parallelSpeedup: parallelSpeedup.toFixed(2),
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      totalIterations: results.reduce((sum, r) => sum + r.iterations, 0)
    }, '[Orchestrator] Execution completed');

    // Emit orchestration completed event
    this.emit('orchestration_completed', {
      totalDurationMs,
      parallelSpeedup,
      subtaskCount: results.length,
      successCount: results.filter(r => r.success).length,
      failureCount: results.filter(r => !r.success).length,
      totalIterations: results.reduce((sum, r) => sum + r.iterations, 0),
      synthesisLength: synthesis.length
    });

    return orchestrationResult;
  }

  /**
   * Convenience method to plan and execute in one call
   */
  async orchestrate(userRequest: string, availableTools?: string[]): Promise<OrchestrationResult> {
    const plan = await this.createPlan(userRequest, availableTools);
    return this.execute(plan);
  }

  // ============================================================================
  // THE BRAIN - LLM ReAct Loop for Each Subagent
  // ============================================================================

  /**
   * Run a subagent with its own LLM reasoning loop
   * This is THE BRAIN that decides what each subagent does
   */
  private async runSubagentReActLoop(
    task: SubagentTask,
    previousResults: Map<string, SubagentResult>
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    const reasoning: string[] = [];
    const maxIterations = task.maxIterations || 5;
    let iterations = 0;
    let totalTokens = { input: 0, output: 0, total: 0 };

    this.logger.info({
      taskId: task.id,
      domain: task.domain,
      maxIterations
    }, '[Subagent] Starting ReAct loop');

    // Emit subagent started event
    this.emit('subagent_started', {
      taskId: task.id,
      taskName: task.name,
      domain: task.domain,
      mcpServer: task.mcpServer,
      tools: task.tools,
      maxIterations
    });

    // If no LLM client, fall back to direct tool execution
    if (!this.llmClient) {
      return this.executeSubtaskWithoutLLM(task, previousResults);
    }

    try {
      // Get domain-specific system prompt
      const domainConfig = DOMAIN_CONFIGS[task.domain];
      const systemPrompt = domainConfig?.systemPrompt ||
        `You are a helpful assistant focused on ${task.domain} analysis.`;

      // Build tool definitions for LLM
      const toolDefinitions = this.buildToolDefinitions(task);

      // Initialize conversation
      const messages: CompletionRequest['messages'] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task.prompt }
      ];

      let finalContent = '';
      let isComplete = false;

      // ReAct Loop - LLM reasons and acts until done
      while (!isComplete && iterations < maxIterations) {
        iterations++;

        this.logger.debug({
          taskId: task.id,
          iteration: iterations,
          messageCount: messages.length
        }, '[Subagent] ReAct iteration');

        // Call LLM (non-streaming, so cast to CompletionResponse)
        const response = await this.llmClient.createCompletion({
          messages,
          model: domainConfig?.model || this.defaultModel,
          tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
          max_tokens: 2000,
          temperature: 0.3,  // Lower temperature for more focused execution
          stream: false
        }) as CompletionResponse;

        // Track tokens
        if (response.usage) {
          totalTokens.input += response.usage.prompt_tokens;
          totalTokens.output += response.usage.completion_tokens;
          totalTokens.total += response.usage.total_tokens;
        }

        const choice = response.choices[0];
        const assistantMessage = choice.message;

        // Check if LLM wants to call tools
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: assistantMessage.tool_calls
          });

          // Execute each tool call
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              toolArgs = {};
            }

            reasoning.push(`Calling ${toolName} with ${JSON.stringify(toolArgs)}`);

            // Emit tool call event
            this.emit('subagent_tool_call', {
              taskId: task.id,
              taskName: task.name,
              domain: task.domain,
              iteration: iterations,
              toolName,
              toolArgs,
              status: 'calling'
            });

            // Execute tool via MCP Proxy
            let toolResult: any;
            try {
              if (this.mcpProxy && task.mcpServer) {
                toolResult = await this.mcpProxy.callTool(
                  task.mcpServer,
                  toolName,
                  toolArgs
                );
                toolsUsed.push(toolName);
              } else {
                toolResult = { error: 'MCP Proxy not available' };
              }
            } catch (error: any) {
              toolResult = { error: error.message };
            }

            // Add tool result to conversation
            messages.push({
              role: 'tool',
              content: JSON.stringify(toolResult),
              tool_call_id: toolCall.id
            });

            // Emit tool result event
            this.emit('subagent_tool_call', {
              taskId: task.id,
              taskName: task.name,
              domain: task.domain,
              iteration: iterations,
              toolName,
              status: 'completed',
              resultPreview: JSON.stringify(toolResult).substring(0, 200)
            });

            reasoning.push(`${toolName} returned: ${JSON.stringify(toolResult).substring(0, 200)}...`);
          }
        } else {
          // No tool calls - LLM is done reasoning
          finalContent = assistantMessage.content || '';
          isComplete = true;
          reasoning.push(`Final response: ${finalContent.substring(0, 200)}...`);

          // Emit reasoning event
          this.emit('subagent_reasoning', {
            taskId: task.id,
            taskName: task.name,
            domain: task.domain,
            iteration: iterations,
            contentPreview: finalContent.substring(0, 300),
            isComplete: true
          });
        }

        // Check finish reason
        if (choice.finish_reason === 'stop' && !assistantMessage.tool_calls) {
          isComplete = true;
        }
      }

      // If we hit max iterations, ask LLM for final summary
      if (!isComplete) {
        messages.push({
          role: 'user',
          content: 'Please provide your final analysis based on the information gathered so far.'
        });

        const finalResponse = await this.llmClient.createCompletion({
          messages,
          model: domainConfig?.model || this.defaultModel,
          max_tokens: 1000,
          stream: false
        }) as CompletionResponse;

        finalContent = finalResponse.choices[0]?.message?.content || 'Analysis incomplete';

        if (finalResponse.usage) {
          totalTokens.input += finalResponse.usage.prompt_tokens;
          totalTokens.output += finalResponse.usage.completion_tokens;
          totalTokens.total += finalResponse.usage.total_tokens;
        }
      }

      const result: SubagentResult = {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: true,
        result: finalContent,
        toolsUsed,
        iterations,
        durationMs: Date.now() - startTime,
        tokenUsage: totalTokens,
        reasoning
      };

      // Emit subagent completed event
      this.emit('subagent_completed', {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: true,
        iterations,
        durationMs: result.durationMs,
        toolsUsed,
        resultPreview: finalContent.substring(0, 300)
      });

      return result;

    } catch (error: any) {
      this.logger.error({
        taskId: task.id,
        error: error.message,
        iterations
      }, '[Subagent] ReAct loop failed');

      const durationMs = Date.now() - startTime;

      // Emit subagent completed event (failure)
      this.emit('subagent_completed', {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: false,
        error: error.message,
        iterations,
        durationMs,
        toolsUsed
      });

      return {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: false,
        error: error.message,
        toolsUsed,
        iterations,
        durationMs,
        reasoning
      };
    }
  }

  /**
   * Build OpenAI-compatible tool definitions for LLM
   */
  private buildToolDefinitions(task: SubagentTask): any[] {
    if (task.toolDefinitions) {
      return task.toolDefinitions;
    }

    // Build simple tool definitions from tool names
    return task.tools.map(toolName => ({
      type: 'function',
      function: {
        name: toolName,
        description: `Execute the ${toolName} tool`,
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: true
        }
      }
    }));
  }

  /**
   * Fallback: Execute subtask without LLM (just call tools directly)
   */
  private async executeSubtaskWithoutLLM(
    task: SubagentTask,
    previousResults: Map<string, SubagentResult>
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];

    this.logger.debug({
      taskId: task.id,
      domain: task.domain,
      mcpServer: task.mcpServer
    }, '[Subagent] Executing without LLM (fallback mode)');

    try {
      let result: any;

      if (task.domain === 'synthesis') {
        result = await this.performSynthesis(task, previousResults);
      } else if (task.mcpServer && this.mcpProxy) {
        result = await this.executeMCPTask(task, toolsUsed);
      } else {
        result = {
          message: `Would execute: ${task.name}`,
          tools: task.tools,
          prompt: task.prompt
        };
      }

      return {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: true,
        result,
        toolsUsed,
        iterations: 1,
        durationMs: Date.now() - startTime
      };

    } catch (error: any) {
      return {
        taskId: task.id,
        taskName: task.name,
        domain: task.domain,
        success: false,
        error: error.message,
        toolsUsed,
        iterations: 1,
        durationMs: Date.now() - startTime
      };
    }
  }

  // ============================================================================
  // Private Methods - Detection & Decomposition
  // ============================================================================

  private detectDomains(request: string): string[] {
    const detected: string[] = [];
    const lowerRequest = request.toLowerCase();

    for (const [domain, config] of Object.entries(DOMAIN_CONFIGS)) {
      if (config.keywords.some(keyword => lowerRequest.includes(keyword))) {
        detected.push(domain);
      }
    }

    return detected;
  }

  private isParallelizable(request: string, domains: string[]): boolean {
    if (domains.length >= 2) {
      return true;
    }
    return PARALLEL_PATTERNS.some(pattern => pattern.test(request));
  }

  private async decomposeIntoSubtasks(
    request: string,
    domains: string[],
    availableTools?: string[]
  ): Promise<SubagentTask[]> {
    const subtasks: SubagentTask[] = [];

    if (domains.length === 0) {
      subtasks.push({
        id: 'task-0',
        name: 'General Analysis',
        description: 'Process the request',
        domain: 'general',
        tools: availableTools || [],
        prompt: request,
        priority: 1,
        maxIterations: 5
      });
      return subtasks;
    }

    for (const [index, domain] of domains.entries()) {
      const config = DOMAIN_CONFIGS[domain];
      const domainPrompt = this.createDomainPrompt(request, domain);

      subtasks.push({
        id: `task-${index}`,
        name: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Analysis`,
        description: `Analyze ${domain} aspects of the request`,
        domain,
        mcpServer: config?.mcpServer,
        tools: config?.defaultTools || [],
        prompt: domainPrompt,
        priority: 1,
        maxIterations: 5,
        timeoutMs: 120000 // 2 minute timeout per subtask
      });
    }

    // Add synthesis task if multiple domains
    if (subtasks.length > 1) {
      subtasks.push({
        id: 'task-synthesis',
        name: 'Synthesize Results',
        description: 'Combine all domain results',
        domain: 'synthesis',
        tools: [],
        prompt: 'Synthesize the results from all parallel analyses',
        dependsOn: subtasks.map(t => t.id),
        priority: 2,
        maxIterations: 1
      });
    }

    return subtasks;
  }

  private createDomainPrompt(originalRequest: string, domain: string): string {
    const config = DOMAIN_CONFIGS[domain];
    if (config) {
      return `Analyze the following request, focusing ONLY on ${domain.toUpperCase()} aspects:\n\n${originalRequest}\n\nUse the available tools to gather information and provide a comprehensive ${domain} analysis.`;
    }
    return `Analyze the following request from the ${domain} perspective:\n\n${originalRequest}`;
  }

  private groupByDependencies(subtasks: SubagentTask[]): SubagentTask[][] {
    const groups: SubagentTask[][] = [];
    const completed = new Set<string>();
    const remaining = [...subtasks];

    while (remaining.length > 0) {
      const canRun = remaining.filter(task =>
        !task.dependsOn || task.dependsOn.every(dep => completed.has(dep))
      );

      if (canRun.length === 0) {
        this.logger.warn({ remaining: remaining.map(t => t.id) },
          '[Orchestrator] Could not resolve dependencies');
        groups.push(remaining);
        break;
      }

      groups.push(canRun);
      canRun.forEach(task => {
        completed.add(task.id);
        const idx = remaining.findIndex(t => t.id === task.id);
        if (idx >= 0) remaining.splice(idx, 1);
      });
    }

    return groups;
  }

  private estimateComplexity(subtasks: SubagentTask[]): 'simple' | 'moderate' | 'complex' | 'expert' {
    const taskCount = subtasks.length;
    const domains = new Set(subtasks.map(t => t.domain)).size;
    const toolCount = subtasks.reduce((sum, t) => sum + t.tools.length, 0);

    if (taskCount <= 1 && toolCount <= 2) return 'simple';
    if (taskCount <= 3 && domains <= 2) return 'moderate';
    if (taskCount <= 6 && domains <= 4) return 'complex';
    return 'expert';
  }

  private estimateParallelDuration(groups: SubagentTask[][]): number {
    const baseTimePerTask = 10000; // 10 seconds with LLM
    let totalMs = 0;
    for (const group of groups) {
      const groupMaxTime = Math.max(...group.map(t => t.timeoutMs || baseTimePerTask));
      totalMs += groupMaxTime;
    }
    return totalMs;
  }

  private estimateCost(subtasks: SubagentTask[]): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }

  // ============================================================================
  // Private Methods - Execution
  // ============================================================================

  private async executeWithDependencyGroups(groups: SubagentTask[][]): Promise<SubagentResult[]> {
    const allResults: SubagentResult[] = [];
    const previousResults: Map<string, SubagentResult> = new Map();

    for (const [groupIndex, group] of groups.entries()) {
      this.logger.debug({
        group: groupIndex + 1,
        tasks: group.map(t => t.name)
      }, '[Orchestrator] Executing parallel group');

      const parallelTasks: ParallelTask<SubagentResult>[] = group.map(subtask => ({
        name: subtask.name,
        timeout: subtask.timeoutMs,
        execute: async () => this.runSubagentReActLoop(subtask, previousResults)
      }));

      const results = await executeParallel(parallelTasks, this.logger);

      for (const result of results) {
        if (result.success && result.result) {
          allResults.push(result.result);
          previousResults.set(result.result.taskId, result.result);
        } else if (result.error) {
          const task = group.find(t => t.name === result.name);
          allResults.push({
            taskId: task?.id || 'unknown',
            taskName: result.name,
            domain: task?.domain || 'unknown',
            success: false,
            error: result.error.message || 'Unknown error',
            toolsUsed: [],
            iterations: 0,
            durationMs: result.duration
          });
        }
      }
    }

    return allResults;
  }

  private async executeSequentially(subtasks: SubagentTask[]): Promise<SubagentResult[]> {
    const results: SubagentResult[] = [];
    const previousResults: Map<string, SubagentResult> = new Map();

    for (const subtask of subtasks) {
      const result = await this.runSubagentReActLoop(subtask, previousResults);
      results.push(result);
      previousResults.set(result.taskId, result);
    }

    return results;
  }

  private async executeMCPTask(task: SubagentTask, toolsUsed: string[]): Promise<any> {
    if (!this.mcpProxy || !task.mcpServer) {
      throw new Error('MCP proxy not configured');
    }

    const results: any[] = [];

    for (const tool of task.tools.slice(0, 3)) {
      try {
        const result = await this.mcpProxy.callTool(
          task.mcpServer,
          tool,
          { prompt: task.prompt }
        );
        results.push({ tool, result });
        toolsUsed.push(tool);
      } catch (error: any) {
        results.push({ tool, error: error.message });
      }
    }

    return {
      domain: task.domain,
      prompt: task.prompt,
      toolResults: results
    };
  }

  private async performSynthesis(
    task: SubagentTask,
    previousResults: Map<string, SubagentResult>
  ): Promise<any> {
    const successfulResults = Array.from(previousResults.values())
      .filter(r => r.success)
      .map(r => ({
        domain: r.domain,
        result: r.result,
        toolsUsed: r.toolsUsed
      }));

    // If LLM is available, use it for synthesis
    if (this.llmClient && successfulResults.length > 0) {
      const synthesisPrompt = `You are synthesizing results from multiple parallel analyses.

Results from each domain:
${successfulResults.map(r => `\n## ${r.domain.toUpperCase()}\n${JSON.stringify(r.result, null, 2)}`).join('\n')}

Please provide a unified executive summary that:
1. Highlights key findings from each domain
2. Identifies cross-domain insights and connections
3. Provides actionable recommendations
4. Notes any conflicts or areas needing attention`;

      try {
        const response = await this.llmClient.createCompletion({
          messages: [
            { role: 'system', content: 'You are an expert analyst synthesizing multi-domain analysis results.' },
            { role: 'user', content: synthesisPrompt }
          ],
          model: this.defaultModel,
          max_tokens: 2000,
          stream: false
        }) as CompletionResponse;

        return {
          synthesized: true,
          summary: response.choices[0]?.message?.content || 'Synthesis failed',
          domains: successfulResults.map(r => r.domain)
        };
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[Orchestrator] LLM synthesis failed, using fallback');
      }
    }

    // Fallback: simple combination
    return {
      synthesized: true,
      inputCount: successfulResults.length,
      domains: successfulResults.map(r => r.domain),
      combinedResults: successfulResults
    };
  }

  // ============================================================================
  // Private Methods - Synthesis
  // ============================================================================

  private async synthesizeResults(
    originalRequest: string,
    results: SubagentResult[]
  ): Promise<string> {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    // Try LLM-powered synthesis
    if (this.llmClient && successfulResults.length > 0) {
      try {
        const synthesisPrompt = `Original request: "${originalRequest}"

Results from ${successfulResults.length} parallel subagent analyses:
${successfulResults.map(r => `
### ${r.taskName} (${r.domain})
${typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2)}
Tools used: ${r.toolsUsed.join(', ') || 'None'}
`).join('\n')}
${failedResults.length > 0 ? `\nFailed analyses: ${failedResults.map(r => r.taskName).join(', ')}` : ''}

Provide a comprehensive synthesis that directly addresses the original request.`;

        const response = await this.llmClient.createCompletion({
          messages: [
            { role: 'system', content: 'You are synthesizing results from multiple parallel analyses into a coherent response.' },
            { role: 'user', content: synthesisPrompt }
          ],
          model: this.defaultModel,
          max_tokens: 2000,
          stream: false
        }) as CompletionResponse;

        return response.choices[0]?.message?.content || this.fallbackSynthesis(successfulResults, failedResults);
      } catch (error: any) {
        this.logger.warn({ error: error.message }, '[Orchestrator] LLM synthesis failed');
      }
    }

    return this.fallbackSynthesis(successfulResults, failedResults);
  }

  private fallbackSynthesis(
    successfulResults: SubagentResult[],
    failedResults: SubagentResult[]
  ): string {
    let synthesis = `## Analysis Results\n\n`;
    synthesis += `Analyzed ${successfulResults.length} domains in parallel.\n\n`;

    for (const result of successfulResults) {
      synthesis += `### ${result.taskName}\n`;
      synthesis += `- Domain: ${result.domain}\n`;
      synthesis += `- Duration: ${result.durationMs}ms (${result.iterations} iterations)\n`;
      synthesis += `- Tools used: ${result.toolsUsed.join(', ') || 'None'}\n`;
      if (result.result) {
        const preview = typeof result.result === 'string'
          ? result.result.substring(0, 300)
          : JSON.stringify(result.result).substring(0, 300);
        synthesis += `- Summary: ${preview}...\n`;
      }
      synthesis += '\n';
    }

    if (failedResults.length > 0) {
      synthesis += `### Failed Analyses\n`;
      for (const result of failedResults) {
        synthesis += `- ${result.taskName}: ${result.error}\n`;
      }
    }

    return synthesis;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSubagentOrchestrator(
  logger: Logger,
  mcpProxy?: MCPProxyClient,
  llmClient?: LLMClient,
  emitEvent?: EventEmitter
): SubagentOrchestrator {
  return new SubagentOrchestrator(logger, mcpProxy, llmClient, emitEvent);
}
