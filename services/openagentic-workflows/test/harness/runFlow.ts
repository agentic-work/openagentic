/**
 * runFlow — Flows test harness entry point.
 *
 * Executes a workflow definition through the *real* WorkflowExecutionEngine
 * (the same code path /execute and /test-execute use in production) and
 * returns a deterministic snapshot of:
 *   - the final execution status,
 *   - every frame the engine emitted (in arrival order),
 *   - the last output value stored against each nodeId,
 *   - wall-clock duration, and
 *   - the top-level error if the run failed.
 *
 * Phase A of the Flows test harness. Per-node primitive tests live under
 * test/harness/primitives/ and use this helper to assert deterministic
 * behavior without booting Fastify or relying on a database.
 *
 * Network calls inside executors (axios, fetch) are intercepted by the
 * MSW node server set up in test/harness/mocks/msw-setup.ts.
 */

import { withTenant, withSystemTenant } from '../../src/utils/tenantPrismaExtension.js';
import {
  executeWorkflow,
  type WorkflowDefinition,
  type ExecutionEvent,
} from '../../src/services/WorkflowExecutionEngine.js';
import { WorkflowCompiler } from '../../src/services/WorkflowCompiler.js';

/** Public frame shape — alias of ExecutionEvent for harness consumers. */
export type WorkflowExecutionFrame = ExecutionEvent;

export interface RunFlowOptions {
  /** Flow definition (nodes + edges). */
  flow: WorkflowDefinition;
  /** Optional input variables seeded onto the trigger. */
  input?: Record<string, unknown>;
  /**
   * Tenant id to wrap execution in. Pass `null` (the default) to run as the
   * system actor via `withSystemTenant`; pass a string to use `withTenant`.
   */
  tenantId?: string | null;
  /**
   * Optional MSW handlers to layer on top of harnessServer defaults. The
   * caller is responsible for installing these via `harnessServer.use(...)`
   * before invoking runFlow — this field is reserved for future ergonomic
   * wrappers that auto-install + reset.
   */
  mocks?: Array<unknown>;
  /** Overall execution timeout in ms (default 30s). */
  timeout?: number;
  /** Optional workflow id label (used in logs / frame `workflowId`). */
  workflowId?: string;
  /** Optional execution id (default: harness-<uuid>). */
  executionId?: string;
  /** Optional user id stamped on the execution (default: `harness-user`). */
  userId?: string;
  /**
   * Trigger type — defaults to `manual`. Use `test` if you want
   * canAutoApprove() to auto-approve human_approval/approval nodes.
   */
  triggerType?: string;
  /** Permissions of the caller. */
  userPermissions?: readonly string[];
  /**
   * Optional caller identity — mirrors chatmode OBO threading. When supplied,
   * `user.accessToken` becomes the engine `authToken` (forwarded by
   * mcp_tool / http_request executors as the `Authorization` header onto
   * mcp-proxy), and `user.idToken` becomes the engine `idToken` (forwarded
   * as `X-Azure-ID-Token` + `X-AWS-ID-Token` for Azure OBO / AWS Identity
   * Center federation). Mirrors the chatmode `buildMcpProxyHeaders`
   * contract so harness assertions match production wire shape.
   */
  user?: {
    id?: string;
    email?: string;
    accessToken?: string;
    idToken?: string;
  };
}

export interface RunFlowResult {
  /** Final execution status: 'completed' | 'failed' | 'cancelled'. */
  status: 'completed' | 'failed' | 'cancelled';
  /** Every frame the engine emitted, in arrival order. */
  frames: WorkflowExecutionFrame[];
  /** Map of nodeId → last output payload. */
  outputs: Record<string, unknown>;
  /** Total wall-clock ms. */
  durationMs: number;
  /** Top-level error when status === 'failed'. */
  error?: { message: string; nodeId?: string };
  /** Raw engine result for power users (success + output + error). */
  raw: { success: boolean; output: unknown; error?: string };
}

const DEFAULT_TIMEOUT_MS = 30_000;

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Execute a flow definition through the real WorkflowExecutionEngine and
 * collect every emitted frame plus the per-node output map.
 *
 * The flow is compiled via WorkflowCompiler first (same as `/execute`); a
 * compilation failure surfaces as `status: 'failed'` with `error.message`
 * describing the first compiler error.
 *
 * Execution runs inside `withTenant` (or `withSystemTenant` when no
 * `tenantId` is supplied), matching the route-handler scoping pattern.
 */
