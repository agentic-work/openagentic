import type { InvariantFn } from '../types';

export function requireMinCount(min: number): InvariantFn {
  return async (manifest) => {
    const total = manifest.sections.reduce((sum, s) => sum + s.items.length, 0);
    if (total >= min) {
      return { ok: true, message: `≥${min} items (got ${total})` };
    }
    return {
      ok: false,
      message: `requireMinCount(${min}): got ${total} items`,
    };
  };
}
