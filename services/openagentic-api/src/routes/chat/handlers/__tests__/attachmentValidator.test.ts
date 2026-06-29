import { describe, it, expect } from 'vitest';
import {
  validateAttachment,
  validateAttachments,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../attachmentValidator.js';

const ONE_MB = 1024 * 1024;

describe('validateAttachment — size + mime gate', () => {
  it('accepts a normal PNG under the size limit', () => {
    const v = validateAttachment({
      originalName: 'screenshot.png',
      mimeType: 'image/png',
      size: 200 * 1024,
    });
    expect(v.ok).toBe(true);
  });

  it('accepts a PDF', () => {
    expect(
      validateAttachment({
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 2 * ONE_MB,
      }).ok,
    ).toBe(true);
  });

  it('accepts a DOCX', () => {
    expect(
      validateAttachment({
        originalName: 'spec.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: ONE_MB,
      }).ok,
    ).toBe(true);
  });

  it('accepts a markdown file (text/markdown)', () => {
    expect(
      validateAttachment({
        originalName: 'readme.md',
        mimeType: 'text/markdown',
        size: 50 * 1024,
      }).ok,
    ).toBe(true);
  });

  it('accepts a plain text file', () => {
    expect(
      validateAttachment({
        originalName: 'notes.txt',
        mimeType: 'text/plain',
        size: 10 * 1024,
      }).ok,
    ).toBe(true);
  });

  it('accepts JSON', () => {
    expect(
      validateAttachment({
        originalName: 'data.json',
        mimeType: 'application/json',
        size: 100 * 1024,
      }).ok,
    ).toBe(true);
  });

  it('rejects a 30 MiB file with 413 + readable message naming the file + size + limit', () => {
    const v = validateAttachment({
      originalName: 'huge.pdf',
      mimeType: 'application/pdf',
      size: 30 * ONE_MB,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return; // type guard
    expect(v.status).toBe(413);
    expect(v.message).toContain('huge.pdf');
    expect(v.message).toContain('30.0 MiB');
    expect(v.message).toContain('25.0 MiB');
  });

  it('rejects an unsupported mime with 415 + supported-list', () => {
    const v = validateAttachment({
      originalName: 'archive.zip',
      mimeType: 'application/zip',
      size: 100 * 1024,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.status).toBe(415);
    expect(v.message).toContain('archive.zip');
    expect(v.message).toContain('application/zip');
    expect(v.message).toContain('PDF');
    expect(v.message).toContain('DOCX');
  });

  it('rejects legacy .doc (binary OLE — mammoth cannot parse)', () => {
    const v = validateAttachment({
      originalName: 'old.doc',
      mimeType: 'application/msword',
      size: 100 * 1024,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.status).toBe(415);
  });

  it('size check beats mime check (so a too-big png returns 413 not 415)', () => {
    const v = validateAttachment({
      originalName: 'huge.png',
      mimeType: 'image/png',
      size: 50 * ONE_MB,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.status).toBe(413);
  });

  it('infers size from base64Data length when size missing', () => {
    // 40 MiB of base64 → ~30 MiB decoded → exceeds 25 MiB
    const big = 'a'.repeat(40 * ONE_MB);
    const v = validateAttachment({
      originalName: 'inline.pdf',
      mimeType: 'application/pdf',
      base64Data: big,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.status).toBe(413);
  });

  it('boundary: exactly at MAX_ATTACHMENT_SIZE_BYTES is accepted', () => {
    expect(
      validateAttachment({
        originalName: 'edge.pdf',
        mimeType: 'application/pdf',
        size: MAX_ATTACHMENT_SIZE_BYTES,
      }).ok,
    ).toBe(true);
  });

  it('boundary: one byte over MAX_ATTACHMENT_SIZE_BYTES is rejected', () => {
    expect(
      validateAttachment({
        originalName: 'edge.pdf',
        mimeType: 'application/pdf',
        size: MAX_ATTACHMENT_SIZE_BYTES + 1,
      }).ok,
    ).toBe(false);
  });
});

describe('validateAttachments — list aggregator', () => {
  it('returns ok for empty list', () => {
    expect(validateAttachments([]).ok).toBe(true);
    expect(validateAttachments(undefined).ok).toBe(true);
  });

  it('returns the FIRST failure when any file is bad', () => {
    const v = validateAttachments([
      { originalName: 'a.png', mimeType: 'image/png', size: 1024 },
      {
        originalName: 'evil.exe',
        mimeType: 'application/x-msdownload',
        size: 1024,
      },
      { originalName: 'b.pdf', mimeType: 'application/pdf', size: 1024 },
    ]);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.status).toBe(415);
    expect(v.message).toContain('evil.exe');
  });

  it('all-good returns ok', () => {
    expect(
      validateAttachments([
        { originalName: 'a.png', mimeType: 'image/png', size: 1024 },
        { originalName: 'b.pdf', mimeType: 'application/pdf', size: 1024 },
      ]).ok,
    ).toBe(true);
  });
});
