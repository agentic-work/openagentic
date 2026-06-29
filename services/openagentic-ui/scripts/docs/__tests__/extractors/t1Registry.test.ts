import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { t1Registry } from '../../extractors/t1Registry';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const REGISTRY_PATH =
  'services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts';

describe('t1Registry extractor (real source)', () => {
  let manifest: DocManifest;
  let realToolNames: string[];

  beforeAll(async () => {
    const src = await readFile(resolve(REPO_ROOT, REGISTRY_PATH), 'utf-8');
    const fnMatch = src.match(
      /export function getAllBaseTools[\s\S]*?return\s*\[([\s\S]*?)\];/,
    );
    expect(fnMatch).not.toBeNull();
    const refs = fnMatch![1].match(/\b([A-Z][A-Z0-9_]+|[a-z][a-zA-Z]*Tool)\b/g) ?? [];
    const normalized = refs.map((r) => (r === 'taskTool' ? 'TASK_TOOL' : r));
    realToolNames = Array.from(new Set(normalized));

    const extractor = t1Registry({
      path: REGISTRY_PATH,
      exportName: 'getAllBaseTools',
    });
    manifest = await extractor(REPO_ROOT);
  });

  it('discovers at least 10 T1 tools in the registry source', () => {
    expect(realToolNames.length).toBeGreaterThanOrEqual(10);
  });

  it('produces one item per constant referenced in getAllBaseTools()', () => {
    const totalItems = manifest.sections.reduce(
      (sum, s) => sum + s.items.length,
      0,
    );
    expect(totalItems).toBe(realToolNames.length);
  });

  it('every tool item has non-empty description', () => {
    for (const section of manifest.sections) {
      for (const item of section.items) {
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('manifest domain is t1-tools and category is core', () => {
    expect(manifest.domain).toBe('t1-tools');
    expect(manifest.category).toBe('core');
  });

  it('resolves the tool human name (e.g. tool_search) for at least 70% of tools', () => {
    const allItems = manifest.sections.flatMap((s) => s.items);
    // The "name" should be the snake_case tool function name, not the CONST name
    const lowercaseNames = allItems.filter((i) => i.name === i.name.toLowerCase());
    expect(lowercaseNames.length / allItems.length).toBeGreaterThanOrEqual(0.7);
  });
});
