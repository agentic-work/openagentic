/**
 * AC-D1 — artifact_emit reducer.
 *
 * Server emits `artifact_emit` when synth-executor (or any tool) finishes
 * writing bytes to UserStorageService. Wire shape:
 *
 *   {
 *     type: 'artifact_emit',
 *     artifact_id: string,    // unique download handle
 *     filename: string,
 *     content_type: string,   // mime
 *     size_bytes: number,
 *     download_url: string,   // presigned MinIO URL (TTL'd)
 *     produced_by?: string,   // 'synth_execute' | 'compose_app' | …
 *     synth_artifact_id?: string,  // back-link to the SynthCard
 *   }
 *
 * Reducer invariants mirror StreamingTable / Findings / InlineWidget:
 *   - empty messageId → drop
 *   - empty artifact_id → drop
 *   - hot-swap by artifactId; per-message scope; no input mutation
 *   - empty/zero size_bytes is OK (placeholder while still uploading)
 */

import { describe, it, expect } from 'vitest';
import {
  applyArtifactEmitFrame,
  type ArtifactEmit,
  type ArtifactEmitFrame,
} from '../useChatStream';

const sample = (overrides: Partial<ArtifactEmitFrame> = {}): ArtifactEmitFrame => ({
  type: 'artifact_emit',
  artifact_id: 'a-1',
  filename: 'report.pdf',
  content_type: 'application/pdf',
  size_bytes: 102400,
  download_url: '/api/storage/users/u1/objects/a-1?token=xyz',
  produced_by: 'synth_execute',
  ...overrides,
});

describe('applyArtifactEmitFrame — AC-D1 download tile reducer', () => {
  it('appends a new artifact under the active messageId', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample());
    expect(next['msg-1']).toBeDefined();
    expect(next['msg-1']).toHaveLength(1);
    expect(next['msg-1'][0]).toMatchObject({
      artifactId: 'a-1',
      filename: 'report.pdf',
      contentType: 'application/pdf',
      sizeBytes: 102400,
      downloadUrl: '/api/storage/users/u1/objects/a-1?token=xyz',
      producedBy: 'synth_execute',
    });
  });

  it('does not mutate the input map', () => {
    const before: Record<string, ArtifactEmit[]> = {};
    const next = applyArtifactEmitFrame(before, 'msg-1', sample());
    expect(next).not.toBe(before);
    expect(before['msg-1']).toBeUndefined();
  });

  it('hot-swaps by artifactId (size + URL update)', () => {
    let m: Record<string, ArtifactEmit[]> = {};
    m = applyArtifactEmitFrame(m, 'msg-1', sample({ size_bytes: 0 }));
    m = applyArtifactEmitFrame(m, 'msg-1', sample({
      size_bytes: 204800,
      download_url: '/api/storage/users/u1/objects/a-1?token=fresh',
    }));
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0].sizeBytes).toBe(204800);
    expect(m['msg-1'][0].downloadUrl).toMatch(/token=fresh/);
  });

  it('appends multiple artifacts under the same messageId when artifact_id differs', () => {
    let m: Record<string, ArtifactEmit[]> = {};
    m = applyArtifactEmitFrame(m, 'msg-1', sample({ artifact_id: 'a-1' }));
    m = applyArtifactEmitFrame(m, 'msg-1', sample({
      artifact_id: 'a-2',
      filename: 'data.xlsx',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    expect(m['msg-1']).toHaveLength(2);
    expect(m['msg-1'][0].artifactId).toBe('a-1');
    expect(m['msg-1'][1].filename).toBe('data.xlsx');
  });

  it('keeps artifacts for other messageIds untouched', () => {
    let m: Record<string, ArtifactEmit[]> = {};
    m = applyArtifactEmitFrame(m, 'msg-1', sample({ artifact_id: 'a-1' }));
    m = applyArtifactEmitFrame(m, 'msg-2', sample({ artifact_id: 'a-99' }));
    expect(m['msg-1'][0].artifactId).toBe('a-1');
    expect(m['msg-2'][0].artifactId).toBe('a-99');
  });

  it('drops frames silently when messageId is empty', () => {
    const next = applyArtifactEmitFrame({}, '', sample());
    expect(Object.keys(next)).toHaveLength(0);
  });

  it('drops frames silently when artifact_id is empty', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample({ artifact_id: '' }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('drops frames silently when filename is empty (defense)', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample({ filename: '' }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('drops frames silently when download_url is empty (defense)', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample({ download_url: '' }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('preserves synth back-link via synth_artifact_id', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample({
      synth_artifact_id: 's-42',
    }));
    expect(next['msg-1'][0].synthArtifactId).toBe('s-42');
  });

  it('coerces missing produced_by to undefined', () => {
    const next = applyArtifactEmitFrame({}, 'msg-1', sample({ produced_by: undefined }));
    expect(next['msg-1'][0].producedBy).toBeUndefined();
  });
});
