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
import { PricingLookup } from './pricingLookup.js';
import { MODELS } from '../config/models.js';
import { canAutoApprove } from './approvalGate.js';
import { createApprovalRecord } from './approvalRecord.js';
import { createDataRequestRecord } from './dataRequestRecord.js';
import { redactSecrets, redactLogMeta, type RedactionMap } from './secretRedaction.js';
import { checkSecretAcl } from './secretAcl.js';
import type { AclSecretRow } from './secretAcl.js';
import {
  denyIfPrivate,
  isAllowedInternalHost,
  EgressBlockedError,
} from '../utils/HostAllowList.js';
import axios from 'axios';
import { abortableAxiosPost, abortableAxiosGet, abortableAxios } from './abortableAxios.js';
import { runSandboxed } from './sandbox.js';
import { registry as nodeRegistry, runWithAssertions } from '../nodes/registry.js';
import { OutputAssertionError } from '../nodes/types.js';
import type { NodeExecutionContext } from '../nodes/types.js';
import {
  attachTraceCollector,
  type TraceCollectorHandle,
} from '@openagentic/workflow-engine/trace/attachTraceCollector';
import { LLMTracingService } from '@openagentic/workflow-engine/tracing/LLMTracingService';

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
   * Threaded from the workflow request layer into the engine; the engine
   * copies it onto every NodeExecutionContext it constructs so executors
   * inherit the same tenant scoping.
   */
  tenantId?: string | null;
  authToken?: string;
  /** Reserved/inert in OSS (local-auth only — no OBO ID-token forwarding). */
  idToken?: string;
  /** User email for MCP workspace isolation */
  userEmail?: string;
  /**
   * Trigger that initiated this execution. Used to gate test-only behavior
   * (auto-approval, mocked node outputs, etc.). Defaults to 'manual' if absent.
   * Allowed values: webhook | schedule | manual | event | api | test
   */
  triggerType?: string;
  /** Permissions of the caller. Used by approvalGate / per-node ACLs. */
  userPermissions?: readonly string[];
  /**
   * Group IDs the caller belongs to. Passed via executeWorkflow opts.userGroups.
   * Used by WorkflowSecret ACL enforcement (allowed_groups check). S0-9 / B5.
   */
  userGroups?: readonly string[];
  input: Record<string, any>;
  variables: Map<string, any>;
  nodeResults: Map<string, any>;
  startTime: number;
  agenticExecutionId?: string;
  sharedContext: Map<string, any>;
  webhookResponse?: { statusCode: number; headers: Record<string, string>; body: any };
  /** Resolved secret values keyed by secret name. Populated at execution start. */
  resolvedSecrets?: Map<string, string>;
  /**
   * ACL metadata for each resolved secret (the three allowed_* arrays).
   * Keyed by secret name. Populated alongside resolvedSecrets at execution start.
   * Used by interpolateTemplate to enforce per-node ACL checks synchronously.
   * S0-9 / B5.
   */
  resolvedSecretAcls?: Map<string, AclSecretRow>;
  /**
   * Optional test-mode mocks (Phase B #17). Forwarded onto every
   * NodeExecutionContext so mock-aware executors (mcp_tool, etc.) can
   * short-circuit network calls deterministically. Populated by the
   * /test-execute endpoint when the api proxies WorkflowTestRunner
   * requests. Absent in production traffic.
   */
  testMocks?: import('@openagentic/workflow-engine').TestMocks;
  /**
   * Current sub-flow nesting depth. The root execution starts at 0; every
   * call to executeSubWorkflow increments it by 1 when constructing the
   * child context. The `flow_tool` executor enforces a hard cap (default
   * 3) by reading ctx.subFlowDepth. Gap-analysis 2026-05-14 P0 #3.
   */
  subFlowDepth?: number;
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeType: string;
  status: 'success' | 'error' | 'skipped';
  output: any;
  error?: string;
  executionTimeMs: number;
}

export type OutputFormat = 'markdown' | 'html' | 'json' | 'table';

export interface OutputEnvelope {
  format: OutputFormat;
  title: string;
  content: string;
  raw: any;
  artifacts: string[];
  nodeId?: string;
  nodeType?: string;
  persistToMilvus?: boolean;
}

