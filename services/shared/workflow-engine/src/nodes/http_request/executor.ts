/**
 * http_request node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeHTTPRequestNode (lines ~1819-1920).
 * Behavior is preserved verbatim — same templating, same auto-injection of
 * internal-auth headers for in-cluster calls, same error wrapping.
 *
 * Difference from the legacy method: this version delegates non-2xx detection
 * to schema.outputAssertions instead of inline status checks. The
 * `acceptAllStatuses` setting (when true) skips the assertion by returning a
 * special wrapper that the assertion treats as success.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxios } from '../../abortableAxios.js';

/**
 * Recursively interpolate `{{...}}` template expressions inside an object
 * body. Strings hit `ctx.interpolateTemplate`; arrays + objects recurse;
 * primitives pass through. Lets callers ship a structured JSON body that
 * references upstream step outputs (e.g. POST /api/workflows with a
 * proposed_flow.definition pulled from `{{steps.structured.output...}}`).
 */
function interpolateDeep(
  value: unknown,
  input: unknown,
  ctx: NodeExecutionContext,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return ctx.interpolateTemplate(value, input);
  if (Array.isArray(value)) {
    return value.map((v) => interpolateDeep(v, input, ctx));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolateDeep(v, input, ctx);
    }
    return out;
  }
  return value;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    url,
    method = 'GET',
    headers: requestHeaders = {},
    body,
    timeout = 30000,
    responseType = 'json',
    acceptAllStatuses = false,
  } = node.data as Record<string, any>;

  // Interpolate variables in URL, headers, body
  const resolvedUrl = ctx.interpolateTemplate(url || '', input);
  const resolvedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(requestHeaders as Record<string, unknown>)) {
    if (typeof value === 'string') {
      resolvedHeaders[key] = ctx.interpolateTemplate(value, input);
    }
  }

  let resolvedBody: unknown = undefined;
  if (body && method !== 'GET' && method !== 'HEAD') {
    if (typeof body === 'string') {
      resolvedBody = ctx.interpolateTemplate(body, input);
      if (
        resolvedHeaders['Content-Type']?.includes('json') ||
        !resolvedHeaders['Content-Type']
      ) {
        try {
          resolvedBody = JSON.parse(resolvedBody as string);
        } catch {
          // keep as string when not JSON
        }
      }
    } else {
      resolvedBody = interpolateDeep(body, input, ctx);
    }
  }

  if (!resolvedUrl) {
    throw new Error('HTTP Request node requires a url');
  }

  // Auto-inject internal auth for in-cluster API calls (matches legacy behavior).
  const isInternalUrl =
    resolvedUrl.includes('openagentic-api') || resolvedUrl.includes('localhost:8000');
  if (
    isInternalUrl &&
    !resolvedHeaders['Authorization'] &&
    !resolvedHeaders['X-Internal-Secret']
  ) {
    Object.assign(resolvedHeaders, ctx.getInternalAuthHeaders());
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      method,
      url: resolvedUrl,
      isInternal: isInternalUrl,
    },
    '[http_request] Executing',
  );

  let response;
  try {
    response = await abortableAxios({ signal: ctx.signal }, {
      method: (method as string).toLowerCase(),
      url: resolvedUrl,
      headers: resolvedHeaders,
      data: resolvedBody,
      timeout,
      validateStatus: () => true, // never throw on non-2xx
    });
  } catch (error: any) {
    throw new Error(`HTTP request failed: ${error.message}`);
  }

  const result: Record<string, any> = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };

  if (responseType === 'text') {
    result.data =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
  } else {
    result.data = response.data;
  }

  // When the user opts in to non-2xx-as-success, tag the result so the
  // schema-level outputAssertion treats it as a pass. status is preserved.
  if (acceptAllStatuses) {
    result.acceptedAllStatuses = true;
  }

  return result;
}
