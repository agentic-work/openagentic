/**
 * document_loader node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeDocumentLoaderNode.
 * Fetches content from a URL (or passes through inline input), with
 * optional HTML stripping for LLM-friendly text.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosGet } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const sourceType = (node.data as any)?.sourceType || 'url';
  const inputObj = (input || {}) as any;
  const url =
    ctx.interpolateTemplate((node.data as any)?.url || '', input) ||
    (typeof input === 'string' ? input : inputObj?.url || inputObj?.source || '');
  const parseMode = (node.data as any)?.parseMode || 'auto';

  ctx.logger.info(
    { nodeId: node.id, sourceType, url: url?.slice(0, 100) },
    '[document_loader] Loading',
  );

  if (sourceType === 'url' && url) {
    const response = await abortableAxiosGet({ signal: ctx.signal }, url, {
      timeout: 30000,
      responseType: 'text',
      headers: { Accept: 'text/html,application/json,text/plain,*/*' },
      validateStatus: () => true,
    });

    let content =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2);

    if (parseMode === 'text' || (parseMode === 'auto' && content.includes('<html'))) {
      content = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return {
      content,
      source: url,
      sourceType,
      contentLength: content.length,
      mimeType: response.headers['content-type'] || 'text/plain',
    };
  }

  // Non-URL sources: pass through input content.
  const content =
    typeof input === 'string'
      ? input
      : inputObj?.content || inputObj?.text || JSON.stringify(input);
  return {
    content,
    source: sourceType,
    sourceType,
    contentLength: typeof content === 'string' ? content.length : 0,
  };
}
