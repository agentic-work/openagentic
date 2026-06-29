import type { InvariantFn } from '../types';

/**
 * Fail if any item id (or section id) matches one of the forbidden patterns.
 *
 * This is the data-layer guarantee that REMOVED features (Code Mode, sandbox
 * exec, the `code`/`codemode`/`exec` services, denied node types) can never
 * silently reappear in a generated manifest. Strings are matched
 * case-insensitively as substrings; `RegExp` entries are used as-is.
 */
export function requireNoneMatching(forbidden: Array<string | RegExp>): InvariantFn {
  const patterns = forbidden.map((f) =>
    typeof f === 'string' ? new RegExp(f, 'i') : f,
  );
  return async (manifest) => {
    const ids: string[] = [
      ...manifest.sections.map((s) => s.id),
      ...manifest.sections.flatMap((s) => s.items.map((i) => i.id)),
    ];
    const offenders = ids.filter((id) => patterns.some((p) => p.test(id)));
    if (offenders.length === 0) {
      return {
        ok: true,
        message: `no item/section id matches any of ${forbidden.length} forbidden pattern(s)`,
      };
    }
    return {
      ok: false,
      message: `requireNoneMatching: ${offenders.length} id(s) match a forbidden (removed-feature) pattern`,
      missing: Array.from(new Set(offenders)),
    };
  };
}
