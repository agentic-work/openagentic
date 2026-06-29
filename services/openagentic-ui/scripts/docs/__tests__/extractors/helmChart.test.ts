import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { helmChart } from '../../extractors/helmChart';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('helmChart extractor (real source)', () => {
  it('discovers helm templates or returns placeholder section if chart absent', async () => {
    const extractor = helmChart({
      domain: 'helm-templates',
      title: 'Helm Templates',
      description: 'Kubernetes resource manifests',
      icon: 'infra',
      category: 'infrastructure',
      chartPath: 'helm/openagentic',
    });
    const manifest = await extractor(REPO_ROOT);
    expect(manifest.domain).toBe('helm-templates');
    expect(manifest.sections.length).toBeGreaterThanOrEqual(1);
  });
});
