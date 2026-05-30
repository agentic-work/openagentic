/**
 * BrowserSandboxExecTool
 *
 * Closes the task #158 loop: the server emits `browser_exec_request` into
 * the chat SSE stream → the UI runs the code (Pyodide/iframe) → POSTs the
 * result back to /api/chat/sandbox-result → this module's promise resolves.
 *
 * The pipeline's tool dispatcher recognises `browser_sandbox_exec` (and a
 * small set of aliases the model might emit) via `isBrowserSandboxTool()`,
 * then calls `executeBrowserSandbox(context, input)`.
 *
 * Design:
 *   - requestId: crypto-random hex so no collisions across concurrent turns
 *   - timeout: 30 s server default, overridable via `timeout_ms` param
 *   - the SandboxResultStore is the shared in-process rendezvous point
 *     (singleton; see SandboxResultStore.ts)
 *   - context.emit('browser_exec_request', ...) maps to `streamCallback`
 *     which emits the NDJSON frame to the UI
 */

import crypto from 'crypto';
import { getSandboxResultStore, type SandboxResultEnvelope } from './SandboxResultStore.js';

// ---------------------------------------------------------------------------
// Tool schema (OpenAI / Anthropic function-call format)
// ---------------------------------------------------------------------------

export const BROWSER_SANDBOX_EXEC_TOOL = {
  type: 'function',
  function: {
    name: 'browser_sandbox_exec',
    description: [
      'Execute a short Python or JavaScript snippet in the user\'s browser sandbox.',
      'Python runs via Pyodide (numpy, pandas, matplotlib available); JS runs in an',
      'isolated iframe. stdout is captured and returned. NO network access, NO',
      'filesystem writes, 5 s wall-clock.',
      '',
      'Use when the user asks for a calculation, a chart from data they pasted,',
      'a one-shot data transform (CSV → table, JSON reshape), or a quick',
      'algorithmic check. Python plots: call plt.savefig("plot.png") and the',
      'result includes a base64 PNG. Embed inline via standard markdown image',
      'syntax, or call compose_visual for an interactive chart slide-out.',
      '',
      'Do NOT use browser_sandbox_exec for cloud API calls — use the',
      'corresponding cloud MCP tool (azure_*, aws_*, gcp_*) or synth_synthesize',
      'instead. Do NOT use it to read or write files in the user workspace —',
      'use the dedicated file tools. Avoid calling it for tasks the model can',
      'reason through directly without code execution. Never use it as a',
      'general-purpose shell.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['code', 'language'],
      properties: {
        code: {
          type: 'string',
          description: 'The source code to run. Keep it short — 5 s budget.',
        },
        language: {
          type: 'string',
          enum: ['python', 'js'],
          description: '"python" for Pyodide (numpy/pandas/matplotlib); "js" for iframe eval.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Override the server-side deadline in milliseconds (max 30 000).',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const TOOL_ALIASES = new Set([
  'browser_sandbox_exec',
  'browser_exec',
  'run_code',
  'execute_code',
]);

export function isBrowserSandboxTool(name: string): boolean {
  return TOOL_ALIASES.has(name);
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface BrowserSandboxInput {
  code: string;
  language: 'python' | 'js';
  timeout_ms?: number;
}

export type BrowserSandboxResult = Pick<
  SandboxResultEnvelope,
  'requestId' | 'ok' | 'stdout' | 'stderr' | 'timedOut' | 'durationMs' | 'errorCode' | 'images'
>;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/** Minimal slice of PipelineContext that this module needs.
 *
 * The chat pipeline's RunCtx puts sessionId/userId at the top level
 * (see `pipeline/chat/types.ts` RunCtx interface). The old
 * `streamContext.sessionId` shape was a stale reference — fixed in the
 * 2026-05-07 sev-0 because every browser_sandbox_exec dispatch was
 * crashing with "Cannot read properties of undefined (reading 'sessionId')".
 */
interface SandboxContext {
  emit: (event: string, data: unknown) => void;
  messageId?: string;
  sessionId?: string;
  userId?: string;
  /** Back-compat — older callers may still nest. Read from either shape. */
  streamContext?: { sessionId?: string; userId?: string };
}

export async function executeBrowserSandbox(
  context: SandboxContext,
  input: BrowserSandboxInput,
): Promise<BrowserSandboxResult> {
  const requestId = crypto.randomBytes(12).toString('hex');
  const timeoutMs = Math.min(input.timeout_ms ?? 30_000, 30_000);

  // Register BEFORE emitting so there's no race where the UI posts back
  // before the store has an entry.
  const store = getSandboxResultStore();
  const pending = store.awaitResult(requestId, timeoutMs);

  // Emit the NDJSON frame. The `context.emit` call maps to `streamCallback`
  // → client receives { type: 'browser_exec_request', data: { ... } }.
  const sessionId = context.sessionId ?? context.streamContext?.sessionId ?? '';
  context.emit('browser_exec_request', {
    requestId,
    code: input.code,
    language: input.language,
    timeoutMs,
    sessionId,
    messageId: context.messageId ?? '',
  });

  const envelope = await pending;

  return {
    requestId: envelope.requestId,
    ok: envelope.ok,
    stdout: envelope.stdout,
    stderr: envelope.stderr,
    timedOut: envelope.timedOut ?? false,
    durationMs: envelope.durationMs,
    errorCode: envelope.errorCode,
    images: envelope.images,
  };
}
