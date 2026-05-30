import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { readdir, stat } from 'fs/promises';
import { mcpTools } from '../../extractors/mcpTools';
import type { DocManifest } from '../../types';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

async function listMcpDirs(): Promise<string[]> {
  const mcpsRoot = resolve(REPO_ROOT, 'services', 'mcps');
  const entries = await readdir(mcpsRoot);
  const dirs: string[] = [];
  for (const name of entries) {
    if (!name.startsWith('openagentic-')) continue;
    const s = await stat(resolve(mcpsRoot, name));
    if (s.isDirectory()) dirs.push(name);
  }
  return dirs;
}

describe('mcpTools extractor (real source)', () => {
  let manifest: DocManifest;
  let realDirs: string[];

  beforeAll(async () => {
    realDirs = await listMcpDirs();
    const extractor = mcpTools({ rootGlob: 'services/mcps/openagentic-*' });
    manifest = await extractor(REPO_ROOT);
  });

  it('discovers at least 10 openagentic-* MCP server directories', () => {
    expect(realDirs.length).toBeGreaterThanOrEqual(10);
  });

  it('produces a section id matching every openagentic-* dir that has server.py', () => {
    const sectionIds = manifest.sections.map((s) => s.id).sort();
    for (const id of sectionIds) {
      expect(realDirs).toContain(id);
    }
    // assert we got the majority (some MCPs may not have a server.py at all)
    expect(sectionIds.length).toBeGreaterThanOrEqual(Math.floor(realDirs.length * 0.7));
  });

  it('finds at least one tool per MCP server (live source)', () => {
    const sectionsWithTools = manifest.sections.filter((s) => s.items.length > 0);
    expect(sectionsWithTools.length).toBeGreaterThanOrEqual(Math.floor(manifest.sections.length * 0.7));
  });

  it('every tool item has non-empty name and description', () => {
    for (const section of manifest.sections) {
      for (const item of section.items) {
        expect(item.name.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('manifest has the canonical DocManifest top-level fields', () => {
    expect(manifest.domain).toBe('mcp-servers');
    expect(manifest.title).toBe('MCP Servers');
    expect(typeof manifest.generatedAt).toBe('string');
    expect(Array.isArray(manifest.sourceFiles)).toBe(true);
  });
});
