/**
 * file_upload node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeFileUploadNode.
 * POSTs raw content + chunking parameters to /api/files/embed for
 * server-side chunking and Milvus embedding.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    collection = 'default',
    content: fileContent,
    fileName,
    chunkSize = 512,
    chunkOverlap = 50,
    metadata,
  } = node.data as Record<string, any>;

  const resolvedCollection = ctx.interpolateTemplate(collection, input);
  const resolvedContent = ctx.interpolateTemplate(fileContent || '', input);
  const resolvedFileName = ctx.interpolateTemplate(fileName || 'workflow-upload', input);

  // Content can come from node config or from upstream input.
  const inputObj = (input || {}) as any;
  const contentToEmbed =
    resolvedContent ||
    (typeof input === 'string' ? input : inputObj?.content || inputObj?.text || '');

  if (!contentToEmbed) {
    throw new Error('File upload node requires content to embed');
  }

  ctx.logger.info(
    {
      nodeId: node.id,
      collection: resolvedCollection,
      contentLength: contentToEmbed.length,
      chunkSize,
    },
    '[file_upload] Executing',
  );

  let resolvedMetadata: unknown;
  if (metadata) {
    if (typeof metadata === 'string') {
      try {
        resolvedMetadata = JSON.parse(ctx.interpolateTemplate(metadata, input));
      } catch {
        resolvedMetadata = undefined;
      }
    } else {
      resolvedMetadata = metadata;
    }
  }

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${ctx.apiUrl}/api/files/embed`,
    {
      collection: resolvedCollection,
      content: contentToEmbed,
      fileName: resolvedFileName,
      chunkSize,
      chunkOverlap,
      metadata: resolvedMetadata,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        ...ctx.getInternalAuthHeaders(),
      },
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  if (response.status >= 400) {
    const data: any = response.data;
    throw new Error(
      `File upload/embed failed: ${data?.error || response.statusText}`,
    );
  }

  const data: any = response.data || {};
  return {
    collection: resolvedCollection,
    fileName: resolvedFileName,
    chunkCount: data.chunkCount || data.chunks || 0,
    status: 'embedded',
    ...data,
  };
}
