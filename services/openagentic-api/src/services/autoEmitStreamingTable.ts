/**
 * autoEmitStreamingTable — detects list-shaped tool results and emits a
 * `streaming_table` NDJSON frame so the UI's v2/StreamingTable renders
 * the rows inline. Mock 01:385-462 anatomy.
 *
 * Heuristics (no regex on tool name; all data-driven):
 *   1. result is Array (or JSON-parseable string of an Array)
 *   2. OR result is a plain object whose ONLY array field satisfies (1)
 *      — covers MCP wrappers like { resource_groups: [...] } /
 *      { subscriptions: [...] } (Phase 32 nested-lift)
 *   3. 2 ≤ length ≤ 200
 *   4. every element is a plain object with the SAME key set
 *   5. ≥ 2 keys per row
 *
 * Reject (no-op) when any check fails so prose-only / scalar / mixed
 * shapes aren't tabulated.
 *
 * Column labels are derived from keys via Title-Case-on-separators
 * (snake_case + kebab-case + camelCase). Numeric columns get
 * `cell_class: 'tnum'` + `align: 'right'`.
 */

export interface StreamingTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  cell_class?: 'mono' | 'tnum';
}

export interface StreamingTableFrame {
  type: 'streaming_table';
  artifact_id: string;
  title: string;
  count_text?: string;
  columns: StreamingTableColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface AutoEmitOptions {
  toolCallId: string;
  toolName: string;
  result: unknown;
  /** NDJSON frame writer — typically `(frame) => ctx.emit(frame.type, frame)`. */
  write: (frame: StreamingTableFrame) => void;
  /** Override max rows (default 200). */
  maxRows?: number;
}

const MIN_ROWS = 2;
const DEFAULT_MAX_ROWS = 200;
const MIN_COLS = 2;

function titleCase(key: string): string {
  // snake_case + kebab-case + camelCase → "Title Case With Spaces"
  const withSpaces = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return withSpaces
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && (v as object).constructor === Object;
}

function tryParseJsonArray(s: string): unknown[] | null {
  const t = s.trim();
  if (!t.startsWith('[')) return null;
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function autoEmitStreamingTable(opts: AutoEmitOptions): boolean {
  const { toolCallId, toolName, result, write } = opts;
  const max = opts.maxRows ?? DEFAULT_MAX_ROWS;

  if (result == null) return false;

  // Coerce stringified JSON (array OR object). For objects we'll then
  // try the nested-array lift below.
  let working: unknown = result;
  if (typeof working === 'string') {
    const t = (working as string).trim();
    if (t.startsWith('[')) {
      const parsed = tryParseJsonArray(t);
      if (!parsed) return false;
      working = parsed;
    } else if (t.startsWith('{')) {
      try {
        working = JSON.parse(t);
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  // Phase 32 — nested-lift. When result is a plain object, find the
  // FIRST top-level field whose value is an array. Common MCP shapes:
  //   { resource_groups: [...], executed_as: {...} }
  //   { subscriptions: [...] }
  //   { rows: [...], meta: {...} }
  // If no field is an array, bail (we don't tabulate scalar-only objects).
  let rows: unknown[];
  if (Array.isArray(working)) {
    rows = working;
  } else if (isPlainObject(working)) {
    let firstArrayField: unknown[] | null = null;
    for (const key of Object.keys(working as Record<string, unknown>)) {
      const v = (working as Record<string, unknown>)[key];
      if (Array.isArray(v)) {
        firstArrayField = v;
        break;
      }
    }
    if (!firstArrayField) return false;
    rows = firstArrayField;
  } else {
    return false;
  }

  if (rows.length < MIN_ROWS || rows.length > max) return false;

  // All rows must be plain objects.
  for (const row of rows) {
    if (!isPlainObject(row)) return false;
  }

  // Lock the key set from the first row; every subsequent row must match
  // exactly (no missing keys, no extra keys).
  const firstKeys = Object.keys(rows[0] as Record<string, unknown>);
  if (firstKeys.length < MIN_COLS) return false;
  const keySet = new Set(firstKeys);
  for (let i = 1; i < rows.length; i++) {
    const ks = Object.keys(rows[i] as Record<string, unknown>);
    if (ks.length !== firstKeys.length) return false;
    for (const k of ks) {
      if (!keySet.has(k)) return false;
    }
  }

  // Derive column metadata. Numeric columns (every value finite number)
  // get tnum + right-align so dollar amounts / counts line up cleanly.
  const columns: StreamingTableColumn[] = firstKeys.map((key) => {
    const allNumeric = rows.every((r) => {
      const v = (r as Record<string, unknown>)[key];
      return typeof v === 'number' && Number.isFinite(v);
    });
    return {
      key,
      label: titleCase(key),
      ...(allNumeric ? { align: 'right' as const, cell_class: 'tnum' as const } : {}),
    };
  });

  const frame: StreamingTableFrame = {
    type: 'streaming_table',
    artifact_id: toolCallId,
    title: toolName,
    count_text: `${rows.length} row${rows.length === 1 ? '' : 's'}`,
    columns,
    rows: rows as Array<Record<string, unknown>>,
  };

  try {
    write(frame);
  } catch {
    return false;
  }
  return true;
}
