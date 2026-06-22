import { resolve } from 'path';
import { readdir, stat } from 'fs/promises';
import type { InvariantFn } from '../types';

export interface FileSetOptions {
  excludeSuffixes?: string[];
}

export function requireFileSetMatches(
  globExpr: string,
  options: FileSetOptions = {},
): InvariantFn {
  return async (manifest, basePath) => {
    const parts = globExpr.split('/');
    const lastIdx = parts.findIndex((p) => p.includes('*'));
    if (lastIdx < 0) {
      return { ok: false, message: `requireFileSetMatches: glob has no wildcard: ${globExpr}` };
    }
    const parentRel = parts.slice(0, lastIdx).join('/');
    const pattern = new RegExp('^' + parts[lastIdx].replaceAll('*', '.*') + '$');
    const parentAbs = resolve(basePath, parentRel);

    let entries: string[];
    try {
      entries = await readdir(parentAbs);
    } catch {
      return {
        ok: false,
        message: `requireFileSetMatches: parent dir not readable: ${parentRel}`,
      };
    }

    const expectedFiles: string[] = [];
    for (const e of entries) {
      if (!pattern.test(e)) continue;
      if (options.excludeSuffixes?.some((suf) => e.endsWith(suf))) continue;
      const s = await stat(resolve(parentAbs, e));
      if (s.isFile()) expectedFiles.push(`${parentRel}/${e}`);
    }

    const sourceFileSet = new Set(
      manifest.sections
        .flatMap((s) => s.items.map((i) => i.sourceFile))
        .filter((sf): sf is string => !!sf),
    );
    const missing = expectedFiles.filter((f) => !sourceFileSet.has(f));

    if (missing.length === 0) {
      return {
        ok: true,
        message: `all ${expectedFiles.length} files matching ${globExpr} referenced`,
      };
    }
    return {
      ok: false,
      message: `requireFileSetMatches(${globExpr}): ${missing.length}/${expectedFiles.length} files not referenced`,
      missing,
    };
  };
}
