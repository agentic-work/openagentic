import { describe, it, expect } from 'vitest';
import { validateAttachment, MAX_ATTACHMENT_SIZE_BYTES } from '../validateAttachment';

function fakeFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(0)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateAttachment (client)', () => {
  it('accepts a small PNG image', () => {
    const r = validateAttachment(fakeFile('snap.png', 'image/png', 12_345));
    expect(r.ok).toBe(true);
  });

  it('accepts a small PDF', () => {
    const r = validateAttachment(fakeFile('doc.pdf', 'application/pdf', 200_000));
    expect(r.ok).toBe(true);
  });

  it('accepts a docx (Office Open XML wordprocessingml)', () => {
    const r = validateAttachment(fakeFile(
      'r.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      120_000,
    ));
    expect(r.ok).toBe(true);
  });

  it('accepts a markdown file by mime', () => {
    const r = validateAttachment(fakeFile('notes.md', 'text/markdown', 4_000));
    expect(r.ok).toBe(true);
  });

  it('accepts a .md file with empty mime via extension safety net', () => {
    const r = validateAttachment(fakeFile('notes.md', '', 4_000));
    expect(r.ok).toBe(true);
  });

  it('rejects a file that exceeds the 25 MiB cap with a message naming the file and the limit', () => {
    const r = validateAttachment(fakeFile('big.pdf', 'application/pdf', 30 * 1024 * 1024));
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.message).toMatch(/big\.pdf/);
      expect(r.message).toMatch(/MiB per-file/);
      expect(r.message).toMatch(/25/);
    }
  });

  it('rejects an unsupported zip with a message listing supported types', () => {
    const r = validateAttachment(fakeFile('archive.zip', 'application/zip', 10_000));
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.message).toMatch(/archive\.zip/);
      expect(r.message).toMatch(/unsupported/i);
      expect(r.message).toMatch(/PDF/);
      expect(r.message).toMatch(/DOCX/);
    }
  });

  it('rejects legacy .doc (binary OLE) — only .docx is supported', () => {
    const r = validateAttachment(fakeFile('legacy.doc', 'application/msword', 10_000));
    expect(r.ok).toBe(false);
  });

  it('exact boundary: file size == MAX_ATTACHMENT_SIZE_BYTES is accepted', () => {
    const r = validateAttachment(fakeFile('exact.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE_BYTES));
    expect(r.ok).toBe(true);
  });

  it('one byte over MAX is rejected', () => {
    const r = validateAttachment(fakeFile('over.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE_BYTES + 1));
    expect(r.ok).toBe(false);
  });

  it('size check beats mime check (huge unsupported still gets size error)', () => {
    const r = validateAttachment(fakeFile('huge.zip', 'application/zip', 100 * 1024 * 1024));
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.message).toMatch(/MiB per-file/);
    }
  });
});
