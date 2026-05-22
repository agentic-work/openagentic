/**
 * Binary data plane — types contract guard.
 *
 * Tier 2 #5 scoping deliverable. The runtime BinaryStore impls
 * (api-proxy / local-fs / in-memory) haven't been written yet, but the
 * INTERFACE shape is locked so future PRs that land the impls + the
 * consuming executors (csv_processor binary mode, xlsx_processor,
 * document_loader) ship against a stable signature.
 *
 * Closing a slot in `BinaryRef` or `BinaryStore` means:
 *   - Add the new field / method here so the contract test fails RED.
 *   - Land the change in `binary/types.ts` so it goes GREEN.
 *   - Update every impl in the same PR.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const TYPES_PATH = join(__dirname, '..', '..', 'binary', 'types.ts');

describe('binary data plane — types contract', () => {
  const src = readFileSync(TYPES_PATH, 'utf8');

  it('exports BinaryRef interface', () => {
    expect(src).toMatch(/export\s+interface\s+BinaryRef\b/);
  });

  it('BinaryRef carries the required identity + integrity fields', () => {
    // id + backend + mimeType + sizeBytes + sha256 + createdAt are
    // all mandatory; nodes inspect these to route without dereferencing
    // the bytes (e.g. csv_processor refuses non-csv mimeTypes).
    for (const field of [
      'readonly id: string',
      'readonly backend: BinaryBackend',
      'readonly mimeType: string',
      'readonly sizeBytes: number',
      'readonly sha256: string',
      'readonly createdAt: number',
    ]) {
      expect(src).toContain(field);
    }
  });

  it('BinaryRef has optional filename + meta slots', () => {
    expect(src).toMatch(/readonly\s+filename\?:\s+string/);
    expect(src).toMatch(/readonly\s+meta\?:\s+Record<string,\s+unknown>/);
  });

  it('exports the 3 BinaryBackend literals', () => {
    expect(src).toMatch(/'api-proxy'\s*\|\s*'local-fs'\s*\|\s*'in-memory'/);
  });

  it('BinaryStore declares put / get / exists / delete', () => {
    expect(src).toMatch(/put\(input:\s*BinaryPutInput\):\s*Promise<BinaryRef>/);
    expect(src).toMatch(/get\(ref:\s*BinaryRef\):\s*Promise<Buffer\s*\|\s*null>/);
    expect(src).toMatch(/exists\(ref:\s*BinaryRef\):\s*Promise<boolean>/);
    expect(src).toMatch(/delete\(ref:\s*BinaryRef\):\s*Promise<void>/);
  });

  it('BinaryPutInput accepts data + mimeType + optional filename/meta', () => {
    expect(src).toMatch(/data:\s*Buffer/);
    expect(src).toMatch(/mimeType:\s*string/);
    expect(src).toMatch(/filename\?:\s*string/);
    expect(src).toMatch(/meta\?:\s*Record<string,\s*unknown>/);
  });
});
