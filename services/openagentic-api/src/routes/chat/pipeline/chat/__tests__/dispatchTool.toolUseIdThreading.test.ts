/**
 * F1-5 (2026-05-12 audit): splitEnvelope was called with
 * `toolUseId: ''` at two sites (dispatchTool.ts:213, :409), even though
 * chatLoop stamps the real id on `ctx.toolUseId` at chatLoop.ts:601
 * before the dispatch call. The envelope's tool_use_id field carries
 * through to the persisted visualizations row + audit log; when blank,
 * UI/audit can't correlate the envelope back to the source tool_use
 * card.
 *
 * Fix: read `ctx.toolUseId` (when present) and pass it to splitEnvelope
 * at both sites. Falls back to '' when ctx doesn't carry it (e.g. some
 * legacy test paths).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'dispatchTool.ts');

describe('dispatchTool — splitEnvelope receives real toolUseId from ctx (F1-5)', () => {
  it('does NOT pass a hard-coded empty toolUseId to splitEnvelope', () => {
    const src = readFileSync(SRC, 'utf8');
    // Catch the literal regression: `toolUseId: ''` somewhere in the source.
    // Allow the legacy fallback wrapped in a ternary off ctx.toolUseId.
    const literalEmptyHits = (src.match(/toolUseId:\s*'',/g) || []).length;
    expect(literalEmptyHits).toBe(0);
  });

  it('reads toolUseId off ctx and threads to splitEnvelope', () => {
    const src = readFileSync(SRC, 'utf8');
    // The fix pattern: at both splitEnvelope call sites, the toolUseId
    // arg should look like `toolUseId: (ctx as any).toolUseId ?? ''`.
    expect(src).toMatch(/toolUseId:\s*\(ctx as any\)\.toolUseId/);
  });
});
