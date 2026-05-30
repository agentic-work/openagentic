/**
 * synth_execute — meta-tool that delegates to the SynthExecutorClient.
 *
 * The model emits `synth_execute({ code, intent })` and this dispatcher
 * sends the code to the dedicated synth-executor service for sandboxed
 * Python execution. Process isolation, timeout, memory cap, capability
 * gating all live in the executor service — this dispatcher is a thin
 * shape adapter.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 9 (Tasks 9.1-9.10)
 *
 * NOTE: An older codepath (WorkflowExecutionEngine) exposes a
 * `synth_synthesize` meta-tool that orchestrates synthesis + execution
 * in a single tool call. This new `synth_execute` is the lower-level,
 * model-driven primitive — the model brings its own pre-synthesized code
 * and the dispatcher just runs it. Future: collapse to one or the other
 * once the V3 prompt-module set converges.
 */

import type { SynthExecutorClient, SynthExecutionResponse } from './SynthExecutorClient.js';

export const SYNTH_EXECUTE_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'synth_execute',
    description:
      'Execute Python code in a sandboxed runtime with strict capability gating and resource ' +
      'limits (default 30s timeout, 256MB RAM). Use this when the user asks for a one-off ' +
      'computation, data crunch, file conversion, or quick scrape that no installed MCP tool ' +
      'covers. The executor returns stdout/stderr/result; on failure, returns ok:false with the ' +
      'error message. NOT for shell commands — Python only.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Python source code to execute. Must be self-contained.',
        },
        intent: {
          type: 'string',
          description:
            'Short human-readable summary of what this code does. Audit + UI use this for the ' +
            'tool-use card and the synth audit log.',
        },
        timeout_seconds: {
          type: 'integer',
          minimum: 1,
          maximum: 120,
          default: 30,
          description: 'Wall-clock timeout in seconds. Defaults to 30.',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Capability names this code needs (e.g. "http", "json", "datetime"). Capabilities ' +
            'beyond the default set require admin pre-approval per CapabilityRegistry.',
          nullable: true,
        },
      },
      required: ['code', 'intent'],
    },
  },
} as const;

export interface SynthExecuteInput {
  code: string;
  intent: string;
  timeout_seconds?: number;
  capabilities?: string[];
  /** Optional credentials map — usually projected by CapCredentialMap server-side. */
  credentials?: Record<string, string>;
}

/**
 * #781 Phase A3 — exportable manifest describing how the UI's
 * ArtifactSlideOut should offer download/export buttons for this
 * synth_execute result. Detected post-hoc from stdout shape; UI never
 * has to re-derive from raw bytes.
 *
 * `sources` always includes the user-supplied `code` (so the slide-out
 * can offer "Download .py source" alongside the rendered report).
 */
export interface SynthExportableManifest {
  kind: 'python-report' | 'chart' | 'table' | 'code';
  mime: string[];
  sources: string[];
}

export interface SynthExecuteOutput {
  ok: boolean;
  output?: {
    stdout?: string;
    stderr?: string;
    result?: unknown;
    executionTimeMs: number;
    /**
     * #781 Phase A3 — present when the stdout/result shape matches a
     * recognized artifact pattern (markdown report, matplotlib PNG,
     * pandas DataFrame). Absent for plain-text / unrecognized output.
     */
    exportable?: SynthExportableManifest;
  };
  error?: string;
}

/**
 * Detect the exportable manifest for a synth_execute result.
 *
 * Single rule shipped in A3 (others added per future RED→GREEN cycles):
 *   - stdout starts with markdown heading (`#` after optional whitespace)
 *     → kind: 'python-report', mime: [pdf, md], sources: [code]
 *
 * Returns undefined when no rule matches — UI gracefully degrades to
 * "Copy" + "Download source" without specialized export buttons.
 */
function detectExportableManifest(
  stdout: string | undefined,
  code: string,
): SynthExportableManifest | undefined {
  if (typeof stdout === 'string' && /^\s*#\s/.test(stdout)) {
    return {
      kind: 'python-report',
      mime: ['application/pdf', 'text/markdown'],
      sources: [code],
    };
  }
  return undefined;
}

export interface SynthExecuteDeps {
  /** Production wiring: getSynthExecutorClient(logger). */
  client: Pick<SynthExecutorClient, 'execute'>;
}

/**
 * Execute the synth_execute meta-tool. Mints a per-call execution id +
 * forwards parent ctx (userId/sessionId/userEmail) so the executor's
 * service-JWT scopes correlate to the right audit row.
 */
export async function executeSynthExecute(
  ctx: { userId?: string; sessionId?: string; userEmail?: string; logger?: { warn: (...a: unknown[]) => void } },
  input: SynthExecuteInput,
  deps: SynthExecuteDeps,
): Promise<SynthExecuteOutput> {
  const executionId = `synth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let response: SynthExecutionResponse;
  try {
    response = await deps.client.execute({
      executionId,
      code: input.code,
      intent: input.intent,
      userId: ctx.userId ?? 'anonymous',
      sessionId: ctx.sessionId ?? '',
      userEmail: ctx.userEmail,
      timeoutSeconds: input.timeout_seconds,
      capabilities: input.capabilities,
      credentials: input.credentials,
    });
  } catch (err: any) {
    ctx.logger?.warn?.({ err: err?.message ?? String(err) }, '[synth_execute] client threw');
    return {
      ok: false,
      error: err?.message ?? String(err),
    };
  }

  if (!response.success) {
    return {
      ok: false,
      error: response.error ?? 'synth-executor returned failure with no error message',
    };
  }

  const exportable = detectExportableManifest(response.stdout, input.code);
  return {
    ok: true,
    output: {
      stdout: response.stdout,
      stderr: response.stderr,
      result: response.result,
      executionTimeMs: response.executionTimeMs,
      ...(exportable ? { exportable } : {}),
    },
  };
}
