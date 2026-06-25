/**
 * applyTruncateTemplate — generic per-tool truncate_summary builder.
 *
 * The chat pipeline's ToolEnvelopeSplitter offloads multi-MB tool results
 * to Redis (via LargeResultStorageService) and falls back to a per-tool
 * truncate_summary fn to produce a compact `StructuredContent` the model
 * sees. This helper compiles a stored template + digestKeys list into a
 * fn that:
 *   1. counts the source array (when `countPath` is set)
 *   2. extracts digest values via dot-paths from `digestKeys`
 *   3. resolves `{{key}}` placeholders in the template using a small DSL:
 *       - {{count}}              → array length
 *       - {{sample_names}}       → first N items, comma-joined by `sampleNameKey`
 *       - {{<dot.path>}}         → value at dot-path in raw
 *      missing path → "?" (fail-soft).
 *   4. returns `{ summary, data: digest, truncated: true }`
 *
 * The digest object preserves the extracted keys only — model channel
 * stays under 2KB even for multi-MB raw payloads. The full raw payload
 * lives in Redis behind the `_meta.artifactHandle`.
 *
 * the design notes
 */
import type { StructuredContent } from '../types/ToolResult.js';

export interface ApplyTruncateTemplateOpts {
  /** Template string with `{{path}}` placeholders. */
  template: string;
  /** Dot-paths to extract as digest values (alongside summary). */
  digestKeys: string[];
  /** Dot-path to the top-level array used for `{{count}}`. */
  countPath?: string;
  /** Dot-path to the array used for `{{sample_names}}` / `{{top_N_summary}}`. */
  samplePath?: string;
  /** Property name to extract from each sample row (default `name`). */
  sampleNameKey?: string;
  /** Number of items to include in the sample (default 5). */
  sampleSize?: number;
}

export function applyTruncateTemplate(
  raw: unknown,
  opts: ApplyTruncateTemplateOpts,
): StructuredContent {
  const sampleSize = opts.sampleSize ?? 5;
  const sampleNameKey = opts.sampleNameKey ?? 'name';

  // 1. Compute the count (top-level array length).
  let countValue: number | undefined;
  if (opts.countPath) {
    const arr = getPath(raw, opts.countPath);
    if (Array.isArray(arr)) countValue = arr.length;
  } else if (Array.isArray(raw)) {
    countValue = raw.length;
  }

  // 2. Compute the sample (first N items, joined by sampleNameKey).
  let sampleNames: string | undefined;
  if (opts.samplePath) {
    const arr = getPath(raw, opts.samplePath);
    if (Array.isArray(arr)) {
      const slice = arr.slice(0, sampleSize);
      const names = slice.map((row) => {
        if (row == null) return '';
        if (typeof row === 'object' && sampleNameKey in (row as Record<string, unknown>)) {
          return String((row as Record<string, unknown>)[sampleNameKey] ?? '');
        }
        return String(row);
      });
      sampleNames = names.filter(Boolean).join(', ');
    }
  }

  // 3. Build a small token table for the DSL substitutions. Placeholders
  // that match a token resolve directly; everything else goes through the
  // dot-path resolver against `raw`.
  const tokens: Record<string, string> = {};
  if (countValue !== undefined) tokens.count = String(countValue);
  if (sampleNames !== undefined) tokens.sample_names = sampleNames;

  // 4. Substitute placeholders. `{{path}}` with optional whitespace.
  const summary = opts.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path) => {
    const key = String(path).trim();
    if (key in tokens) return tokens[key]!;
    const v = getPath(raw, key);
    if (v == null) return '?';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return '?';
      }
    }
    return String(v);
  });

  // 5. Build the digest object — only the explicit `digestKeys` paths
  // (NOT the full raw payload). Keeps `data` under the budget.
  const digest: Record<string, unknown> = {};
  for (const key of opts.digestKeys) {
    const v = getPath(raw, key);
    if (v !== undefined) digest[key] = v;
  }

  return {
    summary,
    data: digest,
    truncated: true,
  };
}

/**
 * Lodash.get-style path resolver supporting dot syntax + bracket array
 * indices. Mirrors `EnrichedToolService.getPath`. Returns undefined on
 * any miss; caller substitutes "?".
 */
function getPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path
    .split('.')
    .flatMap((part) => {
      const tokens: string[] = [];
      let buf = '';
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if (ch === '[') {
          if (buf) {
            tokens.push(buf);
            buf = '';
          }
        } else if (ch === ']') {
          if (buf) {
            tokens.push(buf);
            buf = '';
          }
        } else {
          buf += ch;
        }
      }
      if (buf) tokens.push(buf);
      return tokens;
    })
    .filter(Boolean);

  return parts.reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const idx = Number(key);
      return Number.isFinite(idx) ? acc[idx] : undefined;
    }
    if (typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
