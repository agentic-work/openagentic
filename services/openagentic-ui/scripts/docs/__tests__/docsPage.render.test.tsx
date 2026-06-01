/**
 * Docs page render test — mounts the actual DocsContent React component
 * with every generated manifest as input, asserts the page renders without
 * throwing.
 *
 * This is Layer 3 of the test harness (per the design spec):
 *   - Layer 1: extractor unit tests (each extractor vs real source)
 *   - Layer 2: manifest integration (every domain's invariants vs source)
 *   - Layer 3: docs page render (UI ingests generated JSON without choking)
 *
 * Catches the "JSON is valid but the page chokes on it" class of bug — e.g.
 * a section without items causing a `.map` on undefined, or a missing icon
 * crashing an icon-resolution lookup.
 *
 * Mounts via @testing-library/react + Zustand setState pre-population
 * (the store's API supports this for testing).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { resolve } from 'path';
import { readFile, readdir } from 'fs/promises';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { useDocsStore } from '@/stores/useDocsStore';
import { DocsContent } from '@/features/docs/components/DocsContent';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const GENERATED_DIR = resolve(process.cwd(), 'public/docs/generated');

interface LoadedDoc {
  domain: string;
  manifest: any;
}

async function loadAllGenerated(): Promise<LoadedDoc[]> {
  const files = (await readdir(GENERATED_DIR)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json',
  );
  const docs: LoadedDoc[] = [];
  for (const f of files) {
    const content = await readFile(resolve(GENERATED_DIR, f), 'utf-8');
    const parsed = JSON.parse(content);
    docs.push({ domain: parsed.domain, manifest: parsed });
  }
  return docs;
}

describe('docs page renders every generated manifest without crashing', () => {
  let docs: LoadedDoc[];

  beforeAll(async () => {
    docs = await loadAllGenerated();
  });

  afterEach(() => {
    cleanup();
  });

  it('loads every generated manifest JSON from disk (one per DOMAINS entry)', () => {
    // The unified generator (scripts/docs/manifest.ts → DOMAINS) emits one
    // manifest per source-derived domain. Pin a sane floor so an accidental
    // domain drop is caught, without hardcoding the exact count.
    expect(docs.length).toBeGreaterThanOrEqual(8);
  });

  it.each([] as Array<[string, any]>)(
    'mounts DocsContent with %s manifest without throwing',
    () => {
      /* placeholder — replaced by dynamic test loop below */
    },
  );
});

// Use a separate `describe` so we can await docs before defining tests
describe('docs page mount — per-domain smoke', async () => {
  const docs = await loadAllGenerated();

  afterEach(() => {
    cleanup();
  });

  it.each(docs.map((d) => [d.domain, d] as const))(
    '%s manifest mounts without error and renders the title',
    async (_domain, doc) => {
      // Pre-populate the Zustand store with this manifest
      useDocsStore.setState({
        currentDomain: doc.manifest.domain,
        currentSectionId: null,
        loadedManifests: new Map([[doc.manifest.domain, doc.manifest]]),
        index: {
          domains: [
            {
              domain: doc.manifest.domain,
              title: doc.manifest.title,
              description: doc.manifest.description,
              category: doc.manifest.category,
              icon: doc.manifest.icon,
              file: `${doc.manifest.domain}.json`,
              sectionCount: doc.manifest.sections.length,
              itemCount: doc.manifest.sections.reduce(
                (sum: number, s: any) => sum + s.items.length,
                0,
              ),
              adminOnly: false,
            },
          ],
          categories: [],
          totalDomains: 1,
          totalItems: 0,
          generatedAt: new Date().toISOString(),
        } as any,
      });

      const { container } = render(React.createElement(DocsContent));

      // The page mounted; no React error boundary triggered
      expect(container.textContent).not.toContain('Something went wrong');
      // Title should appear somewhere in the rendered DOM
      expect(container.textContent).toContain(doc.manifest.title);
    },
  );
});
