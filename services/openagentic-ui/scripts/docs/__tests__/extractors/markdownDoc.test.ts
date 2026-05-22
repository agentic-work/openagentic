import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { readdir } from 'fs/promises';
import { markdownDoc } from '../../extractors/markdownDoc';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('markdownDoc extractor (real source — docs/releases)', () => {
  let manifest: DocManifest;
  let realFiles: string[];

  beforeAll(async () => {
    realFiles = (await readdir(resolve(REPO_ROOT, 'docs/releases'))).filter(
      (f) => f.startsWith('v') && /^v\d/.test(f) && f.endsWith('.md'),
    );
    const extractor = markdownDoc({
      domain: 'release-notes',
      title: 'Release Notes',
      description: 'Platform release notes',
      icon: 'doc',
      category: 'core',
      pathOrGlob: 'docs/releases/v*.md',
      sectionFromHeading: 'h2',
    });
    manifest = await extractor(REPO_ROOT);
  });

  it('discovers at least 2 release-notes markdown files', () => {
    expect(realFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('produces one section per markdown file matched', () => {
    expect(manifest.sections.length).toBe(realFiles.length);
  });

  it('every section has non-empty description', () => {
    for (const section of manifest.sections) {
      expect(section.description.length).toBeGreaterThan(0);
    }
  });
});
