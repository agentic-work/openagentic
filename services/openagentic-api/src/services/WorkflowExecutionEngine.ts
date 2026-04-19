/**
 * WorkflowExecutionEngine
 *
 * Executes workflow graphs by traversing nodes and edges.
 * Supports: LLM completion, MCP tools, code execution, conditions, loops, transforms, merges.
 *
 * This is the core engine that powers OpenAgenticflows.
 */

import { EventEmitter } from 'events';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { MODELS } from '../config/models.js';
import axios from 'axios';

const logger = loggers.services;

// =============================================================================
// Types
// =============================================================================

export interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, any>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ExecutionContext {
  executionId: string;
  workflowId: string;
  userId: string;
  authToken?: string;
  /** Azure AD ID token for AWS/Azure OBO federation */
  idToken?: string;
  /** User email for MCP workspace isolation */
  userEmail?: string;
  input: Record<string, any>;
  variables: Map<string, any>;
  nodeResults: Map<string, any>;
  startTime: number;
  agenticExecutionId?: string;
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeType: string;
  status: 'success' | 'error' | 'skipped';
  output: any;
  error?: string;
  executionTimeMs: number;
}

export interface ExecutionEvent {
  type: 'execution_start' | 'node_start' | 'node_complete' | 'node_error' | 'node_stream' | 'node_retry' | 'node_fallback' | 'execution_complete' | 'execution_error' | 'approval_required' | 'approval_received' | 'execution_paused' | 'execution_resumed';
  executionId: string;
  nodeId?: string;
  nodeType?: string;
  data?: any;
  timestamp: string;
}

export interface ApprovalConfig {
  approvers: string[];           // User IDs or group names
  requiredCount?: number;        // Number of approvals needed (default: 1)
  timeout?: number;              // Timeout in seconds (default: 86400 = 24 hours)
  timeoutAction?: 'approve' | 'reject' | 'escalate';
  escalateTo?: string[];         // User IDs to escalate to on timeout
  message?: string;              // Message to show approvers
  notificationChannels?: ('email' | 'slack' | 'teams' | 'in_app')[];
}

export interface RetryConfig {
  maxRetries: number;            // Maximum retry attempts (default: 3)
  initialDelay: number;          // Initial delay in ms (default: 1000)
  maxDelay: number;              // Maximum delay in ms (default: 30000)
  backoffMultiplier: number;     // Exponential backoff multiplier (default: 2)
  retryOn?: string[];            // Error patterns to retry on (default: all errors)
  skipOn?: string[];             // Error patterns to NOT retry on
}

export interface FallbackConfig {
  fallbackNodeId?: string;       // Node to execute on failure
  fallbackValue?: any;           // Static value to return on failure
  continueOnFailure?: boolean;   // Continue workflow even if node fails
  propagateError?: boolean;      // Include error info in output
}

export interface ErrorRecoveryConfig {
  retry?: RetryConfig;
  fallback?: FallbackConfig;
  circuitBreaker?: {
    failureThreshold: number;    // Failures before opening circuit (default: 5)
    resetTimeout: number;        // Time to reset circuit in ms (default: 60000)
  };
}

export interface ApprovalResult {
  status: 'approved' | 'rejected' | 'timeout' | 'escalated';
  approvedBy?: string[];
  rejectedBy?: string;
  message?: string;
}

// =============================================================================
// WorkflowExecutionEngine
// =============================================================================

// Lazy import for AgentRegistry (avoids circular dependencies, same pattern as SynthService)
let _agentRegistryModule: typeof import('./AgentRegistry.js') | null = null;
async function getAgentRegistryLazy() {
  try {
    if (!_agentRegistryModule) {
      _agentRegistryModule = await import('./AgentRegistry.js');
    }
    return _agentRegistryModule.getAgentRegistry();
  } catch {
    return null;
  }
}

// Circuit breaker state tracking (shared across executions)
const circuitBreakerState: Map<string, {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}> = new Map();

export class WorkflowExecutionEngine extends EventEmitter {
  private context: ExecutionContext;
  private definition: WorkflowDefinition;
  private nodeMap: Map<string, WorkflowNode>;
  private incomingEdges: Map<string, WorkflowEdge[]>;
  private outgoingEdges: Map<string, WorkflowEdge[]>;
  private mcpProxyUrl: string;
  private apiUrl: string;
  private openagenticManagerUrl: string;
  private nodeRetryState: Map<string, number>; // Track retry counts per node
  private abortController: AbortController;
  private pendingNodeOutputs: Map<string, any>; // Accumulated node outputs for batch write

  constructor(
    definition: WorkflowDefinition,
    context: ExecutionContext
  ) {
    super();
    this.definition = definition;
    this.context = context;
    this.nodeMap = new Map();
    this.incomingEdges = new Map();
    this.outgoingEdges = new Map();
    this.abortController = new AbortController();

    // Build lookup maps
    for (const node of definition.nodes) {
      this.nodeMap.set(node.id, node);
      this.incomingEdges.set(node.id, []);
      this.outgoingEdges.set(node.id, []);
    }

    for (const edge of definition.edges) {
      this.incomingEdges.get(edge.target)?.push(edge);
      this.outgoingEdges.get(edge.source)?.push(edge);
    }

    // Get service URLs from environment
    this.mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080';
    this.apiUrl = process.env.API_URL || 'http://localhost:8000';
    this.openagenticManagerUrl = process.env.OPENAGENTIC_MANAGER_URL || 'http://openagentic-code-manager:3050';

    // Initialize retry state tracking
    this.nodeRetryState = new Map();
    this.pendingNodeOutputs = new Map();
  }

  /**
   * Get internal service auth headers for self-calls (LLM endpoint, etc.)
   * Uses INTERNAL_SERVICE_SECRET bypass so workflow LLM calls don't depend on user JWT validity.
   * MCP calls still use the user's auth token for OBO (on-behalf-of) flows.
   */
  private getInternalAuthHeaders(): Record<string, string> {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (secret) {
      return {
        'X-Request-From': 'internal',
        'X-Internal-Secret': secret,
      };
    }
    // Fallback to user's auth token if no internal secret configured
    return this.context.authToken ? { 'Authorization': this.context.authToken } : {};
  }

