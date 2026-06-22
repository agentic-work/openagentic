/**
 * #925 — freestyle HTML / CSS leak strip + structured payload surface.
 *
 * Symptom (live evidence 2026-05-18 → 2026-05-20): some models emit raw
 * HTML / CSS in their text response when they intended to call a UI tool
 * but missed BOTH the function-call syntax AND the inline
 * `<compose_app>...</compose_app>` XML rescue shape. Without intervention
 * those bytes leak into the assistant body — page-level `<style>` rules
 * contaminate the surrounding chat layout and the user sees raw HTML.
 *
 * History: an earlier attempt (`stripBareHtmlPayload`, commit `3f7d9171`,
 * reverted in `52fe6712`) only DELETED the bytes — the iframe never
 * mounted because no replacement tool_use was synthesized. This helper
 * BOTH strips the bytes AND surfaces a structured payload list so
 * `chatLoop` can repackage each one as a synthetic `render_artifact`
 * tool_use block with `kind: 'html'`, mounting the existing AppRenderer
 * iframe path for sandboxed display.
 *
 * Scope:
 *   - Strips bare `<!doctype html>...</html>` blocks (full pages)
 *   - Strips bare `<html>...</html>` blocks without doctype
 *   - Strips standalone `<style>...</style>` blocks
 *   - PRESERVES HTML inside markdown code fences (``` blocks) — those are
 *     legitimate code examples
 *   - PRESERVES `<compose_app>...</compose_app>` XML rescue shape — that
 *     path is owned by the inline-compose rescue (#807 part 2 / #946)
 *   - Returns empty result for empty / null / non-string input (no throw)
 *
 * Each freestyle payload is surfaced as `{ kind, content }` where the
 * caller is expected to translate to a `render_artifact` tool_use:
 *
 *   { name: 'render_artifact', input: { kind, content, title, group_id } }
 *
 * See `RenderArtifactTool.ts` for the dispatch contract.
 */

export interface FreestylePayload {
  /** Artifact kind for the synthetic `render_artifact` tool_use. */
  kind: 'html';
  /** Verbatim HTML / CSS body extracted from text. */
  content: string;
}

export interface StripResult {
  /** Text with bare HTML/CSS blocks removed; surrounding prose preserved. */
  stripped: string;
  /**
   * Each stripped block surfaced as a structured payload so the caller
   * can repackage it into a synthetic `render_artifact` tool_use.
   */
  freestylePayloads: FreestylePayload[];
}

const EMPTY_RESULT: StripResult = { stripped: '', freestylePayloads: [] };

/**
 * Find the byte ranges occupied by markdown fenced code blocks
 * (triple-backtick) so we can SKIP any HTML matches that fall inside one.
 * Returns a list of `[start, end)` ranges in source order.
 */
function findFencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceRe = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInsideFence(start: number, fencedRanges: Array<[number, number]>): boolean {
  for (const [a, b] of fencedRanges) {
    if (start >= a && start < b) return true;
  }
  return false;
}

/**
 * Match a single bare HTML / style block in `text` starting at or after
 * `from`. Returns the match metadata or null if no further match.
 *
 * Patterns (order matters — doctype first because it subsumes <html>):
 *   1) /<!doctype\s+html\b[\s\S]*?<\/html\s*>/i      (full page)
 *   2) /<html\b[^>]*>[\s\S]*?<\/html\s*>/i           (no doctype)
 *   3) /<style\b[^>]*>[\s\S]*?<\/style\s*>/i         (standalone css)
 */
interface RawMatch {
  start: number;
  end: number;
  body: string;
}

function findNextBareBlock(text: string, from: number): RawMatch | null {
  // Run all three patterns from `from` and pick the earliest start.
  const patterns: RegExp[] = [
    /<!doctype\s+html\b[\s\S]*?<\/html\s*>/i,
    /<html\b[^>]*>[\s\S]*?<\/html\s*>/i,
    /<style\b[^>]*>[\s\S]*?<\/style\s*>/i,
  ];
  let best: RawMatch | null = null;
  for (const pat of patterns) {
    // exec with a sticky-ish offset by slicing — the patterns are not
    // /g, so we slice and adjust the index.
    const slice = text.substring(from);
    const m = pat.exec(slice);
    if (!m) continue;
    const absStart = from + m.index;
    const absEnd = absStart + m[0].length;
    if (best === null || absStart < best.start) {
      best = { start: absStart, end: absEnd, body: m[0] };
    }
  }
  return best;
}

export function stripFreestyleHtml(input: string): StripResult {
  if (typeof input !== 'string' || input.length === 0) {
    return EMPTY_RESULT;
  }

  const fencedRanges = findFencedRanges(input);
  const freestylePayloads: FreestylePayload[] = [];

  // Walk forward, accumulating non-stripped slices into `out`.
  const outParts: string[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const m = findNextBareBlock(input, cursor);
    if (!m) {
      outParts.push(input.substring(cursor));
      break;
    }
    // If the match is inside a fenced code block, skip past the fence
    // and continue scanning AFTER the fence (the next match could be
    // outside it, anywhere later in the body).
    if (isInsideFence(m.start, fencedRanges)) {
      // Append everything up through the end of the enclosing fence
      // unchanged, then continue.
      // Find which fence contains m.start.
      const containing = fencedRanges.find(([a, b]) => m.start >= a && m.start < b);
      const skipTo = containing ? containing[1] : m.end;
      outParts.push(input.substring(cursor, skipTo));
      cursor = skipTo;
      continue;
    }

    // Real bare leak — strip it and capture the payload.
    outParts.push(input.substring(cursor, m.start));
    freestylePayloads.push({ kind: 'html', content: m.body });
    cursor = m.end;
  }

  let stripped = outParts.join('');
  if (freestylePayloads.length > 0) {
    // Collapse runs of blank lines left behind by the strip and trim.
    stripped = stripped.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { stripped, freestylePayloads };
}
