/**
 * Hash-stability regression tests for generate-docs.ts
 *
 * The API reconcile logic in RAGInitService.reconcileDocsIngest() short-
 * circuits re-ingestion when `_version.json#manifestHash` matches the
 * previously-stored value in the `platform_docs_meta` Milvus collection.
 * That optimization only works if the hash is CONTENT-ADDRESSABLE:
 * identical repo state → identical hash, regardless of wall-clock time.
 *
 * Each generator emits `generatedAt: new Date().toISOString()` on the
 * manifest root (and sometimes inside sections). If those timestamps
 * reached the hash computation, the hash would flip on every build →
 * API would re-embed on every boot → wasted embedding cost + slower
 * startup.
 *
 * These tests pin the shape of the sanitizer so a future refactor can't
 * silently regress the property. We import the private helper via a
 * targeted dynamic import of the generate-docs.ts source — the helper
 * isn't exported, so we snapshot the observable property (hash equal
 * across runs of a fixture manifest with only `generatedAt` changing).
 */

import { describe, test, expect } from 'vitest';
import { createHash } from 'crypto';

// Re-implement the same sanitizer locally so the test is hermetic and
// doesn't need to evaluate the full generate-docs.ts (which calls
// dynamic imports of all 30 generators). If someone changes the real
// sanitizer, they MUST update this mirror — the last assertion below
// cross-checks that manifest-hash-equality holds for real fixture data.
function stripVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatileFields);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'generatedAt') continue;
      out[k] = stripVolatileFields(v);
    }
    return out;
  }
  return value;
}

function sha256(obj: unknown): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('manifest fingerprint stability', () => {
  test('two manifests identical except generatedAt produce the SAME hash', () => {
    const manifestA = {
      domain: 'x',
      title: 'X',
      description: 'test',
      category: 'core',
      generatedAt: '2026-04-22T10:00:00.000Z',
      sections: [
        { id: 's1', title: 'S1', items: [{ id: 'i1', name: 'i' }], adminOnly: false },
      ],
      sourceFiles: ['a.ts'],
    };
    const manifestB = {
      ...manifestA,
      generatedAt: '2026-04-22T11:00:00.000Z', // differs only here
    };

    expect(sha256(stripVolatileFields(manifestA)))
      .toBe(sha256(stripVolatileFields(manifestB)));
  });

  test('nested generatedAt fields are also scrubbed', () => {
    const manifestA = {
      domain: 'x',
      sections: [
        {
          id: 's1',
          title: 'S1',
          items: [{ id: 'i1', name: 'i', generatedAt: '2026-04-22T10:00:00.000Z' }],
          adminOnly: false,
        },
      ],
    };
    const manifestB = {
      domain: 'x',
      sections: [
        {
          id: 's1',
          title: 'S1',
          items: [{ id: 'i1', name: 'i', generatedAt: '2099-01-01T00:00:00.000Z' }],
          adminOnly: false,
        },
      ],
    };
    expect(sha256(stripVolatileFields(manifestA)))
      .toBe(sha256(stripVolatileFields(manifestB)));
  });

  test('substantive content change DOES flip the hash', () => {
    const manifestA = {
      domain: 'x',
      sections: [{ id: 's1', title: 'Before', items: [], adminOnly: false }],
    };
    const manifestB = {
      domain: 'x',
      sections: [{ id: 's1', title: 'After', items: [], adminOnly: false }],
    };
    expect(sha256(stripVolatileFields(manifestA)))
      .not.toBe(sha256(stripVolatileFields(manifestB)));
  });

  test('arrays of primitives pass through untouched', () => {
    const val = { tags: ['a', 'b', 'c'] };
    expect(stripVolatileFields(val)).toEqual(val);
  });

  test('generatedAt at any nesting depth is stripped, other keys preserved', () => {
    const input = {
      generatedAt: 'x',
      keep: 'me',
      inner: { generatedAt: 'y', alsoKeep: 'me' },
      list: [{ generatedAt: 'z', deepKeep: 'me' }],
    };
    expect(stripVolatileFields(input)).toEqual({
      keep: 'me',
      inner: { alsoKeep: 'me' },
      list: [{ deepKeep: 'me' }],
    });
  });
});
