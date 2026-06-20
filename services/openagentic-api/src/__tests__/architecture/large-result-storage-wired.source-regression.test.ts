/**
 * Architecture gate (2026-05-11): LargeResultStorage adapter MUST be wired
 * end-to-end through the chat pipeline so enterprise-scale tool results
 * (multi-MB cloud-list aggregates) overflow to Redis instead of bloating
 * the model context.
 *
 * the design notes
 *
 * Wires checked (in order):
 *   1. RunChatDeps surface has `largeResultStorage` + `thresholdBytes`
 *      typed fields.
 *   2. buildChatV2Deps imports the LargeResultStorageService singleton
 *      accessor + constructs the splitter adapter wrapper.
 *   3. buildChatV2Deps populates `largeResultStorage` + `thresholdBytes`
 *      on the returned deps struct.
 *   4. runChat threads `deps.largeResultStorage` + `deps.thresholdBytes`
 *      into the V3DispatchDeps it hands to makeDispatch.
 *
 * Pure source-regression — reads files from disk so the gate works even
 * when Prisma client / tsc cannot compile. Mirrors the
 * compaction-wired-source-regression test pattern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiSrc = resolve(__dirname, '../..');

describe('arch: LargeResultStorage wired end-to-end (chat pipeline)', () => {
  it('RunChatDeps surfaces largeResultStorage + thresholdBytes', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/types.ts`, 'utf8');
    expect(src).toContain('largeResultStorage');
    expect(src).toContain('thresholdBytes');
    // Surfaces the SplitterLargeResultStorage shape from the splitter
    // module (so the splitter contract stays the single source of truth
    // and runChat hands the same adapter through).
    expect(src).toMatch(/SplitterLargeResultStorage/);
  });

  it('buildChatV2Deps imports getLargeResultStorageService + SplitterLargeResultStorage', () => {
    const src = readFileSync(`${apiSrc}/services/buildChatV2Deps.ts`, 'utf8');
    expect(src).toContain('getLargeResultStorageService');
    expect(src).toContain('SplitterLargeResultStorage');
  });

  it('buildChatV2Deps constructs the adapter and surfaces it on the returned deps struct', () => {
    const src = readFileSync(`${apiSrc}/services/buildChatV2Deps.ts`, 'utf8');
    // Adapter must call storeResult() — proves it delegates to the
    // Redis-backed service rather than buffering in-process.
    expect(src).toMatch(/svc\.storeResult\(/);
    // Returned deps struct carries the resolved values; greps for the
    // identifiers in the final RunChatDeps base assignment.
    expect(src).toMatch(/largeResultStorage:\s*resolvedLargeResultStorage/);
    expect(src).toMatch(/thresholdBytes:\s*resolvedThresholdBytes/);
  });

  it('runChat threads largeResultStorage + thresholdBytes into V3DispatchDeps', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/runChat.ts`, 'utf8');
    // The v3DispatchDeps literal must carry both fields off `deps`.
    expect(src).toMatch(/largeResultStorage:\s*deps\.largeResultStorage/);
    expect(src).toMatch(/thresholdBytes:\s*deps\.thresholdBytes/);
  });

  it('ToolEnvelopeSplitter forwards opts.toolName through to LargeResultStorage.put', () => {
    // Without `toolName`, every stored row carries the placeholder default
    // and `LargeResultStorageService.generateSummary` can't pick per-tool
    // chunking strategies. Pin: the splitter MUST pass tool.slug as
    // toolName when invoking `largeResultStorage.put`.
    const src = readFileSync(`${apiSrc}/services/ToolEnvelopeSplitter.ts`, 'utf8');
    expect(src).toMatch(/toolName:\s*opts\.tool\.slug/);
  });

  it('dispatchTool.ts passes v3Deps.largeResultStorage through to splitEnvelope', () => {
    const src = readFileSync(
      `${apiSrc}/routes/chat/pipeline/chat/dispatchTool.ts`,
      'utf8',
    );
    expect(src).toMatch(/largeResultStorage:\s*v3Deps\.largeResultStorage/);
    expect(src).toMatch(/thresholdBytes:\s*v3Deps\.thresholdBytes/);
  });
});
