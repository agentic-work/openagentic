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
import {
  classifyInternalHost,
  assertEgressAllowed,
  filterResponseHeaders,
  EgressBlockedError,
} from './urlGuard.js';

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

  // ---------------------------------------------------------------------------
  // SSRF + internal-secret-leak hardening (mirrors WorkflowExecutionEngine S4).
  //
  // 1) Parse the URL with `new URL(...)` and classify the HOSTNAME component
  //    against an exact internal-service allowlist. This replaces the old
  //    substring check (`resolvedUrl.includes('openagentic-api')`) which let
  //    `https://attacker.com/openagentic-api/x` masquerade as internal and
  //    leak the X-Internal-Secret to attacker infra.
  //
  // 2) Run the SSRF egress gate BEFORE issuing the request: reject non-http(s)
  //    schemes and any target resolving to a private / loopback / link-local /
  //    cloud-metadata IP. Internal-allowlisted hosts are exempt (they resolve
  //    to cluster-private IPs by design).
  // ---------------------------------------------------------------------------
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolvedUrl);
  } catch {
    throw new Error(`HTTP request failed: invalid URL: ${resolvedUrl}`);
  }

  const isInternalUrl = classifyInternalHost(parsedUrl);

  try {
    await assertEgressAllowed(parsedUrl, { isInternal: isInternalUrl });
  } catch (error) {
    if (error instanceof EgressBlockedError) {
      // Surface a clear node error; never fall through to the request.
      throw new Error(error.message);
    }
    throw error;
  }

  // Auto-inject internal auth ONLY for genuinely-internal hosts (strict host
  // match above), and only when the caller hasn't supplied auth itself.
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

  // Filter sensitive response headers (set-cookie, authorization,
  // www-authenticate, x-internal-*, etc.) before surfacing them into the flow
  // output — otherwise a flow author could exfiltrate auth material echoed by
  // an upstream service.
  const result: Record<string, any> = {
    status: response.status,
    statusText: response.statusText,
    headers: filterResponseHeaders(response.headers),
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
