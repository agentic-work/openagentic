import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { readdir } from 'fs/promises';
import { requireFileSetMatches } from '../../invariants/requireFileSetMatches';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

function manifest(sourceFiles: string[]): DocManifest {
  return {
    domain: 't',
    title: 'T',
    description: '',
    icon: '',
    category: '',
    generatedAt: '',
    sourceFiles: [],
    sections: [
      {
        id: 's',
        title: 'S',
        description: '',
        adminOnly: false,
        items: sourceFiles.map((sf, i) => ({
          id: `i${i}`,
          name: `i${i}`,
          description: 'd',
          sourceFile: sf,
        })),
      },
    ],
  };
}

describe('requireFileSetMatches (real source)', () => {
  it('passes when every file matching the glob has an item referencing it', async () => {
    const inv = requireFileSetMatches(
      'services/openagentic-api/src/routes/chat/pipeline/chat/*.ts',
      { excludeSuffixes: ['.test.ts'] },
    );
    const dir = 'services/openagentic-api/src/routes/chat/pipeline/chat';
    const files = (await readdir(resolve(REPO_ROOT, dir)))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => `${dir}/${f}`);
    const result = await inv(manifest(files), REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  it('fails when a real source file is not referenced by any item', async () => {
    const inv = requireFileSetMatches(
      'services/openagentic-api/src/routes/chat/pipeline/chat/*.ts',
      { excludeSuffixes: ['.test.ts'] },
    );
    const result = await inv(manifest([]), REPO_ROOT);
    expect(result.ok).toBe(false);
    expect(result.missing!.length).toBeGreaterThan(0);
  });
});
