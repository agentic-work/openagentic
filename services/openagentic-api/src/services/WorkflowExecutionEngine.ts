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
import { canAutoApprove } from './approvalGate.js';
import { createApprovalRecord } from './approvalRecord.js';
import { redactSecrets, redactLogMeta, type RedactionMap } from './secretRedaction.js';
import axios from 'axios';
import { abortableAxiosPost, abortableAxiosGet, abortableAxios } from './abortableAxios.js';
import { ModelConfigurationService } from './ModelConfigurationService.js';
import { subscribeAgentProgressForWorkflowNode } from './workflowAgentProgressBridge.js';
import { runSandboxed } from './sandbox.js';
// Schema-driven plugin registry (Task #41 — closes the api fallback gap on
// outputAssertions). Migrated nodes go through the registry so the same
// refusal-detection / fake-success protections apply when the api engine runs
// a flow directly (WORKFLOW_SERVICE_URL unset OR forwarding fails).
import {
  registry as nodeRegistry,
  runWithAssertions,
} from '@openagentic/workflow-engine/nodes/registry';
import {
  OutputAssertionError,
  type NodeExecutionContext as SharedNodeCtx,
  type NodePlugin as SharedNodePlugin,
} from '@openagentic/workflow-engine/nodes/types';
// Approval gate + audit (HIGH-severity bypass fix, 2026-06-20). When the api
// engine runs a flow in-process (WORKFLOW_SERVICE_URL unset / forwarding
// fails), its mcp_tool node must be governed by the SAME runAuditAndGate as
// chat/orchestrate. In-process here — no HTTP self-call needed.
import { runAuditAndGate } from './approval/auditAndGate.js';

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
  /**
   * Caller's tenant id (Azure AD `azure_tenant_id`). Theme A / S1-1.
   * Threaded from the API request layer (`request.tenantId`) into the
   * engine; the engine in turn copies it onto every NodeExecutionContext
   * it constructs so executors inherit the same tenant scoping.
   */
  tenantId?: string | null;
  authToken?: string;
  /** Azure AD ID token for AWS/Azure OBO federation */
  idToken?: string;
  /** User email for MCP workspace isolation */
  userEmail?: string;
  /** Trigger initiating this execution: webhook|schedule|manual|event|api|test. Used to gate test-only behavior. */
  triggerType?: string;
  /** Permissions of the caller. Used by approvalGate / per-node ACLs. */
  userPermissions?: readonly string[];
  input: Record<string, any>;
  variables: Map<string, any>;
  nodeResults: Map<string, any>;
  startTime: number;
  agenticExecutionId?: string;
  /** Resolved secret values keyed by secret name. Populated at execution start. */
  resolvedSecrets?: Map<string, string>;
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