export interface ExecutionEvent {
  type: 'execution_start' | 'node_start' | 'node_complete' | 'node_error' | 'node_stream' | 'node_progress' | 'node_canonical' | 'node_retry' | 'node_fallback' | 'execution_complete' | 'execution_error' | 'approval_required' | 'approval_received' | 'needs_input' | 'execution_paused' | 'execution_resumed';
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

/**
 * Node types that own their own downstream routing.
 * - condition / switch / llm_router own routing via ctx.routeBranches
 * - parallel owns routing via ctx.fanOutBranches
 * - loop owns routing via ctx.iterateOver
 * - retry_with_backoff drives + re-runs its downstream via ctx.runSubStep
 * The outer walker MUST NOT re-fire their outgoing edges or it
 * double-executes downstream nodes (and breaks merge-gate arrival counts).
 */
const ROUTING_OWNS_DOWNSTREAM = new Set<string>([
  'condition', 'loop', 'switch', 'parallel', 'llm_router', 'retry_with_backoff',
]);

/**
 * Edges with sourceHandle/label === 'error' are reserved for the failure
 * path (route_to_error_handler). They must not fire on the success path.
 */
const isHappyEdge = (e: WorkflowEdge): boolean =>
  e.sourceHandle !== 'error' && e.label !== 'error';

/**
 * Map a MIME type to the filename extension the artifacts library expects.
 * Falls back to `.bin` for anything unknown. Mirrors the few types the
 * webhook_response → artifact-persistence path actually emits.
 */
function mimeTypeToExtension(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m === 'text/html') return 'html';
  if (m === 'application/json') return 'json';
  if (m === 'text/markdown' || m === 'text/x-markdown') return 'md';
  if (m === 'text/plain') return 'txt';
  if (m === 'text/csv') return 'csv';
  if (m === 'application/xml' || m === 'text/xml') return 'xml';
  return 'bin';
}

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
  private mergeBarriers: Map<string, { arrived: number; expected: number; resolve: (() => void) | null; promise: Promise<void> | null }>; // Barrier for merge nodes
  private mergeSkipCounts: Map<string, number>; // Pre-registered skip counts for merge nodes from condition routing
  private pricingLookup: PricingLookup; // DB-backed per-execution token cost calculator
  /**
   * The type of the node currently being executed (set in executeNodeCore
   * before dispatch, cleared after). Used by interpolateTemplate to pass
   * nodeType to the secret ACL check without threading it through every call.
   * S0-9 / B5.
   */
  private _currentNodeType: string | undefined = undefined;
  /**
   * Secret names whose ACL check failed for the current node. Reset at the
   * start of each node execution and drained after executeNodeCore returns.
   * S0-9 / B5.
   */
  private _nodeAclDenials: string[] = [];
  /** LLM tracing service — one instance per engine boot; fan-out to configured provider. */
  private tracing: LLMTracingService;

  constructor(
    definition: WorkflowDefinition,
    context: ExecutionContext
  ) {
    super();
    this.definition = definition;
    this.context = context;
    this.context.sharedContext = this.context.sharedContext || new Map();
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
    this.apiUrl = process.env.API_URL || 'http://openagentic-api:8000';

    // Initialize retry state tracking
    this.nodeRetryState = new Map();
    this.pendingNodeOutputs = new Map();
    this.mergeBarriers = new Map();
    this.mergeSkipCounts = new Map();

    // DB-driven pricing lookup; one instance per execution so rates are cached across LLM nodes
    this.pricingLookup = new PricingLookup(prisma as any, logger);

    // LLM tracing service — reads OBSERVABILITY_PROVIDER env; default = none (no-op).
    this.tracing = new LLMTracingService();
  }

  /**
   * Get internal service auth headers for self-calls (LLM endpoint, etc.)
   * Uses INTERNAL_SERVICE_SECRET bypass so workflow LLM calls don't depend on user JWT validity.
   * MCP calls carry the user's auth token for identity/audit. OSS is local-auth
   * only — no OBO (On-Behalf-Of) federation; cloud MCPs use service-account creds.
   *
   * INTERNAL-AUTH USER PROPAGATION (2026-05-14): when the engine has a real
   * user context (this.context.userId from /:id/execute, NOT system-fired
   * schedule triggers), forward X-User-Id + X-User-Email so the api can
   * resolve a real user from internal-auth and apply per-user filtering.
   * Closes the engine→api gap surfaced by data_source_query + create_subflow
   * in the capstone — both call endpoints that filter by userId and would
   * otherwise see a synthetic `service-internal` identity.
   */
  private getInternalAuthHeaders(): Record<string, string> {
    const secret = process.env.INTERNAL_SERVICE_SECRET;
    if (secret) {
      const headers: Record<string, string> = {
        'X-Request-From': 'internal',
        'X-Internal-Secret': secret,
      };
      if (this.context.userId && !this.context.userId.startsWith('service-') && this.context.userId !== 'system') {
        headers['X-User-Id'] = this.context.userId;
        if (this.context.userEmail) {
          headers['X-User-Email'] = this.context.userEmail;
        }
      }
      return headers;
    }
    // Fallback to user's auth token if no internal secret configured
    return this.context.authToken ? { 'Authorization': this.context.authToken } : {};
  }

  /**
   * Approval gate + audit for the `mcp_tool` node (HIGH-severity bypass fix,
   * 2026-06-20). POSTs the gated decision endpoint on the api so a Flow's tool
   * call is audited + (gate ON) human-approval-gated by the SAME
   * `runAuditAndGate` the chat + orchestrate paths use (origin 'subagent').
   *
   * Returns the gate decision. FAIL SAFE: a non-2xx response or any transport
   * error THROWS — the mcp_tool executor catches it and blocks anything that
   * looks mutating (never silently executes an un-audited mutation). A clean
   * `{ allowed:false }` likewise blocks the call (the executor does not proxy).
   */
  private async gateMcpCall(call: {
    toolName: string;
    serverName?: string;
    args: Record<string, unknown>;
  }): Promise<{ allowed: boolean; blockReason?: string; classification?: 'READ' | 'MUTATING' }> {
    const resp = await axios.post(
      `${this.apiUrl}/api/internal/mcp/exec`,
      {
        toolName: call.toolName,
        serverName: call.serverName,
        args: call.args ?? {},
        userId: this.context.userId,
        // The workflow exec id is the closest thing to a session for audit
        // correlation; threads through so the audit row links to the run.
        sessionId: this.context.executionId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
        },
        // Long timeout: a gated MUTATING call blocks server-side on
        // ApprovalRegistry.waitFor until approved/denied/timed-out. The api's
        // own approval-gate policy timeout (default 300s → deny) bounds this;
        // give the HTTP call headroom past that so we receive the decision
        // rather than tripping our own client timeout first (which would
        // fail-safe block, but we prefer the real audited decision).
        timeout: 360_000,
        validateStatus: () => true,
      },
    );
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`mcp gate returned HTTP ${resp.status}`);
    }
    const data = (resp.data ?? {}) as {
      allowed?: boolean;
      blockReason?: string;
      classification?: 'READ' | 'MUTATING';
    };
    return {
      allowed: data.allowed === true,
      blockReason: data.blockReason,
      classification: data.classification,
    };
  }

  /** Auth headers for openagentic-proxy (uses its own internal key + X-Agent-Proxy flag) */
  private getOpenAgenticProxyAuthHeaders(): Record<string, string> {
    const agentKey = process.env.OPENAGENTIC_PROXY_INTERNAL_KEY;
    if (agentKey) {
      return {
        'Authorization': `Bearer ${agentKey}`,
        'X-Agent-Proxy': 'true',
        'X-User-Id': this.context.userId || 'workflow-engine',
      };
    }
    // Fallback to internal headers
    return this.getInternalAuthHeaders();
  }

  /**
   * Execute the workflow
   */
  async execute(): Promise<{ success: boolean; output: any; error?: string }> {
    const { executionId } = this.context;

    // Pillar 2 (#52): attach a TraceCollector to the engine's event
    // channel BEFORE the first emit so execution_start is the first
    // event in the signed trace. Finalize on either completion path.
    // Falls back through SIGNING_SECRET → JWT_SECRET → INTERNAL_SERVICE_SECRET
    // so any environment with at least one of these (which is every real
    // dev / prod deployment) gets signed traces by default.
    let traceHandle: TraceCollectorHandle | undefined;
    try {
      const signingSecret =
        process.env.SIGNING_SECRET ||
        process.env.JWT_SECRET ||
        process.env.INTERNAL_SERVICE_SECRET ||
        '';
      if (signingSecret) {
        traceHandle = attachTraceCollector(this, executionId, signingSecret);
      }
    } catch (e) {
      logger.warn({ err: e, executionId }, '[WorkflowEngine] Failed to attach trace collector — continuing without signed trace');
    }

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
          const resolvedSecretAcls = new Map<string, AclSecretRow>();
          // Load secrets from DB and decrypt. No ACL context here — pre-load is
          // scope-only; per-node ACL enforcement happens at interpolation time. S0-9/B5.
          for (const name of secretRefs) {
            try {
              const { workflowSecretService } = await import('./WorkflowSecretService.js');
              // Resolve value (legacy context — no nodeType/userId to avoid false denials)
              const value = await workflowSecretService.resolveSecretValue(name, {
                workflowId: this.context.workflowId,
              });
              if (value) resolvedSecrets.set(name, value);
              // Also fetch ACL metadata for inline per-node checks at interpolation time
              const aclRow = await prisma.workflowSecret.findFirst({
                where: { name, scope: 'global' },
                select: { allowed_node_types: true, allowed_users: true, allowed_groups: true },
              }) ?? await prisma.workflowSecret.findFirst({
                where: { name, scope: 'workflow', workflow_id: this.context.workflowId },
                select: { allowed_node_types: true, allowed_users: true, allowed_groups: true },
              });
              if (aclRow) {
                resolvedSecretAcls.set(name, {
                  allowed_node_types: aclRow.allowed_node_types,
                  allowed_users: aclRow.allowed_users,
                  allowed_groups: aclRow.allowed_groups,
                });
              }
            } catch (err) {
              logger.warn({ err, secretName: name }, '[WorkflowEngine] Failed to resolve secret');
            }
          }
          this.context.resolvedSecrets = resolvedSecrets;
          this.context.resolvedSecretAcls = resolvedSecretAcls;
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

      // Pre-flight: enforce required trigger inputs. Each trigger node may
      // declare data.inputs = [{ name, label, required, ... }]. The runtime
      // input MUST satisfy every required name — a workflow without a topic
      // cannot run a research team. Caught the user's "Please provide the
      // topic" fake-success on Multi-Agent Research Team (2026-04-26).
      const runtimeInput =
        this.context.input && typeof this.context.input === 'object'
          ? (this.context.input as Record<string, any>)
          : {};
      const missingRequired: string[] = [];
      for (const trigger of triggerNodes) {
        const inputs = (trigger.data as any)?.inputs;
        if (!Array.isArray(inputs)) continue;
        for (const param of inputs) {
          if (!param?.required) continue;
          const name = param.name;
          if (!name) continue;
          const v = runtimeInput[name];
          if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
            missingRequired.push(`${name} (${param.label || name})`);
          }
        }
      }
      if (missingRequired.length > 0) {
        const msg = `Cannot run workflow — missing required trigger input(s): ${missingRequired.join(', ')}. Provide them in the Run dialog or via body.input.`;
        logger.warn({ workflowId: this.context.workflowId, missing: missingRequired }, '[WorkflowEngine] Pre-flight validation rejected run');
        try { await this.updateExecutionRecord('failed', null, msg); } catch { /* already failing */ }
        throw new Error(msg);
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
      const outputEnvelopes: OutputEnvelope[] = [];
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          // Wrap terminal node output in a structured envelope for rich rendering
          const envelope = this.formatOutputEnvelope(node, result);
          outputEnvelopes.push(envelope);
          finalOutput[node.id] = result;
        }
      }

      // If only one terminal node, unwrap
      if (Object.keys(finalOutput).length === 1) {
        finalOutput = Object.values(finalOutput)[0];
      }

      // Attach output envelopes to the execution context for downstream use
      (this.context as any).outputEnvelopes = outputEnvelopes;

      // Honest status: if any node failed during this run, the workflow as
      // a whole is FAILED — even if downstream nodes (merge, compare) ran
      // successfully on the failure markers. Earlier, returning 'completed'
      // here while 3 of 6 nodes had status:'failed' produced a 'fake success'
      // where the engine reported green but the output was a meta-summary
      // describing the failures. Caught 2026-04-26 on Smart Router Showcase.
      const failedNodes = Array.from(this.pendingNodeOutputs.entries())
        .filter(([, data]: [string, any]) => data?.status === 'failed' || (data?.error != null && data.error !== ''))
        .map(([id]) => id);
      const finalStatus: 'completed' | 'failed' = failedNodes.length > 0 ? 'failed' : 'completed';
      const summaryError = failedNodes.length > 0
        ? `Workflow has ${failedNodes.length} failed node(s): ${failedNodes.join(', ')}. Inspect node_outputs for per-node errors.`
        : undefined;
      try {
        await this.updateExecutionRecord(finalStatus, finalOutput, summaryError);
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

      this.emitEvent('execution_complete', { output: finalOutput, outputEnvelopes });

      // Pillar 2: sign + log the run trace. Persistence is a follow-up
      // (workflow_traces table) — for now the signature lands in logs
      // so we can verify replay-identical runs end-to-end via grep.
      if (traceHandle) {
        try {
          const signed = traceHandle.finalize();
          logger.info(
            {
              executionId,
              workflowId: this.context.workflowId,
              signedTrace: {
                contentHash: signed.contentHash,
                signature: signed.signature,
                algorithm: signed.algorithm,
                eventCount: signed.eventCount,
                signedAt: signed.signedAt,
              },
            },
            '[WorkflowEngine] Run trace signed (Pillar 2)',
          );
        } catch (e) {
          logger.warn({ err: e, executionId }, '[WorkflowEngine] Trace finalize failed (non-fatal)');
        }
      }

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

      // Auto-persist output artifacts to Milvus
      try {
        const envelopesToPersist = outputEnvelopes.filter(e => e.persistToMilvus);
        if (envelopesToPersist.length > 0) {
          for (const envelope of envelopesToPersist) {
            try {
              const response = await abortableAxiosPost(
                this,
                `${this.apiUrl}/api/workflows/executions/${this.context.executionId}/artifacts`,
                {
                  content: envelope.content,
                  title: envelope.title,
                  format: envelope.format,
                  nodeId: envelope.nodeId,
                  workflowId: this.context.workflowId,
                },
                { headers: this.getInternalAuthHeaders(), timeout: 10000 }
              );
              if (response.data?.artifactId) {
                envelope.artifacts.push(response.data.artifactId);
                logger.info({
                  artifactId: response.data.artifactId,
                  nodeId: envelope.nodeId,
                  executionId: this.context.executionId,
                }, '[WorkflowEngine] Output artifact persisted to Milvus');
              }
            } catch (err) {
              this.safeLog('warn', { err, nodeId: envelope.nodeId }, '[WorkflowEngine] Failed to persist output artifact (non-fatal)'); // err.message may contain secret bleed from upstream formatter
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, '[WorkflowEngine] Failed to auto-persist artifacts (non-fatal)');
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

      // Pillar 2: sign + log even on failure paths — failed runs need
      // tamper-evident traces just as much as successful ones.
      if (traceHandle) {
        try {
          const signed = traceHandle.finalize();
          logger.info(
            {
              executionId,
              workflowId: this.context.workflowId,
              signedTrace: {
                contentHash: signed.contentHash,
                signature: signed.signature,
                algorithm: signed.algorithm,
                eventCount: signed.eventCount,
                signedAt: signed.signedAt,
              },
              outcome: 'error',
            },
            '[WorkflowEngine] Run trace signed (Pillar 2)',
          );
        } catch (e) {
          logger.warn({ err: e, executionId }, '[WorkflowEngine] Trace finalize failed (non-fatal)');
        }
      }

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

    // Merge gate: only the last arriving branch executes the merge node.
    // Earlier branches store their result and return immediately (no await/blocking).
    if (node.type === 'merge') {
      const incoming = this.incomingEdges.get(nodeId) || [];
      if (incoming.length > 1) {
        let gate = this.mergeBarriers.get(nodeId);
        if (!gate) {
          // Account for pre-registered skips from condition routing
          const skipCount = this.mergeSkipCounts.get(nodeId) || 0;
          const adjustedExpected = Math.max(1, incoming.length - skipCount);
          gate = { arrived: 0, expected: adjustedExpected, resolve: null, promise: null };
          this.mergeBarriers.set(nodeId, gate);
          if (skipCount > 0) {
            logger.info({ nodeId, incoming: incoming.length, skipCount, adjustedExpected },
              '[WorkflowEngine] Merge gate: created with skip-adjusted expected count');
          }
        }
        gate.arrived++;
        logger.info({
          nodeId,
          arrived: gate.arrived,
          expected: gate.expected,
        }, '[WorkflowEngine] Merge gate: branch arrived');
        if (gate.arrived < gate.expected) {
          // Not the last branch — return early; the merge will run when the last branch arrives
          return input;
        }
        if (gate.arrived > gate.expected) {
          // Merge gates must be idempotent: defensive guard against upstream
          // double-fan-out from a routing-owning node missed from the
          // exclusion list. The gate already fired on the arrived==expected
          // call; subsequent arrivals must be a no-op, not re-execute the
          // merge and emit another node_complete frame.
          logger.warn({
            nodeId,
            arrived: gate.arrived,
            expected: gate.expected,
          }, '[WorkflowEngine] Merge gate: extra arrival past expected — ignoring (idempotent)');
          return this.context.nodeResults.get(nodeId) ?? input;
        }
        // Last branch: fall through to execute the merge node with all collected inputs
        logger.info({ nodeId }, '[WorkflowEngine] Merge gate: all branches arrived, executing merge');
      }
    }

    // Disabled node: skip execution, pass input through
    if (node.data.disabled) {
      this.context.nodeResults.set(nodeId, input);
      this.emitEvent('node_complete', {
        nodeId, nodeType: node.type, output: input,
        executionTimeMs: 0, skipped: true, reason: 'disabled'
      });
      await this.fanOutToDownstream(nodeId, node.type, input, 'disabled passthrough');
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
      await this.fanOutToDownstream(nodeId, node.type, pinned, 'pinned data');
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

        // Secret ACL enforcement — S0-9 / B5.
        // If any {{secret:name}} interpolation was denied for this node's type,
        // emit node_error and abort rather than silently passing a redacted value.
        if (this._nodeAclDenials.length > 0) {
          const deniedNames = [...this._nodeAclDenials];
          this._nodeAclDenials = [];
          this._currentNodeType = undefined;
          this.emitEvent('node_error', {
            nodeId,
            nodeType: node.type,
            error: `secret_acl_denied: secrets [${deniedNames.join(', ')}] are not accessible from node type '${node.type}'`,
            reason: 'secret_acl_denied',
            deniedSecrets: deniedNames,
          });
          throw new Error(`Secret ACL denied for node ${nodeId}: [${deniedNames.join(', ')}] not allowed for node type '${node.type}'`);
        }
        this._currentNodeType = undefined;

        // Data flow trace
        const inputPreview = input === undefined ? 'undefined' : input === null ? 'null' :
          typeof input === 'string' ? `string(${input.length})` :
          typeof input === 'object' ? `object(${Object.keys(input).join(',').substring(0, 60)})` : typeof input;
        const resultPreview = result === undefined ? 'undefined' : result === null ? 'null' :
          typeof result === 'string' ? `string(${result.length})` :
          typeof result === 'object' ? `object(${Object.keys(result).join(',').substring(0, 60)})` : typeof result;
        logger.info({ nodeId, nodeType: node.type, inputPreview, resultPreview }, '[WorkflowEngine] Node data flow'); // previews contain only type/length/key-name metadata, not values — no secret interpolation

        // Success - reset circuit breaker on successful execution
        if (circuitBreakerConfig) {
          this.recordCircuitBreakerSuccess(nodeId);
        }

        // Merge shared context updates from node result
        if (result && typeof result === 'object' && result.__contextUpdates) {
          for (const [k, v] of Object.entries(result.__contextUpdates)) {
            this.context.sharedContext.set(k, v);
          }
          delete result.__contextUpdates;
        }

        // Store result
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

        // Calculate per-node cost from token usage BEFORE storing
        if ((node.type === 'llm_completion' || node.type === 'openagentic_llm' || node.type === 'agent_single') && result?.usage) {
          const usage = result.usage;
          const modelName = result.model || node.data.model || 'unknown';
          const totalTokens = usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
          const nodeCost = await this.calculateTokenCost(modelName, usage.prompt_tokens || 0, usage.completion_tokens || 0);
          (this as any).totalCost = ((this as any).totalCost || 0) + nodeCost;

          result._costMeta = {
            tokens: totalTokens,
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            cost: nodeCost,
            model: modelName,
          };
        }

        // Store node execution in database (non-fatal for ad-hoc test executions)
        try {
          await this.storeNodeExecution(nodeId, node.type, nodeStatus, result, executionTimeMs, resultHasError ? String(result.error || 'Node result indicates failure') : undefined, input);
        } catch (storeErr) {
          logger.warn({ storeErr, nodeId }, '[WorkflowEngine] Non-fatal: failed to store node execution');
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

              // Record LLM usage in AgentRegistry
              if ((node.type === 'llm_completion' || node.type === 'openagentic_llm' || node.type === 'agent_single') && result?.usage) {
                const modelName = result.model || node.data.model || 'unknown';
                registry.recordToolCall(
                  this.context.agenticExecutionId,
                  `llm/${modelName}`
                );
              }
            }
          }
        } catch (err) {
          logger.debug({ err, nodeId }, '[WorkflowEngine] Failed to record node in Agent registry (non-fatal)');
        }

        // Wrap node output in structured envelope for rich rendering
        const nodeEnvelope = this.formatOutputEnvelope(node, result);

        this.emitEvent('node_complete', {
          nodeId,
          nodeType: node.type,
          output: result,
          outputEnvelope: nodeEnvelope,
          executionTimeMs,
          attempts: attempt + 1
        });

        // If human_input/request_data returned awaiting_input, suspend the run.
        // ctx.requestData already persisted the WorkflowDataRequest + emitted the
        // `needs_input` frame; the user submits via POST /resume-execution which
        // re-enters through resumeExecution() with their typed values.
        if (result?.status === 'awaiting_input' &&
            (node.type === 'human_input' || node.type === 'request_data')) {
          this.emitEvent('execution_paused', {
            nodeId,
            reason: 'awaiting_input',
            requestId: result.requestId,
          });
          return; // Stop processing this branch — resumeExecution() continues after the user submits
        }

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

        // Execute downstream nodes (unless the node owns its own routing).
        // Routing-owning nodes drive their downstream via ctx.routeBranches /
        // ctx.fanOutBranches / ctx.iterateOver — the outer walker re-firing
        // their outgoing edges would double-execute downstream and corrupt
        // merge-gate arrival counts.
        await this.fanOutToDownstream(nodeId, node.type, result, 'success');

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

          // Continue to downstream nodes with the fallback result. Same
          // routing-ownership + happy-edge filtering as the primary success
          // path above.
          await this.fanOutToDownstream(nodeId, node.type, result, 'fallback');

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
        const normalEdges = outgoing.filter(isHappyEdge);
        for (const edge of normalEdges) {
          await this.executeNode(edge.target, errorOutput);
        }
        return errorOutput;
      }
    }

    // Notify downstream merge gates that this branch failed,
    // so they can execute once all branches (including failures) are accounted for
    await this.notifyMergeGatesForFailedBranch(nodeId);

    throw lastError;
  }

  /**
   * Fan out execution to a node's downstream happy-path edges.
   *
   * Skips when the node owns its own routing (condition/switch/loop/parallel)
   * because re-firing the outer walker's edges would double-execute downstream
   * nodes and corrupt merge-gate arrival counts.
   *
   * For a single edge, awaits the child sequentially. For multiple edges,
   * uses Promise.allSettled so a single branch failure does not collapse
   * the whole fan-out — failed branches are logged at warn level.
   */
  private async fanOutToDownstream(
    nodeId: string,
    nodeType: string,
    payload: any,
    contextLabel: string,
  ): Promise<void> {
    if (ROUTING_OWNS_DOWNSTREAM.has(nodeType)) return;

    const happyEdges = (this.outgoingEdges.get(nodeId) ?? []).filter(isHappyEdge);
    if (happyEdges.length === 0) return;

    if (happyEdges.length === 1) {
      await this.executeNode(happyEdges[0].target, payload);
      return;
    }

    logger.info({
      nodeId,
      parallelBranches: happyEdges.length,
      targets: happyEdges.map(e => e.target),
      context: contextLabel,
    }, '[WorkflowEngine] Fan-out: executing parallel branches');

    const branchResults = await Promise.allSettled(
      happyEdges.map(edge => this.executeNode(edge.target, payload))
    );
    for (let i = 0; i < branchResults.length; i++) {
      const r = branchResults[i];
      if (r.status === 'rejected') {
        this.safeLog(
          'warn',
          { nodeId, targetNode: happyEdges[i].target, error: r.reason?.message, context: contextLabel },
          `[WorkflowEngine] Branch execution failed (${contextLabel})`,
        ); // r.reason?.message may contain secret-interpolated content
      }
    }
  }

  /**
   * Notify merge gates downstream of a failed branch.
   * When a parallel branch fails, it never calls executeNode on its downstream merge node,
   * so the merge gate count stays incomplete. This method increments the arrived count
   * for the failed branch, and if all branches have now arrived, executes the merge node.
   */
  private async notifyMergeGatesForFailedBranch(failedNodeId: string): Promise<void> {
    const outgoing = this.outgoingEdges.get(failedNodeId) || [];
    for (const edge of outgoing) {
      const targetNode = this.nodeMap.get(edge.target);
      if (targetNode?.type === 'merge') {
        // Store error result so executeMergeNode can see this branch's outcome
        if (!this.context.nodeResults.has(failedNodeId)) {
          this.context.nodeResults.set(failedNodeId, {
            error: `Node ${failedNodeId} failed`,
            status: 'error',
            _failedBranch: true,
          });
        }

        let gate = this.mergeBarriers.get(edge.target);
        if (!gate) {
          const incoming = this.incomingEdges.get(edge.target) || [];
          gate = { arrived: 0, expected: incoming.length, resolve: null, promise: null };
          this.mergeBarriers.set(edge.target, gate);
        }
        gate.arrived++;
        logger.info({
          nodeId: edge.target,
          arrived: gate.arrived,
          expected: gate.expected,
          failedBranch: failedNodeId,
        }, '[WorkflowEngine] Merge gate: failed branch counted');
        if (gate.arrived >= gate.expected) {
          // All branches have arrived (some failed) — execute the merge
          logger.info({ nodeId: edge.target }, '[WorkflowEngine] Merge gate: all branches arrived (including failures), executing merge');
          try {
            await this.executeNode(edge.target, null);
          } catch (err: any) {
            this.safeLog('warn', { nodeId: edge.target, error: err.message }, '[WorkflowEngine] Merge node execution failed after failed branch notification'); // err.message may contain secret-interpolated content
          }
        }
      } else {
        // Recurse: the failed branch may have had further downstream nodes
        await this.notifyMergeGatesForFailedBranch(edge.target);
      }
    }
  }

  /**
   * Execute the core logic of a node (without retry/fallback handling)
   */
  private async executeNodeCore(node: WorkflowNode, input: any): Promise<any> {
    // Provide shared context to the node via input
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      input.__sharedContext = Object.fromEntries(this.context.sharedContext);
    }

    // Track the current node type so interpolateTemplate can enforce secret ACLs
    // synchronously without threading nodeType through every call. S0-9 / B5.
    this._currentNodeType = node.type;
    this._nodeAclDenials = [];

    // Schema-driven plugin path — migrated nodes go through the registry.
    // Falls through to the legacy switch for unmigrated types.
    const plugin = nodeRegistry.get(node.type);
    if (plugin) {
      return this.runRegistryNode(plugin, node, input);
    }

    // All node types are now schema-driven via the nodes/<type>/ registry
    // above; the legacy switch only retains the default-throw guard for
    // unknown types. Some node executor classes are still in this file as
    // dead code pending physical removal.
    switch (node.type) {
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  /**
   * Execute a schema-driven (registry-backed) node and validate the output
   * against its schema.outputAssertions. If any assertion fails, emit
   * `node_error` with `reason: 'output_failed_assertion'` and rethrow so the
   * existing retry/fallback path activates.
   */
  private async runRegistryNode(
    plugin: import('../nodes/types.js').NodePlugin,
    node: WorkflowNode,
    input: any,
  ): Promise<any> {
    const ctx: NodeExecutionContext = {
      signal: this.signal,
      executionId: this.context.executionId,
      workflowId: this.context.workflowId,
      // Theme A / S1-1: forward the caller's tenant onto every node ctx
      // so executors that touch Prisma inherit tenant scoping. Coerce
      // null -> undefined so the optional shared interface stays satisfied.
      tenantId: this.context.tenantId ?? undefined,
      apiUrl: this.apiUrl,
      mcpProxyUrl: this.mcpProxyUrl,
      // Batch 4 — agent nodes (agent_spawn / a2a / agent_single / agent_pool /
      // agent_supervisor / multi_agent) read the openagentic-proxy URL + internal
      // auth key from the context.
      openagenticProxyUrl: process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300',
      openagenticProxyInternalKey: process.env.OPENAGENTIC_PROXY_INTERNAL_KEY,
      userId: this.context.userId,
      authToken: this.context.authToken,
      idToken: this.context.idToken,
      userEmail: this.context.userEmail,
      interpolateTemplate: (t, i) => this.interpolateTemplate(t, i),
      getInternalAuthHeaders: () => this.getInternalAuthHeaders(),
      // Approval gate + audit for mcp_tool (HIGH-severity bypass fix,
      // 2026-06-20). Routes the engine's tool call through the SAME
      // runAuditAndGate the chat/orchestrate paths use, via the api's gated
      // decision endpoint. The api owns the audit row + ApprovalRegistry; this
      // hook returns only the decision (the executor blocks the proxy call when
      // allowed===false). See executor.ts for the fail-safe-block contract.
      gateMcpCall: (call) => this.gateMcpCall(call),
      logger,
      tracing: this.tracing,
      subFlowDepth: this.context.subFlowDepth ?? 0,

      // webhook_response: stash resolved response on execution context so the
      // webhook handler can pick it up after execution completes.
      setWebhookResponse: (response) => {
        this.context.webhookResponse = response;
      },

      // webhook_response (2026-05-14) — when the node has `persistAsArtifact: true`,
      // the executor calls this hook with the rendered body so the engine writes
      // a row into `artifact_files`. The artifacts library reads from the same
      // table via /api/artifacts → ArtifactService.listArtifacts, so the row
      // appears alongside chat-produced artifacts.
      //
      // Failures are non-fatal — they are logged and bubble null back to the
      // executor (which already swallows). The artifact id format matches
      // ArtifactService.generateId so downstream consumers can identify
      // flow-produced artifacts by the `artifact_` prefix.
      persistArtifact: async (artifact) => {
        try {
          const userId = this.context.userId;
          if (!userId) {
            logger.warn(
              { executionId: this.context.executionId },
              '[engine] persistArtifact called with no userId — skipping',
            );
            return null;
          }
          const id = `artifact_${Date.now()}_${Math.random().toString(36).substring(2)}`;
          const bodyBytes = Buffer.byteLength(artifact.body, 'utf-8');
          const tagsWithKind = Array.from(
            new Set([
              ...(artifact.tags ?? []),
              ...(artifact.kind ? [artifact.kind] : []),
            ]),
          );
          await prisma.artifactFile.create({
            data: {
              id,
              user_id: userId,
              filename: `${id}.${mimeTypeToExtension(artifact.mimeType)}`,
              mime_type: artifact.mimeType,
              file_size: bodyBytes,
              storage_path: null,
              content_hash: null,
              title: artifact.title,
              description: artifact.description ?? null,
              tags: tagsWithKind,
              is_public: false,
              extracted_text: artifact.body,
              thumbnail_url: null,
              uploaded_at: new Date(),
              last_accessed: null,
              access_count: 0,
            },
          });
          logger.info(
            { artifactId: id, userId, title: artifact.title, bytes: bodyBytes },
            '[engine] persistArtifact wrote artifact_files row',
          );
          return id;
        } catch (err: any) {
          logger.warn(
            {
              err: err?.message ?? String(err),
              executionId: this.context.executionId,
            },
            '[engine] persistArtifact failed (non-fatal)',
          );
          return null;
        }
      },

      // multi_agent / agent_pool / agent_supervisor — emits per-subagent
      // progress events through the execution stream so the UI can render
      // the live swarm popover. Two accepted shapes:
      //   1. Legacy { eventType, payload } — back-compat for executors
      //      still emitting the free-form pre-Tier-A taxonomy
      //      (e.g. subagent.contract_violation, subagent.update).
      //   2. Canonical SDK AgenticEvent { event: { type, ts, ... } }
      //      from @agentic-work/llm-sdk builders. Forwarded verbatim under
      //      `frame.event` so chatmode + Flows share one swarm-renderer
      //      contract.
      emitNodeProgress: (event) => {
        if ('event' in event) {
          // Canonical SDK AgenticEvent path — Tier A.
          this.emitEvent('node_progress', {
            nodeId: event.nodeId,
            event: event.event,
          });
        } else {
          // Legacy free-form path.
          this.emitEvent('node_progress', {
            nodeId: event.nodeId,
            eventType: event.eventType,
            payload: event.payload,
          });
        }
      },

      // Tier B — llm_completion (and follow-on AI nodes) emit canonical
      // CanonicalEvent frames per provider token. The engine forwards each
      // event verbatim under `frame.data.canonical` on a `node_canonical`
      // ExecutionEvent so the UI can render incremental token deltas in
      // real time, identical to chatmode.
      emitCanonical: (canonical) => {
        this.emitEvent('node_canonical', {
          nodeId: node.id,
          canonical,
        });
      },

      // merge: surface incoming edge results via the context hook so the
      // executor can merge them without direct access to engine internals.
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

      // Control-flow plugins (Task #45 — condition, switch, parallel, loop)
      // need read access to outgoing-edge topology to make routing decisions.
      // Sister of getIncomingResults; same shape minus the resolved value.
      getOutgoingEdges: (nodeId) => {
        const outgoing = this.outgoingEdges.get(nodeId) || [];
        return outgoing.map(e => ({
          target: e.target,
          label: e.label,
          sourceHandle: e.sourceHandle,
        }));
      },

      // condition + switch: dispatch the executor's follow/skip decision.
      // Mirrors the legacy executeConditionNode / executeSwitchNode order:
      // notify the merge gates of all skipped branches FIRST so they don't
      // hang waiting for branches that will never arrive (W1 / commit
      // 1601b7a2), then sequentially execute the followed branches.
      routeBranches: async (_fromNodeId, decision, branchInput) => {
        for (const skippedTarget of decision.skip) {
          this.notifySkippedBranch(skippedTarget);
        }
        for (const followedTarget of decision.follow) {
          await this.executeNode(followedTarget, branchInput);
        }
      },

      // parallel: fan out to ALL outgoing edges with Promise.allSettled —
      // matches the legacy executeParallelNode waitForAll=true path. Per-
      // branch timeout / race-mode handling were dropped from the schema-
      // driven version; the executor + outputAssertions now drive the
      // success-rate gate. See nodes/parallel/executor.ts header.
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

      // loop / map_reduce: per-iteration subgraph execution. For each item,
      // build the loop-aware input shape that mirrors the legacy
      // executeLoopNode (primitive items pass through bare; object items are
      // spread with `${itemVariable}` + `__loopIndex` + `__loopTotal`
      // metadata) and dispatch to every outgoing edge. Returns the
      // per-iteration results in INPUT ORDER (edge-major within each item),
      // independent of completion order.
      //
      // `concurrency` (default 1 / sequential — loop's historical behaviour)
      // bounds how many items run their subgraph at once. map_reduce passes a
      // configured limit to fan out; a bounded sliding window keeps at most
      // `concurrency` item-subgraphs in flight while preserving result order.
      iterateOver: async (fromNodeId, items, itemVariable, baseInput, concurrency?: number) => {
        const outgoing = this.outgoingEdges.get(fromNodeId) || [];
        const limit = Math.max(
          1,
          Math.min(
            items.length || 1,
            typeof concurrency === 'number' && Number.isFinite(concurrency)
              ? Math.floor(concurrency)
              : 1,
          ),
        );

        const buildInput = (currentItem: unknown, i: number): unknown => {
          if (typeof currentItem !== 'object' || currentItem === null) {
            return currentItem;
          }
          return {
            ...(typeof baseInput === 'object' && baseInput !== null ? baseInput : {}),
            ...(currentItem as Record<string, unknown>),
            [itemVariable]: currentItem,
            __loopIndex: i,
            __loopTotal: items.length,
          };
        };

        // Run one item's subgraph: every outgoing edge, sequentially within
        // the item, returning that item's edge results in edge order.
        const runItem = async (i: number): Promise<unknown[]> => {
          const loopInput = buildInput(items[i], i);
          const perEdge: unknown[] = [];
          for (const edge of outgoing) {
            perEdge.push(await this.executeNode(edge.target, loopInput));
          }
          return perEdge;
        };

        // Sequential fast-path preserves the exact prior behaviour (loop and
        // map_reduce with concurrency=1) — no Promise scheduling overhead.
        if (limit === 1) {
          const results: unknown[] = [];
          for (let i = 0; i < items.length; i++) {
            results.push(...(await runItem(i)));
          }
          return results;
        }

        // Bounded sliding window: a shared cursor hands the next index to each
        // of `limit` workers. Per-item results are written into a slot keyed by
        // the item's index, so the final flattened array is in input order
        // regardless of which worker finished first.
        const perItem: unknown[][] = new Array(items.length);
        let next = 0;
        const worker = async (): Promise<void> => {
          for (;;) {
            const i = next++;
            if (i >= items.length) return;
            perItem[i] = await runItem(i);
          }
        };
        await Promise.all(Array.from({ length: limit }, () => worker()));
        return perItem.flat();
      },

      // retry_with_backoff: execute the node's outgoing subgraph exactly once
      // with the supplied input and surface the FIRST rejection so the
      // executor can decide whether to back off and retry. Distinct from
      // iterateOver (never re-runs the same item) and fanOutBranches (swallows
      // rejections into a settled array). Each happy-path edge is executed
      // sequentially; if any rejects, the rejection propagates immediately
      // (no allSettled). Returns the terminal subgraph result (last edge's
      // value, or the lone edge's value). A retry node with no downstream is a
      // misconfiguration — we reject so the executor's exhaustion path names it.
      runSubStep: async (fromNodeId: string, branchInput: unknown) => {
        const outgoing = (this.outgoingEdges.get(fromNodeId) || []).filter(isHappyEdge);
        if (outgoing.length === 0) {
          throw new Error(
            `retry_with_backoff[${fromNodeId}]: no downstream step to run — ` +
              'connect a node to its output so there is an operation to retry.',
          );
        }
        let last: unknown;
        for (const edge of outgoing) {
          // Awaited sequentially: the first rejection escapes the loop and
          // rejects this hook, which is exactly the signal the executor's
          // retry loop catches to back off.
          last = await this.executeNode(edge.target, branchInput);
        }
        return last;
      },

      // trigger: publish the workflow's first event onto the execution
      // context so {{trigger.body.*}} and {{trigger.<key>}} resolve for
      // every downstream node.
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
      // isolated-vm sandbox. Mirrors the legacy executeJavaScript helper:
      // 5s default timeout, 256MB cap, throws on sandbox error.
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

      // conversation_memory (gap-analysis 2026-05-14 P0 #2): Prisma-backed
      // chat history service. Lazy-imported so the harness mock at
      // test/harness/setup.ts can still stand in. Tenant id is threaded
      // through ctx.tenantId on every hook call.
      conversationMemory: {
        read: async (args) => {
          const { ConversationMemoryService } = await import('./ConversationMemoryService.js');
          const svc = new ConversationMemoryService({
            apiUrl: this.apiUrl,
            internalAuthHeaders: () => this.getInternalAuthHeaders(),
            executionId: this.context.executionId,
          });
          return svc.read(args);
        },
        write: async (args) => {
          const { ConversationMemoryService } = await import('./ConversationMemoryService.js');
          const svc = new ConversationMemoryService({
            apiUrl: this.apiUrl,
            internalAuthHeaders: () => this.getInternalAuthHeaders(),
            executionId: this.context.executionId,
          });
          return svc.write(args);
        },
        clear: async (args) => {
          const { ConversationMemoryService } = await import('./ConversationMemoryService.js');
          const svc = new ConversationMemoryService({
            apiUrl: this.apiUrl,
            internalAuthHeaders: () => this.getInternalAuthHeaders(),
            executionId: this.context.executionId,
          });
          return svc.clear(args);
        },
        summarize: async (args) => {
          const { ConversationMemoryService } = await import('./ConversationMemoryService.js');
          const svc = new ConversationMemoryService({
            apiUrl: this.apiUrl,
            internalAuthHeaders: () => this.getInternalAuthHeaders(),
            executionId: this.context.executionId,
          });
          return svc.summarize(args);
        },
        search: async (args) => {
          const { ConversationMemoryService } = await import('./ConversationMemoryService.js');
          const svc = new ConversationMemoryService({
            apiUrl: this.apiUrl,
            internalAuthHeaders: () => this.getInternalAuthHeaders(),
            executionId: this.context.executionId,
          });
          return svc.search(args);
        },
      },

      // sub_workflow: invoke another saved workflow by id. Loads the child
      // definition from Prisma, derives a child execution id, and recurses
      // into executeWorkflow with the caller's user/auth context.
      executeSubWorkflow: async (workflowId, subInput) => {
        const subWorkflow = await prisma.workflow.findUnique({
          where: { id: workflowId },
          select: { id: true, name: true, definition: true },
        });
        if (!subWorkflow || !subWorkflow.definition) {
          return {
            success: false,
            output: undefined,
            error: `Sub-workflow ${workflowId} not found or has no definition`,
          };
        }
        const subDef = typeof subWorkflow.definition === 'string'
          ? JSON.parse(subWorkflow.definition)
          : subWorkflow.definition;

        const subExecId = `sub-${this.context.executionId}-${node.id}`;
        const { executeWorkflow: execSubWf } = await import('./WorkflowExecutionEngine.js');
        const result = await execSubWf(
          workflowId,
          subExecId,
          subDef,
          (subInput as Record<string, any>) ?? {},
          this.context.userId,
          this.context.authToken,
          undefined, // no event handler for sub-workflow
          {
            userEmail: this.context.userEmail,
            idToken: this.context.idToken,
            tenantId: this.context.tenantId,
            subFlowDepth: (this.context.subFlowDepth ?? 0) + 1,
          },
        );
        return result;
      },

      // human_approval / approval — persist the approval row, checkpoint
      // the execution state, emit `approval_required`, and dispatch
      // notifications. The engine's outer pause logic
      // (executeNodeWithRecovery, ~line 920) still owns the
      // `execution_paused` event after the executor returns.
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

        try {
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
        } catch (dbErr) {
          logger.warn({ dbErr, nodeId: payload.nodeId }, '[WorkflowEngine] Could not update execution for approval');
        }

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

      // human_input / request_data — persist the typed data-request, checkpoint
      // the execution, emit the `needs_input` frame. Mirrors pauseForApproval;
      // the outer pause logic suspends the run after the executor returns
      // awaiting_input. POST /resume-execution re-enters with the user's
      // submitted values.
      requestData: async (payload) => {
        const request = await createDataRequestRecord(prisma, {
          executionId: this.context.executionId,
          nodeId: payload.nodeId,
          fields: payload.fields as any,
          title: payload.title,
          description: payload.description,
          timeoutSeconds: payload.timeoutSeconds,
          timeoutAction: payload.timeoutAction,
          assignTo: payload.assignTo,
          channel: payload.channel,
          contextData: {
            input: payload.input,
            nodeResults: Object.fromEntries(this.context.nodeResults),
          },
          tenantId: this.context.tenantId ?? null,
        });

        try {
          await prisma.workflowExecution.update({
            where: { id: this.context.executionId },
            data: {
              status: 'awaiting_input',
              current_node_id: payload.nodeId,
              state: {
                nodeResults: Object.fromEntries(this.context.nodeResults),
                variables: Object.fromEntries(this.context.variables),
                pendingDataRequestId: request.id,
                input: payload.input as any,
              } as any,
            },
          });
        } catch (dbErr) {
          logger.warn({ dbErr, nodeId: payload.nodeId }, '[WorkflowEngine] Could not update execution for data request');
        }

        this.emitEvent('needs_input', {
          requestId: request.id,
          nodeId: payload.nodeId,
          title: payload.title,
          description: payload.description,
          fields: payload.fields,
          channel: payload.channel,
          expiresAt: request.timeout_at,
        });

        return {
          id: request.id,
          timeout_at: request.timeout_at as Date | string,
        };
      },

      // Test-mode mocks (Phase B #17). Forwarded onto every node ctx so
      // mock-aware executors (mcp_tool, llm_completion, etc.) can
      // short-circuit network calls when the api proxies a /test-execute
      // request. Absent in production traffic.
      testMocks: this.context.testMocks,
    };

    let result: any;
    try {
      result = await runWithAssertions(plugin, node, input, ctx);
    } catch (err) {
      if (err instanceof OutputAssertionError) {
        // Surface the failed-assertion details so observers (UI, logs, alerts)
        // can distinguish "fake success" from genuine errors. The engine's
        // outer catch in executeNodeWithRecovery still handles retry/fallback.
        this.emitEvent('node_error', {
          nodeId: node.id,
          nodeType: node.type,
          error: err.message,
          reason: err.reason, // 'output_failed_assertion'
          failedAssertion: err.failedAssertion,
        });
      }
      throw err;
    }

    // wait: long-wait sentinel — persist state and schedule resume.
    // The executor returns { status: 'waiting', durationMs, resumeAt, message }
    // when the duration is >= 30s. The engine handles the Prisma state-save
    // and emitEvent (same as the legacy executeWaitNode did).
    if (node.type === 'wait' && result?.status === 'waiting') {
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: {
          status: 'waiting',
          current_node_id: node.id,
          resume_at: new Date(result.resumeAt),
          state: {
            nodeResults: Object.fromEntries(this.context.nodeResults),
            variables: Object.fromEntries(this.context.variables),
            input,
          },
        },
      });

      this.emitEvent('execution_paused', {
        nodeId: node.id,
        resumeAt: result.resumeAt,
        reason: 'wait_node',
      });
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
    // Supports both {{trigger.body.message}} (canonical nested) and {{trigger.message}} (flat alias)
    const triggerData: Record<string, any> = {};
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      Object.assign(triggerData, input);        // flat keys: trigger.message, trigger.topic, etc.
    }
    triggerData.body = input;                   // canonical nested: trigger.body.message
    this.context.nodeResults.set('__trigger__', triggerData);

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

    // Resolve model: prefer explicit model, otherwise use 'auto' for Smart Router
    const effectiveModel = model && model !== 'auto' ? model : 'auto';

    // Call the OpenAI-compatible endpoint
    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: effectiveModel,
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
    const { toolName, toolServer: toolServerRaw, serverName, arguments: argsField, toolParams, toolArgs: toolArgsField } = node.data;
    const toolServer = toolServerRaw || serverName; // Fall back to serverName for UI compat

    // Normalize server name: hyphens → underscores, strip trailing _mcp
    // MCP proxy registers servers with underscores (e.g. openagentic_azure) but workflow
    // nodes may store hyphens (e.g. oap-azure-mcp)
    const normalizedServer = toolServer
      ? toolServer.replaceAll('-', '_').replace(/_mcp$/, '')
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

    // Smart parameter resolution: if arguments are empty/blank but upstream input exists,
    // try to extract tool parameters from the input. This handles templates where
    // MCP tool nodes rely on upstream LLM/merge output without explicit argument mapping.
    // Also handles cases where template interpolation resolved to empty strings.
    const hasEmptyArgs = Object.keys(resolvedArgs).length === 0 ||
      Object.values(resolvedArgs).every(v => v === '' || v === undefined || v === null);
    if (hasEmptyArgs && input) {
      const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
      // For web_search: extract query from input text
      if (toolName === 'web_search' || toolName === 'web_news_search') {
        resolvedArgs.query = typeof input === 'string' ? input.substring(0, 500) :
          (input?.query || input?.search || input?.text || input?.message || inputStr.substring(0, 500));
      }
      // For k8s tools: extract namespace and deployment_name from input
      else if (toolName?.startsWith('k8s_') && !resolvedArgs.namespace) {
        resolvedArgs.namespace = input?.namespace || process.env.OPENAGENTIC_NAMESPACE || 'default';
        if (input?.deployment_name) resolvedArgs.deployment_name = input.deployment_name;
        if (input?.deployment) resolvedArgs.deployment_name = input.deployment;
      }
      // For loki_query: extract query from input
      else if (toolName === 'loki_query' && !resolvedArgs.query) {
        resolvedArgs.query = input?.query || input?.loki_query ||
          `{namespace="${input?.namespace || process.env.OPENAGENTIC_NAMESPACE || 'default'}"}`;
      }
      // Generic: if input is an object with simple values, pass as arguments
      // BUT skip LLM output fields (content, model, usage, provider, _costMeta)
      // which leak from upstream openagentic_llm nodes
      else if (typeof input === 'object' && !Array.isArray(input)) {
        const llmOutputFields = new Set(['content', 'model', 'usage', 'provider', '_costMeta', 'message', 'role']);
        for (const [k, v] of Object.entries(input)) {
          if (!k.startsWith('__') && !llmOutputFields.has(k) && typeof v !== 'object') {
            resolvedArgs[k] = v;
          }
        }
      }
    }

    // Strip internal workflow properties that MCP tools don't expect
    delete resolvedArgs.__sharedContext;
    delete resolvedArgs.__nodeId;
    delete resolvedArgs.__executionId;

    // Route web_search and web_news_search through openagentic_web MCP server
    // (Searx on K8s — handles rate limiting, multi-engine aggregation)
    const effectiveServer = (toolName === 'web_search' || toolName === 'web_news_search')
      ? 'openagentic_web'
      : normalizedServer;

    logger.info({
      nodeId: node.id,
      toolName,
      toolServer: effectiveServer,
      originalServer: toolServer,
    }, '[WorkflowEngine] Executing MCP tool node');

    // Call MCP Proxy — authToken is already the real Azure AD token (loaded in workflows.ts)
    const response = await abortableAxiosPost(
      this,
      `${this.mcpProxyUrl}/call`,
      {
        server: effectiveServer,
        tool: toolName,
        arguments: resolvedArgs
      },
      {
        headers: {
          'Content-Type': 'application/json',
          // Authenticate as System Root via the service-internal key so mcp-proxy
          // authorizes WITHOUT a per-user policy round-trip to the api. The
          // user-token path is fragile: mcp-proxy must reach the api to resolve
          // group policies, which fails transiently and 401s the whole tool call
          // (made grounded flows non-deterministic). Single-tenant: correct.
          'Authorization': (process.env.API_INTERNAL_KEY || process.env.INTERNAL_API_KEY)
            ? `Bearer ${process.env.API_INTERNAL_KEY || process.env.INTERNAL_API_KEY}`
            : (this.context.authToken || ''),
          // OSS: no OBO (On-Behalf-Of) token forwarding. Cloud MCP servers
          // authenticate via their own service-account / static-keypair / ADC
          // credentials, not via a per-user OBO token (enterprise-only).
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

    // Substrate-fix S4 (spec §3): SSRF + IMDS + RFC1918 deny-then-allowlist.
    //
    // 1) FIRST: parse + deny private/loopback/IMDS/cluster-local targets.
    //    Replaces silent fetch failures (or worse, IMDS-token exfil) with
    //    an EgressBlockedError surfaced at the node-failure boundary.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(resolvedUrl);
    } catch (e: any) {
      throw new Error(`HTTP request failed: invalid URL: ${resolvedUrl}`);
    }
    await denyIfPrivate(parsedUrl); // throws EgressBlockedError on private/IMDS

    // 2) THEN: gate X-Internal-Secret on an explicit allowlist, NOT on
    //    substring match. Default allowlist covers the in-cluster api
    //    Service DNS; admins can override via INTERNAL_HOST_ALLOWLIST
    //    (comma-separated FQDNs). Empty allowlist → no secret injected.
    //
    //    Note: denyIfPrivate above will reject `*.svc.cluster.local`
    //    targets BEFORE this branch fires, so the allowlist below is
    //    effectively narrowed by the deny step. Internal-cluster traffic
    //    has to flow through the api proxy (which uses Kubernetes
    //    short-name DNS — not the FQDN — so it hits no deny rule).
    const internalAllowList = (process.env.INTERNAL_HOST_ALLOWLIST?.split(',').map((s) => s.trim()).filter(Boolean))
      ?? [`openagentic-api.${process.env.OPENAGENTIC_NAMESPACE || 'default'}.svc.cluster.local`];
    let isInternalUrl = false;
    if (await isAllowedInternalHost(parsedUrl, internalAllowList)) {
      isInternalUrl = true;
      if (!resolvedHeaders['Authorization'] && !resolvedHeaders['X-Internal-Secret']) {
        Object.assign(resolvedHeaders, this.getInternalAuthHeaders());
      }
    }

    logger.info({
      nodeId: node.id,
      method,
      url: resolvedUrl,
      isInternal: isInternalUrl,
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

      // Check if the node opts into raw HTTP responses (for APIs that use non-2xx codes intentionally)
      const acceptAllStatuses = node.data.acceptAllStatuses === true;

      // For non-2xx responses (excluding redirects), throw an error so the workflow engine's
      // error recovery mechanism (retry, fallback, error routing via onError) activates.
      // Without this, HTTP errors silently cascade to downstream nodes as bad input data.
      if (!acceptAllStatuses && (response.status >= 400 || (response.status >= 300 && response.status !== 301 && response.status !== 302 && response.status !== 304))) {
        logger.warn({
          nodeId: node.id,
          status: response.status,
          url: resolvedUrl,
        }, '[WorkflowEngine] HTTP request returned non-2xx status');
        // Include response data in the error for downstream error handlers
        const errorDetail = typeof response.data === 'string'
          ? response.data.substring(0, 500)
          : JSON.stringify(response.data)?.substring(0, 500) || '';
        const err = new Error(`HTTP ${response.status} ${response.statusText || 'error'} from ${resolvedUrl}: ${errorDetail}`);
        (err as any).httpStatus = response.status;
        (err as any).httpResponse = result;
        throw err;
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
      port: smtpPort || Number.parseInt(process.env.SMTP_PORT || '587'),
      secure: (smtpPort || Number.parseInt(process.env.SMTP_PORT || '587')) === 465,
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
   * Execute RAG query node — semantic search against a Milvus collection
   */
  private async executeRagQueryNode(node: WorkflowNode, input: any): Promise<any> {
    const {
      collection = 'default',
      query,
      topK = 5,
      filters,
      scoreThreshold,
    } = node.data;

    const resolvedQuery = this.interpolateTemplate(query || '', input);
    const resolvedCollection = this.interpolateTemplate(collection, input);

    if (!resolvedQuery) throw new Error('RAG query node requires a query');

    logger.info({
      nodeId: node.id,
      collection: resolvedCollection,
      topK,
    }, '[WorkflowEngine] Executing RAG query node');

    // Call the vector search API endpoint
    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/vector/search`,
      {
        collection: resolvedCollection,
        query: resolvedQuery,
        topK,
        filters: filters ? (typeof filters === 'string' ? JSON.parse(this.interpolateTemplate(filters, input)) : filters) : undefined,
        scoreThreshold: scoreThreshold || 0.5,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    if (response.status >= 400) {
      throw new Error(`RAG query failed: ${response.data?.error || response.statusText}`);
    }

    const results = response.data?.results || response.data || [];
    return {
      query: resolvedQuery,
      collection: resolvedCollection,
      resultCount: Array.isArray(results) ? results.length : 0,
      results,
    };
  }

  /**
   * Execute file upload node — embed documents into a Milvus collection
   */
  private async executeFileUploadNode(node: WorkflowNode, input: any): Promise<any> {
    const {
      collection = 'default',
      content: fileContent,
      fileName,
      chunkSize = 512,
      chunkOverlap = 50,
      metadata,
    } = node.data;

    const resolvedCollection = this.interpolateTemplate(collection, input);
    const resolvedContent = this.interpolateTemplate(fileContent || '', input);
    const resolvedFileName = this.interpolateTemplate(fileName || 'workflow-upload', input);

    // Content can come from node data or from upstream input
    const contentToEmbed = resolvedContent || (typeof input === 'string' ? input : input?.content || input?.text || '');

    if (!contentToEmbed) throw new Error('File upload node requires content to embed');

    logger.info({
      nodeId: node.id,
      collection: resolvedCollection,
      contentLength: contentToEmbed.length,
      chunkSize,
    }, '[WorkflowEngine] Executing file upload (embed) node');

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/files/embed`,
      {
        collection: resolvedCollection,
        content: contentToEmbed,
        fileName: resolvedFileName,
        chunkSize,
        chunkOverlap,
        metadata: metadata ? (typeof metadata === 'string' ? JSON.parse(this.interpolateTemplate(metadata, input)) : metadata) : undefined,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
        },
        timeout: 120000,
        validateStatus: () => true,
      }
    );

    if (response.status >= 400) {
      throw new Error(`File upload/embed failed: ${response.data?.error || response.statusText}`);
    }

    return {
      collection: resolvedCollection,
      fileName: resolvedFileName,
      chunkCount: response.data?.chunkCount || response.data?.chunks || 0,
      status: 'embedded',
      ...response.data,
    };
  }

  /**
   * Execute text_splitter node — split documents into chunks
   */
  private async executeTextSplitterNode(node: WorkflowNode, input: any): Promise<any> {
    const strategy = node.data.strategy || 'recursive';
    const chunkSize = node.data.chunkSize || 512;
    const chunkOverlap = node.data.chunkOverlap || 50;
    const separators = node.data.separators || ['\n\n', '\n', '. ', ' '];

    const text = typeof input === 'string' ? input : input?.content || input?.text || input?.document || JSON.stringify(input);
    if (!text) throw new Error('Text splitter requires text input');

    logger.info({ nodeId: node.id, strategy, chunkSize, textLength: text.length }, '[WorkflowEngine] Splitting text'); // metadata only — no secret interpolation

    const chunks: Array<{ content: string; index: number; metadata: any }> = [];

    if (strategy === 'recursive') {
      let remaining = text;
      let index = 0;
      while (remaining.length > 0) {
        let end = Math.min(remaining.length, chunkSize);
        // Try to break at a separator
        if (end < remaining.length) {
          for (const sep of separators) {
            const lastSep = remaining.lastIndexOf(sep, end);
            if (lastSep > chunkSize * 0.5) { end = lastSep + sep.length; break; }
          }
        }
        chunks.push({ content: remaining.slice(0, end).trim(), index, metadata: { strategy, chunkSize } });
        remaining = remaining.slice(Math.max(0, end - chunkOverlap));
        index++;
      }
    } else {
      // Simple fixed-size chunking
      for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
        chunks.push({ content: text.slice(i, i + chunkSize).trim(), index: chunks.length, metadata: { strategy: 'fixed', chunkSize } });
      }
    }

    return { chunks, totalChunks: chunks.length, originalLength: text.length };
  }

  /**
   * Execute embedding node — generate vector embeddings
   */
  private async executeEmbeddingNode(node: WorkflowNode, input: any): Promise<any> {
    const model = this.interpolateTemplate(node.data.model || 'text-embedding-3-small', input);
    const batchSize = node.data.batchSize || 100;

    // Accept array of chunks or single text
    let texts: string[];
    if (Array.isArray(input?.chunks)) {
      texts = input.chunks.map((c: any) => typeof c === 'string' ? c : c.content);
    } else if (Array.isArray(input)) {
      texts = input.map((i: any) => typeof i === 'string' ? i : i.content || JSON.stringify(i));
    } else {
      texts = [typeof input === 'string' ? input : input?.content || input?.text || JSON.stringify(input)];
    }

    logger.info({ nodeId: node.id, model, textCount: texts.length }, '[WorkflowEngine] Generating embeddings'); // metadata only — no secret interpolation

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/embeddings`,
      { input: texts.slice(0, batchSize), model },
      { headers: this.getInternalAuthHeaders(), timeout: 60000, validateStatus: () => true }
    );

    if (response.status >= 400) {
      // Fallback: use the vector search endpoint's embedding path
      const fallback = await abortableAxiosPost(
        this,
        `${this.apiUrl}/api/v1/vector/embed`,
        { texts, model },
        { headers: this.getInternalAuthHeaders(), timeout: 60000, validateStatus: () => true }
      );
      return {
        vectors: fallback.data?.embeddings || [],
        model,
        count: texts.length,
        dimensions: fallback.data?.dimensions || 0,
        texts,
      };
    }

    const embeddings = response.data?.data?.map((d: any) => d.embedding) || response.data?.embeddings || [];
    return { vectors: embeddings, model, count: texts.length, dimensions: embeddings[0]?.length || 0, texts };
  }

  /**
   * Execute vector_store node — write/upsert vectors to Milvus
   */
  private async executeVectorStoreNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data.operation || 'upsert';
    const collection = this.interpolateTemplate(node.data.collection || 'default', input);
    const createIfMissing = node.data.createIfMissing !== false;

    const vectors = input?.vectors || [];
    const texts = input?.texts || [];
    const metadata = node.data.metadata || input?.metadata || {};

    logger.info({ nodeId: node.id, operation, collection, vectorCount: vectors.length }, '[WorkflowEngine] Vector store operation');

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/vector/store`,
      { collection, operation, vectors, texts, metadata, createIfMissing },
      { headers: this.getInternalAuthHeaders(), timeout: 120000, validateStatus: () => true }
    );

    if (response.status >= 400) {
      // Fallback: use the files/embed endpoint
      const content = texts.join('\n\n');
      const fallback = await abortableAxiosPost(
        this,
        `${this.apiUrl}/api/files/embed`,
        { content, collection, fileName: `flow-${this.context.executionId}`, chunkSize: 0 },
        { headers: this.getInternalAuthHeaders(), timeout: 120000, validateStatus: () => true }
      );
      return { collection, operation, stored: fallback.data?.chunks || texts.length, ...fallback.data };
    }

    return { collection, operation, stored: response.data?.count || vectors.length, ...response.data };
  }

  /**
   * Execute document_loader node — load content from URLs, files, etc.
   */
  private async executeDocumentLoaderNode(node: WorkflowNode, input: any): Promise<any> {
    const sourceType = node.data.sourceType || 'url';
    const url = this.interpolateTemplate(node.data.url || '', input) || (typeof input === 'string' ? input : input?.url || input?.source || '');
    const parseMode = node.data.parseMode || 'auto';

    logger.info({ nodeId: node.id, sourceType, url: url?.slice(0, 100) }, '[WorkflowEngine] Loading document');

    if (sourceType === 'url' && url) {
      const response = await abortableAxiosGet(this, url, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'Accept': 'text/html,application/json,text/plain,*/*' },
        validateStatus: () => true,
      });

      let content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);

      // Strip HTML tags if parseMode is text
      if (parseMode === 'text' || (parseMode === 'auto' && content.includes('<html'))) {
        content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim();
      }

      return {
        content,
        source: url,
        sourceType,
        contentLength: content.length,
        mimeType: response.headers['content-type'] || 'text/plain',
      };
    }

    // For non-URL sources, pass through input content
    const content = typeof input === 'string' ? input : input?.content || input?.text || JSON.stringify(input);
    return { content, source: sourceType, sourceType, contentLength: content.length };
  }

  /**
   * Execute structured_output node — enforce JSON schema on LLM response
   */
  private async executeStructuredOutputNode(node: WorkflowNode, input: any): Promise<any> {
    const model = this.interpolateTemplate(node.data.model || 'gpt-4.1', input);
    const schema = node.data.schema || '{}';
    const prompt = this.interpolateTemplate(node.data.prompt || '', input) || (typeof input === 'string' ? input : input?.content || input?.prompt || '');
    const maxRetries = node.data.maxRetries || 2;

    logger.info({ nodeId: node.id, model }, '[WorkflowEngine] Structured output generation');

    const systemPrompt = `You MUST respond with valid JSON matching this schema:\n${schema}\n\nDo not include markdown code fences. Return ONLY the JSON object.`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await abortableAxiosPost(
        this,
        `${this.apiUrl}/api/v1/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        },
        { headers: this.getInternalAuthHeaders(), timeout: 60000, validateStatus: () => true }
      );

      const raw = response.data?.choices?.[0]?.message?.content || response.data?.content || '';
      try {
        const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
        return { output: parsed, model, attempts: attempt + 1, raw };
      } catch {
        if (attempt === maxRetries) {
          return { output: null, error: 'Failed to parse structured output after retries', raw, model, attempts: attempt + 1 };
        }
      }
    }
  }

  /**
   * Execute guardrails node — validate content against safety rules
   */
  private async executeGuardrailsNode(node: WorkflowNode, input: any): Promise<any> {
    const checks = node.data.checks || ['pii', 'toxicity', 'injection'];
    const action = node.data.action || 'block';

    const content = typeof input === 'string' ? input : input?.content || input?.text || input?.output || JSON.stringify(input);

    logger.info({ nodeId: node.id, checks, contentLength: content.length }, '[WorkflowEngine] Running guardrails'); // metadata only — no secret interpolation

    // Use DLP scanner via API
    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/guardrails/check`,
      { content, checks, action },
      { headers: this.getInternalAuthHeaders(), timeout: 15000, validateStatus: () => true }
    );

    if (response.status >= 400) {
      // Fallback: basic regex checks locally
      const findings: string[] = [];
      if (checks.includes('pii')) {
        if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) findings.push('SSN detected');
        if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content) && content.match(/@/g)!.length > 3) findings.push('Bulk email addresses');
      }
      if (checks.includes('injection')) {
        if (/ignore.*previous.*instructions|system.*prompt/i.test(content)) findings.push('Prompt injection attempt');
      }

      const passed = findings.length === 0;
      return {
        passed,
        findings,
        action: passed ? 'allow' : action,
        content: passed ? content : (action === 'redact' ? '[REDACTED]' : content),
        checksRun: checks,
      };
    }

    return response.data;
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

    // Only the in-process JavaScript V8 isolate is supported; other
    // languages have no execution backend in the OSS edition.
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

    // Determine which edges to follow vs skip
    const followEdges: typeof outgoing = [];
    const skipEdges: typeof outgoing = [];

    for (const edge of outgoing) {
      const edgeLabel = (edge.label || '').toLowerCase().trim();
      const shouldFollow =
        edgeLabel === resultStr ||
        (isTruthy && (edgeLabel === 'true' || edgeLabel === 'yes' || edgeLabel === '')) ||
        (isFalsy && (edgeLabel === 'false' || edgeLabel === 'no')) ||
        (edge.sourceHandle && edge.sourceHandle.toLowerCase() === resultStr);

      if (shouldFollow || outgoing.length === 1) {
        followEdges.push(edge);
      } else {
        skipEdges.push(edge);
      }
    }

    // Fallback: if no edge matched by label, route by position
    if (followEdges.length === 0 && outgoing.length >= 2) {
      const targetEdge = isTruthy ? outgoing[0] : outgoing[1];
      const skippedEdge = isTruthy ? outgoing[1] : outgoing[0];
      logger.info({
        nodeId: node.id,
        result: resultStr,
        isTruthy,
        targetNode: targetEdge.target,
      }, '[WorkflowEngine] Condition: no label match, routing by position');
      followEdges.push(targetEdge);
      // Rebuild skip list
      skipEdges.length = 0;
      skipEdges.push(skippedEdge);
    }

    // FIRST: notify merge gates about skipped branches BEFORE executing the matched branch
    // This prevents merge nodes from hanging when the skipped branch never arrives
    for (const edge of skipEdges) {
      this.notifySkippedBranch(edge.target);
    }

    // THEN: execute the matched branch(es)
    for (const edge of followEdges) {
      await this.executeNode(edge.target, input);
    }

    return result;
  }

  /**
   * Evaluate a condition expression - returns string or boolean for flexible routing
   */
  /**
   * When a condition skips a branch, walk downstream from the skipped node
   * to find any merge nodes and decrement their expected count so they don't hang.
   */
  /**
   * When a condition skips a branch, walk downstream to find merge nodes
   * and pre-register that one fewer branch will arrive.
   * This is called BEFORE the matched branch executes, so the merge gate
   * may not exist yet -- we store the skip count for later.
   */
  private notifySkippedBranch(skippedNodeId: string): void {
    const visited = new Set<string>();
    const queue = [skippedNodeId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodeMap.get(nodeId);
      if (!node) continue;

      if (node.type === 'merge') {
        // Pre-register skip count -- the merge gate will read this when created
        const current = this.mergeSkipCounts.get(nodeId) || 0;
        this.mergeSkipCounts.set(nodeId, current + 1);
        logger.info({ nodeId, skipCount: current + 1 },
          '[WorkflowEngine] Merge gate: pre-registered skip for condition branch');

        // Also update existing gate if already created
        const gate = this.mergeBarriers.get(nodeId);
        if (gate) {
          gate.expected = Math.max(1, gate.expected - 1);
          if (gate.arrived >= gate.expected && gate.resolve) {
            (gate.resolve as any)();
          }
        }
        continue; // Don't traverse past merge
      }

      const outgoing = this.outgoingEdges.get(nodeId) || [];
      for (const edge of outgoing) {
        queue.push(edge.target);
      }
    }
  }

  private async evaluateCondition(condition: string, operator: string, input: any): Promise<any> {
    // S0-2 / B1: condition expressions previously ran via `new Function`,
    // which let user-authored workflow code escape via Function.prototype.constructor.
    // Now evaluated inside a true V8 isolate via runSandboxed().
    try {
      // Resolve {{steps.X.output}} references as named variables instead of inline text.
      // Without this, template expansion turns "{{steps.llm.output}}.includes('critical')"
      // into "Long text about critical issues.includes('critical')" — invalid JS.
      // The fix: replace each {{steps.X.output}} with a variable name (__step_X), then
      // pass the resolved values as sandboxed globals.
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
        const resolvedCondition = this.interpolateTemplate(condition, input);
        const sandboxed2 = await runSandboxed(`return (${resolvedCondition});`, {
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
      // Build loop input: pass the item directly for code nodes
      // For primitive items (number, string), pass as-is so `return input * 2` works
      // For object items, spread them and add item/index metadata
      let loopInput: any;
      const currentItem = items[i];
      if (typeof currentItem !== 'object' || currentItem === null) {
        // Primitive value: pass directly (code node gets `input = 10`)
        loopInput = currentItem;
      } else {
        // Object value: spread it and add loop metadata
        loopInput = {
          ...currentItem,
          [itemVariable]: currentItem,
          [indexVariable]: i,
          __loopIndex: i,
          __loopTotal: items.length,
        };
      }

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
        // Extract a field from input using JS expression
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

    // Get all incoming node results, labeled by source node
    const incoming = this.incomingEdges.get(node.id) || [];
    const inputs: any[] = [];
    const labeledInputs: Record<string, any> = {};

    for (const edge of incoming) {
      const sourceResult = this.context.nodeResults.get(edge.source);
      if (sourceResult !== undefined) {
        inputs.push(sourceResult);
        // Label by source node label or id for keyed merge
        const sourceNode = this.nodeMap.get(edge.source);
        const label = (sourceNode?.data?.label || sourceNode?.id || edge.source)
          .replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        labeledInputs[label] = sourceResult;
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
        // Use labeled merge to avoid key collisions (e.g. all inputs having {success, data})
        return labeledInputs;

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
    try {
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: {
          status: 'awaiting_approval',
          current_node_id: node.id,
          state: {
            nodeResults: Object.fromEntries(this.context.nodeResults),
            variables: Object.fromEntries(this.context.variables),
            pendingApprovalId: approval?.id,
            input
          }
        }
      });
    } catch (dbErr) {
      logger.warn({ dbErr, nodeId: node.id }, '[WorkflowEngine] Could not update execution for approval');
    }

    // Emit approval required event
    this.emitEvent('approval_required', {
      approvalId: approval?.id,
      nodeId: node.id,
      approvers,
      message: approval?.message || `Approval required for ${node.id}`,
      expiresAt: approval?.timeout_at
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
      case 'ms':
      case 'milliseconds': durationMs = duration; break;
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
    const startTime = Date.now();
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

    // Resolve agent: prefer DB agentId, then map role to DB agent_type
    const agentRole = node.data.agentRole || agentType;
    // Legacy role mapping — maps old template roles to DB agent_type values
    const ROLE_TO_AGENT_TYPE: Record<string, string> = {
      'general': 'reasoning', 'researcher': 'reasoning', 'research': 'reasoning',
      'coder': 'code_execution', 'code-generator': 'code_execution',
      'analyst': 'data_query', 'data-analyst': 'data_query',
      'security-scanner': 'tool_orchestration', 'investigator': 'reasoning',
      'deployer': 'tool_orchestration', 'urgent-handler': 'reasoning',
      'routine-handler': 'summarization', 'planner': 'planning',
      'validator': 'validation', 'summarizer': 'summarization',
      'synthesizer': 'synthesis', 'deep-reasoner': 'reasoning',
      'fact-checker': 'validation',
    };
    const resolvedRole = ROLE_TO_AGENT_TYPE[agentRole] || ROLE_TO_AGENT_TYPE[agentType] || agentRole;
    const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300';

    logger.info({
      nodeId: node.id,
      agentType,
      agentRole,
      resolvedRole,
      agentId: node.data.agentId,
      model,
      toolCount: tools.length,
      maxTurns
    }, '[WorkflowEngine] Executing Agent Spawn via openagentic-proxy (DB-resolved)');

    try {
      // Call openagentic-proxy execute-sync directly with role — openagentic-proxy resolves from DB
      const executeResponse = await abortableAxiosPost(
        this,
        `${openagenticProxyUrl}/api/agents/execute-sync`,
        {
          agents: [{
            role: resolvedRole,
            task: resolvedTask,
            model: model || undefined,
            tools: tools.length > 0 ? tools : undefined,
            systemPrompt: systemPrompt || undefined,
            maxTurns: maxTurns || 10,
            timeout: timeout || 120000,
          }],
          orchestration: 'parallel',
          aggregation: 'first',
          sessionId: this.context.executionId,
          userId: this.context.userId,
          userMessage: resolvedTask,
          totalBudgetCents: 200,
          timeoutMs: timeout || 120000,
          flowContext: {
            flowId: this.context.workflowId,
            executionId: this.context.executionId,
            nodeId: node.id,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getOpenAgenticProxyAuthHeaders(),
            'X-Workflow-Execution': this.context.executionId,
          },
          timeout: (timeout || 120000) + 30000,
        }
      );

      if (executeResponse.status >= 200 && executeResponse.status < 300) {
        const agentResult = {
          source: 'agent_spawn',
          agentId: node.data.agentId || resolvedRole,
          agentType: agentRole,
          executionId: executeResponse.data?.executionId,
          status: executeResponse.data?.results?.[0]?.status || 'completed',
          content: executeResponse.data?.output || '',
          output: executeResponse.data?.output || '',
          tokenUsage: executeResponse.data?.metrics,
        };
        // Record to DB for observability dashboard
        this.recordFlowAgentExecution(node.id, resolvedRole, 'completed',
          Date.now() - startTime,
          executeResponse.data?.metrics);
        return agentResult;
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
   * Record a flow-triggered agent execution to the DB for observability.
   * Agent-proxy only records Prometheus metrics — this fills the gap so
   * the Agent Execution Dashboard shows flow-spawned agents too.
   */
  private recordFlowAgentExecution(
    nodeId: string,
    agentType: string,
    status: 'completed' | 'failed',
    durationMs: number,
    metrics?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costCents?: number },
    error?: string,
  ): void {
    // Find the DB agent matching this type to get the loop_id FK
    prisma.agent.findFirst({ where: { agent_type: agentType }, select: { id: true } })
      .then((agent: any) => {
        if (!agent) return; // No matching agent in DB — skip recording
        return prisma.agentRunLog.create({
          data: {
            loop_id: agent.id,
            session_id: this.context.executionId,
            user_id: this.context.userId,
            status,
            model_used: 'auto', // Agent-proxy resolved the model
            duration_ms: durationMs,
            input_tokens: metrics?.inputTokens || 0,
            output_tokens: metrics?.outputTokens || 0,
            total_tokens: metrics?.totalTokens || 0,
            estimated_cost: metrics?.costCents || 0,
            error: error || undefined,
            tool_calls_involved: [`flow:${this.context.workflowId}`, `node:${nodeId}`],
          },
        });
      })
      .catch((err: any) => {
        logger.warn({ err, nodeId, agentType }, '[WorkflowEngine] Failed to record agent execution (non-fatal)');
      });
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
   * Calculate token cost based on model pricing.
   * Delegates to PricingLookup which reads rates from the LLMCostRate DB table.
   * Never throws — uses fallback economy rates if the DB is unavailable or has no row.
   */
  private async calculateTokenCost(model: string, promptTokens: number, completionTokens: number): Promise<number> {
    return this.pricingLookup.calculateCost(model, promptTokens, completionTokens);
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

      // #1262 resume-merge: write the submitted resumeInput BACK into the
      // resumed node's STORED result so downstream {{steps.<id>.output.values.
      // <field>}} references resolve to the user-supplied values instead of
      // staying frozen at the paused-state placeholder ({status:'awaiting_input'}).
      // This is what makes the HITL needs-input gate's collected values actually
      // flow to the rest of the graph. Spread-on-top is backward-compatible for
      // human_approval (it keeps approvalId/status and layers the decision on top).
      if (resumeInput && typeof resumeInput === 'object') {
        const prior = this.context.nodeResults.get(fromNodeId);
        const priorObj = prior && typeof prior === 'object' ? prior : {};
        this.context.nodeResults.set(fromNodeId, { ...priorObj, ...resumeInput });
      }

      // Continue execution from downstream nodes
      for (const edge of outgoing) {
        await this.executeNode(edge.target, contextInput);
      }

      // Get final output
      const terminalNodes = this.definition.nodes.filter(
        n => (this.outgoingEdges.get(n.id)?.length || 0) === 0
      );

      let finalOutput: any = {};
      const resumeEnvelopes: OutputEnvelope[] = [];
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          finalOutput[node.id] = result;
          resumeEnvelopes.push(this.formatOutputEnvelope(node, result));
        }
      }

      if (Object.keys(finalOutput).length === 1) {
        finalOutput = Object.values(finalOutput)[0];
      }

      await this.updateExecutionRecord('completed', finalOutput);
      this.emitEvent('execution_complete', { output: finalOutput, outputEnvelopes: resumeEnvelopes });

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
      try {
        await this.updateExecutionRecord('failed', null, errorMessage);
      } catch (dbErr) {
        logger.error({ dbErr }, '[WorkflowEngine] Failed to update execution record on failure');
      }
      this.emitEvent('execution_error', { error: errorMessage });
      return { success: false, output: null, error: errorMessage };
    }
  }

  // ===========================================================================
  // Unified OpenAgentic LLM Node
  // ===========================================================================

  /**
   * Execute a knowledge ingestion node - pushes content into Milvus via the API
   * Takes output from previous node (e.g. LLM-generated text) and ingests into shared or private collection
   */
  private async executeKnowledgeIngestNode(node: WorkflowNode, input: any): Promise<any> {
    const { collection = 'shared', source = 'workflow' } = node.data || {};

    // Get the content from previous node output or from node config
    const content = input?.output?.content || input?.output || input?.content || node.data?.content || '';
    if (!content || typeof content !== 'string' || content.length < 10) {
      return { success: false, error: 'No content to ingest (need at least 10 chars)', chunksIngested: 0 };
    }

    const userId = this.context?.userId || 'system';
    logger.info({ nodeId: node.id, collection, contentLength: content.length, userId }, '[WorkflowEngine] Executing knowledge ingest node'); // metadata only — no secret interpolation

    try {
      // Call the API's knowledge ingestion endpoint
      const apiUrl = process.env.API_URL || 'http://openagentic-api:8000';
      const response = await fetch(`${apiUrl}/api/chat/knowledge/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-From': 'internal',
          'X-Internal-Secret': process.env.INTERNAL_SERVICE_SECRET || '',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          content,
          collection,
          metadata: { source, workflow_node: node.id, ingested_by: 'workflow_engine' }
        })
      });

      const result = await response.json() as any;
      this.safeLog('info', { nodeId: node.id, result }, '[WorkflowEngine] Knowledge ingestion result');
      return result;
    } catch (error: any) {
      this.safeLog('error', { nodeId: node.id, error: error.message }, '[WorkflowEngine] Knowledge ingestion failed'); // error.message may contain secret-interpolated content
      return { success: false, error: error.message, chunksIngested: 0 };
    }
  }

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

    // Auto-append input context when prompt doesn't reference template variables
    // (mirrors executeLLMNode behavior — ensures LLM always sees workflow data)
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

    const requestBody: any = {
      model: 'auto',  // Smart Router selects based on task complexity + slider position
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens || 4096,
      stream: false,
    };

    // Allow explicit model override, otherwise Smart Router handles it
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
    const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-proxy:3300';

    logger.info({ nodeId: node.id, agentCount: agents.length, maxConcurrency }, '[WorkflowEngine] Executing Multi-Agent via openagentic-proxy');

    if (!agents.length) {
      return { content: 'No agents configured', agents: [] };
    }

    // Build agent specs for openagentic-proxy — each agent resolved from DB by role
    const agentSpecs = agents.map((agent: any, idx: number) => {
      const resolvedTask = this.interpolateTemplate(agent.taskDescription || agent.prompt || '', input);
      const taskWithContext = sharedContext && input
        ? `Context: ${JSON.stringify(input)}\n\nTask: ${resolvedTask}`
        : resolvedTask;

      return {
        agentId: agent.agentId || undefined,
        role: agent.role || 'custom',
        task: taskWithContext,
        model: agent.model || undefined,
        tools: agent.tools || [],
        systemPrompt: agent.systemPrompt || undefined,
        maxTurns: agent.maxTurns || 5,
        costBudget: agent.costBudget || 50,
        timeout: timeoutMs,
      };
    });

    try {
      // Route through openagentic-proxy — agents resolved from DB with composable prompts
      const response = await abortableAxiosPost(
        this,
        `${openagenticProxyUrl}/api/agents/execute-sync`,
        {
          agents: agentSpecs,
          orchestration: 'parallel',
          aggregation: aggregationStrategy === 'first' ? 'first' : aggregationStrategy === 'vote' ? 'vote' : 'merge',
          sessionId: this.context.executionId,
          userId: this.context.userId,
          userMessage: typeof input === 'string' ? input : (input?.message || JSON.stringify(input)),
          totalBudgetCents: 200,
          timeoutMs,
          maxConcurrency,
          flowContext: {
            flowId: this.context.workflowId,
            executionId: this.context.executionId,
            nodeId: node.id,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getOpenAgenticProxyAuthHeaders(),
            'X-Workflow-Execution': this.context.executionId,
          },
          timeout: timeoutMs + 30000,
        }
      );

      return {
        content: response.data?.output || '',
        agents: response.data?.results || [],
        agentCount: response.data?.results?.length || agentSpecs.length,
        strategy: aggregationStrategy,
        metrics: response.data?.metrics || {},
      };
    } catch (error: any) {
      // Fallback: direct LLM calls if openagentic-proxy is unavailable
      this.safeLog('warn', { nodeId: node.id, error: error.message }, '[WorkflowEngine] Agent-proxy unavailable for multi_agent, falling back to direct LLM'); // error.message may contain secret-interpolated content

      const results: any[] = [];
      for (let i = 0; i < agentSpecs.length; i += maxConcurrency) {
        const batch = agentSpecs.slice(i, i + maxConcurrency);
        const batchResults = await Promise.allSettled(
          batch.map(async (spec: any) => {
            const messages: Array<{ role: string; content: string }> = [];
            if (spec.systemPrompt) messages.push({ role: 'system', content: spec.systemPrompt });
            messages.push({ role: 'user', content: spec.task });

            const res = await abortableAxiosPost(
              this,
              `${this.apiUrl}/api/v1/chat/completions`,
              { model: 'auto', messages, max_tokens: 4096, stream: false },
              {
                headers: { 'Content-Type': 'application/json', ...this.getInternalAuthHeaders() },
                timeout: timeoutMs,
              }
            );
            return {
              agentId: spec.agentId || spec.role,
              role: spec.role,
              content: res.data?.choices?.[0]?.message?.content || '',
              usage: res.data?.usage,
            };
          })
        );

        for (const result of batchResults) {
          results.push(result.status === 'fulfilled' ? result.value : { error: (result as any).reason?.message || 'Agent failed' });
        }
      }

      const aggregated = results.map(r => r.content || '').filter(Boolean).join('\n\n---\n\n');
      return { content: aggregated, agents: results, agentCount: results.length, strategy: aggregationStrategy };
    }
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

    const response = await abortableAxiosPost(
      this,
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
   * Execute an Agent-Proxy node -- delegates to openagentic-proxy service for orchestrated agent execution
   */
  private async executeOpenAgenticProxyNode(
    node: WorkflowNode,
    input: any,
    orchestration: 'parallel' | 'sequential' | 'supervisor'
  ): Promise<any> {
    const startTime = Date.now();
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
      const response = await abortableAxiosPost(
        this,
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
            ...this.getOpenAgenticProxyAuthHeaders(),
            'X-Workflow-Execution': this.context.executionId,
          },
          timeout: (nodeData.timeout || 120000) + 30000,
        }
      );

      const result = {
        output: response.data?.output || response.data?.results || '',
        agents: response.data?.results || [],
        metrics: response.data?.metrics || {},
        orchestration,
        status: response.data?.status || 'completed',
      };
      // Record each agent in the pool to DB for observability
      const agentTypes = agents.map((a: any) => a.role || 'custom');
      for (const role of agentTypes) {
        this.recordFlowAgentExecution(node.id, role, 'completed',
          Date.now() - startTime, response.data?.metrics);
      }
      return result;
    } catch (error: any) {
      // Record failure
      const agentTypes = agents.map((a: any) => a.role || 'custom');
      for (const role of agentTypes) {
        this.recordFlowAgentExecution(node.id, role, 'failed',
          Date.now() - startTime, undefined, (error as Error).message);
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`Agent-proxy service is not reachable at ${openagenticProxyUrl}. Ensure the openagentic-proxy deployment is running.`);
      }
      throw new Error(`Agent-proxy execution failed: ${error.response?.data?.error || error.message}`);
    }
  }

  /**
   * Execute a data source query node.
   * Supports raw mode (direct SQL/API) and NL mode (LLM translates natural language).
   */
  private async executeDataSourceQueryNode(node: WorkflowNode, input: any): Promise<any> {
    const { dataSourceId, mode = 'raw', query, question } = node.data;

    if (!dataSourceId) {
      throw new Error('Data source query node requires a dataSourceId');
    }

    const queryText = mode === 'nl'
      ? this.interpolateTemplate(question || '{{input.message}}', input)
      : this.interpolateTemplate(query || '', input);

    if (!queryText) {
      throw new Error(`Data source query node requires a ${mode === 'nl' ? 'question' : 'query'}`);
    }

    const endpoint = mode === 'nl'
      ? `${this.apiUrl}/api/data-sources/${dataSourceId}/nl-query`
      : `${this.apiUrl}/api/data-sources/${dataSourceId}/query`;

    const body = mode === 'nl' ? { question: queryText } : { query: queryText };

    logger.info({ nodeId: node.id, dataSourceId, mode, queryLength: queryText.length },
      '[WorkflowEngine] Executing data source query');

    const response = await abortableAxiosPost(this, endpoint, body, {
      headers: { ...this.getInternalAuthHeaders(), 'Content-Type': 'application/json' },
      timeout: 35000,
    });

    const result = response.data;
    if (!result.success) {
      throw new Error(result.error || 'Data source query failed');
    }

    return {
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      executionTimeMs: result.executionTimeMs,
      generatedQuery: result.generatedQuery,
      content: JSON.stringify(result.rows?.slice(0, 50), null, 2),
    };
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
   * Canonical "primary output" of a node result for `{{steps.X.output}}` —
   * prefer an explicit `output`, else fall back to the next most likely
   * primary-output field (LLM → .content, rag_query → nested .result.results).
   */
  private canonicalNodeOutput(r: any): any {
    if (r === null || r === undefined) return r;
    if (typeof r !== 'object') return r;
    if (r.output !== undefined) return r.output;
    if (r.content !== undefined) return r.content;
    if (r.text !== undefined) return r.text;
    if (r.answer !== undefined) return r.answer;
    if (r.result !== undefined) return this.canonicalNodeOutput(r.result);
    if (r.results !== undefined) return r.results;
    if (r.data !== undefined) return r.data;
    return r;
  }

  /**
   * SCHEMA-AWARE primary-output accessor (typed-IO contract, #1268/#1269):
   *   1. explicit `value.output` wins;
   *   2. else the SOURCE node TYPE's declared schema.primary if present;
   *   3. else the canonicalNodeOutput heuristic.
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

  private interpolateTemplate(template: string, context: any): string {
    if (!template) return template;

    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      let trimmedPath = path.trim();

      // Support default values: {{trigger.body.topic || "fallback text"}}
      let defaultValue: string | null = null;
      const pipeIdx = trimmedPath.indexOf('||');
      if (pipeIdx > 0) {
        defaultValue = trimmedPath.slice(pipeIdx + 2).trim().replace(/^["']|["']$/g, '');
        trimmedPath = trimmedPath.slice(0, pipeIdx).trim();
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
        // (the typed-IO contract). When found by direct id it's nameOrId; when
        // found by label fallback it's the matched nId.
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
          const nodeRoot = value;
          for (const key of rest) {
            // 'output' is a virtual alias meaning the node's PRIMARY output.
            // Schema-aware (typed-IO contract, #1268/#1269): when the source node
            // TYPE declares schema.primary and it's present, return result[primary];
            // else explicit .output; else the canonicalNodeOutput heuristic (LLM →
            // .content, rag_query → nested .result.results). An explicit .output
            // key is left untouched by resolvePrimaryOutput.
            if (key === 'output' && value !== undefined && (value as any)[key] === undefined) {
              const srcType = resolvedSrcId ? this.nodeMap.get(resolvedSrcId)?.type : undefined;
              value = this.resolvePrimaryOutput(value, srcType);
              continue;
            }
            value = value?.[key];
          }
          // If path traversal ended with undefined, try common content extraction patterns
          // MCP tools normalize to { content: string } but some return nested structures
          if (value === undefined && rest.length > 0) {
            const nodeResult = nodeRoot;
            if (nodeResult !== undefined) {
              // Try extracting from common result shapes
              const lastKey = rest[rest.length - 1];
              if (lastKey === 'content' || lastKey === 'text') {
                value = nodeResult?.content || nodeResult?.text || nodeResult?.result || nodeResult?.data;
                if (typeof value === 'object') value = JSON.stringify(value);
              }
            }
          }
        }
        if (value !== undefined) {
          return typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        // If still unresolved, check if node hasn't executed yet (return empty rather than raw template)
        logger.debug({ variable: trimmedPath }, '[WorkflowEngine] Template variable unresolved (steps)');
        return '';
      }

      // {{env.<VAR>}} - engine-controlled allow-list ONLY.
      //
      // P0b sev-0 fix (audit AUDIT-2026-05-03): the prior `?? process.env[envVar]`
      // fallback let any workflow author exfil the pod's process.env by
      // writing {{env.WORKFLOW_SECRET_KEY}}, {{env.AWS_SECRET_ACCESS_KEY}},
      // {{env.JWT_SECRET}}, etc. into a node field. The rendered value
      // would flow into the LLM call / HTTP body / log line, leaking
      // master-keys cluster-wide.
      //
      // After this change, {{env.X}} only resolves when the engine has
      // explicitly seeded `env.X` into context.variables (no current
      // call-site does, but the path is kept for engine-controlled
      // allow-list use cases). Workflow authors must use {{secret:NAME}}
      // for credentials — that path is ACL-checked + audit-logged.
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
      // S0-9 / B5: enforce allowed_node_types / allowed_users / allowed_groups ACLs.
      if (trimmedPath.startsWith('secret:')) {
        const secretName = trimmedPath.slice(7);
        const resolved = this.context.resolvedSecrets?.get(secretName);
        if (resolved !== undefined) {
          // Inline ACL check using preloaded metadata. checkSecretAcl is synchronous.
          const aclRow = this.context.resolvedSecretAcls?.get(secretName);
          if (aclRow && this._currentNodeType !== undefined) {
            const decision = checkSecretAcl(aclRow, {
              nodeType: this._currentNodeType,
              userId: this.context.userId,
              userGroups: this.context.userGroups ?? [],
            });
            if (!decision.allowed) {
              logger.warn(
                {
                  secretName,
                  nodeType: this._currentNodeType,
                  userId: this.context.userId,
                  reason: decision.reason,
                  details: decision.details,
                },
                '[WorkflowEngine] Secret ACL denied at interpolation — substituting sentinel',
              );
              this._nodeAclDenials.push(secretName);
              return `[secret_acl_denied:${secretName}]`;
            }
          }
          return String(resolved);
        }
        logger.warn({ secretName }, '[WorkflowEngine] Secret not found in resolved secrets');
        return match;
      }

      // {{trigger.<path>}} - trigger node input
      // Supports: {{trigger.body.message}}, {{trigger.message}}, {{trigger.body.topic}} with flat input
      if (trimmedPath.startsWith('trigger.')) {
        const triggerResult = this.context.nodeResults.get('__trigger__');
        const rawInput = this.context.input;
        const subPath = trimmedPath.slice(8); // Remove 'trigger.' prefix
        const parts = subPath.split('.');

        const resolveNestedPath = (obj: any, keys: string[]): any => {
          let v = obj;
          for (const k of keys) { v = v?.[k]; }
          return v;
        };
        const formatValue = (v: any): string =>
          v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));

        // Strategy 1: Direct path on stored trigger data (handles trigger.body.X and trigger.X)
        if (triggerResult) {
          const v = resolveNestedPath(triggerResult, parts);
          if (v !== undefined) return formatValue(v);
        }

        // Strategy 2: Strip 'body.' prefix and resolve against raw input
        // Handles: {{trigger.body.message}} when input is flat { message: "..." }
        if (parts[0] === 'body' && parts.length > 1 && rawInput) {
          const v = resolveNestedPath(rawInput, parts.slice(1));
          if (v !== undefined) return formatValue(v);
        }

        // Strategy 3: Direct sub-path against raw input (no body prefix)
        // Handles: {{trigger.message}} resolving against raw input { message: "..." }
        if (rawInput) {
          const v = resolveNestedPath(rawInput, parts);
          if (v !== undefined) return formatValue(v);
        }

        if (defaultValue !== null) return defaultValue;
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

      // Bare {{input}} → the entire input value. The context IS the input,
      // so {{input}} should serialize the whole context, not look for a
      // (non-existent) `input` key on it. Fixes templates like
      // `{{input}}` in openagentic_chat / openagentic_llm prompts which
      // were resolving to '' and producing empty user messages → 400 from
      // upstream providers (Vertex: "Model input cannot be empty").
      if (trimmedPath === 'input') {
        if (context === undefined || context === null) return '';
        return typeof context === 'object' ? JSON.stringify(context) : String(context);
      }

      // Navigate the path in context (for {{input.field}}, {{item.field}}, etc.)
      const pathParts = trimmedPath.split('.');
      let value: any = context;
      // If path starts with 'input', the context IS the input -- skip the 'input' prefix
      if (pathParts[0] === 'input' && pathParts.length > 1 && context?.[pathParts[1]] !== undefined) {
        // Direct field access: {{input.name}} -> context.name (context IS the input)
        for (let i = 1; i < pathParts.length; i++) {
          value = value?.[pathParts[i]];
        }
      } else {
        // Standard path traversal
        for (const key of pathParts) {
          value = value?.[key];
        }
      }

      if (value !== undefined) {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      }

      // Use captured default from `{{path || "fallback"}}` syntax if present.
      // Bug found 2026-04-26: Data Transform Pipeline template's
      // `{{input.url || "https://jsonplaceholder..."}}` was returning empty
      // string because the default was only honored inside the trigger.* path,
      // not on the general fall-through.
      if (defaultValue !== null) return defaultValue;

      // Variable unresolved — return empty string instead of raw {{...}} so LLMs don't see template syntax
      logger.debug({ variable: trimmedPath }, '[WorkflowEngine] Template variable unresolved');
      return '';
    });
  }

  /**
   * Emit an execution event
   */
  /**
   * Wrap a node's output in a structured OutputEnvelope for rich rendering.
   * AI/LLM nodes produce markdown; MCP/HTTP nodes get auto-formatted from JSON.
   */
  private formatOutputEnvelope(node: WorkflowNode, rawOutput: any): OutputEnvelope {
    const nodeLabel = node.data?.label || node.id;
    const outputFormat: OutputFormat = node.data?.outputFormat || this.inferOutputFormat(node.type, rawOutput);
    // Auto-persist: explicit opt-in OR substantial AI/agent outputs (reports, deliverables)
    const autoArtifactTypes = new Set([
      'llm_completion', 'openagentic_llm', 'openagentic_chat',
      'agent_single', 'agent_pool', 'agent_supervisor', 'multi_agent',
      'reasoning', 'agent_spawn',
    ]);
    const contentStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput || '');
    const isSubstantialOutput = contentStr.length >= 500;
    const persistToMilvus = node.data?.persistToMilvus === true
      || (autoArtifactTypes.has(node.type) && isSubstantialOutput);

    let content: string;
    switch (outputFormat) {
      case 'markdown':
        content = this.toMarkdown(node.type, rawOutput, nodeLabel);
        break;
      case 'html':
        content = typeof rawOutput === 'string' ? rawOutput : `<pre>${JSON.stringify(rawOutput, null, 2)}</pre>`;
        break;
      case 'table':
        content = this.toMarkdownTable(rawOutput);
        break;
      case 'json':
      default:
        content = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);
        break;
    }

    // Build a semantic title so users can identify artifacts in Milvus
    const semanticTitle = this.buildSemanticTitle(node, rawOutput, content);

    return {
      format: outputFormat,
      title: semanticTitle,
      content,
      raw: rawOutput,
      artifacts: [],
      nodeId: node.id,
      nodeType: node.type,
      persistToMilvus,
    };
  }

  // ===========================================================================
  // Sub-Workflow Node -- execute a saved workflow by ID
  // ===========================================================================

  private async executeSubWorkflowNode(node: WorkflowNode, input: any): Promise<any> {
    const { workflowId, timeout = 120000, passInput = true } = node.data;

    if (!workflowId) {
      throw new Error('Sub-workflow node requires a workflowId');
    }

    logger.info({ nodeId: node.id, subWorkflowId: workflowId, timeout },
      '[WorkflowEngine] Executing sub-workflow node');

    // Step 1: Fetch the sub-workflow definition directly from the database
    const subWorkflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, name: true, definition: true },
    });

    if (!subWorkflow || !subWorkflow.definition) {
      throw new Error(`Sub-workflow ${workflowId} not found or has no definition`);
    }

    const subDef = typeof subWorkflow.definition === 'string'
      ? JSON.parse(subWorkflow.definition)
      : subWorkflow.definition;

    logger.info({ nodeId: node.id, subWorkflowName: subWorkflow.name, nodeCount: subDef?.nodes?.length },
      '[WorkflowEngine] Sub-workflow definition loaded');
    const subInput = passInput ? (typeof input === 'object' ? input : { data: input }) : {};

    // Step 2: Execute the sub-workflow inline using a new engine instance
    const subExecId = `sub-${this.context.executionId}-${node.id}`;
    const { executeWorkflow: execSubWf } = await import('./WorkflowExecutionEngine.js');

    const result = await execSubWf(
      workflowId,
      subExecId,
      subDef,
      subInput,
      this.context.userId,
      this.context.authToken,
      undefined, // no event handler for sub-workflow
      { userEmail: this.context.userEmail, idToken: this.context.idToken }
    );

    if (!result.success) {
      throw new Error(`Sub-workflow failed: ${result.error || 'unknown error'}`);
    }

    logger.info({ nodeId: node.id, subWorkflowId: workflowId, success: result.success },
      '[WorkflowEngine] Sub-workflow completed');

    return result.output;
  }

  /**
   * Generate a semantic, human-readable title for artifacts stored in Milvus.
   * Format: "[Workflow] Node Label - Content Summary"
   * Examples:
   *   "Research Team - Enterprise AI Platform Market Report"
   *   "Final Report - Key Findings on Remote Work Productivity"
   *   "Code Analysis - 15 security vulnerabilities found"
   */
  private buildSemanticTitle(node: WorkflowNode, rawOutput: any, content: string): string {
    const nodeLabel = node.data?.label || node.id;
    const workflowName = this.context.workflowId && this.context.workflowId !== 'test-node'
      ? this.context.workflowId.substring(0, 30) : '';

    // Extract a content summary from the output
    let summary = '';
    const textContent = typeof rawOutput === 'string'
      ? rawOutput
      : rawOutput?.content || rawOutput?.text || rawOutput?.result || '';

    if (typeof textContent === 'string' && textContent.length > 0) {
      // Look for a heading or first meaningful line
      const lines = textContent.split('\n').filter((l: string) => l.trim().length > 5);
      const firstLine = lines[0]?.replace(/^#+\s*/, '').replace(/^\*+\s*/, '').trim() || '';
      // Use first heading or first 60 chars as summary
      summary = firstLine.length > 60 ? firstLine.substring(0, 57) + '...' : firstLine;
    } else if (typeof rawOutput === 'object' && rawOutput) {
      // For structured data, describe what it contains
      const keys = Object.keys(rawOutput).filter(k => k !== '__sharedContext' && k !== '_costMeta');
      if (keys.length <= 4) {
        summary = keys.join(', ');
      } else {
        summary = `${keys.length} fields`;
      }
    }

    // Build title: "Node Label - Summary" or "Node Label" if no summary
    if (summary) {
      return `${nodeLabel} - ${summary}`.substring(0, 200);
    }
    return nodeLabel;
  }

  /**
   * Infer the best output format based on node type and output content.
   */
  private inferOutputFormat(nodeType: string, output: any): OutputFormat {
    // AI/LLM nodes naturally produce text — treat as markdown
    const llmTypes = new Set([
      'llm_completion', 'openagentic_llm', 'openagentic_chat',
      'agent_single', 'agent_pool', 'agent_supervisor', 'multi_agent',
      'bedrock', 'vertex', 'azure_ai',
    ]);
    if (llmTypes.has(nodeType)) return 'markdown';

    // If the output is a plain string, treat as markdown
    if (typeof output === 'string') return 'markdown';

    // If output is an object with a 'content' field that's a string, markdown
    if (output && typeof output === 'object' && typeof output.content === 'string') return 'markdown';

    // Arrays → table format for readability
    if (Array.isArray(output)) return 'table';

    // Default to json
    return 'json';
  }

  /**
   * Convert node output to readable markdown based on node type.
   */
  private toMarkdown(nodeType: string, output: any, title: string): string {
    // If output is already a string, return as-is (LLM text, etc.)
    if (typeof output === 'string') return output;

    // Extract content from common response shapes
    if (output && typeof output === 'object') {
      // LLM response: { content: string, model: string, ... }
      if (typeof output.content === 'string') {
        const meta: string[] = [];
        if (output.model) meta.push(`**Model:** ${output.model}`);
        if (output.usage?.total_tokens) meta.push(`**Tokens:** ${output.usage.total_tokens}`);
        return meta.length > 0
          ? `${output.content}\n\n---\n_${meta.join(' | ')}_`
          : output.content;
      }

      // MCP tool result: { result: any, toolName: string, ... }
      if (output.result !== undefined) {
        const resultStr = typeof output.result === 'string'
          ? output.result
          : JSON.stringify(output.result, null, 2);
        return `### ${output.toolName || title}\n\n\`\`\`json\n${resultStr}\n\`\`\``;
      }

      // Generic object: format as sections
      return this.objectToMarkdownSections(output);
    }

    return String(output ?? '');
  }

  /**
   * Convert a generic object into markdown sections.
   */
  private objectToMarkdownSections(obj: Record<string, any>): string {
    const sections: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      const heading = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
      if (typeof value === 'string') {
        sections.push(`### ${heading}\n${value}`);
      } else if (Array.isArray(value)) {
        sections.push(`### ${heading}\n${this.toMarkdownTable(value)}`);
      } else if (typeof value === 'object') {
        sections.push(`### ${heading}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
      } else {
        sections.push(`**${heading}:** ${value}`);
      }
    }
    return sections.join('\n\n');
  }

  /**
   * Convert array data into a markdown table.
   */
  private toMarkdownTable(data: any): string {
    if (!Array.isArray(data) || data.length === 0) {
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }

    // For array of objects, create a table
    const firstItem = data[0];
    if (typeof firstItem === 'object' && firstItem !== null && !Array.isArray(firstItem)) {
      const keys = Object.keys(firstItem);
      const header = `| ${keys.join(' | ')} |`;
      const separator = `| ${keys.map(() => '---').join(' | ')} |`;
      const rows = data.slice(0, 50).map(item =>
        `| ${keys.map(k => {
          const v = item[k];
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return JSON.stringify(v).substring(0, 80);
          return String(v).substring(0, 80);
        }).join(' | ')} |`
      );
      return [header, separator, ...rows].join('\n');
    }

    // For array of primitives, simple list
    return data.slice(0, 50).map((item, i) => `${i + 1}. ${String(item)}`).join('\n');
  }

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

      // Extract cost metadata before stripping from stored output
      const costMeta = safeOutput?._costMeta;
      if (safeOutput?._costMeta) delete safeOutput._costMeta;

      // Verify parent execution record exists before creating FK-dependent log
      const executionExists = await prisma.workflowExecution.findUnique({
        where: { id: this.context.executionId },
        select: { id: true },
      });

      if (executionExists) {
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
      } else {
        logger.warn({ nodeId, executionId: this.context.executionId }, '[WorkflowEngine] Skipping node log — parent execution record not found');
      }

      // Generate output envelope for the node
      const node = this.nodeMap.get(nodeId);
      const envelope = node ? this.formatOutputEnvelope(node, safeOutput) : undefined;

      // Accumulate node outputs locally (written in updateExecutionRecord)
      this.pendingNodeOutputs.set(nodeId, {
        status,
        input: safeInput,
        output: safeOutput,
        outputEnvelope: envelope ? { format: envelope.format, title: envelope.title, content: envelope.content, persistToMilvus: envelope.persistToMilvus } : undefined,
        error: error || null,
        duration: executionTimeMs,
        nodeType,
        ...(costMeta ? {
          tokens: costMeta.tokens,
          promptTokens: costMeta.promptTokens,
          completionTokens: costMeta.completionTokens,
          cost: costMeta.cost,
          model: costMeta.model,
        } : {}),
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
      const totalCost = (this as any).totalCost || 0;
      const updateData: any = {
        status,
        output: safeOutput,
        node_outputs: Object.keys(safeNodeOutputs).length > 0 ? safeNodeOutputs : undefined,
        error,
        completed_nodes: completedNodes,
        execution_time_ms: executionTimeMs,
        completed_at: new Date(),
        ...(totalCost > 0 ? { cost: totalCost } : {}),
      };

      // Use upsert to handle race conditions where the execution record
      // may not have been created yet (e.g., if initial create failed)
      await prisma.workflowExecution.upsert({
        where: { id: this.context.executionId },
        update: updateData,
        create: {
          id: this.context.executionId,
          workflow_id: this.context.workflowId,
          started_by: this.context.userId,
          trigger_type: 'manual',
          input: this.context.input ? JSON.parse(JSON.stringify(this.context.input)) : {},
          ...updateData,
        },
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

  // ===========================================================================
  // Data Query Node
  // ===========================================================================

  private async executeDataQueryNode(node: WorkflowNode, input: any): Promise<any> {
    const { collection, collectionName, query, filters, limit: queryLimit } = node.data;
    const resolvedCollection = this.interpolateTemplate(collection || collectionName || 'default', input);
    const resolvedQuery = query ? this.interpolateTemplate(query, input) : undefined;

    logger.info({ nodeId: node.id, collection: resolvedCollection }, '[WorkflowEngine] Executing data query node');

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/vector/search`,
      {
        collection: resolvedCollection,
        query: resolvedQuery || (typeof input === 'string' ? input : input?.message || input?.query || JSON.stringify(input)),
        topK: queryLimit || 10,
        filters: filters ? (typeof filters === 'string' ? JSON.parse(this.interpolateTemplate(filters, input)) : filters) : undefined,
      },
      {
        headers: { 'Content-Type': 'application/json', ...this.getInternalAuthHeaders() },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    if (response.status >= 400) {
      throw new Error(`Data query failed: ${response.data?.error || response.statusText}`);
    }

    return {
      collection: resolvedCollection,
      results: response.data?.results || response.data || [],
      resultCount: (response.data?.results || response.data || []).length,
    };
  }

  // ===========================================================================
  // Reasoning Node — Extended Chain-of-Thought
  // ===========================================================================

  private async executeReasoningNode(node: WorkflowNode, input: any): Promise<any> {
    const { prompt, systemPrompt, thinkingBudget, maxTokens, modelOverride } = node.data;
    const resolvedPrompt = this.interpolateTemplate(prompt || '', input);
    const resolvedSystemPrompt = this.interpolateTemplate(systemPrompt || '', input);

    logger.info({ nodeId: node.id, thinkingBudget }, '[WorkflowEngine] Executing reasoning node');

    const messages: Array<{ role: string; content: string }> = [];
    if (resolvedSystemPrompt) messages.push({ role: 'system', content: resolvedSystemPrompt });
    messages.push({ role: 'user', content: resolvedPrompt });

    const response = await abortableAxiosPost(
      this,
      `${this.apiUrl}/api/v1/chat/completions`,
      {
        model: modelOverride || 'auto',
        messages,
        max_tokens: maxTokens || 8192,
        stream: false,
        enableThinking: true,
        thinkingBudget: thinkingBudget || 10000,
        sliderPosition: 100, // Max quality for reasoning
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...this.getInternalAuthHeaders(),
          'X-Workflow-Execution': this.context.executionId,
        },
        timeout: 180000, // 3min for extended reasoning
      }
    );

    return {
      content: response.data?.choices?.[0]?.message?.content || '',
      thinking: response.data?.choices?.[0]?.message?.thinking || '',
      model: response.data?.model,
      usage: response.data?.usage,
      provider: 'openagentic',
    };
  }

  // ===========================================================================
  // Webhook Response Node
  // ===========================================================================

  private async executeWebhookResponseNode(node: WorkflowNode, input: any): Promise<any> {
    const { statusCode, headers, bodyTemplate } = node.data;
    const resolvedBody = bodyTemplate ? this.interpolateTemplate(bodyTemplate, input) : input;
    const resolvedHeaders = headers ? JSON.parse(this.interpolateTemplate(typeof headers === 'string' ? headers : JSON.stringify(headers), input)) : {};

    logger.info({ nodeId: node.id, statusCode: statusCode || 200 }, '[WorkflowEngine] Executing webhook response node');

    // Store the response in execution context for the webhook handler to pick up
    this.context.webhookResponse = {
      statusCode: statusCode || 200,
      headers: resolvedHeaders,
      body: resolvedBody,
    };

    return {
      statusCode: statusCode || 200,
      body: resolvedBody,
      delivered: true,
    };
  }

  // ===========================================================================
  // Switch Node — Multi-way Branching
  // ===========================================================================

  private async executeSwitchNode(node: WorkflowNode, input: any): Promise<any> {
    const { expression, cases = [] } = node.data;
    const resolvedExpr = this.interpolateTemplate(expression || '', input);

    logger.info({ nodeId: node.id, expression: resolvedExpr, caseCount: cases.length }, '[WorkflowEngine] Executing switch node');

    // Evaluate the expression in a V8 isolate (S0-2 / B1).
    let switchValue: any;
    const switchResult = await runSandboxed(`return (${resolvedExpr});`, {
      input,
      timeoutMs: 2000,
    });
    if (switchResult.ok) {
      switchValue = switchResult.value;
    } else {
      switchValue = resolvedExpr;
    }

    // Find matching case
    const matchedCase = cases.find((c: any) => String(c.value) === String(switchValue));
    const defaultCase = cases.find((c: any) => c.value === 'default');
    const selectedCase = matchedCase || defaultCase;

    // Route to the correct output edge
    const edges = this.definition.edges || [];
    const outEdges = edges.filter(e => e.source === node.id);

    if (outEdges.length > 0) {
      // Find edge matching the case output handle
      const targetEdge = selectedCase
        ? (outEdges.find(e =>
            e.sourceHandle === selectedCase.value || e.sourceHandle === selectedCase.label
          ) || outEdges[0])
        : outEdges[0];

      // W1: Notify merge gates about all UNCHOSEN edges so they decrement their
      // expected count and don't hang. Mirror the condition node pattern.
      const skippedEdges = outEdges.filter(e => e !== targetEdge);
      for (const edge of skippedEdges) {
        this.notifySkippedBranch(edge.target);
      }

      // Execute only the matched branch
      if (targetEdge) {
        await this.executeNode(targetEdge.target, input);
      }
    }

    return {
      switchValue: String(switchValue),
      matchedCase: selectedCase?.label || selectedCase?.value || 'none',
      input,
    };
  }

  // ===========================================================================
  // Parallel Node — Fan-out / Fan-in
  // ===========================================================================

  private async executeParallelNode(node: WorkflowNode, input: any): Promise<any> {
    const { mode, waitForAll, timeoutMs } = node.data;
    const edges = this.definition.edges || [];
    const outEdges = edges.filter(e => e.source === node.id);

    logger.info({ nodeId: node.id, mode, branchCount: outEdges.length, waitForAll }, '[WorkflowEngine] Executing parallel node');

    if (outEdges.length === 0) {
      return input;
    }

    // Fan-out: execute all downstream nodes in parallel
    const promises = outEdges.map(edge =>
      Promise.race([
        this.executeNode(edge.target, input),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Parallel branch timeout: ${edge.target}`)), timeoutMs || 60000)
        ),
      ])
    );

    if (waitForAll !== false) {
      // Wait for all branches
      const results = await Promise.allSettled(promises);
      return {
        branches: results.map((r, i) => ({
          nodeId: outEdges[i].target,
          status: r.status,
          result: r.status === 'fulfilled' ? r.value : undefined,
          error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
        })),
        allSucceeded: results.every(r => r.status === 'fulfilled'),
      };
    } else {
      // Race: return first completed
      const result = await Promise.race(promises);
      return { result, mode: 'race' };
    }
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
  opts?: {
    userEmail?: string;
    idToken?: string;
    triggerType?: string;
    userPermissions?: readonly string[];
    /** Group IDs the caller belongs to. Used for WorkflowSecret allowed_groups ACL checks. S0-9/B5. */
    userGroups?: readonly string[];
    /** Caller's Azure AD tenant id. Theme A / S1-1. */
    tenantId?: string | null;
    /** Test-mode mocks (Phase B #17). When the request comes from the
     *  api's WorkflowTestRunner via /test-execute, this carries the
     *  serialized mocks payload that mock-aware executors honor. */
    testMocks?: import('@openagentic/workflow-engine').TestMocks;
    /** Current sub-flow nesting depth. Internal — set by the engine when
     *  it recurses via executeSubWorkflow. flow_tool reads ctx.subFlowDepth
     *  to enforce a hard cap on nesting. Gap-analysis 2026-05-14 P0 #3. */
    subFlowDepth?: number;
  }
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
    userGroups: opts?.userGroups,
    input,
    variables: new Map(),
    nodeResults: new Map(),
    sharedContext: new Map(),
    startTime: Date.now(),
    testMocks: opts?.testMocks,
    subFlowDepth: opts?.subFlowDepth ?? 0,
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
