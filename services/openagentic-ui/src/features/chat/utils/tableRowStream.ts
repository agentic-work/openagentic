/**
 * Phase F.3 — detect tabular data inside a tool result so the UI can
 * stream it row-by-row into an inline table component.
 *
 * Heuristic (no explicit schema): look for a top-level array of objects
 * with at least two rows, where every row is a flat-ish record. The
 * output is a normalized `{rows, columns}` shape that the renderer
 * consumes regardless of the wrapping key the MCP tool chose
 * (`rows`, `items`, `data`, `results`, or the array at top-level).
 *
 * Once we have the rows, the renderer reveals them progressively so
 * the user sees paginated Azure/AWS/GCP results landing instead of a
 * big blocky table. The server still emits the result in one shot —
 * the "streaming" here is a client-side animation, which avoids
 * per-row wire events while still matching claude.ai's feel.
 */

export interface TableRowStreamData {
  rows: Array<Record<string, unknown>>;
  columns: string[];
}

const TABLE_KEY_CANDIDATES = ['rows', 'items', 'data', 'results', 'records'] as const;
const MIN_ROWS_TO_STREAM = 2;
const MAX_COLUMNS = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function extractRowsArray(value: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(value)) {
    if (value.every(isPlainObject)) {
      return value as Array<Record<string, unknown>>;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of TABLE_KEY_CANDIDATES) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner) && inner.every(isPlainObject)) {
        return inner as Array<Record<string, unknown>>;
      }
    }
  }
  return null;
}

function deriveColumns(rows: Array<Record<string, unknown>>): string[] {
  // Union keys across the first N rows to cover sparse tables without blowing
  // memory on huge payloads. Preserve first-seen order for column stability.
  const seen = new Set<string>();
  const cols: string[] = [];
  const sample = rows.slice(0, 50);
  for (const row of sample) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
        if (cols.length >= MAX_COLUMNS) return cols;
      }
    }
  }
  return cols;
}

export function detectTableData(value: unknown): TableRowStreamData | null {
  const rows = extractRowsArray(value);
  if (!rows || rows.length < MIN_ROWS_TO_STREAM) return null;
  const columns = deriveColumns(rows);
  if (columns.length === 0) return null;
  return { rows, columns };
}

/**
 * Decide which rows should be visible at a given animation frame.
 * Pure so the reducer is testable without a component. The caller
 * advances `revealed` via setInterval / rAF at whatever cadence fits.
 */
export function revealedSlice(
  rows: Array<Record<string, unknown>>,
  revealed: number
): Array<Record<string, unknown>> {
  if (revealed <= 0) return [];
  if (revealed >= rows.length) return rows;
  return rows.slice(0, revealed);
}

/** Format a cell value for display without risking `[object Object]`. */
export function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    const json = JSON.stringify(value);
    if (json.length > 80) return json.slice(0, 77) + '\u2026';
    return json;
  } catch {
    return String(value);
  }
}