// Lazy import for AgentRegistry (avoids circular dependencies)
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

    // Initialize retry state tracking
    this.nodeRetryState = new Map();
    this.pendingNodeOutputs = new Map();
  }

  /**
   * Get internal service auth headers for self-calls (LLM endpoint, etc.)
   * Uses INTERNAL_SERVICE_SECRET bypass so workflow LLM calls don't depend on user JWT validity.
   * Cloud MCP calls use the per-MCP Service Account credentials (no user-token OBO).
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
          this.context.resolvedSecrets = resolvedSecrets;
          logger.debug({ count: resolvedSecrets.size }, '[WorkflowEngine] Pre-loaded workflow secrets'); // metadata only — no secret interpolation
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
          const importance = ['llm_completion', 'openagentic_llm', 'code'].includes(node.type)
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
            this.safeLog('warn', { nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (disabled passthrough)'); // error.message may contain secret-interpolated content
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
            this.safeLog('warn', { nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (pinned data)'); // error.message may contain secret-interpolated content
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
        this.safeLog('info', { nodeId, resultType: typeof result, resultPreview: JSON.stringify(result)?.substring(0, 100) } as Record<string, unknown>, '[WorkflowEngine] Storing node result');
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
              // Record tool calls for MCP tool nodes
              if (node.type === 'mcp_tool') {
                const toolName = node.data.toolName || node.data.toolServer
                  ? `${node.data.toolServer || 'unknown'}/${node.data.toolName || 'unknown'}`
                  : nodeId;
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
          // Auto-approve gate: only when trigger_type='test' AND caller has the
          // flows:test:auto-approve permission. The legacy `input.autoApprove`
          // flag alone is no longer sufficient — see approvalGate.ts.
          if (canAutoApprove(this.context)) {
            logger.info({ nodeId, executionId: this.context.executionId }, '[WorkflowEngine] Auto-approving for automated test (gated)');
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

        // Execute downstream nodes — UNLESS the node owns its own routing.
        // condition routes via ctx.routeBranches; retry_with_backoff drives +
        // re-runs its downstream via ctx.runSubStep. Re-firing those outgoing
        // edges here would double-execute the guarded subgraph.
        if (node.type !== 'condition' && node.type !== 'retry_with_backoff') {
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
                  this.safeLog('warn', { nodeId, error: br.reason?.message }, '[WorkflowEngine] Branch execution failed (fallback)'); // error.message may contain secret-interpolated content
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
    // Schema-driven plugin path (Task #41) — migrated nodes go through the
    // shared registry so the api engine applies the same outputAssertions
    // (refusal detection, "fake success" catches) as workflows-service.
    // Falls through to the legacy switch for unmigrated types.
    const plugin = nodeRegistry.get(node.type);
    if (plugin) {
      return this.runRegistryNode(plugin as SharedNodePlugin, node, input);
    }

    // Execute based on node type
    switch (node.type) {
      // (trigger — now schema-driven via nodes/trigger/, see registry above)
      case 'llm_completion':
        return this.executeLLMNode(node, input);
      case 'mcp_tool':
        return this.executeMCPToolNode(node, input);
      // (code — now schema-driven via shared nodes/code/, see registry above.
      //  Legacy executeCodeNode is dead code retained for now (Task #46))
      // (condition — now schema-driven via shared nodes/condition/, see
      //  registry above. Legacy executeConditionNode is dead code retained
      //  for now (Task #45))
      // (loop — now schema-driven via shared nodes/loop/, see registry above.
      //  Legacy executeLoopNode is dead code retained for now (Task #45))
      case 'transform':
        return this.executeTransformNode(node, input);
      case 'merge':
        return this.executeMergeNode(node, input);
      // (approval / human_approval — now schema-driven via shared
      //  nodes/human_approval/ (with 'approval' as a registered alias),
      //  see registry. Legacy executeApprovalNode is dead code retained
      //  for now)
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
      // (user_context — now schema-driven via nodes/user_context/, see registry above)
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  /**
   * Execute a registry-backed node and validate the output against its
   * schema.outputAssertions. Mirrors workflows-service runRegistryNode.
   * On OutputAssertionError, emits a node_error with reason + failedAssertion
   * so the UI can distinguish a "fake success" catch from a generic failure
   * — then rethrows so executeNodeWithRecovery's retry/fallback path runs.
   */
  private async runRegistryNode(
    plugin: SharedNodePlugin,
    node: WorkflowNode,
    input: any,
  ): Promise<any> {
    const ctx: SharedNodeCtx = {
      signal: this.abortController.signal,
      executionId: this.context.executionId,
      workflowId: this.context.workflowId,
      // Theme A / S1-1 — forward the caller's tenant onto every node ctx
      // so executors that touch Prisma inherit tenant scoping.
      tenantId: this.context.tenantId ?? undefined,
      apiUrl: this.apiUrl,
      mcpProxyUrl: this.mcpProxyUrl,
      openagenticProxyUrl: process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300',
      openagenticProxyInternalKey: process.env.OPENAGENTIC_PROXY_INTERNAL_KEY,
      userId: this.context.userId,
      authToken: this.context.authToken,
      idToken: this.context.idToken,
      userEmail: this.context.userEmail,
      interpolateTemplate: (t, i) => this.interpolateTemplate(t, i),
      getInternalAuthHeaders: () => this.getInternalAuthHeaders(),
      // Approval gate + audit for mcp_tool (HIGH-severity bypass fix,
      // 2026-06-20). In-process: this api engine path is in the SAME service
      // as runAuditAndGate, so call it directly (origin 'subagent') instead of
      // an HTTP self-call. The executor blocks the proxy call when allowed is
      // false; a gate throw is caught there and fail-safe-blocks mutating calls.
      gateMcpCall: async (call) => {
        const res = await runAuditAndGate({
          toolName: call.toolName,
          serverName: call.serverName,
          args: call.args ?? {},
          userId: this.context.userId,
          sessionId: this.context.executionId,
          origin: 'subagent',
          // No SSE emit on the in-process flow path: a MUTATING call with the
          // gate ON blocks on ApprovalRegistry.waitFor until approved via the
          // approve/deny route or times out → deny (fail safe).
          logger,
        });
        return {
          allowed: res.allowed,
          blockReason: res.blockReason,
          classification: res.classification,
        };
      },
      logger,
      // webhook_response stash hook — same pattern as workflows-service.
      setWebhookResponse: (response) => {
        (this.context as any).webhookResponse = response;
      },
      // merge node fan-in hook.
      getIncomingResults: (nodeId) => {
        const incoming = this.incomingEdges.get(nodeId) || [];
        const results: Array<{ sourceId: string; label: string; value: unknown }> = [];
        for (const edge of incoming) {
          const value = this.context.nodeResults.get(edge.source);
          if (value !== undefined) {
            const sourceNode = this.nodeMap.get(edge.source);
            const label = (sourceNode?.data?.label || sourceNode?.id || edge.source)
              .replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            results.push({ sourceId: edge.source, label, value });
          }
        }
        return results;
      },

      // Control-flow plugins (Task #45). The api engine never had a
      // notifySkippedBranch helper or as-sophisticated parallel impl as
      // workflows-service; both are added here as same-shape inline impls
      // so condition / switch / parallel / loop can run on the schema-
      // driven path when the api engine is the fallback executor.
      getOutgoingEdges: (nodeId) => {
        const outgoing = this.outgoingEdges.get(nodeId) || [];
        return outgoing.map(e => ({
          target: e.target,
          label: e.label,
          sourceHandle: e.sourceHandle,
        }));
      },

      // condition + switch routing. The api engine's legacy
      // executeConditionNode/executeSwitchNode never carried the
      // notifySkippedBranch wiring (workflows-service alone owned the
      // switch→merge fix). Mirror the same notify-skip-then-execute order
      // here for parity, but the no-op fallback path stays correct because
      // Task #45's executors only push targets onto skip[] for actual
      // unchosen branches.
      routeBranches: async (_fromNodeId, decision, branchInput) => {
        // The api engine doesn't track merge gates separately — but routing
        // still needs to happen. Skipped branches have no work; followed
        // branches execute sequentially. (Note: if we ever back-port the
        // notifySkippedBranch logic from workflows-service, this is the
        // call site that would invoke it.)
        for (const followedTarget of decision.follow) {
          await this.executeNode(followedTarget, branchInput);
        }
      },

      // parallel fan-out. Same Promise.allSettled pattern that
      // workflows-service uses, just inline here.
      fanOutBranches: async (fromNodeId, branchInput) => {
        const outgoing = this.outgoingEdges.get(fromNodeId) || [];
        const settled = await Promise.allSettled(
          outgoing.map(edge => this.executeNode(edge.target, branchInput)),
        );
        return settled.map((s, i) => ({
          targetId: outgoing[i].target,
          status: s.status,
          value: s.status === 'fulfilled' ? s.value : undefined,
          reason:
            s.status === 'rejected'
              ? s.reason instanceof Error
                ? s.reason.message
                : String(s.reason)
              : undefined,
        }));
      },

      // loop per-iteration subgraph execution.
      iterateOver: async (fromNodeId, items, itemVariable, baseInput) => {
        const outgoing = this.outgoingEdges.get(fromNodeId) || [];
        const results: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          const currentItem = items[i];
          let loopInput: unknown;
          if (typeof currentItem !== 'object' || currentItem === null) {
            loopInput = currentItem;
          } else {
            loopInput = {
              ...(typeof baseInput === 'object' && baseInput !== null ? baseInput : {}),
              ...(currentItem as Record<string, unknown>),
              [itemVariable]: currentItem,
              __loopIndex: i,
              __loopTotal: items.length,
            };
          }
          for (const edge of outgoing) {
            const result = await this.executeNode(edge.target, loopInput);
            results.push(result);
          }
        }
        return results;
      },

      // retry_with_backoff: execute the node's outgoing subgraph exactly once
      // and surface the FIRST rejection. Mirrors the workflows-service impl —
      // sequential over the happy-path edges, no allSettled, so a downstream
      // failure rejects this hook and the executor's retry loop catches it to
      // back off. Returns the terminal subgraph result.
      runSubStep: async (fromNodeId: string, branchInput: unknown) => {
        const outgoing = (this.outgoingEdges.get(fromNodeId) || []).filter(
          (e) => e.sourceHandle !== 'error' && e.label !== 'error',
        );
        if (outgoing.length === 0) {
          throw new Error(
            `retry_with_backoff[${fromNodeId}]: no downstream step to run — ` +
              'connect a node to its output so there is an operation to retry.',
          );
        }
        let last: unknown;
        for (const edge of outgoing) {
          last = await this.executeNode(edge.target, branchInput);
        }
        return last;
      },

      // trigger node hook — publish first-event payload onto the execution
      // context so {{trigger.body.*}} resolves for downstream nodes.
      setTriggerData: (triggerData) => {
        this.context.nodeResults.set('__trigger__', triggerData);
      },

      // Resolve the calling user's email for nodes that need it (e.g.
      // credential lookup). Returns null on miss.
      getUserEmail: async () => {
        if (!this.context.userId) return null;
        try {
          const user = await prisma.user.findUnique({
            where: { id: this.context.userId },
            select: { email: true },
          });
          return user?.email ?? null;
        } catch {
          return null;
        }
      },

      // code / openagentic (Task #46): run user-supplied JS in the shared
      // isolated-vm sandbox. Mirrors the legacy executeJavaScript helper.
      runIsolatedCode: async (code, language, codeInput, timeoutMs) => {
        if (language !== 'javascript') {
          throw new Error(
            `Language ${language} execution not supported in the in-process sandbox.`,
          );
        }
        const result = await runSandboxed(code, {
          timeoutMs: timeoutMs ?? 5000,
          memoryCapMb: 256,
          input: codeInput,
        });
        if (!result.ok) {
          throw new Error(`Code execution error (${result.errorType}): ${result.error}`);
        }
        return result.value;
      },

      // sub_workflow hook — the api copy never historically supported the
      // sub_workflow legacy switch case, but the schema-driven plugin now
      // works in either engine. Returns "not supported" so any flow that
      // routes a sub_workflow node through the api engine surfaces a clear
      // error rather than a silent no-op.
      executeSubWorkflow: async (workflowId, _subInput) => ({
        success: false,
        output: undefined,
        error: `Sub-workflow execution not supported in api engine; route through openagentic-workflows. workflowId=${workflowId}`,
      }),

      // human_approval / approval — persist approval row, checkpoint
      // execution state, emit `approval_required`, and dispatch
      // notifications. Mirrors the workflows-service hook; both engine
      // copies must stay byte-identical until S0-11 dedup completes.
      pauseForApproval: async (payload) => {
        const approval = await createApprovalRecord(prisma, {
          executionId: this.context.executionId,
          nodeId: payload.nodeId,
          approvers: payload.approvers,
          requiredCount: payload.requiredCount,
          timeoutSeconds: payload.timeoutSeconds,
          timeoutAction: payload.timeoutAction,
          message: payload.message,
          contextData: {
            input: payload.input,
            nodeResults: Object.fromEntries(this.context.nodeResults),
            notificationChannels: payload.notificationChannels,
          },
          notificationChannels: payload.notificationChannels,
        });

        await prisma.workflowExecution.update({
          where: { id: this.context.executionId },
          data: {
            status: 'awaiting_approval',
            current_node_id: payload.nodeId,
            state: {
              nodeResults: Object.fromEntries(this.context.nodeResults),
              variables: Object.fromEntries(this.context.variables),
              pendingApprovalId: approval.id,
              input: payload.input as any,
            } as any,
          },
        });

        this.emitEvent('approval_required', {
          approvalId: approval.id,
          nodeId: payload.nodeId,
          approvers: payload.approvers,
          message: approval.message || payload.message,
          expiresAt: approval.timeout_at,
        });

        await this.sendApprovalNotifications(
          approval.id,
          payload.approvers,
          payload.message,
          payload.notificationChannels,
        );

        return {
          id: approval.id,
          message: (approval.message as string) || payload.message,
          timeout_at: approval.timeout_at as Date | string,
        };
      },
    };

    let result: any;
    try {
      result = await runWithAssertions(plugin, node, input, ctx);
    } catch (err) {
      if (err instanceof OutputAssertionError) {
        this.emitEvent('node_error', {
          nodeId: node.id,
          nodeType: node.type,
          error: err.message,
          reason: err.reason,
          failedAssertion: err.failedAssertion,
        });
      }
      throw err;
    }

    return result;
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
          this.safeLog('debug', { error: error.message, pattern }, '[WorkflowEngine] Error matches skip pattern, not retrying'); // error.message may contain secret-interpolated content
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
    const { model, temperature, maxTokens, prompt, systemPrompt, stream: nodeStream } = node.data;

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

    // Phase E₂.2 — stream LLM deltas into `node_stream` events interleaved
    // between `node_start` and `node_complete`. The inner payload is a
    // canonical `AnthropicStreamEvent` (content_block_start/delta/stop)
    // so the flow UI can render live thinking / text inside the node
    // card before `node_complete` fires. Stream-mode can be disabled
    // per node via `node.data.stream === false` for backward compat
    // with flows that expect the legacy non-streaming path.
    const wantsStream = nodeStream !== false && this.hasListenerForStream();
    if (wantsStream) {
      try {
        return await this.executeLLMNodeStreaming(node, messages, model, temperature, maxTokens);
      } catch (streamErr: any) {
        // If streaming fails (e.g. downstream endpoint doesn't support
        // the stream flag), fall back to the non-streaming path so the
        // flow doesn't hard-fail on migrations.
        logger.warn({
          err: streamErr?.message,
          nodeId: node.id,
        }, '[WorkflowEngine] LLM streaming failed, falling back to non-stream');
      }
    }

    // Legacy non-streaming path — unchanged from pre-E₂ behaviour.
    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || (await ModelConfigurationService.getDefaultChatModel().catch(() => '')),
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
   * Return true if any consumer is listening for `event` emits — the
   * streaming path is only worth the overhead when there's a UI on the
   * other end of the NDJSON pipe.
   */
  private hasListenerForStream(): boolean {
    return this.listenerCount('event') > 0;
  }

  /**
   * Phase E₂.2: execute an LLM node in streaming mode. Calls the
   * internal OpenAI-compatible endpoint with `stream: true`, consumes
   * the NDJSON response line-by-line, and re-emits each canonical
   * event as a `node_stream` ExecutionEvent scoped to this node. The
   * accumulated text is returned as the node output so downstream
   * nodes see the same shape they used to.
   */
  private async executeLLMNodeStreaming(
    node: WorkflowNode,
    messages: Array<{ role: string; content: string }>,
    model: string | undefined,
    temperature: number | undefined,
    maxTokens: number | undefined,
  ): Promise<{ content: string; model?: string; usage?: any }> {
    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || (await ModelConfigurationService.getDefaultChatModel().catch(() => '')),
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens || 2000,
        stream: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId,
        },
        timeout: 600000,
        responseType: 'stream',
      },
    );

    let accumulatedText = '';
    let finalModel: string | undefined = undefined;
    let finalUsage: any = undefined;
    let buffer = '';

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return; // skip malformed lines
      }
      // Re-emit every streamed event as `node_stream` scoped to this node.
      // The inner event retains its `type` so the UI can discriminate on
      // `content_block_delta` / `content_block_start` / etc. exactly as
      // it does for chat.
      this.emitEvent('node_stream', {
        nodeId: node.id,
        nodeType: node.type,
        event: parsed,
      });

      // Opportunistically extract text/model/usage so the node's return
      // value still matches the non-streaming shape.
      const eventType = parsed.type as string | undefined;
      if (eventType === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        accumulatedText += parsed.delta.text || '';
      } else if (eventType === 'stream' && typeof parsed.content === 'string') {
        // Chat pipeline remaps `content_delta` → `stream` on the wire.
        accumulatedText += parsed.content;
      } else if (eventType === 'content_delta' && typeof parsed.content === 'string') {
        accumulatedText += parsed.content;
      } else if (eventType === 'message_delta' && parsed.usage) {
        finalUsage = { ...(finalUsage || {}), ...parsed.usage };
      } else if (eventType === 'message_start' && parsed.message?.model) {
        finalModel = parsed.message.model;
      } else if (eventType === 'model_info' && parsed.model) {
        finalModel = parsed.model;
      }
    };

    await new Promise<void>((resolve, reject) => {
      const stream = response.data as NodeJS.ReadableStream;
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      });
      stream.on('end', () => {
        if (buffer.trim()) processLine(buffer);
        resolve();
      });
      stream.on('error', (err: Error) => reject(err));
      this.abortController.signal.addEventListener('abort', () => {
        try { (stream as any).destroy?.(); } catch { /* noop */ }
        reject(new Error('Workflow aborted'));
      });
    });

    return {
      content: accumulatedText,
      model: finalModel,
      usage: finalUsage,
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
    const response = await abortableAxiosPost(
      this,
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
      const response = await abortableAxios(this, {
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

    const response = await abortableAxiosPost(this, resolvedUrl, payload, { timeout: 15000, validateStatus: () => true });
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

    const response = await abortableAxiosPost(this, resolvedUrl, payload, { timeout: 15000, validateStatus: () => true });
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
        const response = await abortableAxiosPost(this, emailServiceUrl, {
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

    const response = await abortableAxiosPost(this, 'https://events.pagerduty.com/v2/enqueue', payload, {
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

    const response = await abortableAxiosPost(this, apiUrl, resolvedFields, { headers, timeout: 30000, validateStatus: () => true });
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

      const response = await abortableAxiosPost(this, `${baseUrl}/rest/api/3/issue`, payload, { headers, timeout: 30000, validateStatus: () => true });
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

    const response = await abortableAxiosPost(this, resolvedUrl, payload, {
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

    logger.info({ nodeId: node.id, action }, '[WorkflowEngine] Executing error handler node'); // metadata only — no secret interpolation

    if (action === 'log') {
      this.safeLog('warn', { errorData, nodeId: node.id }, '[WorkflowEngine] Error handler: logging error'); // errorData is user input — may contain secrets
      return { action: 'logged', error: errorData };
    }
    if (action === 'transform' && node.data.transformExpression) {
      // S0-2 / B1: was `new Function('error', 'input', ...)`. Now runs in isolate.
      const result = await runSandboxed(`return ${node.data.transformExpression};`, {
        globals: { error: errorData.error, input: errorData.input },
        timeoutMs: 2000,
      });
      if (!result.ok) {
        return { action: 'transform_failed', error: errorData, transformError: result.error };
      }
      return result.value;
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
      const resp = await abortableAxiosGet(this, `${this.apiUrl}/api/user-context`, {
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

    // For JavaScript, execute in a sandboxed isolate (S0-2 / B1).
    if (language === 'javascript' || !language) {
      return this.executeJavaScript(code, input, node.data.timeoutMs, node.data.memoryCapMb);
    }

    // Python execution is not supported by the OSS in-process engine.
    // For now, throw error for unsupported languages
    throw new Error(`Language ${language} execution not yet implemented in workflows`);
  }

  /**
   * Execute JavaScript code in a true V8 isolate sandbox (S0-2 / B1).
   *
   * Replaces the previous `new Function(...)` pattern, which let user code
   * escape via `Function.prototype.constructor.constructor("...")`,
   * `globalThis.process`, and similar tricks. The new sandbox runs each
   * snippet in a fresh `isolated-vm` context with hard CPU and memory caps
   * and zero access to host globals.
   */
  private async executeJavaScript(code: string, input: any, timeoutMs?: number, memoryCapMb?: number): Promise<any> {
    const result = await runSandboxed(code, {
      timeoutMs: timeoutMs ?? 5000,
      memoryCapMb: memoryCapMb ?? 256,
      input,
    });
    if (!result.ok) {
      throw new Error(`Code execution error (${result.errorType}): ${result.error}`);
    }
    return result.value;
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
    const result = await this.evaluateCondition(condition, operator, input);

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
  private async evaluateCondition(condition: string, operator: string, input: any): Promise<any> {
    // S0-2 / B1: condition expressions previously ran via `new Function`,
    // which let user-authored workflow code escape via Function.prototype.constructor.
    // Now evaluated inside a true V8 isolate via runSandboxed().
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
        // First attempt: evaluate as JS expression with step vars exposed.
        const sandboxed = await runSandboxed(`return (${varCondition});`, {
          input,
          globals: stepVars,
          timeoutMs: 2000,
        });
        if (sandboxed.ok) return sandboxed.value;

        // Fallback 1: re-resolve raw template inline and evaluate again.
        const resolved = this.interpolateTemplate(condition, input);
        const sandboxed2 = await runSandboxed(`return (${resolved});`, {
          input,
          timeoutMs: 2000,
        });
        if (sandboxed2.ok) return sandboxed2.value;

        // Fallback 2: pure template interpolation (legacy compat for non-JS conditions).
        return this.interpolateTemplate(condition, input);
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

    // S0-2 / B1: transform expressions now run inside a V8 isolate.
    // Each item-level call is one isolate creation, so map/filter/reduce loops
    // pay an isolate-spawn cost per item — acceptable for typical < 100-item
    // workloads. For very large arrays, use a code node instead.
    switch (transformType) {
      case 'map': {
        const out: any[] = [];
        for (let i = 0; i < items.length; i++) {
          const result = await runSandboxed(`return (${transformExpression});`, {
            input: items[i],
            globals: { item: items[i], index: i },
            timeoutMs: 2000,
          });
          if (!result.ok) throw new Error(`Transform map error (${result.errorType}): ${result.error}`);
          out.push(result.value);
        }
        return out;
      }

      case 'filter': {
        const out: any[] = [];
        for (let i = 0; i < items.length; i++) {
          const result = await runSandboxed(`return !!(${transformExpression});`, {
            input: items[i],
            globals: { item: items[i], index: i },
            timeoutMs: 2000,
          });
          if (!result.ok) throw new Error(`Transform filter error (${result.errorType}): ${result.error}`);
          if (result.value) out.push(items[i]);
        }
        return out;
      }

      case 'reduce': {
        let acc: any = null;
        for (let i = 0; i < items.length; i++) {
          const result = await runSandboxed(`return (${transformExpression});`, {
            input: items[i],
            globals: { acc, item: items[i], index: i },
            timeoutMs: 2000,
          });
          if (!result.ok) throw new Error(`Transform reduce error (${result.errorType}): ${result.error}`);
          acc = result.value;
        }
        return acc;
      }

      case 'extract': {
        // Extract a field from input using JS expression evaluation
        const result = await runSandboxed(`return (${transformExpression});`, {
          input,
          timeoutMs: 2000,
        });
        if (result.ok) return result.value;
        // Fallback: treat as dot-path accessor (legacy compat)
        let value: any = input;
        for (const key of (transformExpression || '').split('.')) {
          value = value?.[key];
        }
        return value ?? input;
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

    // Create approval record in database — throws on any DB error (fail-closed).
    const approval = await createApprovalRecord(prisma, {
      executionId: this.context.executionId,
      nodeId: node.id,
      approvers,
      requiredCount,
      timeoutSeconds: timeout,
      timeoutAction,
      message: message || `Approval required for workflow step: ${node.id}`,
      contextData: {
        input,
        nodeResults: Object.fromEntries(this.context.nodeResults),
        notificationChannels
      },
      notificationChannels
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
      const executeResponse = await abortableAxiosPost(
        this,
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
          const response = await abortableAxiosGet(
            this,
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

    const response = await abortableAxiosPost(
      this,
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
        const response = await abortableAxiosGet(
          this,
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
   * Execute an OpenAgentic LLM node - routes through platform's provider system.
   * 2026-04-19 — slider removed (task #144); model selection via SmartModelRouter
   * unless an explicit modelOverride is provided on the node.
   */
  private async executeOpenAgenticLLMNode(node: WorkflowNode, input: any): Promise<any> {
    // 2026-04-19 — sliderOverride removed (task #144). SmartModelRouter +
    // UserModelBudgetService handle model selection / spend caps.
    const { prompt, systemPrompt, temperature, maxTokens, modelOverride, enableThinking, thinkingBudget } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, modelOverride }, '[WorkflowEngine] Executing OpenAgentic LLM node');

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
    if (enableThinking) {
      requestBody.enableThinking = true;
      requestBody.thinkingBudget = thinkingBudget || 8000;
    }

    const response = await abortableAxiosPost(
      this,
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

          const response = await abortableAxiosPost(
            this,
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

    const response = await abortableAxiosPost(
      this,
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

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || (await ModelConfigurationService.getDefaultChatModel().catch(() => '')),
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

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: model || deploymentName || (await ModelConfigurationService.getDefaultChatModel().catch(() => '')),
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

    // Phase C.3 (2026-04-23) — pre-subscribe to the in-proc AgentEventStore
    // keyed on `executionId` so sub-agent progress envelopes POSTed back
    // by openagentic-proxy's HTTP callback (Phase C) surface as `node_stream`
    // ExecutionEvents. Unsubscribe in `finally` so we don't leak
    // listeners across executions. The flows SSE handler (Phase C.4)
    // re-emits these `node_stream` envelopes as `agent_progress` NDJSON
    // frames — same wire shape as chat.
    const unsubscribeAgentProgress = subscribeAgentProgressForWorkflowNode(
      this.context.executionId,
      node.id,
      (progressEvent) => {
        this.emitEvent('node_stream', {
          nodeId: node.id,
          nodeType: node.type,
          event: progressEvent,
        });
      },
    );

    try {
      const response = await abortableAxiosPost(
        this,
        `${openagenticProxyUrl}/api/agents/execute-sync`,
        {
          agents,
          orchestration,
          aggregation: nodeData.aggregation || 'merge',
          sessionId: this.context.executionId,
          // Phase C.3: pass executionId as `turnId` so openagentic-proxy's
          // AgentProgressContext binds its HTTP callback publisher to
          // that key. The chat-side agent-event route handler then
          // publishes each callback into getAgentEventStore() — and
          // our pre-subscription above picks them up.
          turnId: this.context.executionId,
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
    } finally {
      unsubscribeAgentProgress();
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Interpolate template variables like {{steps.nodeId.output}}, {{env.VAR}},
   * {{trigger.body.field}}, {{nodeId.output}}, {{now}}, {{item.field}}
   */
  /**
   * Look up the declared `schema.primary` for a node TYPE (typed-IO contract,
   * #1268/#1269). Returns undefined when the type is unknown or declares no
   * primary — the resolver then falls back to the canonicalNodeOutput heuristic.
   */
  private nodePrimaryOf(nodeType: string | undefined): string | undefined {
    if (!nodeType) return undefined;
    try {
      return nodeRegistry.get(nodeType)?.schema.primary;
    } catch {
      return undefined;
    }
  }

  /**
   * Canonical "primary output" of a node result for `{{steps.X.output}}` /
   * `{{X.output}}` references. Node executors disagree on the field name —
   * LLM/chat nodes return `{ content }`, rag_query returns nested
   * `{ result: { results } }`, code/transform return `{ output }`, knowledge
   * nodes `{ text }`/`{ answer }`. Every seed template binds `.output`, so this
   * makes `.output` a universal accessor: prefer an explicit `output`, else
   * fall back to the next most likely primary-output field.
   */
  private canonicalNodeOutput(r: any): any {
    if (r === null || r === undefined) return r;
    if (typeof r !== 'object') return r; // bare string/number IS the output
    if (r.output !== undefined) return r.output;
    if (r.content !== undefined) return r.content;
    if (r.text !== undefined) return r.text;
    if (r.answer !== undefined) return r.answer;
    if (r.result !== undefined) return this.canonicalNodeOutput(r.result); // unwrap one level
    if (r.results !== undefined) return r.results;
    if (r.data !== undefined) return r.data;
    return r; // whole object → JSON.stringify downstream
  }

  /**
   * SCHEMA-AWARE primary-output accessor — the typed-contract upgrade of
   * `canonicalNodeOutput` (P0 mechanism, #1268/#1269). Resolution order:
   *   1. EXPLICIT `value.output` always wins (legacy behavior preserved).
   *   2. If the SOURCE node's TYPE declares `schema.primary` AND that field is
   *      PRESENT on `value`, return `value[primary]` (typed contract — fixes the
   *      BROKEN nodes and the guardrails safety-bypass: .output → .passed).
   *   3. Otherwise fall back to the canonicalNodeOutput heuristic.
   */
  private resolvePrimaryOutput(value: any, nodeType: string | undefined): any {
    if (value !== null && typeof value === 'object' && value.output !== undefined) {
      return value.output;
    }
    if (value !== null && typeof value === 'object' && nodeType) {
      const primary = this.nodePrimaryOf(nodeType);
      if (primary && Object.prototype.hasOwnProperty.call(value, primary)) {
        return value[primary];
      }
    }
    return this.canonicalNodeOutput(value);
  }

  /**
   * Probe whether a plain reference body resolves to a present value. Used ONLY
   * to give `??` correct nullish semantics — distinguishing "resolved to empty
   * string" (keep it) from "did not resolve" (use the default).
   */
  private refIsUnresolved(refBody: string, context: any): boolean {
    const trimmed = refBody.trim();
    const walk = (root: any, parts: string[]): any => {
      let v = root;
      for (const k of parts) v = v?.[k];
      return v;
    };
    if (trimmed === 'input' || trimmed.startsWith('input.')) {
      const parts = trimmed === 'input' ? [] : trimmed.slice('input.'.length).split('.');
      const v = walk(this.context.input, parts);
      return v === undefined || v === null;
    }
    if (trimmed.startsWith('steps.')) {
      const parts = trimmed.slice('steps.'.length).split('.');
      const v = this.context.nodeResults?.get(parts[0]);
      return v === undefined || v === null;
    }
    if (trimmed.startsWith('trigger.')) {
      const t = this.context.nodeResults?.get('__trigger__') ?? this.context.input;
      const parts = trimmed.slice('trigger.'.length).split('.');
      const v = walk(t, parts);
      return v === undefined || v === null;
    }
    if (this.context.variables?.has(trimmed)) return false;
    const direct = this.nodeMap?.has(trimmed.split('.')[0]);
    if (direct) return false;
    return walk(context, trimmed.split('.')) === undefined;
  }

  private interpolateTemplate(template: string, context: any): string {
    if (!template) return template;

    // ───────────────────────────────────────────────────────────────────────
    // Default-literal fallback: {{ ref || "default" }} / {{ ref ?? "default" }}.
    // (#1263) The single-path resolver treated `input.url || "https…"` as one
    // variable name, never resolved it, and emitted '' — so the http_request
    // executor threw "HTTP Request node requires a url". We recognise ONLY the
    // minimal, SAFE shape: a reference followed by `||` or `??` and a single-
    // or double-quoted string literal. NO arbitrary eval — the left side is
    // resolved by the SAME machinery; the right side is a verbatim literal.
    // `||` falls back on any falsy left; `??` only on an unresolved (nullish)
    // left, preserving an intentional empty string.
    // ───────────────────────────────────────────────────────────────────────
    const FALLBACK_RE = /^([\s\S]+?)\s*(\|\||\?\?)\s*(["'])([\s\S]*?)\3\s*$/;
    const resolveRef = (refBody: string): string =>
      this.interpolateTemplate(`{{${refBody}}}`, context);

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();

      // {{ ref || "default" }} / {{ ref ?? "default" }} — default-literal fallback.
      const fb = trimmedPath.match(FALLBACK_RE);
      if (fb) {
        const [, leftRefRaw, op, , literal] = fb as unknown as [string, string, string, string, string];
        const leftRef = leftRefRaw.trim();
        // The left side must itself be a plain reference (no nested `||`/`??`).
        if (!FALLBACK_RE.test(leftRef)) {
          const leftVal = resolveRef(leftRef);
          if (op === '||') {
            return leftVal && leftVal !== 'false' && leftVal !== '0' ? leftVal : literal;
          }
          // ?? — nullish only: '' means "resolved to empty string" (kept).
          return leftVal !== '' ? leftVal : (this.refIsUnresolved(leftRef, context) ? literal : leftVal);
        }
      }

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
        // Track the RESOLVED node id so we can look up its declared schema.primary
        // (the typed-IO contract). When the result was found by direct id it's
        // nameOrId; when found by label fallback it's the matched nId.
        let resolvedSrcId: string | undefined = value !== undefined ? nameOrId : undefined;
        // Fallback: match by node label (case-insensitive, normalize hyphens/spaces)
        if (value === undefined) {
          const normalized = nameOrId.toLowerCase().replace(/[-_\s]+/g, '-');
          for (const [nId, nResult] of this.context.nodeResults.entries()) {
            const node = this.nodeMap.get(nId);
            const label = (node?.data?.label || '').toLowerCase().replace(/[-_\s]+/g, '-');
            if (label === normalized || nId.toLowerCase() === normalized) {
              value = nResult;
              resolvedSrcId = nId;
              break;
            }
          }
        }
        if (value !== undefined) {
          let walkPath = rest;
          // {{steps.X.output}} → the node's PRIMARY output. Schema-aware (typed-IO
          // contract, #1268/#1269): when node X's TYPE declares schema.primary and
          // that field is present, return result[primary]; else explicit .output;
          // else the canonicalNodeOutput heuristic (LLM → .content, rag_query →
          // nested .result.results). An explicit .output is left untouched.
          if (
            walkPath[0] === 'output' &&
            (value === null || typeof value !== 'object' || (value as any).output === undefined)
          ) {
            const srcType = resolvedSrcId ? this.nodeMap.get(resolvedSrcId)?.type : undefined;
            value = this.resolvePrimaryOutput(value, srcType);
            walkPath = walkPath.slice(1);
          }
          for (const key of walkPath) {
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

      // {{env.<VAR>}} - engine-controlled allow-list ONLY.
      //
      // P0b sev-0 fix (audit AUDIT-2026-05-03): the prior `?? process.env[envVar]`
      // fallback let any workflow author exfil the pod's process.env by
      // writing {{env.WORKFLOW_SECRET_KEY}}, {{env.AWS_SECRET_ACCESS_KEY}},
      // {{env.JWT_SECRET}}, etc. into a node field. After this change,
      // {{env.X}} only resolves when the engine has explicitly seeded
      // `env.X` into context.variables. Workflow authors must use
      // {{secret:NAME}} for credentials.
      if (trimmedPath.startsWith('env.')) {
        const envVar = trimmedPath.slice(4);
        const value = this.context.variables.get(`env.${envVar}`);
        if (value !== undefined) return String(value);
        logger.warn(
          { variable: trimmedPath },
          '[WorkflowEngine] {{env.*}} blocked — pod env exfil is disabled (P0b). Use {{secret:NAME}} for credentials.'
        );
        return '';
      }

      // {{secret:<name>}} - resolved workflow secrets (pre-loaded in execute())
      if (trimmedPath.startsWith('secret:')) {
        const secretName = trimmedPath.slice(7);
        const resolved = this.context.resolvedSecrets?.get(secretName);
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
          let walkPath = rest;
          // {{nodeId.output}} → the node's PRIMARY output (schema-aware typed-IO
          // contract; mirrors the steps.* branch above).
          if (
            walkPath[0] === 'output' &&
            (value === null || typeof value !== 'object' || (value as any).output === undefined)
          ) {
            const srcType = this.nodeMap.get(resolvedNodeId)?.type;
            value = this.resolvePrimaryOutput(value, srcType);
            walkPath = walkPath.slice(1);
          }
          for (const key of walkPath) {
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
  /**
   * Log helper that redacts resolved secret values from the meta object before
   * writing to pino. Use this instead of `logger.info(...)` at any call site
   * that includes node input, output, prompt, or other interpolated content.
   */
  private safeLog(level: 'info' | 'warn' | 'debug' | 'error', meta: Record<string, unknown>, msg: string): void {
    const safeMeta = redactLogMeta(meta, this.context);
    logger[level](safeMeta, msg);
  }

  private emitEvent(type: ExecutionEvent['type'], data?: any): void {
    const safeData = redactSecrets(data, this.context);
    const event: ExecutionEvent = {
      type,
      executionId: this.context.executionId,
      timestamp: new Date().toISOString(),
      ...safeData
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
      const safeOutput = redactSecrets(output ? JSON.parse(JSON.stringify(output)) : null, this.context);
      const safeInput = redactSecrets(input ? JSON.parse(JSON.stringify(input)) : null, this.context);

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
      const safeOutput = redactSecrets(output ? JSON.parse(JSON.stringify(output)) : null, this.context);
      const safeNodeOutputs = redactSecrets(nodeOutputs, this.context);
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: {
          status,
          output: safeOutput,
          node_outputs: Object.keys(safeNodeOutputs).length > 0 ? safeNodeOutputs : undefined,
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
  opts?: { userEmail?: string; idToken?: string; triggerType?: string; userPermissions?: readonly string[]; tenantId?: string | null }
): Promise<{ success: boolean; output: any; error?: string }> {
  const context: ExecutionContext = {
    executionId,
    workflowId,
    userId,
    tenantId: opts?.tenantId ?? null,
    authToken,
    idToken: opts?.idToken,
    userEmail: opts?.userEmail,
    triggerType: opts?.triggerType,
    userPermissions: opts?.userPermissions,
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
