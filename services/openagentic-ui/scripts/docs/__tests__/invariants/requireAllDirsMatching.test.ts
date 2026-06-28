import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { readdir } from 'fs/promises';
import { requireAllDirsMatching } from '../../invariants/requireAllDirsMatching';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

function manifestWithSectionIds(sectionIds: string[]): DocManifest {
  return {
    domain: 'test',
    title: 'T',
    description: '',
    icon: '',
    category: '',
    generatedAt: '',
    sourceFiles: [],
    sections: sectionIds.map((id) => ({
      id,
      title: id,
      description: '',
      adminOnly: false,
      items: [],
    })),
  };
}

describe('requireAllDirsMatching (real source)', () => {
  it('passes when every matching dir has a corresponding section', async () => {
    const inv = requireAllDirsMatching('services/mcps/oap-*-mcp', { idFrom: 'dirname' });
    const dirs = (await readdir(resolve(REPO_ROOT, 'services/mcps'))).filter((d) =>
      /^oap-.*-mcp$/.test(d),
    );
    const result = await inv(manifestWithSectionIds(dirs), REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  it('fails listing missing dirs', async () => {
    const inv = requireAllDirsMatching('services/mcps/oap-*-mcp', { idFrom: 'dirname' });
    const result = await inv(manifestWithSectionIds(['oap-azure-mcp']), REPO_ROOT);
    expect(result.ok).toBe(false);
    expect(result.missing!.length).toBeGreaterThan(0);
  });
});
