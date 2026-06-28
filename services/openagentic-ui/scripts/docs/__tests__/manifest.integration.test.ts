/**
 * Manifest integration test — runs every domain's extractor + invariants
 * against live monorepo source.
 *
 * This is THE test that catches doc staleness: if anyone adds a new MCP,
 * new T1 tool, or new chat pipeline file and the unified generator doesn't
 * pick it up, the relevant requireAll* invariant fails here BEFORE the
 * change can merge.
 *
 * Per feedback_no_synthetic_chunks_only_real_provider_captures — every
 * extractor runs against real source, no synthetic fixtures.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { DOMAINS } from '../manifest';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe.each(DOMAINS.map((d) => [d.domain, d] as const))(
  'domain: %s',
  (_name, domain) => {
    it('extractor returns a well-formed DocManifest', async () => {
      const manifest = await domain.extractor(REPO_ROOT);
      expect(manifest.domain).toBe(domain.domain);
      expect(manifest.title).toBeTruthy();
      expect(Array.isArray(manifest.sections)).toBe(true);
      expect(typeof manifest.generatedAt).toBe('string');
    });

    it('every section has unique id', async () => {
      const manifest = await domain.extractor(REPO_ROOT);
      const ids = manifest.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    if (domain.invariants.length > 0) {
      it.each(domain.invariants.map((inv, i) => [i, inv] as const))(
        'invariant %i passes against live source',
        async (_i, invariant) => {
          const manifest = await domain.extractor(REPO_ROOT);
          const result = await invariant(manifest, REPO_ROOT);
          expect(
            result.ok,
            `${result.message}${
              result.missing
                ? ` (missing: ${result.missing.slice(0, 5).join(', ')})`
                : ''
            }`,
          ).toBe(true);
        },
      );
    }
  },
);
