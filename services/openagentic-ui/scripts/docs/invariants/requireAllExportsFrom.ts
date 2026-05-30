import { resolve } from 'path';
import { readFile } from 'fs/promises';
import type { InvariantFn } from '../types';

export function requireAllExportsFrom(filePath: string, exportName: string): InvariantFn {
  return async (manifest, basePath) => {
    let src: string;
    try {
      src = await readFile(resolve(basePath, filePath), 'utf-8');
    } catch {
      return {
        ok: false,
        message: `requireAllExportsFrom: cannot read ${filePath}`,
      };
    }
    const fnRe = new RegExp(
      `export function ${exportName}[\\s\\S]*?return\\s*\\[([\\s\\S]*?)\\];`,
    );
    const fnMatch = src.match(fnRe);
    if (!fnMatch) {
      return {
        ok: false,
        message: `requireAllExportsFrom: ${exportName} not found in ${filePath}`,
      };
    }
    // Match SCREAMING_CASE consts AND camelCase `*Tool` identifiers.
    const refs = fnMatch[1].match(/\b([A-Z][A-Z0-9_]+|[a-z][a-zA-Z]*Tool)\b/g) ?? [];
    // Collapse aliases that map to SCREAMING_CASE imports (e.g. taskTool → TASK_TOOL)
    const normalized = refs.map((r) => (r === 'taskTool' ? 'TASK_TOOL' : r));
    const expected = Array.from(new Set(normalized));

    const haveIds = new Set(
      manifest.sections.flatMap((s) => s.items.map((i) => i.id)),
    );
    const haveNames = new Set(
      manifest.sections.flatMap((s) => s.items.map((i) => i.name)),
    );
    const missing = expected.filter(
      (e) => !haveIds.has(e) && !haveNames.has(e),
    );

    if (missing.length === 0) {
      return {
        ok: true,
        message: `all ${expected.length} exports from ${exportName} represented`,
      };
    }
    return {
      ok: false,
      message: `requireAllExportsFrom(${exportName}): ${missing.length}/${expected.length} exports missing`,
      missing,
    };
  };
}
