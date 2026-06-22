import { resolve } from 'path';
import { readdir, stat } from 'fs/promises';
import type { InvariantFn } from '../types';

export interface DirMatchOptions {
  idFrom: 'dirname';
}

export function requireAllDirsMatching(globExpr: string, _options: DirMatchOptions): InvariantFn {
  return async (manifest, basePath) => {
    const parts = globExpr.split('/');
    const lastIdx = parts.findIndex((p) => p.includes('*'));
    if (lastIdx < 0) {
      return { ok: false, message: `glob has no wildcard: ${globExpr}` };
    }
    const parentRel = parts.slice(0, lastIdx).join('/');
    const pattern = new RegExp('^' + parts[lastIdx].replaceAll('*', '.*') + '$');
    const parentAbs = resolve(basePath, parentRel);

    let entries: string[];
    try {
      entries = await readdir(parentAbs);
    } catch {
      return { ok: false, message: `requireAllDirsMatching: parent dir not readable: ${parentRel}` };
    }

    const expectedIds: string[] = [];
    for (const e of entries) {
      if (!pattern.test(e)) continue;
      const s = await stat(resolve(parentAbs, e));
      if (s.isDirectory()) expectedIds.push(e);
    }

    const haveIds = new Set([
      ...manifest.sections.map((s) => s.id),
      ...manifest.sections.flatMap((s) => s.items.map((i) => i.id)),
    ]);
    const missing = expectedIds.filter((id) => !haveIds.has(id));

    if (missing.length === 0) {
      return {
        ok: true,
        message: `all ${expectedIds.length} dirs matching ${globExpr} represented`,
      };
    }
    return {
      ok: false,
      message: `requireAllDirsMatching(${globExpr}): ${missing.length}/${expectedIds.length} dirs missing`,
      missing,
    };
  };
}
