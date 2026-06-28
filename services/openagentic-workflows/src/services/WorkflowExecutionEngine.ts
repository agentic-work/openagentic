/**
 * WorkflowExecutionEngine
 *
 * Executes workflow graphs by traversing nodes and edges.
 * Supports: LLM completion, MCP tools, code execution, conditions, loops, transforms, merges.
 *
 * This is the core engine that powers OpenAgenticflows.
 */

import { EventEmitter } from 'events';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { PricingLookup } from './pricingLookup.js';
import { canAutoApprove } from './approvalGate.js';
import { createApprovalRecord } from './approvalRecord.js';
import { createDataRequestRecord } from './dataRequestRecord.js';
import { redactSecrets, redactLogMeta, type RedactionMap } from './secretRedaction.js';
import { checkSecretAcl } from './secretAcl.js';
import type { AclSecretRow } from './secretAcl.js';
import axios from 'axios';
import { abortableAxiosPost } from './abortableAxios.js';
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
  data: Record<string, unknown>;
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
  input: Record<string, unknown>;
  variables: Map<string, unknown>;
  nodeResults: Map<string, unknown>;
  startTime: number;
  agenticExecutionId?: string;
  sharedContext: Map<string, unknown>;
  webhookResponse?: { statusCode: number; headers: Record<string, string>; body: unknown };
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
  /** Structured output envelopes for terminal nodes, attached at execution end. */
  outputEnvelopes?: OutputEnvelope[];
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeType: string;
  status: 'success' | 'error' | 'skipped';
  output: unknown;
  error?: string;
  executionTimeMs: number;
}

export type OutputFormat = 'markdown' | 'html' | 'json' | 'table';

