/**
 * save_file node executor — persist content to the artifact store.
 *
 * Wraps `ctx.persistArtifact` (same hook webhook_response uses for
 * `persistAsArtifact: true`). The hook delegates to the api's
 * ArtifactService, which writes to whichever BlobStorageService backend
 * is configured (MinIO on chat-dev, S3/GCS/Azure on cloud envs).
 *
 * Text-mode only for now. Binary mode (Buffer / BinaryRef) lands when
 * the binary data plane (Tier 2 #5) ships — see
 * services/shared/workflow-engine/src/binary/types.ts.
 *
 * Returns `{ artifactId, url, sizeBytes, mimeType, filename, title }`
 * so downstream nodes can deep-link to the persisted file in Slack /
 * email / UI artifact rails.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  svg: 'image/svg+xml',
};

function deriveMimeFromFilename(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return (m && MIME_BY_EXT[m[1]]) || 'text/plain';
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const contentRaw = data.content;
  const filenameRaw = data.filename;
  if (contentRaw == null || contentRaw === '') {
    throw new Error('save_file requires `content`.');
  }
  if (!filenameRaw) {
    throw new Error('save_file requires `filename`.');
  }

  // Interpolate templates and normalize content to a string. Objects /
  // arrays get JSON.stringify'd with 2-space indent for readability when
  // the artifact lands in the library.
  let content: string;
  if (typeof contentRaw === 'string') {
    content = ctx.interpolateTemplate(contentRaw, input);
  } else {
    content = JSON.stringify(contentRaw, null, 2);
  }

  const filename = ctx.interpolateTemplate(String(filenameRaw), input);
  const explicitMime = data.mimeType
    ? ctx.interpolateTemplate(String(data.mimeType), input)
    : '';
  const mimeType = explicitMime || deriveMimeFromFilename(filename);

  const title = data.title
    ? ctx.interpolateTemplate(String(data.title), input)
    : filename;
  const description = data.description
    ? ctx.interpolateTemplate(String(data.description), input)
    : undefined;

  const tagsRaw = data.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) =>
        typeof t === 'string' ? ctx.interpolateTemplate(t, input) : String(t),
      )
    : ['save_file'];

  const sizeBytes = Buffer.byteLength(content, 'utf8');

  ctx.logger.info(
    {
      nodeId: node.id,
      filename,
      mimeType,
      sizeBytes,
      title,
      tags,
    },
    '[save_file] Persisting content to artifact store',
  );

  if (!ctx.persistArtifact) {
    throw new Error(
      'save_file: engine does not provide ctx.persistArtifact — the host runtime must wire the hook (see webhook_response for the canonical pattern).',
    );
  }

  let artifactId: string | null;
  try {
    artifactId = await ctx.persistArtifact({
      title,
      description,
      mimeType,
      body: content,
      tags,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`save_file: persistArtifact failed — ${message}`);
  }

  if (!artifactId) {
    throw new Error(
      'save_file: persistArtifact returned no artifact id (host runtime returned null/undefined).',
    );
  }

  // The persistArtifact hook returns just the id; the canonical URL is
  // `/api/artifacts/<id>/download` for the body and `/artifacts/<id>` for
  // the UI deep-link. We emit the API path (programmatic consumers)
  // and let the caller compose the UI URL from `trigger.ui_base` etc.
  const url = `/api/artifacts/${artifactId}/download`;

  return {
    artifactId,
    url,
    sizeBytes,
    mimeType,
    filename,
    title,
  };
}
