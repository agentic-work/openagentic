/**
 * webhook_response node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeWebhookResponseNode.
 * Behavior is preserved verbatim — same template interpolation,
 * same header parsing, same result shape.
 *
 * The legacy method set `this.context.webhookResponse` directly on the engine.
 * After migration, the executor calls the optional `ctx.setWebhookResponse`
 * hook (wired up by the engine in runRegistryNode). This keeps the executor
 * testable without coupling it to the engine class.
 *
 * 2026-05-14 — added optional artifact-persistence behavior. When
 * `node.data.persistAsArtifact === true`, the executor also calls
 * `ctx.persistArtifact(...)` so the rendered body lands in the artifacts
 * library. Backward compatible: every existing flow that does not set
 * the flag is untouched.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    statusCode,
    headers,
    bodyTemplate,
    persistAsArtifact,
    artifactTitle,
    artifactDescription,
    artifactTags,
    artifactKind,
  } = node.data as Record<string, any>;

  const resolvedBody = bodyTemplate
    ? ctx.interpolateTemplate(bodyTemplate, input)
    : input;

  let resolvedHeaders: Record<string, string> = {};
  if (headers) {
    const headersStr =
      typeof headers === 'string' ? headers : JSON.stringify(headers);
    const interpolatedHeaders = ctx.interpolateTemplate(headersStr, input);
    try {
      resolvedHeaders = JSON.parse(interpolatedHeaders as string);
    } catch {
      // If parsing fails, fall back to empty headers.
      resolvedHeaders = {};
    }
  }

  const effectiveStatusCode = statusCode || 200;

  ctx.logger.info(
    { nodeId: node.id, statusCode: effectiveStatusCode },
    '[webhook_response] Executing webhook response node',
  );

  // Stash the response on the execution context via the hook.
  ctx.setWebhookResponse?.({
    statusCode: effectiveStatusCode,
    headers: resolvedHeaders,
    body: resolvedBody,
  });

  // ────────────────────────────────────────────────────────────────────
  // Artifact persistence (opt-in via persistAsArtifact: true)
  //
  // When enabled, the resolved body is written to the artifact_files table
  // so the artifacts library picks it up. The persist call never blocks
  // primary delivery — failures are logged and swallowed.
  // ────────────────────────────────────────────────────────────────────
  let artifactId: string | null | undefined;
  if (persistAsArtifact === true && ctx.persistArtifact) {
    // Find content-type, case-insensitive.
    const ctHeaderKey = Object.keys(resolvedHeaders).find(
      (k) => k.toLowerCase() === 'content-type',
    );
    const explicitMime = ctHeaderKey
      ? String(resolvedHeaders[ctHeaderKey]).split(';')[0].trim()
      : '';
    const mimeType =
      explicitMime ||
      (typeof resolvedBody === 'string'
        ? resolvedBody.trimStart().startsWith('<')
          ? 'text/html'
          : 'text/plain'
        : 'application/json');

    const bodyStr =
      typeof resolvedBody === 'string'
        ? resolvedBody
        : JSON.stringify(resolvedBody);

    const interpolatedTitle = artifactTitle
      ? ctx.interpolateTemplate(String(artifactTitle), input)
      : `Workflow output — ${ctx.executionId}`;

    const interpolatedDesc = artifactDescription
      ? ctx.interpolateTemplate(String(artifactDescription), input)
      : undefined;

    const tags = Array.isArray(artifactTags)
      ? artifactTags.map(String)
      : ['flow-output'];

    try {
      artifactId = await ctx.persistArtifact({
        title: interpolatedTitle,
        description: interpolatedDesc,
        mimeType,
        body: bodyStr,
        tags,
        kind: artifactKind ? String(artifactKind) : undefined,
      });
    } catch (err) {
      ctx.logger.warn(
        {
          nodeId: node.id,
          err: err instanceof Error ? err.message : String(err),
        },
        '[webhook_response] persistArtifact failed (non-fatal)',
      );
      artifactId = null;
    }
  }

  return {
    statusCode: effectiveStatusCode,
    body: resolvedBody,
    delivered: true,
    resolvedHeaders,
    ...(artifactId ? { artifactId } : {}),
  };
}