export interface OutputEnvelope {
  format: OutputFormat;
  title: string;
  content: string;
  raw: unknown;
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
  data?: unknown;
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
  fallbackValue?: unknown;       // Static value to return on failure
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

/**
 * Permissive view over a node's runtime result. Node executors return
 * arbitrary JSON; this captures the well-known fields the engine inspects
 * (status, content, usage, error markers) while keeping everything else
 * `unknown` via the index signature. Used only as a read/write lens — the
 * canonical stored value remains untyped JSON.
 */
type NodeResultView = {
  __contextUpdates?: Record<string, unknown>;
  error?: unknown;
  errorMessage?: unknown;
  isError?: boolean;
  status?: string;
  content?: string;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  _costMeta?: unknown;
  requestId?: unknown;
  approvalId?: unknown;
  autoApproved?: boolean;
  [key: string]: unknown;
};

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
  private pendingNodeOutputs: Map<string, unknown>; // Accumulated node outputs for batch write
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
  /** Admin-level workflow defaults loaded from systemConfiguration at execution start. */
  private adminSettings?: Record<string, unknown>;
  /** Workflow-level settings loaded from the workflow row at execution start. */
  private workflowSettings?: { defaultTimeoutMs?: number; [key: string]: unknown };
  /** Accumulated token cost across all LLM nodes in this execution. */
  private totalCost = 0;

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
    this.pricingLookup = new PricingLookup(prisma as unknown as ConstructorParameters<typeof PricingLookup>[0], logger);

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
  async execute(): Promise<{ success: boolean; output: unknown; error?: string }> {
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
        this.adminSettings = (typeof adminConfig.value === 'string'
          ? JSON.parse(adminConfig.value) : adminConfig.value) as Record<string, unknown>;
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
        this.workflowSettings = (typeof workflow.settings === 'string'
          ? JSON.parse(workflow.settings as string) : workflow.settings) as { defaultTimeoutMs?: number; [key: string]: unknown };
      }
    } catch (err) {
      logger.debug({ err }, '[WorkflowEngine] Failed to load workflow settings (using defaults)');
    }

    // Initialize cost tracking accumulator
    this.totalCost = 0;

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
      const runtimeInput: Record<string, unknown> =
        this.context.input && typeof this.context.input === 'object'
          ? (this.context.input as Record<string, unknown>)
          : {};
      const missingRequired: string[] = [];
      for (const trigger of triggerNodes) {
        const inputs = trigger.data?.inputs;
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

      const finalOutputs: Record<string, unknown> = {};
      const outputEnvelopes: OutputEnvelope[] = [];
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          // Wrap terminal node output in a structured envelope for rich rendering
          const envelope = this.formatOutputEnvelope(node, result);
          outputEnvelopes.push(envelope);
          finalOutputs[node.id] = result;
        }
      }

      // If only one terminal node, unwrap
      let finalOutput: unknown = finalOutputs;
      if (Object.keys(finalOutputs).length === 1) {
        finalOutput = Object.values(finalOutputs)[0];
      }

      // Attach output envelopes to the execution context for downstream use
      this.context.outputEnvelopes = outputEnvelopes;

      // Honest status: if any node failed during this run, the workflow as
      // a whole is FAILED — even if downstream nodes (merge, compare) ran
      // successfully on the failure markers. Earlier, returning 'completed'
      // here while 3 of 6 nodes had status:'failed' produced a 'fake success'
      // where the engine reported green but the output was a meta-summary
      // describing the failures. Caught 2026-04-26 on Smart Router Showcase.
      const failedNodes = Array.from(this.pendingNodeOutputs.entries())
        .filter(([, data]) => {
          const d = data as { status?: string; error?: string } | null | undefined;
          return d?.status === 'failed' || (d?.error != null && d.error !== '');
        })
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

    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';

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
  private async executeNode(nodeId: string, input: unknown): Promise<unknown> {
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
    const nodeRetry = node.data.retryPolicy as { maxRetries?: number; delayMs?: number; backoff?: string; retryOnPatterns?: string[] } | undefined;
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

    let result: NodeResultView | undefined;
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
        const nodeTimeout = (node.data.timeoutMs as number | undefined) || this.workflowSettings?.defaultTimeoutMs || 0;
        if (nodeTimeout > 0) {
          result = await Promise.race([
            this.executeNodeCore(node, input),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Node timeout after ${nodeTimeout}ms`)), nodeTimeout))
          ]) as NodeResultView | undefined;
        } else {
          result = await this.executeNodeCore(node, input) as NodeResultView | undefined;
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
        const rp: unknown = result;
        const resultPreview = rp === undefined ? 'undefined' : rp === null ? 'null' :
          typeof rp === 'string' ? `string(${rp.length})` :
          typeof rp === 'object' ? `object(${Object.keys(rp).join(',').substring(0, 60)})` : typeof rp;
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
          const errorMsg = result?.error || result?.errorMessage || ((node.type === 'llm_completion' || node.type === 'openagentic_llm') ? 'LLM returned empty response' : 'Node returned error result');
          this.emitEvent('node_error', { nodeId, nodeType: node.type, error: String(errorMsg) });
        }

        // Calculate per-node cost from token usage BEFORE storing
        if ((node.type === 'llm_completion' || node.type === 'openagentic_llm' || node.type === 'agent_single') && result?.usage) {
          const usage = result.usage;
          const modelName = result.model || (node.data.model as string | undefined) || 'unknown';
          const totalTokens = usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
          const nodeCost = await this.calculateTokenCost(modelName, usage.prompt_tokens || 0, usage.completion_tokens || 0);
          this.totalCost += nodeCost;

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
          await this.storeNodeExecution(nodeId, node.type, nodeStatus, result, executionTimeMs, resultHasError ? String(result?.error || 'Node result indicates failure') : undefined, input);
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
                const dataToolName = node.data.toolName as string | undefined;
                const dataToolServer = node.data.toolServer as string | undefined;
                const toolName = dataToolName || dataToolServer
                  ? `${dataToolServer || 'unknown'}/${dataToolName || 'unknown'}`
                  : nodeId;
                registry.recordToolCall(this.context.agenticExecutionId, toolName);
              }

              // Record LLM usage in AgentRegistry
              if ((node.type === 'llm_completion' || node.type === 'openagentic_llm' || node.type === 'agent_single') && result?.usage) {
                const modelName = result.model || (node.data.model as string | undefined) || 'unknown';
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

      } catch (error) {
        lastError = error as Error;

        // Check if we should retry this error
        if (retryConfig && !this.shouldRetry(error as Error, retryConfig, attempt, maxRetries)) {
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
        result = await this.handleFallback(node, input, lastError!, fallbackConfig) as NodeResultView | undefined;

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
      } catch (fallbackError) {
        logger.error({
          nodeId,
          fallbackError: (fallbackError as Error).message
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
    payload: unknown,
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
        // Store error result so the merge gate can see this branch's outcome
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
          } catch (err) {
            this.safeLog('warn', { nodeId: edge.target, error: (err as Error).message }, '[WorkflowEngine] Merge node execution failed after failed branch notification'); // err.message may contain secret-interpolated content
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
  private async executeNodeCore(node: WorkflowNode, input: unknown): Promise<unknown> {
    // Provide shared context to the node via input
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      (input as Record<string, unknown>).__sharedContext = Object.fromEntries(this.context.sharedContext);
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
    // unknown types.
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
    input: unknown,
  ): Promise<unknown> {
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
        } catch (err) {
          logger.warn(
            {
              err: (err as Error)?.message ?? String(err),
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
            const label = ((sourceNode?.data?.label as string | undefined) || sourceNode?.id || edge.source)
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
          (subInput as Record<string, unknown>) ?? {},
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
                input: payload.input,
              } as unknown as Prisma.InputJsonValue,
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
          fields: payload.fields as unknown as Parameters<typeof createDataRequestRecord>[1]['fields'],
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
                input: payload.input,
              } as unknown as Prisma.InputJsonValue,
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

    let result: unknown;
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
    const waitResult = result as { status?: string; resumeAt?: string | number | Date } | undefined;
    if (node.type === 'wait' && waitResult?.status === 'waiting') {
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: {
          status: 'waiting',
          current_node_id: node.id,
          resume_at: new Date(waitResult.resumeAt as string | number | Date),
          state: {
            nodeResults: Object.fromEntries(this.context.nodeResults),
            variables: Object.fromEntries(this.context.variables),
            input,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      this.emitEvent('execution_paused', {
        nodeId: node.id,
        resumeAt: waitResult.resumeAt,
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
    input: unknown,
    error: Error,
    config?: FallbackConfig
  ): Promise<unknown> {
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
          ? { ...(input as Record<string, unknown>), __error: { message: error.message, nodeId: node.id } }
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
            gate.resolve();
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
   * Calculate token cost based on model pricing.
   * Delegates to PricingLookup which reads rates from the LLMCostRate DB table.
   * Never throws — uses fallback economy rates if the DB is unavailable or has no row.
   */
  private async calculateTokenCost(model: string, promptTokens: number, completionTokens: number): Promise<number> {
    return this.pricingLookup.calculateCost(model, promptTokens, completionTokens);
  }

  /**
   * Resume a paused workflow execution from a checkpoint
   * Called when an approval is received or wait time elapses
   */
  async resumeExecution(fromNodeId: string, resumeInput?: unknown): Promise<{ success: boolean; output: unknown; error?: string }> {
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

      const finalOutputs: Record<string, unknown> = {};
      const resumeEnvelopes: OutputEnvelope[] = [];
      for (const node of terminalNodes) {
        const result = this.context.nodeResults.get(node.id);
        if (result !== undefined) {
          finalOutputs[node.id] = result;
          resumeEnvelopes.push(this.formatOutputEnvelope(node, result));
        }
      }

      let finalOutput: unknown = finalOutputs;
      if (Object.keys(finalOutputs).length === 1) {
        finalOutput = Object.values(finalOutputs)[0];
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

    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
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
  private canonicalNodeOutput(r: unknown): unknown {
    if (r === null || r === undefined) return r;
    if (typeof r !== 'object') return r;
    const obj = r as Record<string, unknown>;
    if (obj.output !== undefined) return obj.output;
    if (obj.content !== undefined) return obj.content;
    if (obj.text !== undefined) return obj.text;
    if (obj.answer !== undefined) return obj.answer;
    if (obj.result !== undefined) return this.canonicalNodeOutput(obj.result);
    if (obj.results !== undefined) return obj.results;
    if (obj.data !== undefined) return obj.data;
    return r;
  }

  /**
   * SCHEMA-AWARE primary-output accessor (typed-IO contract, #1268/#1269):
   *   1. explicit `value.output` wins;
   *   2. else the SOURCE node TYPE's declared schema.primary if present;
   *   3. else the canonicalNodeOutput heuristic.
   */
  private resolvePrimaryOutput(value: unknown, nodeType: string | undefined): unknown {
    if (value !== null && typeof value === 'object' && (value as Record<string, unknown>).output !== undefined) {
      return (value as Record<string, unknown>).output;
    }
    if (value !== null && typeof value === 'object' && nodeType) {
      const primary = this.nodePrimaryOf(nodeType);
      if (primary && Object.prototype.hasOwnProperty.call(value, primary)) {
        return (value as Record<string, unknown>)[primary];
      }
    }
    return this.canonicalNodeOutput(value);
  }

  private interpolateTemplate(template: string, context: unknown): string {
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
            const label = ((node?.data?.label as string | undefined) || '').toLowerCase().replace(/[-_\s]+/g, '-');
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
            if (key === 'output' && value !== undefined && (value as Record<string, unknown>)[key] === undefined) {
              const srcType = resolvedSrcId ? this.nodeMap.get(resolvedSrcId)?.type : undefined;
              value = this.resolvePrimaryOutput(value, srcType);
              continue;
            }
            value = (value as Record<string, unknown> | undefined)?.[key];
          }
          // If path traversal ended with undefined, try common content extraction patterns
          // MCP tools normalize to { content: string } but some return nested structures
          if (value === undefined && rest.length > 0) {
            const nodeResult = nodeRoot;
            if (nodeResult !== undefined) {
              // Try extracting from common result shapes
              const lastKey = rest[rest.length - 1];
              if (lastKey === 'content' || lastKey === 'text') {
                const nr = nodeResult as Record<string, unknown> | undefined;
                value = nr?.content || nr?.text || nr?.result || nr?.data;
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

        const resolveNestedPath = (obj: unknown, keys: string[]): unknown => {
          let v: unknown = obj;
          for (const k of keys) { v = (v as Record<string, unknown> | undefined)?.[k]; }
          return v;
        };
        const formatValue = (v: unknown): string =>
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
            const label = ((node.data?.label as string | undefined) || '').toLowerCase().replace(/[-_\s]+/g, '-');
            if (label === normalized) {
              resolvedNodeId = nId;
              break;
            }
          }
        }
        if (resolvedNodeId) {
          let value = this.context.nodeResults.get(resolvedNodeId);
          for (const key of rest) {
            value = (value as Record<string, unknown> | undefined)?.[key];
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
      let value: unknown = context;
      // If path starts with 'input', the context IS the input -- skip the 'input' prefix
      if (pathParts[0] === 'input' && pathParts.length > 1 && (context as Record<string, unknown> | undefined)?.[pathParts[1]] !== undefined) {
        // Direct field access: {{input.name}} -> context.name (context IS the input)
        for (let i = 1; i < pathParts.length; i++) {
          value = (value as Record<string, unknown> | undefined)?.[pathParts[i]];
        }
      } else {
        // Standard path traversal
        for (const key of pathParts) {
          value = (value as Record<string, unknown> | undefined)?.[key];
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
  private formatOutputEnvelope(node: WorkflowNode, rawOutput: unknown): OutputEnvelope {
    const nodeLabel = (node.data?.label as string | undefined) || node.id;
    const outputFormat: OutputFormat = (node.data?.outputFormat as OutputFormat | undefined) || this.inferOutputFormat(node.type, rawOutput);
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

  /**
   * Generate a semantic, human-readable title for artifacts stored in Milvus.
   * Format: "[Workflow] Node Label - Content Summary"
   * Examples:
   *   "Research Team - Enterprise AI Platform Market Report"
   *   "Final Report - Key Findings on Remote Work Productivity"
   *   "Code Analysis - 15 security vulnerabilities found"
   */
  private buildSemanticTitle(node: WorkflowNode, rawOutput: unknown, content: string): string {
    const nodeLabel = (node.data?.label as string | undefined) || node.id;
    const workflowName = this.context.workflowId && this.context.workflowId !== 'test-node'
      ? this.context.workflowId.substring(0, 30) : '';

    // Extract a content summary from the output
    let summary = '';
    const ro = rawOutput as Record<string, unknown> | undefined;
    const textContent: unknown = typeof rawOutput === 'string'
      ? rawOutput
      : ro?.content || ro?.text || ro?.result || '';

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
  private inferOutputFormat(nodeType: string, output: unknown): OutputFormat {
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
    if (output && typeof output === 'object' && typeof (output as Record<string, unknown>).content === 'string') return 'markdown';

    // Arrays → table format for readability
    if (Array.isArray(output)) return 'table';

    // Default to json
    return 'json';
  }

  /**
   * Convert node output to readable markdown based on node type.
   */
  private toMarkdown(nodeType: string, output: unknown, title: string): string {
    // If output is already a string, return as-is (LLM text, etc.)
    if (typeof output === 'string') return output;

    // Extract content from common response shapes
    if (output && typeof output === 'object') {
      const obj = output as Record<string, unknown>;
      // LLM response: { content: string, model: string, ... }
      if (typeof obj.content === 'string') {
        const meta: string[] = [];
        if (obj.model) meta.push(`**Model:** ${String(obj.model)}`);
        const totalTokens = (obj.usage as { total_tokens?: number } | undefined)?.total_tokens;
        if (totalTokens) meta.push(`**Tokens:** ${totalTokens}`);
        return meta.length > 0
          ? `${obj.content}\n\n---\n_${meta.join(' | ')}_`
          : obj.content;
      }

      // MCP tool result: { result: unknown, toolName: string, ... }
      if (obj.result !== undefined) {
        const resultStr = typeof obj.result === 'string'
          ? obj.result
          : JSON.stringify(obj.result, null, 2);
        return `### ${(obj.toolName as string | undefined) || title}\n\n\`\`\`json\n${resultStr}\n\`\`\``;
      }

      // Generic object: format as sections
      return this.objectToMarkdownSections(obj);
    }

    return String(output ?? '');
  }

  /**
   * Convert a generic object into markdown sections.
   */
  private objectToMarkdownSections(obj: Record<string, unknown>): string {
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
        sections.push(`**${heading}:** ${String(value)}`);
      }
    }
    return sections.join('\n\n');
  }

  /**
   * Convert array data into a markdown table.
   */
  private toMarkdownTable(data: unknown): string {
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

  private emitEvent(type: ExecutionEvent['type'], data?: unknown): void {
    const safeData = redactSecrets(data, this.context);
    const event: ExecutionEvent = {
      type,
      executionId: this.context.executionId,
      timestamp: new Date().toISOString(),
      ...(safeData as Record<string, unknown>)
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
    output: unknown,
    executionTimeMs: number,
    error?: string,
    input?: unknown,
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
      const nodeOutputs: Record<string, unknown> = {};
      for (const [nodeId, data] of this.pendingNodeOutputs) {
        nodeOutputs[nodeId] = data;
      }
      await prisma.workflowExecution.update({
        where: { id: this.context.executionId },
        data: { node_outputs: nodeOutputs as unknown as Prisma.InputJsonValue }
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
    output: unknown,
    error?: string
  ): Promise<void> {
    const executionTimeMs = Date.now() - this.context.startTime;
    const completedNodes = Array.from(this.context.nodeResults.keys()).length;

    // Build node_outputs from accumulated pending results
    const nodeOutputs: Record<string, unknown> = {};
    for (const [nodeId, data] of this.pendingNodeOutputs) {
      nodeOutputs[nodeId] = data;
    }

    try {
      const safeOutput = redactSecrets(output ? JSON.parse(JSON.stringify(output)) : null, this.context);
      const safeNodeOutputs = redactSecrets(nodeOutputs, this.context);
      const totalCost = this.totalCost || 0;
      const updateData: Record<string, unknown> = {
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
        update: updateData as Parameters<typeof prisma.workflowExecution.upsert>[0]['update'],
        create: {
          id: this.context.executionId,
          workflow_id: this.context.workflowId,
          started_by: this.context.userId,
          trigger_type: 'manual',
          input: this.context.input ? JSON.parse(JSON.stringify(this.context.input)) : {},
          ...updateData,
        } as Parameters<typeof prisma.workflowExecution.upsert>[0]['create'],
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
  input: Record<string, unknown>,
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
): Promise<{ success: boolean; output: unknown; error?: string }> {
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
