/**
 * text_splitter node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeTextSplitterNode.
 * In-process text chunking. No HTTP — operates entirely on the input string.
 *
 * Strategies:
 *   - recursive: tries to break at separators near the chunk boundary
 *   - fixed:     pure fixed-size slices (separator-agnostic)
 *   - semantic:  alias for recursive (the legacy code uses the same path)
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

interface Chunk {
  content: string;
  index: number;
  metadata: { strategy: string; chunkSize: number };
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const strategy = data.strategy || 'recursive';
  const chunkSize = data.chunkSize ?? 512;
  const chunkOverlap = data.chunkOverlap ?? 50;
  const separators = data.separators || ['\n\n', '\n', '. ', ' '];

  const inputObj = (input || {}) as any;
  const text =
    typeof input === 'string'
      ? input
      : inputObj?.content ||
        inputObj?.text ||
        inputObj?.document ||
        (input && typeof input === 'object' ? JSON.stringify(input) : '');

  if (!text) {
    throw new Error('Text splitter requires text input');
  }

  ctx.logger.info(
    { nodeId: node.id, strategy, chunkSize, textLength: text.length },
    '[text_splitter] Splitting',
  );

  const chunks: Chunk[] = [];

  if (strategy === 'fixed') {
    const step = Math.max(1, chunkSize - chunkOverlap);
    for (let i = 0; i < text.length; i += step) {
      chunks.push({
        content: text.slice(i, i + chunkSize).trim(),
        index: chunks.length,
        metadata: { strategy: 'fixed', chunkSize },
      });
    }
  } else {
    // recursive (and semantic alias)
    let remaining: string = text;
    let index = 0;
    while (remaining.length > 0) {
      let end = Math.min(remaining.length, chunkSize);
      // Try to break at a separator
      if (end < remaining.length) {
        for (const sep of separators) {
          const lastSep = remaining.lastIndexOf(sep, end);
          if (lastSep > chunkSize * 0.5) {
            end = lastSep + sep.length;
            break;
          }
        }
      }
      chunks.push({
        content: remaining.slice(0, end).trim(),
        index,
        metadata: { strategy: 'recursive', chunkSize },
      });
      // If we consumed everything, we're done.
      if (end >= remaining.length) break;
      // Advance at least 1 char per iteration. When end <= chunkOverlap
      // the legacy slice(end - overlap) wouldn't progress; force forward.
      const advance = Math.max(1, end - chunkOverlap);
      remaining = remaining.slice(advance);
      index++;
      // Safety net — prevent runaway loops on degenerate inputs.
      if (chunks.length > text.length / Math.max(1, chunkSize - chunkOverlap) + 10) break;
    }
  }

  return {
    chunks,
    totalChunks: chunks.length,
    originalLength: text.length,
  };
}
