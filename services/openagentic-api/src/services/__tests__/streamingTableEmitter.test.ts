/**
 * Phase 5 — streaming_table NDJSON emitter unit tests.
 *
 * Frozen frame shape per
 * services/openagentic-ui/src/features/chat/hooks/useChatStream.ts:553-565.
 */

import { describe, it, expect, vi } from 'vitest';
import { createStreamingTableEmitter } from '../streamingTableEmitter.js';

describe('streamingTableEmitter', () => {
  it('writes a streaming_table frame with the canonical fields', () => {
    const writer = vi.fn();
    const emit = createStreamingTableEmitter(writer);
    emit({
      artifactId: 'tbl-1',
      title: 'IAM drift',
      countText: '24 rows',
      columns: [
        { key: 'name', label: 'Name', align: 'left' },
        { key: 'sev', label: 'Severity', cell_class: 'mono' },
      ],
      rows: [
        { name: 'admin-prod', sev: { sev: 'err', text: 'critical' } },
        { name: 'reader-dev', sev: { sev: 'ok', text: 'ok' } },
      ],
    });
    expect(writer).toHaveBeenCalledTimes(1);
    const frame = writer.mock.calls[0][0];
    expect(frame.type).toBe('streaming_table');
    expect(frame.artifact_id).toBe('tbl-1');
    expect(frame.title).toBe('IAM drift');
    expect(frame.count_text).toBe('24 rows');
    expect(frame.columns).toEqual([
      { key: 'name', label: 'Name', align: 'left' },
      { key: 'sev', label: 'Severity', cell_class: 'mono' },
    ]);
    expect(frame.rows).toHaveLength(2);
  });

  it('omits count_text when not supplied', () => {
    const writer = vi.fn();
    const emit = createStreamingTableEmitter(writer);
    emit({
      artifactId: 'tbl-x',
      title: '',
      columns: [{ key: 'a', label: 'A' }],
      rows: [],
    });
    const frame = writer.mock.calls[0][0];
    expect('count_text' in frame).toBe(false);
  });

  it('drops malformed payloads silently (no artifactId / no columns)', () => {
    const writer = vi.fn();
    const emit = createStreamingTableEmitter(writer);
    emit({ artifactId: '', title: 't', columns: [{ key: 'a', label: 'A' }], rows: [] });
    emit({ artifactId: 'x', title: 't', columns: [], rows: [] });
    expect(writer).not.toHaveBeenCalled();
  });
});
