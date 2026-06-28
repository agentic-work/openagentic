import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { requireAllExportsFrom } from '../../invariants/requireAllExportsFrom';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const REGISTRY =
  'services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts';

function manifest(ids: string[]): DocManifest {
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
        items: ids.map((id) => ({ id, name: id, description: 'd' })),
      },
    ],
  };
}

describe('requireAllExportsFrom (real source)', () => {
  it('passes when manifest has an item for every const returned by getAllBaseTools()', async () => {
    const src = await readFile(resolve(REPO_ROOT, REGISTRY), 'utf-8');
    const fnMatch = src.match(
      /export function getAllBaseTools[\s\S]*?return\s*\[([\s\S]*?)\];/,
    );
    expect(fnMatch).not.toBeNull();
    const refs = fnMatch![1].match(/\b([A-Z][A-Z0-9_]+|[a-z][a-zA-Z]*Tool)\b/g) ?? [];
    const normalized = refs.map((r) => (r === 'taskTool' ? 'TASK_TOOL' : r));
    const allConsts = Array.from(new Set(normalized));

    const inv = requireAllExportsFrom(REGISTRY, 'getAllBaseTools');
    const result = await inv(manifest(allConsts), REPO_ROOT);
    expect(result.ok).toBe(true);
  });

  it('fails listing missing exports', async () => {
    const inv = requireAllExportsFrom(REGISTRY, 'getAllBaseTools');
    const result = await inv(manifest(['TOOL_SEARCH_TOOL']), REPO_ROOT);
    expect(result.ok).toBe(false);
    expect(result.missing!.length).toBeGreaterThan(0);
  });
});
