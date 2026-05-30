import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tsConstExport } from '../../extractors/tsConstExport';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('tsConstExport extractor (real source)', () => {
  it('extracts every top-level `export const` from a real file with wildcard', async () => {
    const extractor = tsConstExport({
      domain: 'composable-prompts',
      title: 'Composable Prompts',
      description: 'Prompt modules',
      icon: 'pen',
      category: 'core',
      path: 'services/openagentic-api/src/services/prompt/getSystemPromptForRole.ts',
      exportName: '*',
    });
    const manifest = await extractor(REPO_ROOT);
    expect(manifest.domain).toBe('composable-prompts');
    expect(manifest.sections.length).toBeGreaterThanOrEqual(1);
    const totalItems = manifest.sections.reduce((s, sec) => s + sec.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(1);
  });
});
