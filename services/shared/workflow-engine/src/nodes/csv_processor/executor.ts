/**
 * csv_processor node executor — text-mode CSV parsing.
 *
 * V1 ships text-mode only. The csv content is passed inline via the `csv`
 * setting (templates fully supported). A future ship adds binary/file mode
 * once the binary data plane lands.
 *
 * Parser handles the common RFC 4180 subset:
 *   - quoted fields (with the delimiter inside)
 *   - doubled-quote escape (`""` inside a quoted field → literal `"`)
 *   - CR/LF line endings (`\r\n` or `\n`)
 *   - trailing blank lines
 */

import type { NodeExecutionContext, WorkflowNode } from '../types.js';

interface ParsedOutput {
  outputAs: 'records' | 'rows';
  columns: string[];
  count: number;
  records?: Array<Record<string, string>>;
  rows?: string[][];
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<ParsedOutput> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;
  const csvRaw = typeof data.csv === 'string' ? data.csv : '';
  const csv = csvRaw.includes('{{')
    ? ctx.interpolateTemplate(csvRaw, input)
    : csvRaw;
  if (!csv || !csv.trim()) {
    throw new Error("csv_processor: 'csv' is required (text-mode, V1)");
  }

  const hasHeader = data.hasHeader !== false; // default true
  const delimiter = typeof data.delimiter === 'string' && data.delimiter.length > 0
    ? data.delimiter
    : ',';
  const outputAs = data.outputAs === 'rows' ? 'rows' : 'records';

  const allRows = parseCsv(csv, delimiter);
  if (allRows.length === 0) {
    throw new Error('csv_processor: parsed zero rows from input');
  }

  if (!hasHeader) {
    ctx.logger.info(
      { nodeId: node.id, count: allRows.length },
      '[csv_processor] parsed (no header)',
    );
    return {
      outputAs: 'rows',
      columns: [],
      count: allRows.length,
      rows: allRows,
    };
  }

  const columns = allRows[0];
  const dataRows = allRows.slice(1);

  if (outputAs === 'rows') {
    return {
      outputAs: 'rows',
      columns,
      count: dataRows.length,
      rows: dataRows,
    };
  }

  const records: Array<Record<string, string>> = dataRows.map((row) => {
    const rec: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      rec[columns[i]] = row[i] ?? '';
    }
    return rec;
  });

  ctx.logger.info(
    { nodeId: node.id, columns, count: records.length, outputAs },
    '[csv_processor] parsed',
  );

  return {
    outputAs: 'records',
    columns,
    count: records.length,
    records,
  };
}

/**
 * RFC 4180-subset CSV parser. Returns an array of rows (string[]). Empty
 * trailing lines are dropped. Handles quoted fields, embedded delimiters,
 * and doubled-quote escape (`""` → `"` inside a quoted field).
 */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          // Escaped quote inside quoted field
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === delimiter) {
      cur.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (c === '\n' || c === '\r') {
      cur.push(field);
      // Drop empty rows produced by trailing newlines + drop pure-empty separator lines
      if (!(cur.length === 1 && cur[0] === '')) {
        rows.push(cur);
      }
      cur = [];
      field = '';
      i += 1;
      // Swallow paired \r\n
      if (c === '\r' && i < len && text[i] === '\n') {
        i += 1;
      }
      continue;
    }

    field += c;
    i += 1;
  }

  // Final field/row flush
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (!(cur.length === 1 && cur[0] === '')) {
      rows.push(cur);
    }
  }

  return rows;
}
