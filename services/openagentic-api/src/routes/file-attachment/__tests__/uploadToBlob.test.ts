// uploadToBlob — pure planning logic for file upload: validation (mime + size),
// dedup key (sha256), blob key construction. Extracted so we can unit-test the
// guardrails without booting Fastify + MinIO.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  planUpload,
} from '../uploadToBlob';

describe('planUpload', () => {
  const USER = 'azure_8f6f8f04-2bd6-48ab-aca7-0e5b3cdd5286';

  it('builds a key of shape YYYY/MM/<sanitizedUserId>/<fileId>.<ext>', () => {
    const plan = planUpload({
      userId: USER,
      originalFilename: 'cat.png',
      mimeType: 'image/png',
      buffer: Buffer.from('AAAA'),
    });
    expect(plan.blobKey).toMatch(/^\d{4}\/\d{2}\/azure_8f6f8f04-2bd6-48ab-aca7-0e5b3cdd5286\/file_\d+_[0-9a-f]+\.png$/);
  });

  it('preserves known double extensions in the MIME → ext fallback (jpeg, svg+xml)', () => {
    expect(planUpload({ userId: USER, originalFilename: 'x.jpeg', mimeType: 'image/jpeg', buffer: Buffer.from('A') })
      .blobKey).toMatch(/\.jpeg$/);
    expect(planUpload({ userId: USER, originalFilename: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('A') })
      .blobKey).toMatch(/\.svg$/);
  });

  it('sanitizes dangerous user id chars (no "/" or ".." allowed in the key)', () => {
    const plan = planUpload({
      userId: '../etc/passwd',
      originalFilename: 'x.png',
      mimeType: 'image/png',
      buffer: Buffer.from('A'),
    });
    expect(plan.blobKey).not.toContain('..');
    expect(plan.blobKey.split('/').length).toBe(4); // YYYY / MM / safeUser / file
  });

  it('computes a stable sha256 for dedup (same bytes → same hash across runs)', () => {
    const a = planUpload({
      userId: USER, originalFilename: 'a', mimeType: 'text/plain', buffer: Buffer.from('hello world'),
    });
    const b = planUpload({
      userId: USER, originalFilename: 'b', mimeType: 'text/plain', buffer: Buffer.from('hello world'),
    });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toHaveLength(64);
    // Different bytes → different hash.
    const c = planUpload({
      userId: USER, originalFilename: 'c', mimeType: 'text/plain', buffer: Buffer.from('HELLO WORLD'),
    });
    expect(c.sha256).not.toBe(a.sha256);
  });

  it('throws when mime type is not in the allow-list', () => {
    expect(() => planUpload({
      userId: USER,
      originalFilename: 'malware.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('X'),
    })).toThrow(/mime|not supported|not allowed/i);
  });

  it('throws when buffer exceeds the max size (default 100MB)', () => {
    // 100MB + 1 byte — allocate sparsely so the test doesn't OOM.
    const tooBig = Buffer.alloc(DEFAULT_MAX_UPLOAD_BYTES + 1, 0);
    expect(() => planUpload({
      userId: USER,
      originalFilename: 'x.png',
      mimeType: 'image/png',
      buffer: tooBig,
    })).toThrow(/size|too large|exceeds/i);
  });

  it('DEFAULT_MAX_UPLOAD_BYTES is 100MB (matches fastify bodyLimit + nginx)', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
  });

  it('DEFAULT_ALLOWED_MIME_TYPES includes images, pdf, text, docx, and markdown', () => {
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('image/png');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('image/webp');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('application/pdf');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('text/plain');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('text/markdown');
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('returns size (buffer length) alongside the key + hash', () => {
    const plan = planUpload({
      userId: USER, originalFilename: 'x.png', mimeType: 'image/png', buffer: Buffer.from('hello'),
    });
    expect(plan.size).toBe(5);
  });

  it('fileId is URL-safe + collision-resistant (timestamp + 8 hex)', () => {
    const plan = planUpload({
      userId: USER, originalFilename: 'x.png', mimeType: 'image/png', buffer: Buffer.from('hello'),
    });
    expect(plan.fileId).toMatch(/^file_\d+_[0-9a-f]{8}$/);
  });
});
