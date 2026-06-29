/**
 * Phase E.10 (2026-05-10) — `RouterTuning.intentToTopK` is ripped
 * alongside the ToolRankerService rip (Phase E.2).
 *
 * The field was the per-intent top-K limit that ToolRankerService used
 * to subset the MCP tool array. With ToolRanker gone (Phase E.2 +
 * #607 cascade rip), `intentToTopK` has no consumer; the field +
 * type + defaults + validation + DB column all go.
 *
 * intentToFcaFloor was already ripped 2026-05-02 with the viz-tier
 * ladder rip; this test guards the second field's removal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('arch: RouterTuning.intentToTopK ripped (Phase E.10)', () => {
  it('RouterTuningService.ts source has no intentToTopK references', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'src', 'services', 'RouterTuningService.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bintentToTopK\b/);
    expect(src).not.toMatch(/\bIntentToTopK\b/);
  });

  it('prisma/schema.prisma has no intentToTopK column', () => {
    const src = readFileSync(join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    expect(src).not.toMatch(/^\s*intentToTopK\s+/m);
  });

  it('admin/router-tuning.ts has no intentToTopK Zod schema', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'src', 'routes', 'admin', 'router-tuning.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bintentToTopK\b/);
  });
});
