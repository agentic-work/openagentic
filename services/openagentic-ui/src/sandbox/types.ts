/**
 * Browser-sandbox wire types (task #158).
 *
 * The model can ask the UI to execute a short Python or JS snippet and
 * report the result back via the canonical NDJSON stream. Two new event
 * types appear on the chat wire:
 *
 *   browser_exec_request  (server → client, NDJSON frame)
 *   browser_exec_result   (client → server, posted to /api/chat/sandbox-result)
 *
 * Both share the same `requestId` so the backend can pair result with
 * request. The UI renders a "Python Sandbox" / "JS Sandbox" card whose
 * ▶ button triggers sandboxManager.execute(); the card then updates
 * with stdout/stderr/returnValue/chart as the worker / iframe reports.
 *
 * All payloads stay intentionally small — no binary blobs, no data URLs
 * above a couple hundred KB. matplotlib figures are base64-encoded PNG
 * strings (handled in the pyodide worker) and capped by the sandbox.
 */

/** Supported sandbox runtimes. */
export type SandboxLanguage = 'python' | 'javascript';

/**
 * What the model asks the UI to run.
 * Emitted on the NDJSON wire as `{type: 'browser_exec_request', ...}`.
 */
export interface BrowserExecRequest {
  /** Pairing id — the UI echoes this in the result frame. */
  requestId: string;
  /** 'python' routes to pyodide, 'javascript' routes to the iframe. */
  language: SandboxLanguage;
  /** Source code to execute. Must be a single module-level snippet. */
  code: string;
  /**
   * Hint for the UI card title. Falls back to "Python Sandbox" /
   * "JS Sandbox" if omitted. Purely cosmetic.
   */
  title?: string;
  /** Hard ceiling in ms. Defaults to 5000 on the sandbox side. */
  timeoutMs?: number;
  /**
   * Conversation id so the backend route can inject the tool_result
   * into the right pending turn. Present on every request emitted by
   * the chat pipeline.
   */
  sessionId?: string;
  /**
   * Assistant message id the request came from. Optional — the
   * backend route will associate the result with the pending
   * turn if this is omitted.
   */
  messageId?: string;
}

/**
 * What the UI reports back after executing the snippet.
 * Posted as JSON body to `POST /api/chat/sandbox-result`.
 */
export interface BrowserExecResult {
  /** Echoed from the request. */
  requestId: string;
  /** True if the snippet returned without throwing and within the timeout. */
  ok: boolean;
  /** Concatenated stdout captured during the run. */
  stdout: string;
  /** Concatenated stderr / error messages. */
  stderr: string;
  /** JSON-serialized return value (if any). */
  returnValue?: string;
  /**
   * If the snippet produced matplotlib figures or an HTML canvas image,
   * the sandbox encodes them as base64 PNG here. Capped at ~2MiB total
   * across all entries so we don't blow the request body.
   */
  images?: Array<{ mime: string; base64: string }>;
  /** Non-null when execution was killed by the timeout watchdog. */
  timedOut?: boolean;
  /** Wall-clock duration of the run in ms. */
  durationMs: number;
  /** Machine-readable error code if `ok === false`. */
  errorCode?:
    | 'TIMEOUT'
    | 'RUNTIME_ERROR'
    | 'SYNTAX_ERROR'
    | 'LOAD_FAILED'
    | 'ABORTED'
    | 'UNKNOWN';
  /** Session / message pairing (echoed from request). */
  sessionId?: string;
  messageId?: string;
}

/**
 * Internal worker/iframe message protocol.
 * These never leave the browser — `BrowserExec*` are the wire types.
 */
export type WorkerInboundMessage =
  | { type: 'init'; pyodideIndexURL?: string }
  | { type: 'run'; requestId: string; code: string; timeoutMs: number };

export type WorkerOutboundMessage =
  | { type: 'ready'; version: string }
  | {
      type: 'stdout' | 'stderr';
      requestId: string;
      chunk: string;
    }
  | {
      type: 'result';
      requestId: string;
      ok: boolean;
      returnValue?: string;
      images?: Array<{ mime: string; base64: string }>;
      errorCode?: BrowserExecResult['errorCode'];
    }
  | { type: 'load_failed'; error: string };

/**
 * Max payload sizes enforced by the sandbox. Silent-cap on overflow:
 * stdout/stderr trims to the last `STDOUT_CAP` chars, images are dropped
 * one at a time from the end until under `IMAGE_CAP_BYTES` total.
 */
export const SANDBOX_LIMITS = {
  DEFAULT_TIMEOUT_MS: 5000,
  MAX_TIMEOUT_MS: 30000,
  STDOUT_CAP: 32_000,
  STDERR_CAP: 8_000,
  IMAGE_CAP_BYTES: 2 * 1024 * 1024,
} as const;
