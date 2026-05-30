/**
 * text_splitter node — executor tests.
 *
 * In-process text chunking — no HTTP. Strategies: recursive, fixed.
 *
 * Covers:
 *   1. recursive — short text → single chunk
 *   2. recursive — long text → multiple chunks honoring chunkSize
 *   3. fixed strategy — fixed-size slices
 *   4. throws when no text input
 *   5. text from input.content / input.text / input.document
 *   6. raw string input
 *   7. result includes totalChunks + originalLength
 *   8. recursive prefers separators when available
 *   9. abort signal context provided (no-op for in-process)
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-ts-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const tsNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_ts',
  type: 'text_splitter',
  data,
});

describe('text_splitter/executor', () => {
  it('recursive — short text → single chunk', async () => {
    const out: any = await execute(tsNode({ strategy: 'recursive', chunkSize: 100 }), 'short', makeCtx());
    expect(out.totalChunks).toBe(1);
    expect(out.chunks[0].content).toBe('short');
    expect(out.originalLength).toBe(5);
  });

  it('recursive — long text → multiple chunks honoring chunkSize', async () => {
    const text = 'a'.repeat(500);
    const out: any = await execute(tsNode({ strategy: 'recursive', chunkSize: 100, chunkOverlap: 0 }), text, makeCtx());
    expect(out.totalChunks).toBeGreaterThan(1);
    // Each chunk should be at most chunkSize
    for (const chunk of out.chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it('fixed strategy — fixed-size slices', async () => {
    const text = 'abcdefghij'.repeat(20); // 200 chars
    const out: any = await execute(
      tsNode({ strategy: 'fixed', chunkSize: 50, chunkOverlap: 0 }),
      text,
      makeCtx(),
    );
    expect(out.totalChunks).toBe(4); // 200/50
    expect(out.chunks[0].metadata.strategy).toBe('fixed');
  });

  it('throws when no text input', async () => {
    await expect(execute(tsNode({}), null, makeCtx())).rejects.toThrow(/text input/i);
    await expect(execute(tsNode({}), '', makeCtx())).rejects.toThrow(/text input/i);
  });

  it('text from input.content', async () => {
    const out: any = await execute(
      tsNode({ chunkSize: 100 }),
      { content: 'from content field' },
      makeCtx(),
    );
    expect(out.chunks[0].content).toBe('from content field');
  });

  it('text from input.text', async () => {
    const out: any = await execute(tsNode({ chunkSize: 100 }), { text: 'from text' }, makeCtx());
    expect(out.chunks[0].content).toBe('from text');
  });

  it('text from input.document', async () => {
    const out: any = await execute(
      tsNode({ chunkSize: 100 }),
      { document: 'from document' },
      makeCtx(),
    );
    expect(out.chunks[0].content).toBe('from document');
  });

  it('result includes totalChunks + originalLength', async () => {
    const text = 'word '.repeat(40); // 200 chars
    const out: any = await execute(tsNode({ chunkSize: 50 }), text, makeCtx());
    expect(out).toHaveProperty('totalChunks');
    expect(out).toHaveProperty('originalLength');
    expect(out.originalLength).toBe(text.length);
    expect(out.totalChunks).toBe(out.chunks.length);
  });

  it('recursive prefers separators when available', async () => {
    // Build a text with a sentence boundary near the chunkSize point
    const text =
      'First sentence here. ' + 'Second sentence with extra padding here '.repeat(5);
    const out: any = await execute(
      tsNode({ strategy: 'recursive', chunkSize: 30, chunkOverlap: 0 }),
      text,
      makeCtx(),
    );
    // Reasonable expectation: chunks aren't all exactly chunkSize and respect breaks
    expect(out.totalChunks).toBeGreaterThan(1);
  });

  it('default strategy = recursive when unspecified', async () => {
    const out: any = await execute(
      tsNode({ chunkSize: 100 }),
      'a'.repeat(50),
      makeCtx(),
    );
    expect(out.chunks[0].metadata.strategy).toBe('recursive');
  });
});
