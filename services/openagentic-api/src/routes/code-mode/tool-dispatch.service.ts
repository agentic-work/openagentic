import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import type { Logger } from 'pino';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import { featureFlags } from '../../config/featureFlags.js';

export interface ToolDispatchResult {
  /** tool_use_id the caller passed in, echoed back for correlation. */
  toolUseId: string;
  /** Tool result payload on success (stringifiable). */
  result?: unknown;
  /** Error message on failure. Mutually exclusive with result. */
  error?: string;
  /** True if the tool ran but reported an error (is_error in Anthropic terms). */
  isError?: boolean;
  /** Total ms spent in the HTTP round-trip (dispatch + execution). */
  durationMs: number;
}

/**
 * Compute the 12-char sha256-prefix userHash used in the exec pod
 * service name. Same algorithm used by server.ts:2218-2223 for the
 * existing /api/code/ws/chat proxy.
 */
function computeUserHash(userId: string): string {
  return crypto
    .createHash('sha256')
    .update(userId)
    .digest('hex')
    .substring(0, 12);
}

/**
 * Build the internal URL for the exec pod's tool execution endpoint.
 * Cluster-internal only — never exposed externally; no TLS needed.
 */
function buildExecPodUrl(userId: string): string {
  const userHash = computeUserHash(userId);
  const namespace = featureFlags.k8sNamespace;
  const service = `openagentic-${userHash}-svc`;
  return `http://${service}.${namespace}.svc.cluster.local:3060/tool-exec`;
}

/**
 * Dispatch a single tool call to the user's exec pod and await the
 * result. Never throws — all errors are captured into the returned
 * ToolDispatchResult so the agentic loop can format them as
 * tool_result blocks and continue (mirrors how chat mode handles
 * tool failures).
 */
export async function executeToolViaPod(
  userId: string,
  toolName: string,
  input: unknown,
  toolUseId: string,
  logger: Logger,
): Promise<ToolDispatchResult> {
  const start = Date.now();
  const url = buildExecPodUrl(userId);
  // getInternalKey() reads the projected secret first and falls back
  // through CODE_MANAGER_INTERNAL_KEY / OPENAGENTIC_INTERNAL_KEY /
  // INTERNAL_API_KEY env vars when the file is missing.
  const internalKey = getInternalKey();

  const body = {
    tool_name: toolName,
    input,
    tool_use_id: toolUseId,
    user_id: userId,
  };

  try {
    logger.debug(
      { toolName, toolUseId, url: url.replace(/^http:\/\/[^/]+/, 'http://***') },
      '[codemode-v2] dispatching tool to exec pod',
    );

    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': internalKey,
      },
      timeout: 60_000,
      // Accept any 2xx/4xx — we want to map 4xx into structured errors,
      // not axios-thrown exceptions. 5xx still throws and is caught
      // in the catch block below.
      validateStatus: (status) => status < 500,
    });

    const durationMs = Date.now() - start;

    if (response.status >= 400) {
      const errText =
        typeof response.data?.error === 'string'
          ? response.data.error
          : JSON.stringify(response.data?.error ?? response.data ?? {});
      logger.warn(
        { toolName, toolUseId, status: response.status, errText },
        '[codemode-v2] exec pod returned 4xx',
      );
      return {
        toolUseId,
        error: `Tool execution failed (HTTP ${response.status}): ${errText}`,
        isError: true,
        durationMs,
      };
    }

    // Happy path. Exec pod returns `{tool_use_id, result, error?}`.
    const data = response.data ?? {};
    if (data.error !== undefined && data.error !== null) {
      return {
        toolUseId,
        error: typeof data.error === 'string' ? data.error : JSON.stringify(data.error),
        isError: true,
        durationMs,
      };
    }
    return {
      toolUseId,
      result: data.result,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const axiosErr = err as AxiosError;
    const msg =
      axiosErr.code === 'ECONNABORTED'
        ? `Tool '${toolName}' timed out after 60s`
        : axiosErr.code === 'ENOTFOUND' || axiosErr.code === 'ECONNREFUSED'
          ? `Exec pod unreachable (${axiosErr.code}) — pod may be starting or has crashed`
          : axiosErr.message || String(err);
    logger.error(
      { toolName, toolUseId, err: msg, code: axiosErr.code },
      '[codemode-v2] tool dispatch failed',
    );
    return {
      toolUseId,
      error: msg,
      isError: true,
      durationMs,
    };
  }
}
