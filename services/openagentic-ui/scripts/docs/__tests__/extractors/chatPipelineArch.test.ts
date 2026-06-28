import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { readdir } from 'fs/promises';
import { chatPipelineArch } from '../../extractors/chatPipelineArch';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const PIPELINE_DIR =
  'services/openagentic-api/src/routes/chat/pipeline/chat';

describe('chatPipelineArch extractor (real source)', () => {
  let manifest: DocManifest;
  let realFiles: string[];

  beforeAll(async () => {
    realFiles = (await readdir(resolve(REPO_ROOT, PIPELINE_DIR))).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    const extractor = chatPipelineArch({ rootDir: PIPELINE_DIR });
    manifest = await extractor(REPO_ROOT);
  });

  it('discovers at least 6 pipeline source files', () => {
    expect(realFiles.length).toBeGreaterThanOrEqual(6);
  });

  it('every .ts file in pipeline/chat/ is represented as an item somewhere', () => {
    const allItemFiles = manifest.sections
      .flatMap((s) => s.items)
      .map((i) => i.sourceFile?.split('/').pop())
      .filter((s): s is string => !!s);
    for (const f of realFiles) {
      expect(allItemFiles).toContain(f);
    }
  });

  it('has three sections corresponding to the three architecture layers', () => {
    const titles = manifest.sections.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => t.includes('layer 1') || t.includes('session'))).toBe(true);
    expect(titles.some((t) => t.includes('layer 2') || t.includes('catalog') || t.includes('registry'))).toBe(true);
    expect(titles.some((t) => t.includes('layer 3') || t.includes('loop'))).toBe(true);
  });

  it('domain and category are correct', () => {
    expect(manifest.domain).toBe('chat-pipeline');
    expect(manifest.category).toBe('core');
  });

  it('produces items with non-empty descriptions', () => {
    for (const section of manifest.sections) {
      for (const item of section.items) {
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });
});
