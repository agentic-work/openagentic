/**
 * text_splitter node — Phase E1 primitive contract.
 *
 * Public contract: pure-compute chunking. No HTTP. Returns
 * `{ chunks: Chunk[], totalChunks, originalLength }` where each chunk has
 * `{ content, index, metadata:{strategy, chunkSize} }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('text_splitter node — recursive + fixed strategies', () => {
  it('splits a long string into multiple chunks via the recursive strategy', async () => {
    const text = ('Paragraph one. ' + 'Sentence here. '.repeat(20)).trim();

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ts',
            type: 'text_splitter',
            data: { strategy: 'recursive', chunkSize: 80, chunkOverlap: 10 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ts' }],
      },
      input: text,
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ts as {
      chunks: Array<{ content: string; index: number; metadata: { strategy: string; chunkSize: number } }>;
      totalChunks: number;
      originalLength: number;
    };
    expect(out.totalChunks).toBeGreaterThan(1);
    expect(out.originalLength).toBe(text.length);
    expect(out.chunks[0].metadata.strategy).toBe('recursive');
    expect(out.chunks[0].metadata.chunkSize).toBe(80);
    expect(out.chunks[0].content.length).toBeGreaterThan(0);
  });

  it('splits via the fixed strategy when configured', async () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ts',
            type: 'text_splitter',
            data: { strategy: 'fixed', chunkSize: 10, chunkOverlap: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ts' }],
      },
      input: text,
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ts as {
      chunks: Array<{ content: string; metadata: { strategy: string } }>;
    };
    // 36 chars / 10-char chunks = 4 chunks
    expect(out.chunks.length).toBe(4);
    expect(out.chunks.every((c) => c.metadata.strategy === 'fixed')).toBe(true);
  });
});
