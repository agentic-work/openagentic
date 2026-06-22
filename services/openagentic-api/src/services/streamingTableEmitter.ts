/**
 * streamingTableEmitter — fires a `streaming_table` NDJSON frame whose
 * shape matches `applyStreamingTableFrame()` in
 * `services/openagentic-ui/src/features/chat/hooks/useChatStream.ts:584`.
 *
 * Pure factory + emit pair so callers can:
 *   const emit = createStreamingTableEmitter(ndjsonWriter);
 *   emit({ artifactId, title, columns, rows, countText });
 *
 * The writer is any function with a `({ type, ...payload }) => void`
 * signature — typically the chatPlugin's existing NDJSON writer wrapped
 * in deps.ndjsonWrite.
 *
 * Shape (frozen by useChatStream.streamingTable.test.ts):
 *   {
 *     type: 'streaming_table',
 *     artifact_id: string,
 *     title: string,
 *     count_text?: string,
 *     columns: [{ key, label, align?, cell_class? }],
 *     rows: [{ [columnKey]: string | number | { sev: 'ok'|'warn'|'err', text } }],
 *   }
 */

export type StreamingTableCellPayload =
  | string
  | number
  | { sev: 'ok' | 'warn' | 'err'; text: string };

export interface StreamingTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  cell_class?: 'mono' | 'tnum';
}

export interface StreamingTableEmit {
  artifactId: string;
  title: string;
  countText?: string;
  columns: StreamingTableColumn[];
  rows: Array<Record<string, StreamingTableCellPayload>>;
}

export interface NdjsonWriter {
  (frame: { type: string; [k: string]: unknown }): void;
}

export function createStreamingTableEmitter(write: NdjsonWriter) {
  return function emit(payload: StreamingTableEmit): void {
    if (!payload || !payload.artifactId || !payload.columns || payload.columns.length === 0) {
      // Drop malformed payloads — UI reducer would drop them anyway.
      return;
    }
    write({
      type: 'streaming_table',
      artifact_id: payload.artifactId,
      title: payload.title || '',
      ...(payload.countText ? { count_text: payload.countText } : {}),
      columns: payload.columns.map((c) => ({
        key: c.key,
        label: c.label,
        ...(c.align ? { align: c.align } : {}),
        ...(c.cell_class ? { cell_class: c.cell_class } : {}),
      })),
      rows: payload.rows || [],
    });
  };
}
