import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { packageReadme } from '../../extractors/packageReadme';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('packageReadme extractor (real companion repo)', () => {
  it('produces a manifest (placeholder if companion absent, real sections if present)', async () => {
    const extractor = packageReadme({
      domain: 'llm-sdk',
      title: 'LLM SDK',
      description: 'openagentic-sdk',
      icon: 'pkg',
      category: 'ui',
      companion: 'openagentic-sdk',
    });
    const manifest = await extractor(REPO_ROOT);
    expect(manifest.domain).toBe('llm-sdk');
    expect(manifest.sections.length).toBeGreaterThanOrEqual(1);
  });
});
