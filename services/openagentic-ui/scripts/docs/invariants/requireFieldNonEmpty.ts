import type { InvariantFn, DocItem } from '../types';

export function requireFieldNonEmpty(field: keyof DocItem): InvariantFn {
  return async (manifest) => {
    const missing: string[] = [];
    for (const section of manifest.sections) {
      for (const item of section.items) {
        const v = item[field];
        if (typeof v !== 'string' || v.trim().length === 0) {
          missing.push(item.id);
        }
      }
    }
    if (missing.length === 0) {
      return { ok: true, message: `every item has non-empty ${String(field)}` };
    }
    return {
      ok: false,
      message: `requireFieldNonEmpty(${String(field)}): ${missing.length} items missing`,
      missing,
    };
  };
}