  /**
   * Execute the workflow
   */
  async execute(): Promise<{ success: boolean; output: any; error?: string }> {
    const { executionId } = this.context;

    this.emitEvent('execution_start', { input: this.context.input });

    // Start AgentRegistry execution tracking (fire-and-forget safe)
    try {
      const registry = await getAgentRegistryLazy();
      if (registry) {
        const agenticExec = await registry.startExecution(
          'tool_orchestration',
          this.context.workflowId,
          this.context.userId
        );
        this.context.agenticExecutionId = agenticExec.executionId;
        logger.debug({
          agenticExecutionId: agenticExec.executionId,
          workflowExecutionId: executionId
        }, '[WorkflowEngine] Agent execution tracking started');
      }
    } catch (err) {
      logger.warn({ err }, '[WorkflowEngine] Failed to start Agent execution tracking (non-fatal)');
    }

    // Load admin workflow settings for config hierarchy
    try {
      const adminConfig = await prisma.systemConfiguration.findFirst({
        where: { key: 'workflow_defaults' }
      });
      if (adminConfig?.value) {
        (this as any).adminSettings = typeof adminConfig.value === 'string'
          ? JSON.parse(adminConfig.value) : adminConfig.value;
      }
    } catch (err) {
      logger.debug({ err }, '[WorkflowEngine] Failed to load admin settings (using defaults)');
    }

    // Load workflow-level settings
    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id: this.context.workflowId },
        select: { settings: true }
      });
      if (workflow?.settings) {
        (this as any).workflowSettings = typeof workflow.settings === 'string'
          ? JSON.parse(workflow.settings as string) : workflow.settings;
      }
    } catch (err) {
      logger.debug({ err }, '[WorkflowEngine] Failed to load workflow settings (using defaults)');
    }

    // Initialize cost tracking accumulator
    (this as any).totalCost = 0;

    try {
      // Pre-load workflow secrets referenced by {{secret:name}} patterns
      try {
        const secretRefs = new Set<string>();
        const secretPattern = /\{\{secret:([^}]+)\}\}/g;
        // Scan all node data for secret references
        for (const node of this.definition.nodes) {
          const nodeStr = JSON.stringify(node.data || {});
          let m: RegExpExecArray | null;
          while ((m = secretPattern.exec(nodeStr)) !== null) {
            secretRefs.add(m[1].trim());
          }
        }
        if (secretRefs.size > 0) {
          const resolvedSecrets = new Map<string, string>();
          // Load secrets from DB and decrypt
          for (const name of secretRefs) {
            try {
              const { workflowSecretService } = await import('./WorkflowSecretService.js');
              const value = await workflowSecretService.resolveSecretValue(name, {
                workflowId: this.context.workflowId,
              });
              if (value) resolvedSecrets.set(name, value);
            } catch (err) {
              logger.warn({ err, secretName: name }, '[WorkflowEngine] Failed to resolve secret');
            }
          }
          (this.context as any).resolvedSecrets = resolvedSecrets;
          logger.debug({ count: resolvedSecrets.size }, '[WorkflowEngine] Pre-loaded workflow secrets');
        }
      } catch (err) {
        logger.warn({ err }, '[WorkflowEngine] Failed to pre-load secrets (non-fatal)');
      }

      // Find trigger nodes (entry points)
      const triggerNodes = this.definition.nodes.filter(n => n.type === 'trigger');

      if (triggerNodes.length === 0) {
        throw new Error('Workflow must have at least one trigger node');
      }

      // Start from trigger nodes
      for (const trigger of triggerNodes) {
        await this.executeNode(trigger.id, this.context.input);
      }

      // Get final output (from nodes with no outgoing edges)
      const terminalNodes = this.definition.nodes.filter(
        n => (this.outgoingEdges.get(n.id)?.length || 0) === 0
      );

      let finalOutput: any = {};
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          finalOutput[node.id] = result;
        }
      }

      // If only one terminal node, unwrap
      if (Object.keys(finalOutput).length === 1) {
        finalOutput = Object.values(finalOutput)[0];
      }

      // Update execution record (includes flushing node_outputs)
      try {
        await this.updateExecutionRecord('completed', finalOutput);
      } catch (dbErr) {
        logger.error({ dbErr }, '[WorkflowEngine] Failed to update execution record');
      }

      // Complete Agent execution tracking on success
      try {
        if (this.context.agenticExecutionId) {
          const registry = await getAgentRegistryLazy();
          if (registry) {
            const executionTimeMs = Date.now() - this.context.startTime;
            const completedNodes = Array.from(this.context.nodeResults.keys()).length;
            await registry.completeExecution(this.context.agenticExecutionId, {
              success: true,
              inputTokens: 0,
              outputTokens: 0,
              resultSize: JSON.stringify(finalOutput || '').length,
              toolCallsInvolved: Array.from(this.context.nodeResults.keys()),
              outputData: { completedNodes, executionTimeMs, output: finalOutput }
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, '[WorkflowEngine] Failed to complete Agent execution tracking (non-fatal)');
      }

      this.emitEvent('execution_complete', { output: finalOutput });

      // Adaptive Memory: ingest workflow execution results
      try {
        const { getUserMemoryService } = await import('./UserMemoryService.js');
        const memService = getUserMemoryService();
        const flowSummary = typeof finalOutput === 'string'
          ? finalOutput.substring(0, 500)
          : JSON.stringify(finalOutput).substring(0, 500);
        memService.ingest(
          this.context.userId,
          'flow',
          this.context.executionId,
          `Workflow "${this.context.workflowId}" completed with ${Array.from(this.context.nodeResults.keys()).length} nodes: ${flowSummary}`,
          0.6,
        ).catch(() => {});
      } catch {
        // Non-critical — adaptive memory not available
      }

      // Artifact detection: ingest significant node outputs individually
      try {
        const { getUserMemoryService: getMemSvc } = await import('./UserMemoryService.js');
        const artifactMemService = getMemSvc();

        for (const [nodeId, result] of this.context.nodeResults.entries()) {
          const node = this.nodeMap.get(nodeId);
          if (!node) continue;

          // Skip trigger nodes and simple pass-through nodes
          if (node.type === 'trigger' || node.type === 'wait' || node.type === 'text') continue;

          const content = typeof result === 'string' ? result : JSON.stringify(result);

          // Only ingest substantial outputs (>100 chars, <10000 chars)
          if (content.length < 100 || content.length > 10000) continue;

          // Determine importance based on node type
          const importance = ['llm_completion', 'openagentic_llm', 'code', 'openagentic'].includes(node.type)
            ? 0.7  // AI-generated content is high value
            : ['mcp_tool', 'http_request'].includes(node.type)
              ? 0.6  // Tool results are medium-high
              : 0.5; // Default

          const artifactSummary = `[Flow artifact] Node "${node.data?.label || nodeId}" (${node.type}) output: ${content.substring(0, 2000)}`;

          artifactMemService.ingest(
            this.context.userId,
            'flow',
            `${this.context.executionId}:${nodeId}`,
            artifactSummary,
            importance,
          ).catch(() => {});
        }
      } catch {
        // Non-critical — artifact ingestion not available
      }

      // Index workflow results into unified context (Phase 16)
      try {
        const { userContextService } = await import('./UserContextService.js');
        const summary = typeof finalOutput === 'string'
          ? finalOutput.substring(0, 1000)
          : JSON.stringify(finalOutput).substring(0, 1000);
        userContextService.indexUserData(this.context.userId, {
          source: 'workflow',
          sourceId: this.context.workflowId,
          content: `Workflow execution ${this.context.executionId} completed: ${summary}`,
          metadata: {
            executionId: this.context.executionId,
            workflowId: this.context.workflowId,
            nodesExecuted: Array.from(this.context.nodeResults.keys()).length,
          },
        }).catch(() => {});
      } catch {
        // Non-critical
      }

      return { success: true, output: finalOutput };

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';

      // Update execution record (includes partial node_outputs)
      try {
        await this.updateExecutionRecord('failed', null, errorMessage);
      } catch (dbErr) {
        logger.error({ dbErr }, '[WorkflowEngine] Failed to update execution record on failure');
      }

      // Complete Agent execution tracking on failure
      try {
        if (this.context.agenticExecutionId) {
          const registry = await getAgentRegistryLazy();
          if (registry) {
            await registry.completeExecution(this.context.agenticExecutionId, {
              success: false,
              inputTokens: 0,
              outputTokens: 0,
              error: errorMessage,
              errorCode: 'WORKFLOW_EXECUTION_FAILED',
              toolCallsInvolved: Array.from(this.context.nodeResults.keys()),
              outputData: { error: errorMessage }
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, '[WorkflowEngine] Failed to record Agent execution failure (non-fatal)');
      }

      this.emitEvent('execution_error', { error: errorMessage });

      return { success: false, output: null, error: errorMessage };
    }
  }

  /**
   * Execute a single node with error recovery (retry + fallback)
   */
  private async executeNode(nodeId: string, input: any): Promise<any> {
    // Check if execution was aborted
    if (this.abortController.signal.aborted) {
      throw new Error('Workflow execution aborted');
    }

    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // Disabled node: skip execution, pass input through
    if (node.data.disabled) {
      this.context.nodeResults.set(nodeId, input);
      this.emitEvent('node_complete', {
        nodeId, nodeType: node.type, output: input,
        executionTimeMs: 0, skipped: true, reason: 'disabled'
      });
      const outgoing = this.outgoingEdges.get(nodeId) || [];
      if (outgoing.length > 1) {
        const branchResults = await Promise.allSettled(
          outgoing.map(edge => this.executeNode(edge.target, input))
        );
        for (const br of branchResults) {
          if (br.status === 'rejected') {
            logger.warn({ nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (disabled passthrough)');
          }
        }
      } else if (outgoing.length === 1) {
        await this.executeNode(outgoing[0].target, input);
      }
      return input;
    }

    // Pinned data: return pinned output without executing
    if (node.data.usePinnedData && node.data.pinnedOutput != null) {
      const pinned = typeof node.data.pinnedOutput === 'string'
        ? JSON.parse(node.data.pinnedOutput)
        : node.data.pinnedOutput;
      this.context.nodeResults.set(nodeId, pinned);
      this.emitEvent('node_complete', {
        nodeId, nodeType: node.type, output: pinned,
        executionTimeMs: 0, skipped: true, reason: 'pinned_data'
      });
      const outgoing = this.outgoingEdges.get(nodeId) || [];
      if (outgoing.length > 1) {
        const branchResults = await Promise.allSettled(
          outgoing.map(edge => this.executeNode(edge.target, pinned))
        );
        for (const br of branchResults) {
          if (br.status === 'rejected') {
            logger.warn({ nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (pinned data)');
          }
        }
      } else if (outgoing.length === 1) {
        await this.executeNode(outgoing[0].target, pinned);
      }
      return pinned;
    }

    // Get error recovery config from node data
    const errorRecovery = node.data.errorRecovery as ErrorRecoveryConfig | undefined;
    const baseRetryConfig = errorRecovery?.retry;
    const fallbackConfig = errorRecovery?.fallback;
    const circuitBreakerConfig = errorRecovery?.circuitBreaker;

    // Merge node.data.retryPolicy with errorRecovery.retry (node.data takes precedence)
    const nodeRetry = node.data.retryPolicy;
    const retryConfig: RetryConfig | undefined = nodeRetry ? {
      maxRetries: nodeRetry.maxRetries ?? baseRetryConfig?.maxRetries ?? 0,
      initialDelay: nodeRetry.delayMs ?? baseRetryConfig?.initialDelay ?? 1000,
      maxDelay: (nodeRetry.delayMs ?? 1000) * 10,
      backoffMultiplier: nodeRetry.backoff === 'exponential' ? 2 : 1,
      retryOn: nodeRetry.retryOnPatterns,
    } : baseRetryConfig;

    // Check circuit breaker state
    if (circuitBreakerConfig) {
      const circuitState = this.checkCircuitBreaker(nodeId, circuitBreakerConfig);
      if (circuitState === 'open') {
        logger.warn({ nodeId }, '[WorkflowEngine] Circuit breaker OPEN - skipping node');
        return this.handleFallback(node, input, new Error('Circuit breaker open'), fallbackConfig);
      }
    }

    const startTime = Date.now();
    this.emitEvent('node_start', { nodeId, nodeType: node.type });

    let result: any;
    let lastError: Error | null = null;
    const maxRetries = retryConfig?.maxRetries ?? 0;

    // Retry loop
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Calculate delay with exponential backoff
          const delay = this.calculateRetryDelay(attempt, retryConfig!);
          logger.info({
            nodeId,
            attempt,
            delay,
            maxRetries
          }, '[WorkflowEngine] Retrying node after delay');

          this.emitEvent('node_retry', {
            nodeId,
            nodeType: node.type,
            attempt,
            delay
          });

          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Execute with optional per-node timeout
        const nodeTimeout = node.data.timeoutMs || (this as any).workflowSettings?.defaultTimeoutMs || 0;
        if (nodeTimeout > 0) {
          result = await Promise.race([
            this.executeNodeCore(node, input),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Node timeout after ${nodeTimeout}ms`)), nodeTimeout))
          ]);
        } else {
          result = await this.executeNodeCore(node, input);
        }

        // Success - reset circuit breaker on successful execution
        if (circuitBreakerConfig) {
          this.recordCircuitBreakerSuccess(nodeId);
        }

        // Store result
        logger.info({ nodeId, resultType: typeof result, resultPreview: JSON.stringify(result)?.substring(0, 100) }, '[WorkflowEngine] Storing node result');
        this.context.nodeResults.set(nodeId, result);

        const executionTimeMs = Date.now() - startTime;

        // Check if result indicates a failure (error content, empty LLM response, etc.)
        const resultHasError = result && (
          result.error ||
          result.isError === true ||
          result.status === 'error' ||
          result.status === 'failed' ||
          result.status === 'tool_unavailable' ||
          ((node.type === 'llm_completion' || node.type === 'openagentic_llm') && (!result.content || result.content.trim() === ''))
        );
        const nodeStatus = resultHasError ? 'failed' : 'completed';

        if (resultHasError) {
          const errorMsg = result.error || result.errorMessage || ((node.type === 'llm_completion' || node.type === 'openagentic_llm') ? 'LLM returned empty response' : 'Node returned error result');
          this.emitEvent('node_error', { nodeId, nodeType: node.type, error: String(errorMsg) });
        }

        // Store node execution in database (non-fatal if no execution record exists, e.g. test-node)
        try {
          await this.storeNodeExecution(nodeId, node.type, nodeStatus, result, executionTimeMs, resultHasError ? String(result.error || 'Node result indicates failure') : undefined, input);
        } catch (storeErr) {
          logger.error({ storeErr, nodeId }, '[WorkflowEngine] Failed to store node execution');
        }

        // Record node execution in AgentRegistry for observability
        try {
          if (this.context.agenticExecutionId) {
            const registry = await getAgentRegistryLazy();
            if (registry) {
              // Record tool calls for MCP tool and Synth nodes
              if (node.type === 'mcp_tool') {
                const toolName = node.data.toolName || node.data.toolServer
                  ? `${node.data.toolServer || 'unknown'}/${node.data.toolName || 'unknown'}`
                  : nodeId;
                registry.recordToolCall(this.context.agenticExecutionId, toolName);
              } else if (node.type === 'synth' || node.type === 'synth_synthesize' || node.type === 'oat_synthesize' || node.type === 'oat') {
                const toolName = `synth/${node.data.intent?.substring(0, 60) || nodeId}`;
                registry.recordToolCall(this.context.agenticExecutionId, toolName);
              }

              // Record cost/token usage for LLM completion nodes
              if (node.type === 'llm_completion' && result?.usage) {
                const usage = result.usage;
                // Update execution with token usage via completeExecution would double-count,
                // so we use a lightweight approach: just record the tool call with model info
                registry.recordToolCall(
                  this.context.agenticExecutionId,
                  `llm/${result.model || node.data.model || 'unknown'}`
                );
              }
            }
          }
        } catch (err) {
          logger.debug({ err, nodeId }, '[WorkflowEngine] Failed to record node in AgentRegistry (non-fatal)');
        }

        this.emitEvent('node_complete', {
          nodeId,
          nodeType: node.type,
          output: result,
          executionTimeMs,
          attempts: attempt + 1
        });

        // If approval node returned awaiting_approval, pause execution — don't continue downstream
        // The resumeExecution() method handles continuing from checkpoint after approval
        if (result?.status === 'awaiting_approval' &&
            (node.type === 'approval' || node.type === 'human_approval')) {
          // Auto-approve mode for automated testing (requires autoApprove in execution input)
          if (this.context.input?.autoApprove) {
            logger.info({ nodeId }, '[WorkflowEngine] Auto-approving for automated test');
            result.status = 'approved';
            result.autoApproved = true;
            this.context.nodeResults.set(nodeId, result);
          } else {
            this.emitEvent('execution_paused', {
              nodeId,
              reason: 'awaiting_approval',
              approvalId: result.approvalId,
            });
            return; // Stop processing this branch — resumeExecution() continues after approval
          }
        }

        // Execute downstream nodes (unless condition which handles its own routing)
        if (node.type !== 'condition') {
          const outgoing = this.outgoingEdges.get(nodeId) || [];
          if (outgoing.length > 1) {
            // Fan-out: execute parallel branches concurrently
            logger.info({
              nodeId,
              parallelBranches: outgoing.length,
              targets: outgoing.map(e => e.target),
            }, '[WorkflowEngine] Fan-out: executing parallel branches');
            const branchResults = await Promise.allSettled(
              outgoing.map(edge => this.executeNode(edge.target, result))
            );
            // Log any failed branches
            for (let i = 0; i < branchResults.length; i++) {
              if (branchResults[i].status === 'rejected') {
                logger.warn({
                  nodeId,
                  targetNode: outgoing[i].target,
                  error: (branchResults[i] as PromiseRejectedResult).reason?.message,
                }, '[WorkflowEngine] Parallel branch failed');
              }
            }
          } else if (outgoing.length === 1) {
            await this.executeNode(outgoing[0].target, result);
          }
        }

        return result;

      } catch (error: any) {
        lastError = error;

        // Check if we should retry this error
        if (retryConfig && !this.shouldRetry(error, retryConfig, attempt, maxRetries)) {
          break;
        }

        // Record failure for circuit breaker
        if (circuitBreakerConfig) {
          this.recordCircuitBreakerFailure(nodeId, circuitBreakerConfig);
        }
      }
    }

    // All retries exhausted - handle failure
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = lastError?.message || 'Unknown error';

    // Try fallback
    if (fallbackConfig) {
      try {
        result = await this.handleFallback(node, input, lastError!, fallbackConfig);

        if (fallbackConfig.continueOnFailure) {
          this.context.nodeResults.set(nodeId, result);
          await this.storeNodeExecution(nodeId, node.type, 'failed_with_fallback', result, executionTimeMs, errorMessage);

          this.emitEvent('node_fallback', {
            nodeId,
            nodeType: node.type,
            error: errorMessage,
            fallbackResult: result
          });

          // Continue to downstream nodes with fallback result
          if (node.type !== 'condition') {
            const outgoing = this.outgoingEdges.get(nodeId) || [];
            if (outgoing.length > 1) {
              const branchResults = await Promise.allSettled(
                outgoing.map(edge => this.executeNode(edge.target, result))
              );
              for (const br of branchResults) {
                if (br.status === 'rejected') {
                  logger.warn({ nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (fallback)');
                }
              }
            } else if (outgoing.length === 1) {
              await this.executeNode(outgoing[0].target, result);
            }
          }

          return result;
        }
      } catch (fallbackError: any) {
        logger.error({
          nodeId,
          fallbackError: fallbackError.message
        }, '[WorkflowEngine] Fallback also failed');
      }
    }

    // Final failure - no successful execution or fallback
    await this.storeNodeExecution(nodeId, node.type, 'failed', null, executionTimeMs, errorMessage);

    this.emitEvent('node_error', {
      nodeId,
      nodeType: node.type,
      error: errorMessage,
      attempts: maxRetries + 1
    });

    // Check for error routing (route_to_error_handler or continue)
    if (node.data.onError === 'route_to_error_handler' || node.data.onError === 'continue') {
      const outgoing = this.outgoingEdges.get(nodeId) || [];
      const errorEdge = outgoing.find(e => e.sourceHandle === 'error' || e.label === 'error');
      if (errorEdge && node.data.onError === 'route_to_error_handler') {
        const errorContext = {
          error: errorMessage,
          failedNodeId: nodeId,
          failedNodeType: node.type,
          input,
        };
        await this.executeNode(errorEdge.target, errorContext);
        return errorContext;
      }
      if (node.data.onError === 'continue') {
        const errorOutput = { error: errorMessage, input };
        this.context.nodeResults.set(nodeId, errorOutput);
        const normalEdges = outgoing.filter(e => e.sourceHandle !== 'error' && e.label !== 'error');
        for (const edge of normalEdges) {
          await this.executeNode(edge.target, errorOutput);
        }
        return errorOutput;
      }
    }

    throw lastError;
  }

  /**
   * Execute the core logic of a node (without retry/fallback handling)
   */
  private async executeNodeCore(node: WorkflowNode, input: any): Promise<any> {
    // Execute based on node type
    switch (node.type) {
      case 'trigger':
        return this.executeTrigger(node, input);
      case 'llm_completion':
        return this.executeLLMNode(node, input);
      case 'mcp_tool':
        return this.executeMCPToolNode(node, input);
      case 'code':
        return this.executeCodeNode(node, input);
      case 'condition':
        return this.executeConditionNode(node, input);
      case 'loop':
        return this.executeLoopNode(node, input);
      case 'transform':
        return this.executeTransformNode(node, input);
      case 'merge':
        return this.executeMergeNode(node, input);
      case 'approval':
      case 'human_approval':
        return this.executeApprovalNode(node, input);
      case 'wait':
        return this.executeWaitNode(node, input);
      case 'agent_spawn':
      case 'a2a':
        return this.executeAgentSpawnNode(node, input);
      // Agent-Proxy nodes
      case 'agent_single':
        return this.executeOpenAgenticProxyNode(node, input, 'parallel');
      case 'agent_pool':
        return this.executeOpenAgenticProxyNode(node, input, 'parallel');
      case 'agent_supervisor':
        return this.executeOpenAgenticProxyNode(node, input, 'supervisor');
      // HTTP Request
      case 'http_request':
        return this.executeHTTPRequestNode(node, input);
      // Synth (Tool Synthesis) - Dynamic tool synthesis
      case 'synth_synthesize':
      case 'synth':
      case 'oat_synthesize': // backwards compat
      case 'oat': // backwards compat
        return this.executeSynthNode(node, input);
      // Unified OpenAgentic LLM node - routes through platform provider system
      case 'openagentic_llm':
        return this.executeOpenAgenticLLMNode(node, input);
      // Multi-Agent Orchestrator - spawns concurrent agents
      case 'multi_agent':
        return this.executeMultiAgentNode(node, input);
      // Legacy cloud AI provider nodes (kept for backwards compatibility)
      case 'bedrock':
        return this.executeBedrockNode(node, input);
      case 'vertex':
        return this.executeVertexNode(node, input);
      case 'azure_ai':
        return this.executeAzureAINode(node, input);
      // Code execution via openagentic
      case 'openagentic':
        return this.executeOpenagenticNode(node, input);
      // Integration nodes — notifications, ticketing, messaging
      case 'slack_message':
        return this.executeSlackNode(node, input);
      case 'teams_message':
        return this.executeTeamsNode(node, input);
      case 'outlook_email':
      case 'send_email':
        return this.executeEmailNode(node, input);
      case 'pagerduty_incident':
        return this.executePagerDutyNode(node, input);
      case 'servicenow_ticket':
        return this.executeServiceNowNode(node, input);
      case 'jira_issue':
        return this.executeJiraNode(node, input);
      case 'discord_message':
        return this.executeDiscordNode(node, input);
      // Error handler node — receives routed errors
      case 'error_handler':
        return this.executeErrorHandlerNode(node, input);
      // User context node — injects user context from various sources
      case 'user_context':
        return this.executeUserContextNode(node, input);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  // ===========================================================================
  // Error Recovery Helper Methods
  // ===========================================================================

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    const delay = Math.min(
      config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1),
      config.maxDelay
    );
    // Add jitter (±10%)
    return delay * (0.9 + Math.random() * 0.2);
  }

  /**
   * Check if an error should be retried based on config
   */
  private shouldRetry(error: Error, config: RetryConfig, attempt: number, maxRetries: number): boolean {
    // Already at max retries
    if (attempt >= maxRetries) {
      return false;
    }

    const errorMessage = error.message.toLowerCase();

    // Check skip patterns first (these should never be retried)
    if (config.skipOn) {
      for (const pattern of config.skipOn) {
        if (errorMessage.includes(pattern.toLowerCase())) {
          logger.debug({ error: error.message, pattern }, '[WorkflowEngine] Error matches skip pattern, not retrying');
          return false;
        }
      }
    }

    // If retryOn is specified, only retry on those patterns
    if (config.retryOn && config.retryOn.length > 0) {
      for (const pattern of config.retryOn) {
        if (errorMessage.includes(pattern.toLowerCase())) {
          return true;
        }
      }
      // No matching pattern found
      return false;
    }

    // Default: retry all errors (unless skip matched)
    return true;
  }

  /**
   * Handle fallback execution or value
   */
  private async handleFallback(
    node: WorkflowNode,
    input: any,
    error: Error,
    config?: FallbackConfig
  ): Promise<any> {
    if (!config) {
      throw error;
    }

    logger.info({
      nodeId: node.id,
      hasFallbackNode: !!config.fallbackNodeId,
      hasFallbackValue: config.fallbackValue !== undefined
    }, '[WorkflowEngine] Executing fallback');

    // If there's a fallback node, execute it
    if (config.fallbackNodeId) {
      const fallbackNode = this.nodeMap.get(config.fallbackNodeId);
      if (fallbackNode) {
        const fallbackInput = config.propagateError
          ? { ...input, __error: { message: error.message, nodeId: node.id } }
          : input;
        return this.executeNodeCore(fallbackNode, fallbackInput);
      }
      logger.warn({ fallbackNodeId: config.fallbackNodeId }, '[WorkflowEngine] Fallback node not found');
    }

    // If there's a fallback value, return it
    if (config.fallbackValue !== undefined) {
      const result = config.propagateError
        ? { value: config.fallbackValue, __error: { message: error.message, nodeId: node.id } }
        : config.fallbackValue;
      return result;
    }

    // No fallback configured, propagate error
    throw error;
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(
    nodeId: string,
    config: { failureThreshold: number; resetTimeout: number }
  ): 'closed' | 'open' | 'half-open' {
    const state = circuitBreakerState.get(nodeId);

    if (!state) {
      return 'closed';
    }

    // Check if circuit should be reset (timeout elapsed)
    if (state.state === 'open' && Date.now() - state.lastFailure > config.resetTimeout) {
      // Move to half-open state (allow one attempt)
      state.state = 'half-open';
      return 'half-open';
    }

    return state.state;
  }

  /**
   * Record a successful execution for circuit breaker
   */
  private recordCircuitBreakerSuccess(nodeId: string): void {
    const state = circuitBreakerState.get(nodeId);
    if (state) {
      // Reset on success
      state.failures = 0;
      state.state = 'closed';
    }
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordCircuitBreakerFailure(
    nodeId: string,
    config: { failureThreshold: number; resetTimeout: number }
  ): void {
    let state = circuitBreakerState.get(nodeId);

    if (!state) {
      state = { failures: 0, lastFailure: Date.now(), state: 'closed' };
      circuitBreakerState.set(nodeId, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    // Check if we should open the circuit
    if (state.failures >= config.failureThreshold) {
      state.state = 'open';
      logger.warn({
        nodeId,
        failures: state.failures,
        threshold: config.failureThreshold
      }, '[WorkflowEngine] Circuit breaker OPENED');
    }
  }

  // ===========================================================================
  // Node Type Executors
  // ===========================================================================

  /**
   * Execute trigger node - validates and passes through input
   */
  private async executeTrigger(node: WorkflowNode, input: any): Promise<any> {
    const { triggerType, triggerConfig } = node.data;

    logger.info({ triggerType, nodeId: node.id }, '[WorkflowEngine] Executing trigger');

    // Store trigger input for {{trigger.*}} template variable resolution
    this.context.nodeResults.set('__trigger__', { body: input, ...input });

    // For manual triggers, just pass through input
    // Future: handle webhook, schedule, etc.
    return input;
  }

  /**
   * Execute LLM completion node
   */
  private async executeLLMNode(node: WorkflowNode, input: any): Promise<any> {
    const { model, temperature, maxTokens, prompt, systemPrompt } = node.data;

    // Interpolate variables in prompt
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({
      nodeId: node.id,
      model,
      promptLength: resolvedPrompt.length
    }, '[WorkflowEngine] Executing LLM node');

    const messages: Array<{ role: string; content: string }> = [];

    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }

    // Auto-append input context to the prompt when it doesn't reference template variables.
    // This ensures the LLM always sees the data flowing through the workflow.
    let userContent = resolvedPrompt;
    const hadTemplateVars = (prompt || '').includes('{{');
    if (!hadTemplateVars && input != null) {
      const inputStr = typeof input === 'string' ? input
        : typeof input === 'object' ? JSON.stringify(input, null, 2)
        : String(input);
      if (inputStr && inputStr !== '{}' && inputStr !== 'null') {
        userContent = `${resolvedPrompt}\n\n--- Input Data ---\n${inputStr}`;
      }
    }

    messages.push({ role: 'user', content: userContent });

    // Call the OpenAI-compatible endpoint
    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || MODELS.default,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 2000,
        stream: false
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId
        },
        timeout: 600000 // 10 minute timeout for slow models (e.g. Ollama)
      }
    );

    const content = response.data?.choices?.[0]?.message?.content || '';

    return {
      content,
      model: response.data?.model,
      usage: response.data?.usage
    };
  }

  /**
   * Execute MCP tool node
   */
  private async executeMCPToolNode(node: WorkflowNode, input: any): Promise<any> {
    const { toolName, toolServer, arguments: argsField, toolParams, toolArgs: toolArgsField } = node.data;

    // Normalize server name: hyphens → underscores, strip trailing _mcp
    // MCP proxy registers servers with underscores (e.g. openagentic_azure) but workflow
    // nodes may store hyphens (e.g. oap-azure-mcp)
    const normalizedServer = toolServer
      ? toolServer.replace(/-/g, '_').replace(/_mcp$/, '')
      : toolServer;

    // Interpolate variables in arguments (support all field names: arguments, toolArgs, toolParams)
    const rawArgs = argsField || toolArgsField || toolParams || {};
    const resolvedArgs: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawArgs)) {
      if (typeof value === 'string') {
        resolvedArgs[key] = this.interpolateTemplate(value, input);
      } else {
        resolvedArgs[key] = value;
      }
    }

    logger.info({
      nodeId: node.id,
      toolName,
      toolServer: normalizedServer,
      originalServer: toolServer,
    }, '[WorkflowEngine] Executing MCP tool node');

    // Call MCP Proxy — authToken is already the real Azure AD token (loaded in workflows.ts)
    const response = await axios.post(
      `${this.mcpProxyUrl}/call`,
      {
        server: normalizedServer,
        tool: toolName,
        arguments: resolvedArgs
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.context.authToken || '',
          // Pass ID token for AWS Identity Center and Azure OBO federation
          // (same as chat mode's tool-execution.helper.ts)
          ...(this.context.idToken ? {
            'X-AWS-ID-Token': this.context.idToken,
            'X-Azure-ID-Token': this.context.idToken,
          } : {}),
        },
        timeout: 60000,
        validateStatus: () => true,
        signal: this.abortController.signal,
      }
    );

    // Check HTTP status
    if (response.status >= 400) {
      const errorMsg = response.data?.error || response.data?.message || `MCP call failed with HTTP ${response.status}`;
      throw new Error(`MCP tool "${toolName}" failed: ${errorMsg}`);
    }

    // Check for error in response body (MCP proxy returns 200 with error objects)
    // The proxy /call endpoint returns: { server, tool, result: <jsonrpc_response>, error?: envelope }
    // where <jsonrpc_response> is: { jsonrpc, id, result: { content: [...], isError }, error?: {...} }
    // We need to unwrap through both layers to get the actual MCP tool result.

    const proxyResponse = response.data;

    // Layer 0: Check proxy-level error envelope (MCPErrorEnvelope from classify_error)
    if (proxyResponse?.error && typeof proxyResponse.error === 'object' && proxyResponse.error.code) {
      const errMsg = proxyResponse.error.message || 'MCP proxy error';
      throw new Error(`MCP tool "${toolName}" error: ${errMsg}`);
    }

    // Layer 1: Unwrap proxy wrapper → JSONRPC response
    const jsonrpcResponse = proxyResponse?.result ?? proxyResponse;

    // Layer 2: Check JSONRPC-level error (protocol error from MCP server)
    if (jsonrpcResponse?.error) {
      const errMsg = jsonrpcResponse.error.message || jsonrpcResponse.error.data || JSON.stringify(jsonrpcResponse.error);
      throw new Error(`MCP tool "${toolName}" error: ${errMsg}`);
    }

    // Layer 3: Unwrap JSONRPC result → actual MCP tool result ({ content, isError })
    const mcpResult = jsonrpcResponse?.result ?? jsonrpcResponse;

    if (mcpResult && typeof mcpResult === 'object') {
      // Check isError flag (MCP SDK standard)
      if (mcpResult.isError) {
        const errContent = mcpResult.content?.[0]?.text || 'Unknown MCP error';
        throw new Error(`MCP tool "${toolName}" error: ${errContent}`);
      }

      // Check for tool-level failure inside MCP content blocks
      // Tools like Azure/AWS return { content: [{ text: '{"success":false,"error":"..."}' }], isError: false }
      if (Array.isArray(mcpResult.content)) {
        for (const block of mcpResult.content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            try {
              const parsed = JSON.parse(block.text);
              if (parsed && typeof parsed === 'object' && parsed.success === false && parsed.error) {
                const errMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
                const errType = parsed.error_type ? ` (${parsed.error_type})` : '';
                throw new Error(`MCP tool "${toolName}" failed${errType}: ${errMsg}`);
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message.startsWith(`MCP tool "${toolName}"`)) {
                throw parseErr;
              }
            }
          }
        }
      }

      // Check top-level success:false pattern (flat result objects)
      if (mcpResult.success === false && (mcpResult.error || mcpResult.error_message)) {
        const errMsg = mcpResult.error || mcpResult.error_message;
        const errType = mcpResult.error_type ? ` (${mcpResult.error_type})` : '';
        throw new Error(`MCP tool "${toolName}" failed${errType}: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`);
      }
    }

    // Normalize MCP result: extract text content from content blocks array
    // so template variables like {{nodeId.content}} resolve to readable text
    if (mcpResult && Array.isArray(mcpResult.content)) {
      const textContent = mcpResult.content
        .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('\n');
      return {
        ...mcpResult,
        content: textContent || JSON.stringify(mcpResult.content),
      };
    }

    return mcpResult;
  }

  /**
   * Execute Synth (Tool Synthesis) node
   * Synthesizes a dynamic tool from natural language intent and executes it.
   *
   * CRITICAL SECURITY:
   * - Tools run AS the authenticated user (no service accounts)
   * - Credentials come from user's SSO provider
   * - Session-based OAuth for services like GitHub
   */
  private async executeSynthNode(node: WorkflowNode, input: any): Promise<any> {
    const { intent, capabilities, dryRun, credentials } = node.data;

    // Interpolate variables in intent
    const resolvedIntent = typeof intent === 'string'
      ? this.interpolateTemplate(intent, input)
      : (typeof input === 'string' ? input : intent);

    if (!resolvedIntent) {
      throw new Error('Synth node requires an intent (either in node data or as input)');
    }

    logger.info({
      nodeId: node.id,
      intent: resolvedIntent?.substring(0, 100),
      capabilities,
      dryRun,
      userId: this.context.userId
    }, '[WorkflowEngine] Executing Synth node - dynamic tool synthesis');

    // Import SynthService dynamically to avoid circular dependencies
    const { SynthService } = await import('./SynthService.js');
    const synthService = SynthService.getInstance(logger);

    // Resolve user email from context or DB lookup
    let userEmail = '';
    try {
      const user = await prisma.user.findUnique({
        where: { id: this.context.userId },
        select: { email: true },
      });
      userEmail = user?.email || '';
    } catch {
      // Non-fatal: continue without email
    }

    try {
      // Synthesize and execute the tool
      const result = await synthService.synthesize({
        intent: resolvedIntent,
        userId: this.context.userId,
        userEmail,
        capabilities: capabilities || [],
        dryRun: dryRun || false,
        sessionId: this.context.executionId,
        credentials: credentials || undefined,
      });

      // If approval is required, return the approval info instead of throwing
      if (result.approval?.required && !result.approval?.approved) {
        logger.info({
          nodeId: node.id,
          riskLevel: result.tool?.riskLevel,
          approvalRequired: true,
        }, '[WorkflowEngine] Synth node requires approval');

        return {
          status: 'awaiting_approval',
          intent: resolvedIntent,
          riskLevel: result.tool?.riskLevel,
          message: result.error || 'Synthesis requires human approval',
          tool: result.tool ? {
            explanation: result.tool.explanation,
            riskLevel: result.tool.riskLevel,
            riskReasoning: result.tool.riskReasoning,
            capabilitiesUsed: result.tool.capabilitiesUsed,
          } : undefined,
          metrics: result.metrics,
        };
      }

      if (!result.success) {
        throw new Error(result.error || 'Tool synthesis failed');
      }

      logger.info({
        nodeId: node.id,
        success: result.success,
        riskLevel: result.tool?.riskLevel,
        executionTimeMs: result.metrics?.executionTimeMs,
        totalTimeMs: result.metrics?.totalTimeMs,
      }, '[WorkflowEngine] Synth node completed');

      // Return comprehensive result including tool info and metrics
      return {
        result: result.result,
        tool: result.tool ? {
          explanation: result.tool.explanation,
          riskLevel: result.tool.riskLevel,
          capabilitiesUsed: result.tool.capabilitiesUsed,
        } : undefined,
        metrics: {
          synthesisTimeMs: result.metrics.synthesisTimeMs,
          executionTimeMs: result.metrics.executionTimeMs,
          totalTimeMs: result.metrics.totalTimeMs,
          costUsd: result.metrics.costUsd,
        },
        existingToolsSuggested: result.existingToolsSuggested,
      };
    } catch (error: any) {
      logger.error({
        nodeId: node.id,
        error: error.message,
        intent: resolvedIntent?.substring(0, 100)
      }, '[WorkflowEngine] Synth node failed');

      throw error;
    }
  }

  /**
   * Execute HTTP Request node - makes HTTP calls with template interpolation
   */
  private async executeHTTPRequestNode(node: WorkflowNode, input: any): Promise<any> {
    const {
      url,
      method = 'GET',
      headers: requestHeaders = {},
      body,
      timeout = 30000,
      responseType = 'json',
    } = node.data;

    // Interpolate variables in URL, headers, and body
    const resolvedUrl = this.interpolateTemplate(url || '', input);
    const resolvedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(requestHeaders)) {
      if (typeof value === 'string') {
        resolvedHeaders[key] = this.interpolateTemplate(value, input);
      }
    }

    let resolvedBody: any = undefined;
    if (body && method !== 'GET' && method !== 'HEAD') {
      if (typeof body === 'string') {
        resolvedBody = this.interpolateTemplate(body, input);
        // Try to parse as JSON for JSON content types
        if (resolvedHeaders['Content-Type']?.includes('json') || !resolvedHeaders['Content-Type']) {
          try {
            resolvedBody = JSON.parse(resolvedBody);
          } catch {
            // Keep as string if not valid JSON
          }
        }
      } else {
        resolvedBody = body;
      }
    }

    if (!resolvedUrl) {
      throw new Error('HTTP Request node requires a url');
    }

    logger.info({
      nodeId: node.id,
      method,
      url: resolvedUrl,
    }, '[WorkflowEngine] Executing HTTP request node');

    try {
      const response = await axios({
        method: method.toLowerCase(),
        url: resolvedUrl,
        headers: resolvedHeaders,
        data: resolvedBody,
        timeout,
        validateStatus: () => true, // Don't throw on non-2xx
      });

      const result: Record<string, any> = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };

      if (responseType === 'text') {
        result.data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      } else {
        result.data = response.data;
      }

      return result;
    } catch (error: any) {
      throw new Error(`HTTP request failed: ${error.message}`);
    }
  }

  // ===========================================================================
  // Integration Node Handlers (Slack, Teams, PagerDuty, ServiceNow, Jira, Email, Discord)
  // ===========================================================================

  /**
   * Send a Slack message via webhook
   */
  private async executeSlackNode(node: WorkflowNode, input: any): Promise<any> {
    const { webhookUrl, channel, message, blocks } = node.data;
    const resolvedUrl = this.interpolateTemplate(webhookUrl || process.env.SLACK_WEBHOOK_URL || '', input);
    const resolvedMsg = this.interpolateTemplate(message || '', input);

    if (!resolvedUrl) throw new Error('Slack node requires a webhook URL (or SLACK_WEBHOOK_URL env)');

    logger.info({ nodeId: node.id, channel }, '[WorkflowEngine] Executing Slack message node');

    const payload: any = { text: resolvedMsg };
    if (channel) payload.channel = this.interpolateTemplate(channel, input);
    if (blocks && blocks.length > 0) payload.blocks = blocks;

    const response = await axios.post(resolvedUrl, payload, { timeout: 15000, validateStatus: () => true });
    return { status: response.status, sent: response.status === 200, channel: channel || 'default' };
  }

  /**
   * Send a Microsoft Teams message via webhook
   */
  private async executeTeamsNode(node: WorkflowNode, input: any): Promise<any> {
    const { webhookUrl, message, cardTitle, cardBody } = node.data;
    const resolvedUrl = this.interpolateTemplate(webhookUrl || process.env.TEAMS_WEBHOOK_URL || '', input);
    const resolvedMsg = this.interpolateTemplate(message || '', input);

    if (!resolvedUrl) throw new Error('Teams node requires a webhook URL (or TEAMS_WEBHOOK_URL env)');

    logger.info({ nodeId: node.id }, '[WorkflowEngine] Executing Teams message node');

    // Use Adaptive Card if cardTitle provided, otherwise plain text
    let payload: any;
    if (cardTitle) {
      payload = {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: this.interpolateTemplate(cardTitle, input), weight: 'Bolder', size: 'Medium' },
              { type: 'TextBlock', text: this.interpolateTemplate(cardBody || message || '', input), wrap: true },
            ],
          },
        }],
      };
    } else {
      payload = { text: resolvedMsg };
    }

    const response = await axios.post(resolvedUrl, payload, { timeout: 15000, validateStatus: () => true });
    return { status: response.status, sent: response.status === 200 || response.status === 202 };
  }

  /**
   * Send email via SMTP (Outlook, Gmail, SendGrid, custom)
   */
  private async executeEmailNode(node: WorkflowNode, input: any): Promise<any> {
    const { to, cc, subject, body, isHtml, smtpHost, smtpPort, smtpUser, smtpPasswordRef } = node.data;
    const resolvedTo = this.interpolateTemplate(to || '', input);
    const resolvedSubject = this.interpolateTemplate(subject || '', input);
    const resolvedBody = this.interpolateTemplate(body || '', input);

    if (!resolvedTo) throw new Error('Email node requires a "to" address');
    if (!resolvedSubject) throw new Error('Email node requires a subject');

    logger.info({ nodeId: node.id, to: resolvedTo }, '[WorkflowEngine] Executing email node');

    // Use platform NotificationService if no SMTP override
    if (!smtpHost) {
      // Try platform email service
      const emailServiceUrl = process.env.EMAIL_SERVICE_URL;
      if (emailServiceUrl) {
        const response = await axios.post(emailServiceUrl, {
          to: resolvedTo, cc: cc ? this.interpolateTemplate(cc, input) : undefined,
          subject: resolvedSubject, body: resolvedBody, isHtml: isHtml !== false,
        }, { timeout: 30000, validateStatus: () => true });
        return { status: response.status, sent: response.status >= 200 && response.status < 300, to: resolvedTo };
      }
      // Fallback: use nodemailer directly if env vars set
      const host = process.env.SMTP_HOST;
      if (!host) throw new Error('No SMTP configuration found. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS or EMAIL_SERVICE_URL');
    }

    // Direct SMTP via nodemailer
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: smtpHost || process.env.SMTP_HOST,
      port: smtpPort || parseInt(process.env.SMTP_PORT || '587'),
      secure: (smtpPort || parseInt(process.env.SMTP_PORT || '587')) === 465,
      auth: { user: smtpUser || process.env.SMTP_USER, pass: smtpPasswordRef || process.env.SMTP_PASS },
    });

    const info = await transport.sendMail({
      from: smtpUser || process.env.SMTP_USER || 'noreply@openagentic.io',
      to: resolvedTo,
      cc: cc ? this.interpolateTemplate(cc, input) : undefined,
      subject: resolvedSubject,
      [isHtml !== false ? 'html' : 'text']: resolvedBody,
    });

    return { sent: true, messageId: info.messageId, to: resolvedTo };
  }

  /**
   * Create/trigger/resolve PagerDuty incidents via Events API v2
   */
  private async executePagerDutyNode(node: WorkflowNode, input: any): Promise<any> {
    const { action = 'trigger', routingKey, severity = 'error', summary, source = 'openagentic', dedupKey } = node.data;
    const resolvedKey = this.interpolateTemplate(routingKey || process.env.PAGERDUTY_ROUTING_KEY || '', input);
    const resolvedSummary = this.interpolateTemplate(summary || '', input);

    if (!resolvedKey) throw new Error('PagerDuty node requires a routing key (or PAGERDUTY_ROUTING_KEY env)');

    logger.info({ nodeId: node.id, action, severity }, '[WorkflowEngine] Executing PagerDuty node');

    const payload: any = {
      routing_key: resolvedKey,
      event_action: action, // trigger, acknowledge, resolve
    };

    if (action === 'trigger') {
      payload.payload = {
        summary: resolvedSummary,
        severity, // critical, error, warning, info
        source: this.interpolateTemplate(source, input),
        timestamp: new Date().toISOString(),
      };
    }

    if (dedupKey) payload.dedup_key = this.interpolateTemplate(dedupKey, input);

    const response = await axios.post('https://events.pagerduty.com/v2/enqueue', payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true,
    });

    return { status: response.status, sent: response.status === 202, dedupKey: response.data?.dedup_key, action };
  }

  /**
   * Create/update ServiceNow records via REST Table API
   */
  private async executeServiceNowNode(node: WorkflowNode, input: any): Promise<any> {
    const { action = 'create_incident', instanceUrl, table = 'incident', fields = {} } = node.data;
    const resolvedUrl = this.interpolateTemplate(instanceUrl || process.env.SERVICENOW_INSTANCE_URL || '', input);

    if (!resolvedUrl) throw new Error('ServiceNow node requires an instance URL (or SERVICENOW_INSTANCE_URL env)');

    logger.info({ nodeId: node.id, action, table }, '[WorkflowEngine] Executing ServiceNow node');

    // Resolve template expressions in field values
    const resolvedFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      resolvedFields[key] = typeof value === 'string' ? this.interpolateTemplate(value, input) : value;
    }

    const baseUrl = resolvedUrl.replace(/\/$/, '');
    const apiUrl = `${baseUrl}/api/now/table/${table}`;
    const auth = process.env.SERVICENOW_AUTH_TOKEN || process.env.SERVICENOW_USERNAME;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (auth?.startsWith('Basic ') || auth?.startsWith('Bearer ')) {
      headers['Authorization'] = auth;
    } else if (process.env.SERVICENOW_USERNAME && process.env.SERVICENOW_PASSWORD) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`).toString('base64');
    }

    const response = await axios.post(apiUrl, resolvedFields, { headers, timeout: 30000, validateStatus: () => true });
    return { status: response.status, created: response.status === 201, sysId: response.data?.result?.sys_id, number: response.data?.result?.number };
  }

  /**
   * Create/update Jira issues via REST API v3
   */
  private async executeJiraNode(node: WorkflowNode, input: any): Promise<any> {
    const { action = 'create', projectKey, issueType = 'Task', summary, description, priority = 'Medium', assignee } = node.data;
    const baseUrl = this.interpolateTemplate(process.env.JIRA_BASE_URL || '', input);
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (!baseUrl) throw new Error('Jira node requires JIRA_BASE_URL env var');
    if (!email || !apiToken) throw new Error('Jira node requires JIRA_EMAIL and JIRA_API_TOKEN env vars');

    const resolvedSummary = this.interpolateTemplate(summary || '', input);
    const resolvedDesc = this.interpolateTemplate(description || '', input);
    const resolvedProject = this.interpolateTemplate(projectKey || '', input);

    logger.info({ nodeId: node.id, action, projectKey: resolvedProject }, '[WorkflowEngine] Executing Jira node');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
    };

    if (action === 'create') {
      const payload: any = {
        fields: {
          project: { key: resolvedProject },
          summary: resolvedSummary,
          issuetype: { name: issueType },
          priority: { name: priority },
        },
      };
      if (resolvedDesc) payload.fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: resolvedDesc }] }] };
      if (assignee) payload.fields.assignee = { accountId: this.interpolateTemplate(assignee, input) };

      const response = await axios.post(`${baseUrl}/rest/api/3/issue`, payload, { headers, timeout: 30000, validateStatus: () => true });
      return { status: response.status, created: response.status === 201, key: response.data?.key, id: response.data?.id };
    }

    throw new Error(`Jira action "${action}" not yet implemented`);
  }

  /**
   * Send Discord message via webhook
   */
  private async executeDiscordNode(node: WorkflowNode, input: any): Promise<any> {
    const { webhookUrl, content, username = 'OpenAgentic', embeds } = node.data;
    const resolvedUrl = this.interpolateTemplate(webhookUrl || '', input);
    const resolvedContent = this.interpolateTemplate(content || '', input);

    if (!resolvedUrl) throw new Error('Discord node requires a webhook URL');

    logger.info({ nodeId: node.id }, '[WorkflowEngine] Executing Discord message node');

    const payload: any = { content: resolvedContent, username };
    if (embeds && embeds.length > 0) payload.embeds = embeds;

    const response = await axios.post(resolvedUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true,
    });

    return { status: response.status, sent: response.status === 204 || response.status === 200 };
  }

  /**
   * Execute error_handler node — receives routed errors and processes them
   */
  private async executeErrorHandlerNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.errorAction || 'log';
    const errorData = input;

    logger.info({ nodeId: node.id, action }, '[WorkflowEngine] Executing error handler node');

    if (action === 'log') {
      logger.warn({ errorData, nodeId: node.id }, '[WorkflowEngine] Error handler: logging error');
      return { action: 'logged', error: errorData };
    }
    if (action === 'transform' && node.data.transformExpression) {
      try {
        const fn = new Function('error', 'input', `return ${node.data.transformExpression}`);
        return fn(errorData.error, errorData.input);
      } catch (e) {
        return { action: 'transform_failed', error: errorData, transformError: (e as Error).message };
      }
    }
    if (action === 'notify') {
      this.emitEvent('node_complete', {
        nodeId: node.id, nodeType: 'error_handler',
        output: { action: 'notify', channel: node.data.notificationChannel, error: errorData }
      });
      return { action: 'notified', channel: node.data.notificationChannel, error: errorData };
    }
    return { action, error: errorData };
  }

  /**
   * Execute user_context node — injects user context from various sources
   */
  private async executeUserContextNode(node: WorkflowNode, input: any): Promise<any> {
    logger.info({ nodeId: node.id }, '[WorkflowEngine] Executing user context node');
    try {
      const sources = node.data.contextSources || ['chat', 'workflow', 'memory'];
      const query = this.interpolateTemplate(node.data.contextQuery || '', input);
      const maxTokens = node.data.contextMaxTokens || 2000;

      const headers = this.getInternalAuthHeaders();
      const resp = await axios.get(`${this.apiUrl}/api/user-context`, {
        params: { userId: this.context.userId, sources: sources.join(','), query, maxTokens },
        headers,
        timeout: 10000,
      });
      return resp.data;
    } catch (err) {
      logger.warn({ err, nodeId: node.id }, '[WorkflowEngine] Failed to load user context');
      return { context: [], error: (err as Error).message };
    }
  }

  /**
   * Execute code node (JavaScript in sandbox or via openagentic)
   */
  private async executeCodeNode(node: WorkflowNode, input: any): Promise<any> {
    const { code, language } = node.data;

    logger.info({
      nodeId: node.id,
      language,
      codeLength: code?.length
    }, '[WorkflowEngine] Executing code node');

    // For JavaScript, execute in a sandboxed function
    if (language === 'javascript' || !language) {
      return this.executeJavaScript(code, input);
    }

    // For Python, would route to openagentic-manager
    // For now, throw error for unsupported languages
    throw new Error(`Language ${language} execution not yet implemented in workflows`);
  }

  /**
   * Execute JavaScript code in sandbox
   */
  private async executeJavaScript(code: string, input: any): Promise<any> {
    // Create a sandbox with limited globals
    const sandbox = {
      input,
      result: undefined as any,
      console: {
        log: (...args: any[]) => logger.info({ args }, '[WorkflowCode] console.log'),
        error: (...args: any[]) => logger.error({ args }, '[WorkflowCode] console.error'),
      },
      fetch: globalThis.fetch,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      setTimeout,
      URL,
      URLSearchParams,
      // Utility functions
      parseJSON: (str: string) => JSON.parse(str),
      stringify: (obj: any) => JSON.stringify(obj, null, 2),
    };

    // Wrap code in async function to support await
    // NOTE: wrappedCode must NOT start with newline -- ASI would make `return\n(async...)` return undefined
    const wrappedCode = `(async function(input) { ${code} })(input)`;

    try {
      // Execute with Function constructor (safer than eval)
      const fn = new Function(...Object.keys(sandbox), `return ${wrappedCode}`);
      const result = await fn(...Object.values(sandbox));
      return result;
    } catch (error: any) {
      throw new Error(`Code execution error: ${error.message}`);
    }
  }

  /**
   * Execute condition node - routes to different branches
   */
  private async executeConditionNode(node: WorkflowNode, input: any): Promise<any> {
    // Accept both 'condition' and 'expression' field names (workflows use either)
    const condition = node.data.condition || node.data.expression;
    const operator = node.data.operator;

    logger.info({
      nodeId: node.id,
      condition,
      operator
    }, '[WorkflowEngine] Executing condition node');

    // Evaluate condition - returns string or boolean for flexible edge matching
    const result = this.evaluateCondition(condition, operator, input);

    // Store result
    this.context.nodeResults.set(node.id, result);

    // Route to appropriate branch based on edge labels
    const outgoing = this.outgoingEdges.get(node.id) || [];
    const resultStr = String(result).toLowerCase();
    const isTruthy = result === true || result === 'true' || (typeof result === 'number' && result > 0);
    const isFalsy = result === false || result === 'false' || result === 0 || result === null || result === undefined;

    let routed = false;
    for (const edge of outgoing) {
      const edgeLabel = (edge.label || '').toLowerCase().trim();
      const shouldFollow =
        // Exact string match (supports custom labels like "Critical", "Safe", etc.)
        edgeLabel === resultStr ||
        // Boolean matching for true/yes/empty edges — also match first edge for truthy
        (isTruthy && (edgeLabel === 'true' || edgeLabel === 'yes' || edgeLabel === '')) ||
        // Boolean matching for false/no edges — also match second edge for falsy
        (isFalsy && (edgeLabel === 'false' || edgeLabel === 'no')) ||
        // sourceHandle matching (alternative routing mechanism)
        (edge.sourceHandle && edge.sourceHandle.toLowerCase() === resultStr);

      if (shouldFollow || outgoing.length === 1) {
        routed = true;
        await this.executeNode(edge.target, input);
      }
    }

    // Fallback: if no edge matched by label, route by position (first edge = truthy, second = falsy)
    if (!routed && outgoing.length >= 2) {
      const targetEdge = isTruthy ? outgoing[0] : outgoing[1];
      logger.info({
        nodeId: node.id,
        result: resultStr,
        isTruthy,
        targetNode: targetEdge.target,
        edgeLabel: targetEdge.label,
      }, '[WorkflowEngine] Condition: no label match, routing by position (first=truthy, second=falsy)');
      await this.executeNode(targetEdge.target, input);
    } else if (!routed && outgoing.length === 1) {
      // Only one outgoing edge — always follow it
      await this.executeNode(outgoing[0].target, input);
    }

    return result;
  }

  /**
   * Evaluate a condition expression - returns string or boolean for flexible routing
   */
  private evaluateCondition(condition: string, operator: string, input: any): any {
    // Workflow condition expressions are authored by authenticated admins via the UI.
    // Dynamic evaluation via Function constructor is the standard pattern used by
    // workflow engines (n8n, Flowise, Temporal) for user-defined expressions.
    try {
      // Resolve {{steps.X.output}} as named JS variables instead of inline text.
      // Prevents "Long text....includes('critical')" invalid JS from template expansion.
      const stepVars: Record<string, any> = {};
      const varCondition = condition.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        const trimmedPath = path.trim();
        if (trimmedPath.startsWith('steps.')) {
          const parts = trimmedPath.slice(6).split('.');
          const nameOrId = parts[0];
          let value = this.context.nodeResults.get(nameOrId);
          if (value === undefined) {
            const normalized = nameOrId.toLowerCase().replace(/[-_\s]+/g, '-');
            for (const [nId] of this.context.nodeResults.entries()) {
              const node = this.nodeMap.get(nId);
              const label = (node?.data?.label || '').toLowerCase().replace(/[-_\s]+/g, '-');
              if (label === normalized || nId.toLowerCase() === normalized) {
                value = this.context.nodeResults.get(nId);
                break;
              }
            }
          }
          if (value !== undefined) {
            for (const key of parts.slice(1)) {
              if (key === 'output' && value !== undefined && (typeof value !== 'object' || value[key] === undefined)) continue;
              if (value && typeof value === 'object' && key in value) value = value[key];
            }
          }
          const strValue = typeof value === 'string' ? value
            : typeof value === 'object' ? JSON.stringify(value)
            : String(value ?? '');
          const varName = `__step_${nameOrId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
          stepVars[varName] = strValue;
          return varName;
        }
        return this.interpolateTemplate(match, input);
      });

      if (operator === 'expression' || !operator) {
        try {
          const varNames = Object.keys(stepVars);
          const varValues = Object.values(stepVars);
          const fn = new Function('input', ...varNames, `return (${varCondition})`); // eslint-disable-line no-new-func
          return fn(input, ...varValues);
        } catch {
          try {
            const resolved = this.interpolateTemplate(condition, input);
            const fn2 = new Function('input', `return (${resolved})`); // eslint-disable-line no-new-func
            return fn2(input);
          } catch {
            return this.interpolateTemplate(condition, input);
          }
        }
      }

      const resolvedCondition = this.interpolateTemplate(condition, input);
      return !!resolvedCondition;
    } catch {
      return false;
    }
  }

  /**
   * Execute loop node - iterates over array
   */
  private async executeLoopNode(node: WorkflowNode, input: any): Promise<any> {
    const { iterateOver: _iterateOver, collection, itemVariable = 'item', indexVariable = 'index' } = node.data;
    const iterateOver = _iterateOver || collection; // Accept both field names

    // Get the array to iterate over
    let items: any[] = input;
    if (iterateOver) {
      const resolved = this.interpolateTemplate(`{{${iterateOver}}}`, input);
      if (typeof resolved === 'string') {
        try {
          items = JSON.parse(resolved);
        } catch {
          // If LLM returned plain text, try to extract JSON array from it
          const arrayMatch = resolved.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            try {
              items = JSON.parse(arrayMatch[0]);
            } catch {
              items = resolved.split('\n').filter((s: string) => s.trim());
            }
          } else {
            items = resolved.split('\n').filter((s: string) => s.trim());
          }
          logger.warn({ nodeId: node.id, resolvedLength: resolved.length, itemCount: items.length },
            '[WorkflowEngine] Loop: resolved value was not valid JSON, split into items');
        }
      } else {
        items = resolved;
      }
    }

    if (!Array.isArray(items)) {
      items = [items];
    }

    logger.info({
      nodeId: node.id,
      itemCount: items.length
    }, '[WorkflowEngine] Executing loop node');

    const results: any[] = [];
    const outgoing = this.outgoingEdges.get(node.id) || [];

    for (let i = 0; i < items.length; i++) {
      const loopInput = {
        ...input,
        [itemVariable]: items[i],
        [indexVariable]: i,
        __loopIndex: i,
        __loopTotal: items.length
      };

      // Execute downstream nodes for each item
      for (const edge of outgoing) {
        const result = await this.executeNode(edge.target, loopInput);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Execute transform node - map, filter, reduce
   */
  private async executeTransformNode(node: WorkflowNode, input: any): Promise<any> {
    const { transformType, transformExpression: _txExpr, expression: _expr } = node.data;
    const transformExpression = _txExpr || _expr; // Accept both field names

    logger.info({
      nodeId: node.id,
      transformType
    }, '[WorkflowEngine] Executing transform node');

    // Get input array
    const items = Array.isArray(input) ? input : [input];

    switch (transformType) {
      case 'map':
        return items.map(item => {
          const fn = new Function('item', 'index', `return ${transformExpression}`);
          return fn(item, items.indexOf(item));
        });

      case 'filter':
        return items.filter(item => {
          const fn = new Function('item', 'index', `return !!(${transformExpression})`);
          return fn(item, items.indexOf(item));
        });

      case 'reduce':
        return items.reduce((acc, item, index) => {
          const fn = new Function('acc', 'item', 'index', `return ${transformExpression}`);
          return fn(acc, item, index);
        }, null);

      case 'extract': {
        // Extract a field from input using JS expression evaluation
        // This is intentional dynamic code execution for workflow user-defined expressions
        // eslint-disable-next-line no-new-func
        try {
          const extractFn = new Function('input', `return (${transformExpression})`);
          return extractFn(input);
        } catch {
          // Fallback: treat as dot-path accessor
          let value: any = input;
          for (const key of (transformExpression || '').split('.')) {
            value = value?.[key];
          }
          return value ?? input;
        }
      }

      default:
        return input;
    }
  }

  /**
   * Execute merge node - combines multiple inputs
   */
  private async executeMergeNode(node: WorkflowNode, input: any): Promise<any> {
    const { mergeStrategy = 'object' } = node.data;

    // Get all incoming node results
    const incoming = this.incomingEdges.get(node.id) || [];
    const inputs: any[] = [];

    for (const edge of incoming) {
      const sourceResult = this.context.nodeResults.get(edge.source);
      if (sourceResult !== undefined) {
        inputs.push(sourceResult);
      }
    }

    // If only one input, pass it through
    if (inputs.length <= 1) {
      return inputs[0] || input;
    }

    logger.info({
      nodeId: node.id,
      inputCount: inputs.length,
      mergeStrategy
    }, '[WorkflowEngine] Executing merge node');

    switch (mergeStrategy) {
      case 'array':
        return inputs;

      case 'object':
        return Object.assign({}, ...inputs.filter(i => typeof i === 'object'));

      case 'concat':
        return inputs.flat();

      default:
        return inputs;
    }
  }

  /**
   * Execute approval node - pauses workflow for human approval
   * This node creates an approval request and pauses execution until approved/rejected
   */
  private async executeApprovalNode(node: WorkflowNode, input: any): Promise<any> {
    const config = node.data as Partial<ApprovalConfig>;
    const {
      approvers = [],
      requiredCount = 1,
      timeout = 86400, // 24 hours default
      timeoutAction = 'reject',
      escalateTo = [],
      message,
      notificationChannels = ['in_app']
    } = config;

    logger.info({
      nodeId: node.id,
      approvers,
      requiredCount,
      timeout
    }, '[WorkflowEngine] Executing approval node - pausing workflow');

    // Create approval record in database
    const approval = await prisma.workflowApproval.create({
      data: {
        execution_id: this.context.executionId,
        node_id: node.id,
        required_approvers: approvers,
        required_count: requiredCount,
        timeout_seconds: timeout,
        timeout_action: timeoutAction,
        status: 'pending',
        message: message || `Approval required for workflow step: ${node.id}`,
        context_data: {
          input,
          nodeResults: Object.fromEntries(this.context.nodeResults),
          notificationChannels
        },
        notification_channels: notificationChannels,
        timeout_at: new Date(Date.now() + timeout * 1000)
      }
    });

    // Update execution status to 'awaiting_approval'
    await prisma.workflowExecution.update({
      where: { id: this.context.executionId },
      data: {
        status: 'awaiting_approval',
        current_node_id: node.id,
        // Store checkpoint for resume
        state: {
          nodeResults: Object.fromEntries(this.context.nodeResults),
          variables: Object.fromEntries(this.context.variables),
          pendingApprovalId: approval.id,
          input
        }
      }
    });

    // Emit approval required event
    this.emitEvent('approval_required', {
      approvalId: approval.id,
      nodeId: node.id,
      approvers,
      message: approval.message,
      expiresAt: approval.timeout_at
    });

    // Send notifications via notification service
    await this.sendApprovalNotifications(approval.id, approvers, message || `Approval required`, notificationChannels);

    // Return approval info - execution is now paused
    return {
      status: 'awaiting_approval',
      approvalId: approval.id,
      message: 'Workflow paused - awaiting human approval',
      approvers,
      expiresAt: approval.timeout_at
    };
  }

  /**
   * Send notifications to approvers
   */
  private async sendApprovalNotifications(
    approvalId: string,
    approvers: string[],
    message: string,
    channels: string[]
  ): Promise<void> {
    try {
      // Import notification service dynamically to avoid circular deps
      const { getNotificationService } = await import('./NotificationService.js');
      const notificationService = getNotificationService();

      await notificationService.sendApprovalRequest({
        approvalId,
        recipients: approvers,
        message,
        channels,
        workflowId: this.context.workflowId,
        executionId: this.context.executionId,
        approvalUrl: `/workflows/approvals/${approvalId}`
      });
    } catch (error) {
      logger.warn({ error, approvalId }, '[WorkflowEngine] Failed to send approval notifications');
      // Don't fail the workflow if notifications fail
    }
  }

  /**
   * Execute wait node - pauses for specified duration
   */
  private async executeWaitNode(node: WorkflowNode, input: any): Promise<any> {
    const { duration = 0, unit = 'seconds' } = node.data;

    // Convert to milliseconds
    let durationMs = duration;
    switch (unit) {
      case 'minutes': durationMs = duration * 60 * 1000; break;
      case 'hours': durationMs = duration * 60 * 60 * 1000; break;
      case 'days': durationMs = duration * 24 * 60 * 60 * 1000; break;
      default: durationMs = duration * 1000; // seconds
    }

    logger.info({
      nodeId: node.id,
      duration,
      unit,
      durationMs
    }, '[WorkflowEngine] Executing wait node');

    // For short waits (< 30s), just sleep
    if (durationMs < 30000) {
      await new Promise(resolve => setTimeout(resolve, durationMs));
      return { waited: true, duration: durationMs };
    }

    // For longer waits, save state and schedule resume
    await prisma.workflowExecution.update({
      where: { id: this.context.executionId },
      data: {
        status: 'waiting',
        current_node_id: node.id,
        resume_at: new Date(Date.now() + durationMs),
        state: {
          nodeResults: Object.fromEntries(this.context.nodeResults),
          variables: Object.fromEntries(this.context.variables),
          input
        }
      }
    });

    this.emitEvent('execution_paused', {
      nodeId: node.id,
      resumeAt: new Date(Date.now() + durationMs),
      reason: 'wait_node'
    });

    return {
      status: 'waiting',
      resumeAt: new Date(Date.now() + durationMs),
      message: `Workflow paused - will resume in ${duration} ${unit}`
    };
  }

  /**
   * Execute Agent Spawn node (A2A) - spawn a sub-agent for specific tasks
   * Enables Agent-to-Agent communication patterns
   */
  private async executeAgentSpawnNode(node: WorkflowNode, input: any): Promise<any> {
    const {
      agentType = 'general',
      task,
      taskDescription,        // Alias for task (templates may use either)
      model,
      tools = [],
      systemPrompt,
      maxTurns = 10,
      timeout = 120000,
      returnType = 'result',
      waitForCompletion = true
    } = node.data;

    // Interpolate task description (support both field names)
    const rawTask = task || taskDescription || '';
    const resolvedTask = this.interpolateTemplate(rawTask, input);

    if (!resolvedTask) {
      throw new Error('Agent spawn node requires a task description');
    }

    // Map agentType/agentRole to openagentic-proxy agent IDs
    const agentRole = node.data.agentRole || agentType;
    const AGENT_TYPE_MAP: Record<string, string> = {
      'general': 'research',
      'researcher': 'research',
      'research': 'research',
      'coder': 'code-generator',
      'code-generator': 'code-generator',
      'analyst': 'data-analyst',
      'data-analyst': 'data-analyst',
      'security-scanner': 'tool-orchestrator',
      'investigator': 'research',
      'deployer': 'tool-orchestrator',
      'urgent-handler': 'research',
      'routine-handler': 'summarizer',
      'planner': 'planner',
      'validator': 'validator',
      'summarizer': 'summarizer',
      'synthesizer': 'synthesizer',
      'deep-reasoner': 'deep-reasoner',
      'fact-checker': 'fact-checker',
    };
    const agentId = AGENT_TYPE_MAP[agentRole] || AGENT_TYPE_MAP[agentType] || 'research';

    logger.info({
      nodeId: node.id,
      agentType,
      agentRole,
      agentId,
      model,
      toolCount: tools.length,
      maxTurns
    }, '[WorkflowEngine] Executing Agent Spawn via openagentic-proxy');

    try {
      // Try openagentic-proxy via the API's /api/agents/:id/execute route
      const executeResponse = await axios.post(
        `${this.apiUrl}/api/agents/${agentId}/execute`,
        {
          task: resolvedTask,
          context: {
            parent_workflow: this.context.workflowId,
            parent_execution: this.context.executionId,
            parent_node: node.id,
            input_data: input,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getInternalAuthHeaders(),
            'X-Workflow-Execution': this.context.executionId,
            'X-User-Id': this.context.userId,
          },
          timeout: 15000, // 15s to get executionId
          validateStatus: () => true,
        }
      );

      if (executeResponse.status >= 200 && executeResponse.status < 300 && executeResponse.data?.executionId) {
        const executionId = executeResponse.data.executionId;

        if (!waitForCompletion) {
          return {
            source: 'agent_spawn',
            agentId,
            executionId,
            status: 'spawned',
            message: 'Agent spawned - running asynchronously',
          };
        }

        // Collect SSE results from /api/agents/stream/:executionId
        const result = await this.collectAgentSSE(executionId, timeout);
        return {
          source: 'agent_spawn',
          agentId,
          agentType: agentRole,
          executionId,
          status: result.status,
          content: result.content,
          output: result.content,
          tokenUsage: result.tokenUsage,
        };
      }

      // Agent-proxy not available — fallback to LLM completion
      logger.warn({
        nodeId: node.id,
        status: executeResponse.status,
        error: executeResponse.data?.error,
      }, '[WorkflowEngine] Agent-proxy unavailable, falling back to LLM completion');

      return this.agentSpawnFallbackLLM(node, resolvedTask, input, agentRole);

    } catch (error: any) {
      // Network error → fallback to LLM completion
      logger.warn({
        nodeId: node.id,
        error: error.message,
      }, '[WorkflowEngine] Agent-proxy call failed, falling back to LLM completion');

      return this.agentSpawnFallbackLLM(node, resolvedTask, input, agentRole);
    }
  }

  /**
   * Collect results from openagentic-proxy SSE stream
   */
  private async collectAgentSSE(
    executionId: string,
    timeout: number
  ): Promise<{ status: string; content: string; tokenUsage?: any }> {
    // Plain Promise executor (no async) so any throw in the inner async IIFE
    // becomes a resolve() path instead of a silently-swallowed rejection.
    return new Promise<{ status: string; content: string; tokenUsage?: any }>((resolve) => {
      const timer = setTimeout(() => {
        resolve({ status: 'timeout', content: 'Agent execution timed out' });
      }, timeout);

      void (async () => {
        try {
          const response = await axios.get(
            `${this.apiUrl}/api/agents/stream/${executionId}`,
            {
              headers: {
                ...this.getInternalAuthHeaders(),
                'Accept': 'text/event-stream',
              },
              responseType: 'stream',
              timeout,
            }
          );

          let content = '';
          let status = 'completed';
          let tokenUsage: any;

          response.data.on('data', (chunk: Buffer) => {
            const text = chunk.toString();
            for (const line of text.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === 'agent_message' || event.type === 'content') {
                    content += event.content || event.data?.content || '';
                  } else if (event.type === 'agent_complete' || event.type === 'complete') {
                    status = event.status || 'completed';
                    content = event.result || event.content || content;
                    tokenUsage = event.token_usage || event.tokenUsage;
                  } else if (event.type === 'agent_error' || event.type === 'error') {
                    status = 'error';
                    content = event.error || event.message || 'Agent execution failed';
                  }
                } catch {
                  // Skip non-JSON lines
                }
              }
            }
          });

          response.data.on('end', () => {
            clearTimeout(timer);
            resolve({ status, content, tokenUsage });
          });

          response.data.on('error', () => {
            clearTimeout(timer);
            resolve({ status: 'error', content: content || 'SSE stream error' });
          });

        } catch (error: any) {
          clearTimeout(timer);
          resolve({ status: 'error', content: `Failed to connect to agent stream: ${error.message}` });
        }
      })();
    });
  }

  /**
   * Fallback: execute agent task via LLM completion when openagentic-proxy is unavailable
   */
  private async agentSpawnFallbackLLM(
    node: WorkflowNode,
    task: string,
    input: any,
    agentRole: string
  ): Promise<any> {
    const systemPrompt = node.data.systemPrompt
      ? this.interpolateTemplate(node.data.systemPrompt, input)
      : `You are a specialized ${agentRole} agent. Complete the assigned task thoroughly and return structured results.`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ];

    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        messages,
        max_tokens: 4096,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId,
        },
        timeout: 120000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content || '';
    return {
      source: 'agent_spawn_fallback',
      agentType: agentRole,
      status: 'completed',
      content,
      output: content,
      usage: response.data?.usage,
    };
  }

  /**
   * Poll for agent completion status (legacy — kept for backwards compat)
   */
  private async pollAgentCompletion(
    agentId: string,
    timeout: number
  ): Promise<{
    status: string;
    result: any;
    history?: any[];
    lastMessage?: any;
    tokenUsage?: any;
    turnCount?: number;
  }> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.get(
          `${this.apiUrl}/api/agents/${agentId}/status`,
          {
            headers: {
              ...this.getInternalAuthHeaders(),
            },
            timeout: 10000
          }
        );

        const { status, result, history, token_usage, turn_count } = response.data;

        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          return {
            status,
            result,
            history,
            lastMessage: history?.[history.length - 1],
            tokenUsage: token_usage,
            turnCount: turn_count
          };
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error: any) {
        logger.warn({
          agentId,
          error: error.message
        }, '[WorkflowEngine] Agent poll failed, retrying...');
      }
    }

    throw new Error(`Agent ${agentId} did not complete within timeout`);
  }

  /**
   * Resume a paused workflow execution from a checkpoint
   * Called when an approval is received or wait time elapses
   */
  async resumeExecution(fromNodeId: string, resumeInput?: any): Promise<{ success: boolean; output: any; error?: string }> {
    logger.info({
      executionId: this.context.executionId,
      fromNodeId,
      hasResumeInput: !!resumeInput
    }, '[WorkflowEngine] Resuming workflow execution');

    this.emitEvent('execution_resumed', {
      nodeId: fromNodeId,
      resumeInput
    });

    try {
      // Get downstream nodes from the resume point
      const outgoing = this.outgoingEdges.get(fromNodeId) || [];

      // Merge resume input with existing context
      const contextInput = resumeInput || this.context.nodeResults.get(fromNodeId) || {};

      // Continue execution from downstream nodes
      for (const edge of outgoing) {
        await this.executeNode(edge.target, contextInput);
      }

      // Get final output
      const terminalNodes = this.definition.nodes.filter(
        n => (this.outgoingEdges.get(n.id)?.length || 0) === 0
      );

      let finalOutput: any = {};
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          finalOutput[node.id] = result;
        }
      }

      if (Object.keys(finalOutput).length === 1) {
        finalOutput = Object.values(finalOutput)[0];
      }

      await this.updateExecutionRecord('completed', finalOutput);
      this.emitEvent('execution_complete', { output: finalOutput });

      // Index workflow results into unified context (Phase 16)
      try {
        const { userContextService } = await import('./UserContextService.js');
        const summary = typeof finalOutput === 'string'
          ? finalOutput.substring(0, 1000)
          : JSON.stringify(finalOutput).substring(0, 1000);
        userContextService.indexUserData(this.context.userId, {
          source: 'workflow',
          sourceId: this.context.workflowId,
          content: `Workflow execution ${this.context.executionId} completed: ${summary}`,
          metadata: {
            executionId: this.context.executionId,
            workflowId: this.context.workflowId,
            nodesExecuted: Array.from(this.context.nodeResults.keys()).length,
          },
        }).catch(() => {});
      } catch {
        // Non-critical
      }

      return { success: true, output: finalOutput };

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      await this.updateExecutionRecord('failed', null, errorMessage);
      this.emitEvent('execution_error', { error: errorMessage });
      return { success: false, output: null, error: errorMessage };
    }
  }

  // ===========================================================================
  // Unified OpenAgentic LLM Node
  // ===========================================================================

  /**
   * Execute an OpenAgentic LLM node - routes through platform's provider system
   * Uses the intelligence slider or explicit model override
   */
  private async executeOpenAgenticLLMNode(node: WorkflowNode, input: any): Promise<any> {
    const { prompt, systemPrompt, temperature, maxTokens, modelOverride, sliderOverride, enableThinking, thinkingBudget } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, modelOverride, sliderOverride }, '[WorkflowEngine] Executing OpenAgentic LLM node');

    const messages: Array<{ role: string; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
    messages.push({ role: 'user', content: resolvedPrompt });

    const requestBody: any = {
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens || 4096,
      stream: false,
    };

    // Allow explicit model override, otherwise let the platform route via slider
    if (modelOverride) {
      requestBody.model = modelOverride;
    }
    if (sliderOverride !== null && sliderOverride !== undefined) {
      requestBody.sliderPosition = sliderOverride;
    }
    if (enableThinking) {
      requestBody.enableThinking = true;
      requestBody.thinkingBudget = thinkingBudget || 8000;
    }

    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId
        },
        timeout: 120000
      }
    );

    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      model: response.data?.model,
      usage: response.data?.usage,
      provider: 'openagentic',
    };
  }

  // ===========================================================================
  // Multi-Agent Orchestrator Node
  // ===========================================================================

  /**
   * Execute a Multi-Agent node - spawns multiple concurrent agents and aggregates results
   */
  private async executeMultiAgentNode(node: WorkflowNode, input: any): Promise<any> {
    const { agents = [], maxConcurrency = 5, aggregationStrategy = 'merge', sharedContext = true, timeoutMs = 120000 } = node.data;

    logger.info({ nodeId: node.id, agentCount: agents.length, maxConcurrency }, '[WorkflowEngine] Executing Multi-Agent Orchestrator');

    if (!agents.length) {
      return { content: 'No agents configured', agents: [] };
    }

    // Build agent tasks from config
    const agentTasks = agents.map((agent: any, idx: number) => {
      const resolvedTask = this.interpolateTemplate(agent.taskDescription || agent.prompt || '', input);
      return {
        id: `agent-${idx}`,
        role: agent.role || `Agent ${idx + 1}`,
        taskDescription: resolvedTask,
        systemPrompt: agent.systemPrompt || '',
      };
    });

    // Execute agents concurrently with concurrency limit
    const results: any[] = [];
    for (let i = 0; i < agentTasks.length; i += maxConcurrency) {
      const batch = agentTasks.slice(i, i + maxConcurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (agentTask: any) => {
          const messages: Array<{ role: string; content: string }> = [];
          if (agentTask.systemPrompt) {
            messages.push({ role: 'system', content: agentTask.systemPrompt });
          }
          if (sharedContext && input) {
            messages.push({ role: 'user', content: `Context: ${JSON.stringify(input)}\n\nTask: ${agentTask.taskDescription}` });
          } else {
            messages.push({ role: 'user', content: agentTask.taskDescription });
          }

          const response = await axios.post(
            `${this.apiUrl}/api/v1/chat/completions`,
            { messages, max_tokens: 4096, stream: false },
            {
              headers: {
                'Content-Type': 'application/json',
                ...this.getInternalAuthHeaders(),
                'X-Workflow-Execution': this.context.executionId,
              },
              timeout: timeoutMs,
            }
          );

          return {
            agentId: agentTask.id,
            role: agentTask.role,
            content: response.data?.choices?.[0]?.message?.content || '',
            usage: response.data?.usage,
          };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({ error: result.reason?.message || 'Agent failed' });
        }
      }
    }

    // Aggregate results
    let aggregated: string;
    switch (aggregationStrategy) {
      case 'first':
        aggregated = results[0]?.content || '';
        break;
      case 'vote':
        // Simple majority — just pick most common response (simplified)
        aggregated = results.map(r => r.content).join('\n\n---\n\n');
        break;
      case 'merge':
      default:
        aggregated = results.map(r => `## ${r.role || r.agentId}\n${r.content}`).join('\n\n');
        break;
    }

    return {
      content: aggregated,
      agents: results,
      agentCount: results.length,
      strategy: aggregationStrategy,
    };
  }

  // ===========================================================================
  // Cloud AI Provider Nodes (Legacy - kept for backwards compatibility)
  // ===========================================================================

  /**
   * Execute a Bedrock node -- sends a prompt to AWS Bedrock via the API's LLM completion endpoint
   */
  private async executeBedrockNode(node: WorkflowNode, input: any): Promise<any> {
    const { model, prompt, systemPrompt, temperature, maxTokens } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, model }, '[WorkflowEngine] Executing Bedrock node');

    const messages: Array<{ role: string; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
    messages.push({ role: 'user', content: resolvedPrompt });

    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || process.env.AWS_BEDROCK_CHAT_MODEL || process.env.DEFAULT_MODEL,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 4096,
        stream: false,
        provider: 'bedrock'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId
        },
        timeout: 120000
      }
    );

    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      model: response.data?.model,
      usage: response.data?.usage,
      provider: 'bedrock'
    };
  }

  /**
   * Execute a Vertex AI node -- sends a prompt to Google Vertex AI via the API's LLM completion endpoint
   */
  private async executeVertexNode(node: WorkflowNode, input: any): Promise<any> {
    const { model, prompt, systemPrompt, temperature, maxTokens } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, model }, '[WorkflowEngine] Executing Vertex AI node');

    const messages: Array<{ role: string; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
    messages.push({ role: 'user', content: resolvedPrompt });

    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || MODELS.vertexChat,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 4096,
        stream: false,
        provider: 'vertex'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId
        },
        timeout: 120000
      }
    );

    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      model: response.data?.model,
      usage: response.data?.usage,
      provider: 'vertex'
    };
  }

  /**
   * Execute an Azure AI node -- sends a prompt to Azure OpenAI via the API's LLM completion endpoint
   */
  private async executeAzureAINode(node: WorkflowNode, input: any): Promise<any> {
    const { model, prompt, systemPrompt, temperature, maxTokens, deploymentName } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, model, deploymentName }, '[WorkflowEngine] Executing Azure AI node');

    const messages: Array<{ role: string; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
    messages.push({ role: 'user', content: resolvedPrompt });

    const response = await axios.post(
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || deploymentName || MODELS.azureOpenai,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 4096,
        stream: false,
        provider: 'azure_openai'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId
        },
        timeout: 120000
      }
    );

    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      model: response.data?.model,
      usage: response.data?.usage,
      provider: 'azure_openai'
    };
  }

  /**
   * Execute an Openagentic node -- runs code in a managed execution pod via the code manager
   */
  private async executeOpenagenticNode(node: WorkflowNode, input: any): Promise<any> {
    const { language, code, timeout: execTimeout } = node.data;
    const resolvedCode = this.interpolateTemplate(code || '', input);

    logger.info({
      nodeId: node.id,
      language: language || 'python',
      codeLength: resolvedCode.length
    }, '[WorkflowEngine] Executing Openagentic node');

    try {
      const response = await axios.post(
        `${this.openagenticManagerUrl}/api/execute`,
        {
          language: language || 'python',
          code: resolvedCode,
          timeout: execTimeout || 30000,
          workflowExecutionId: this.context.executionId
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.context.authToken || '',
            'X-Internal-Service': process.env.INTERNAL_SERVICE_SECRET || ''
          },
          timeout: (execTimeout || 30000) + 10000
        }
      );

      return {
        stdout: response.data?.stdout || '',
        stderr: response.data?.stderr || '',
        exitCode: response.data?.exitCode ?? 0,
        language: language || 'python'
      };
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`Openagentic manager is not reachable at ${this.openagenticManagerUrl}`);
      }
      throw new Error(`Openagentic execution failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Execute an Agent-Proxy node -- delegates to openagentic-proxy service for orchestrated agent execution
   */
  private async executeOpenAgenticProxyNode(
    node: WorkflowNode,
    input: any,
    orchestration: 'parallel' | 'sequential' | 'supervisor'
  ): Promise<any> {
    const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300';
    const nodeData = node.data || {};

    logger.info({
      nodeId: node.id,
      nodeType: node.type,
      orchestration,
      agentId: nodeData.agentId
    }, '[WorkflowEngine] Executing openagentic-proxy node');

    // Build agent specs based on node type
    let agents: any[] = [];

    if (node.type === 'agent_single') {
      agents = [{
        agentId: nodeData.agentId || undefined,
        role: nodeData.role || 'custom',
        task: this.interpolateTemplate(nodeData.prompt || nodeData.task || '{{input.message}}', input),
        model: nodeData.model || undefined,
        tools: nodeData.tools || [],
        systemPrompt: nodeData.systemPrompt || undefined,
        maxTurns: nodeData.maxTurns || 5,
        costBudget: nodeData.costBudget || 50,
        timeout: nodeData.timeout || 60000,
      }];
    } else if (node.type === 'agent_pool') {
      const agentList = nodeData.agents || [];
      agents = agentList.map((a: any) => ({
        agentId: a.agentId || undefined,
        role: a.role || 'custom',
        task: this.interpolateTemplate(a.task || '{{input.message}}', input),
        model: a.model || undefined,
        tools: a.tools || [],
        maxTurns: a.maxTurns || 5,
        costBudget: a.costBudget || 50,
        timeout: a.timeout || 60000,
      }));
      if (agents.length === 0) {
        return { error: 'Agent pool has no agents configured', output: '' };
      }
    } else if (node.type === 'agent_supervisor') {
      const workers = nodeData.workers || [];
      agents = [{
        role: 'supervisor',
        task: this.interpolateTemplate(nodeData.supervisorPrompt || '{{input.message}}', input),
        model: nodeData.supervisorModel || undefined,
        maxTurns: nodeData.maxTurns || 10,
      }];
      // Workers are passed alongside for the supervisor strategy
      for (const w of workers) {
        agents.push({
          agentId: w.agentId || undefined,
          role: w.role || 'custom',
          task: '{{delegated}}', // Supervisor assigns tasks dynamically
          model: w.model || undefined,
          tools: w.tools || [],
          maxTurns: w.maxTurns || 5,
        });
      }
    }

    try {
      const response = await axios.post(
        `${openagenticProxyUrl}/api/agents/execute-sync`,
        {
          agents,
          orchestration,
          aggregation: nodeData.aggregation || 'merge',
          sessionId: this.context.executionId,
          userId: this.context.userId,
          userMessage: typeof input === 'string' ? input : (input?.message || JSON.stringify(input)),
          totalBudgetCents: nodeData.totalBudget || 200,
          timeoutMs: nodeData.timeout || 120000,
          maxConcurrency: nodeData.concurrency || 5,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.context.authToken || '',
            'X-Internal-Service': process.env.INTERNAL_SERVICE_SECRET || '',
            'X-Workflow-Execution': this.context.executionId,
          },
          timeout: (nodeData.timeout || 120000) + 30000,
        }
      );

      return {
        output: response.data?.output || response.data?.results || '',
        agents: response.data?.results || [],
        metrics: response.data?.metrics || {},
        orchestration,
        status: response.data?.status || 'completed',
      };
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`Agent-proxy service is not reachable at ${openagenticProxyUrl}. Ensure the openagentic-proxy deployment is running.`);
      }
      throw new Error(`Agent-proxy execution failed: ${error.response?.data?.error || error.message}`);
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Interpolate template variables like {{steps.nodeId.output}}, {{env.VAR}},
   * {{trigger.body.field}}, {{nodeId.output}}, {{now}}, {{item.field}}
   */
  private interpolateTemplate(template: string, context: any): string {
    if (!template) return template;

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();

      // Built-in temporal variables
      if (trimmedPath === 'now') {
        return new Date().toISOString();
      }
      if (trimmedPath === 'today') {
        return new Date().toISOString().slice(0, 10) + 'T00:00:00.000';
      }
      if (trimmedPath === 'today_minus_1') {
        return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T00:00:00.000';
      }
      if (trimmedPath === 'fifteen_minutes_ago') {
        return new Date(Date.now() - 15 * 60 * 1000).toISOString();
      }
      if (trimmedPath === 'generated_temp_password') {
        const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
        let pwd = '';
        for (let i = 0; i < 16; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
        return pwd;
      }

      // {{steps.<nodeId>.<path>}} - reference another node's output
      if (trimmedPath.startsWith('steps.')) {
        const parts = trimmedPath.slice(6).split('.'); // Remove 'steps.' prefix
        const nameOrId = parts[0];
        const rest = parts.slice(1);
        // Try direct node ID first
        let value = this.context.nodeResults.get(nameOrId);
        // Fallback: match by node label (case-insensitive, normalize hyphens/spaces)
        if (value === undefined) {
          const normalized = nameOrId.toLowerCase().replace(/[-_\s]+/g, '-');
          for (const [nId, nResult] of this.context.nodeResults.entries()) {
            const node = this.nodeMap.get(nId);
            const label = (node?.data?.label || '').toLowerCase().replace(/[-_\s]+/g, '-');
            if (label === normalized || nId.toLowerCase() === normalized) {
              value = nResult;
              break;
            }
          }
        }
        if (value !== undefined) {
          for (const key of rest) {
            value = value?.[key];
          }
        }
        if (value !== undefined) {
          return typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        // If still unresolved, check if node hasn't executed yet (return empty rather than raw template)
        logger.warn({ variable: trimmedPath }, '[WorkflowEngine] Template variable unresolved (steps)');
        return '';
      }

      // {{env.<VAR>}} - environment variables
      if (trimmedPath.startsWith('env.')) {
        const envVar = trimmedPath.slice(4);
        const value = this.context.variables.get(`env.${envVar}`) ?? process.env[envVar];
        if (value !== undefined) return String(value);
        logger.warn({ variable: trimmedPath }, '[WorkflowEngine] Env variable unresolved');
        return '';
      }

      // {{secret:<name>}} - resolved workflow secrets (pre-loaded in execute())
      if (trimmedPath.startsWith('secret:')) {
        const secretName = trimmedPath.slice(7);
        const resolved = (this.context as any).resolvedSecrets?.get(secretName);
        if (resolved !== undefined) return String(resolved);
        logger.warn({ secretName }, '[WorkflowEngine] Secret not found in resolved secrets');
        return match;
      }

      // {{trigger.<path>}} - trigger node input
      if (trimmedPath.startsWith('trigger.')) {
        const triggerResult = this.context.nodeResults.get('__trigger__');
        if (triggerResult) {
          const parts = trimmedPath.slice(8).split('.'); // Remove 'trigger.' prefix
          let value: any = triggerResult;
          for (const key of parts) {
            value = value?.[key];
          }
          if (value !== undefined) {
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
          }
        }
        // Also check if workflow input has the data directly (e.g., {{trigger.body.description}} where input = {description: "..."})
        if (this.context.input) {
          const parts = trimmedPath.slice(8).split('.');
          let value: any = { body: this.context.input, ...this.context.input };
          for (const key of parts) {
            value = value?.[key];
          }
          if (value !== undefined) {
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
          }
        }
        logger.warn({ variable: trimmedPath }, '[WorkflowEngine] Trigger variable unresolved');
        return '';
      }

      // Direct node ID reference: {{nodeId.output.path}} or {{nodeLabel.output.path}}
      {
        const [nameOrId, ...rest] = trimmedPath.split('.');
        let resolvedNodeId: string | undefined;
        // Check direct node ID
        if (this.nodeMap.has(nameOrId)) {
          resolvedNodeId = nameOrId;
        } else {
          // Fallback: match by node label
          const normalized = nameOrId.toLowerCase().replace(/[-_\s]+/g, '-');
          for (const [nId, node] of this.nodeMap.entries()) {
            const label = (node.data?.label || '').toLowerCase().replace(/[-_\s]+/g, '-');
            if (label === normalized) {
              resolvedNodeId = nId;
              break;
            }
          }
        }
        if (resolvedNodeId) {
          let value = this.context.nodeResults.get(resolvedNodeId);
          for (const key of rest) {
            value = value?.[key];
          }
          if (value !== undefined) {
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
          }
        }
      }

      // Check context variables
      if (this.context.variables.has(trimmedPath)) {
        return String(this.context.variables.get(trimmedPath));
      }

      // Navigate the path in context (for {{input.field}}, {{item.field}}, etc.)
      let value: any = context;
      for (const key of trimmedPath.split('.')) {
        value = value?.[key];
      }

      if (value !== undefined) {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      }

      // Variable unresolved — return empty string instead of raw {{...}} so LLMs don't see template syntax
      logger.warn({ variable: trimmedPath }, '[WorkflowEngine] Template variable unresolved');
      return '';
    });
  }

  /**
   * Emit an execution event
   */
  private emitEvent(type: ExecutionEvent['type'], data?: any): void {
    const event: ExecutionEvent = {
      type,
      executionId: this.context.executionId,
      timestamp: new Date().toISOString(),
      ...data
    };

    this.emit('event', event);
  }

  /**
   * Store node execution in database
   */
  private async storeNodeExecution(
    nodeId: string,
    nodeType: string,
    status: 'completed' | 'failed' | 'failed_with_fallback',
    output: any,
    executionTimeMs: number,
    error?: string,
    input?: any,
  ): Promise<void> {
    try {
      const safeOutput = output ? JSON.parse(JSON.stringify(output)) : null;
      const safeInput = input ? JSON.parse(JSON.stringify(input)) : null;

      // Write node-level log
      await prisma.workflowExecutionLog.create({
        data: {
          execution_id: this.context.executionId,
          node_id: nodeId,
          level: status === 'completed' ? 'info' : 'error',
          message: `Node ${nodeType} (${nodeId}) ${status} in ${executionTimeMs}ms`,
          data: {
            node_type: nodeType,
            status,
            input: safeInput,
            output: safeOutput,
            error,
            execution_time_ms: executionTimeMs
          }
        }
      });

      // Accumulate node outputs locally (written in updateExecutionRecord)
      this.pendingNodeOutputs.set(nodeId, {
        status,
        input: safeInput,
        output: safeOutput,
        error: error || null,
        duration: executionTimeMs,
        nodeType,
      });
    } catch (err) {
      logger.error({ err, nodeId }, '[WorkflowEngine] Failed to store node execution');
    }
  }

  /**
   * Flush accumulated node outputs to the workflowExecution record in a single write.
   * This avoids read-modify-write races from per-node merges.
   */
  private async flushNodeOutputs(): Promise<void> {
    if (this.pendingNodeOutputs.size === 0) return;
    try {
      const nodeOutputs: Record<string, any> = {};
      for (const [nodeId, data] of this.pendingNodeOutputs) {
        nodeOutputs[nodeId] = data;
      }
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: { node_outputs: nodeOutputs }
      });
    } catch (err) {
      logger.error({ err }, '[WorkflowEngine] Failed to flush node_outputs');
    }
  }

  /**
   * Update the main execution record (includes flushing node_outputs)
   */
  private async updateExecutionRecord(
    status: 'completed' | 'failed',
    output: any,
    error?: string
  ): Promise<void> {
    const executionTimeMs = Date.now() - this.context.startTime;
    const completedNodes = Array.from(this.context.nodeResults.keys()).length;

    // Build node_outputs from accumulated pending results
    const nodeOutputs: Record<string, any> = {};
    for (const [nodeId, data] of this.pendingNodeOutputs) {
      nodeOutputs[nodeId] = data;
    }

    try {
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: {
          status,
          output: output ? JSON.parse(JSON.stringify(output)) : null,
          node_outputs: Object.keys(nodeOutputs).length > 0 ? nodeOutputs : undefined,
          error,
          completed_nodes: completedNodes,
          execution_time_ms: executionTimeMs,
          completed_at: new Date()
        }
      });
    } catch (err) {
      logger.error({ err }, '[WorkflowEngine] Failed to update execution record');
    }
  }

  /**
   * Abort a running workflow execution.
   * Signals all in-flight node executions to cancel and updates the
   * execution status to 'aborted'. Returns partial results collected so far.
   */
  abortExecution(reason?: string): void {
    if (this.abortController.signal.aborted) return;

    const msg = reason ?? 'Workflow execution aborted by user';
    this.abortController.abort(new Error(msg));

    this.emit('execution_aborted', {
      executionId: this.context.executionId,
      reason: msg,
      completedNodes: Array.from(this.context.nodeResults?.keys() ?? []),
    });
  }

  /**
   * Get the abort signal for this execution (for passing to sub-operations).
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }
}

// =============================================================================
// Factory function for easy instantiation
// =============================================================================

// =============================================================================
// Running engine registry (for abort/stop API)
// =============================================================================

const runningEngines = new Map<string, WorkflowExecutionEngine>();

export function getRunningEngine(executionId: string): WorkflowExecutionEngine | undefined {
  return runningEngines.get(executionId);
}

export function abortWorkflowExecution(executionId: string, reason?: string): boolean {
  const engine = runningEngines.get(executionId);
  if (!engine) return false;
  engine.abortExecution(reason);
  return true;
}

export async function executeWorkflow(
  workflowId: string,
  executionId: string,
  definition: WorkflowDefinition,
  input: Record<string, any>,
  userId: string,
  authToken?: string,
  onEvent?: (event: ExecutionEvent) => void,
  opts?: { userEmail?: string; idToken?: string }
): Promise<{ success: boolean; output: any; error?: string }> {
  const context: ExecutionContext = {
    executionId,
    workflowId,
    userId,
    authToken,
    idToken: opts?.idToken,
    userEmail: opts?.userEmail,
    input,
    variables: new Map(),
    nodeResults: new Map(),
    startTime: Date.now()
  };

  const engine = new WorkflowExecutionEngine(definition, context);

  if (onEvent) {
    engine.on('event', onEvent);
  }

  // Register engine for abort API
  runningEngines.set(executionId, engine);

  try {
    return await engine.execute();
  } finally {
    runningEngines.delete(executionId);
  }
}
