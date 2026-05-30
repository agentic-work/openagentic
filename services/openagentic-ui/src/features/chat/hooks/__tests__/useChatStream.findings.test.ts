/**
 * Phase 27 — findings_emit NDJSON frame + reducer.
 *
 * Wire shape:
 *   {
 *     type: 'findings_emit',
 *     artifact_id: string,
 *     title?: string,
 *     items: [{ id, title, severity, body? }, ...]
 *   }
 *
 * Reducer keys per-message just like streaming_table — older bubbles
 * keep their own findings, in-flight bubble accumulates.
 */

import { describe, it, expect } from 'vitest';
import {
  applyFindingsFrame,
  type FindingsArtifact,
  type FindingsFrame,
} from '../useChatStream';

const sampleFrame = (overrides: Partial<FindingsFrame> = {}): FindingsFrame => ({
  type: 'findings_emit',
  artifact_id: 'fnd-1',
  title: 'Security review',
  items: [
    { id: '1', title: 'JDBC URL is HTTP', severity: 'med' },
    { id: '2', title: 'SASL password not gated', severity: 'high', body: 'fail-fast required' },
    { id: '3', title: 'RLS missing on SubscriptionItem', severity: 'critical' },
  ],
  ...overrides,
});

describe('applyFindingsFrame', () => {
  it('writes a new findings entry under the messageId', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame());
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0].artifactId).toBe('fnd-1');
    expect(m['msg-1'][0].title).toBe('Security review');
    expect(m['msg-1'][0].items).toHaveLength(3);
    expect(m['msg-1'][0].items[2].severity).toBe('critical');
  });

  it('hot-swaps when the artifactId matches an existing entry', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame());
    m = applyFindingsFrame(m, 'msg-1', sampleFrame({
      items: [{ id: 'a', title: 'rewritten', severity: 'low' }],
    }));
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0].items[0].title).toBe('rewritten');
  });

  it('appends a second findings artifact under same message when artifactId differs', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame());
    m = applyFindingsFrame(m, 'msg-1', sampleFrame({ artifact_id: 'fnd-2', title: 'Audit pass 2' }));
    expect(m['msg-1']).toHaveLength(2);
    expect(m['msg-1'][1].title).toBe('Audit pass 2');
  });

  it('drops frames with empty artifact_id', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame({ artifact_id: '' }));
    expect(Object.keys(m)).toHaveLength(0);
  });

  it('drops frames with empty items array', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame({ items: [] }));
    expect(Object.keys(m)).toHaveLength(0);
  });

  it('drops frames with empty messageId', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, '', sampleFrame());
    expect(Object.keys(m)).toHaveLength(0);
  });

  it('isolates entries between different messageIds', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', sampleFrame());
    m = applyFindingsFrame(m, 'msg-2', sampleFrame({ artifact_id: 'fnd-2' }));
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-2']).toHaveLength(1);
    expect(m['msg-1'][0].artifactId).toBe('fnd-1');
    expect(m['msg-2'][0].artifactId).toBe('fnd-2');
  });

  it('coerces malformed item severity to "info"', () => {
    let m: Record<string, FindingsArtifact[]> = {};
    m = applyFindingsFrame(m, 'msg-1', {
      type: 'findings_emit',
      artifact_id: 'x',
      items: [{ id: 'a', title: 't', severity: 'cromulent' as any }],
    });
    expect(m['msg-1'][0].items[0].severity).toBe('info');
  });
});