export async function runFlow(opts: RunFlowOptions): Promise<RunFlowResult> {
  const startTime = Date.now();
  const frames: WorkflowExecutionFrame[] = [];
  const outputs: Record<string, unknown> = {};

  const workflowId = opts.workflowId ?? genId('harness-wf');
  const executionId = opts.executionId ?? genId('harness-exec');
  const userId = opts.user?.id ?? opts.userId ?? 'harness-user';
  const userEmail = opts.user?.email;
  const triggerType = opts.triggerType ?? 'manual';
  const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const tenantId = opts.tenantId ?? null;

  // OBO/auth threading — mirror chatmode `buildMcpProxyHeaders`. When a
  // caller supplies `user.accessToken`, format it as `Bearer <jwt>` so
  // the mcp_tool/http_request executors can forward it verbatim as the
  // outbound `Authorization` header. The `idToken` rides separately on
  // `X-Azure-ID-Token` + `X-AWS-ID-Token`.
  const authToken = opts.user?.accessToken
    ? `Bearer ${opts.user.accessToken}`
    : undefined;
  const idToken = opts.user?.idToken;

  // 1. Compile first — same path /execute uses. A compile failure short-
  //    circuits before we hit the engine.
  const compiler = new WorkflowCompiler();
  const compiled = compiler.compile(opts.flow);
  if (!compiled.valid) {
    const first = compiled.errors[0];
    return {
      status: 'failed',
      frames,
      outputs,
      durationMs: Date.now() - startTime,
      error: { message: `compile: ${first?.code ?? 'UNKNOWN'}: ${first?.message ?? 'invalid workflow'}`, nodeId: first?.nodeId },
      raw: { success: false, output: null, error: first?.message },
    };
  }

  const onEvent = (event: ExecutionEvent): void => {
    frames.push(event);
    // Capture per-node last-known output. node_complete is authoritative;
    // some skip paths emit it with `skipped: true` and pass-through input.
    if (event.type === 'node_complete' && event.nodeId) {
      const data = (event as unknown as { output?: unknown }).output;
      outputs[event.nodeId] = data;
    }
  };

  const exec = async () => {
    return executeWorkflow(
      workflowId,
      executionId,
      opts.flow,
      (opts.input ?? {}) as Record<string, unknown>,
      userId,
      authToken,
      onEvent,
      {
        triggerType,
        tenantId,
        userPermissions: opts.userPermissions,
        idToken,
        userEmail,
      },
    );
  };

  // 2. Tenant-scope the run. Null tenant → system actor.
  const runWithScope = tenantId
    ? () => withTenant({ tenantId }, exec)
    : () => withSystemTenant(exec);

  // 3. Enforce overall timeout. The engine respects AbortController via
  //    abortableAxios, but we still want a hard ceiling on harness runs so
  //    a misbehaving executor cannot stall CI indefinitely.
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`runFlow timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  let raw: { success: boolean; output: unknown; error?: string };
  try {
    raw = (await Promise.race([runWithScope(), timeoutPromise])) as typeof raw;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      frames,
      outputs,
      durationMs: Date.now() - startTime,
      error: { message },
      raw: { success: false, output: null, error: message },
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  // 4. Derive final status. The engine emits execution_error on abort and
  //    execution_complete on success. status is also implicit in raw.success.
  let status: RunFlowResult['status'] = raw.success ? 'completed' : 'failed';
  if (frames.some((f) => f.type === 'execution_aborted' as ExecutionEvent['type'])) {
    status = 'cancelled';
  }

  const errorFrame = frames.find((f) => f.type === 'execution_error' || f.type === 'node_error');
  const error: RunFlowResult['error'] | undefined =
    !raw.success
      ? {
          message: raw.error ?? ((errorFrame as unknown as { error?: string })?.error ?? 'unknown error'),
          nodeId: errorFrame?.nodeId,
        }
      : undefined;

  return {
    status,
    frames,
    outputs,
    durationMs: Date.now() - startTime,
    error,
    raw,
  };
}
