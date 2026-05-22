/**
 * embedding node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeEmbeddingNode.
 * POSTs to the platform's /api/v1/embeddings endpoint with a fallback
 * to /api/v1/vector/embed on primary failure.
 *
 * Note: no model literal is hardcoded here — when `model` is blank the
 * platform's API decides the default. This keeps us compliant with the
 * platform-wide "no hardcoded models in source" rule.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const model = ctx.interpolateTemplate((node.data as any)?.model || '', input);
  const batchSize = (node.data as any)?.batchSize || 100;

  // Accept array of chunks, plain array, or single text.
  let texts: string[];
  const inputObj = (input || {}) as any;
  if (Array.isArray(inputObj?.chunks)) {
    texts = inputObj.chunks.map((c: any) => (typeof c === 'string' ? c : c.content));
  } else if (Array.isArray(input)) {
    texts = (input as any[]).map((i: any) =>
      typeof i === 'string' ? i : i.content || JSON.stringify(i),
    );
  } else {
    texts = [
      typeof input === 'string'
        ? input
        : inputObj?.content || inputObj?.text || JSON.stringify(input),
    ];
  }

  ctx.logger.info(
    { nodeId: node.id, model, textCount: texts.length },
    '[embedding] Generating',
  );

  return withGenAISpan(
    {
      operation: 'embeddings',
      system: 'openagentic.platform',
      requestModel: model || 'auto',
    },
    async () => {
      const response = await abortableAxiosPost(
        { signal: ctx.signal },
        `${ctx.apiUrl}/api/v1/embeddings`,
        { input: texts.slice(0, batchSize), model },
        {
          headers: ctx.getInternalAuthHeaders(),
          timeout: 60000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 400) {
        // Fallback: vector/embed endpoint.
        const fallback = await abortableAxiosPost(
          { signal: ctx.signal },
          `${ctx.apiUrl}/api/v1/vector/embed`,
          { texts, model },
          {
            headers: ctx.getInternalAuthHeaders(),
            timeout: 60000,
            validateStatus: () => true,
          },
        );
        const fbData: any = fallback.data || {};
        const out = {
          vectors: fbData.embeddings || [],
          model,
          count: texts.length,
          dimensions: fbData.dimensions || (fbData.embeddings?.[0]?.length ?? 0),
          texts,
        };
        return {
          result: out,
          meta: {
            responseModel: (fbData.model as string | undefined) ?? model,
            inputTokens: (fbData.usage?.total_tokens as number | undefined) ?? texts.length,
            outputTokens: 0,
          },
        };
      }

      const data: any = response.data || {};
      const embeddings: number[][] =
        data.data?.map((d: any) => d.embedding) || data.embeddings || [];
      const out = {
        vectors: embeddings,
        model,
        count: texts.length,
        dimensions: embeddings[0]?.length || 0,
        texts,
      };
      return {
        result: out,
        meta: {
          responseModel: (data.model as string | undefined) ?? model,
          // OpenAI embeddings response: usage.total_tokens (no separate
          // input/output split for embeddings). Bin everything as input.
          inputTokens: (data.usage?.total_tokens as number | undefined) ?? 0,
          outputTokens: 0,
        },
      };
    },
  );
}
