/**
 * RED→GREEN: Prisma schema is the source of truth for the halfvec dim.
 *
 * Every `Unsupported("halfvec(N)")` declaration in
 * services/openagentic-api/prisma/schema.prisma must agree on N, AND
 * that N must equal the runtime cap `HALFVEC_HNSW_MAX_DIM`. If anyone
 * lowers the schema to halfvec(3072) without lowering the cap, this
 * test fails — the schema and the runtime stay in lockstep.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HALFVEC_HNSW_MAX_DIM } from '../halfvecHnswCap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../../../prisma/schema.prisma');

describe('Prisma schema halfvec dim is SoT', () => {
  const schemaContent = readFileSync(SCHEMA_PATH, 'utf-8');

  // Extract every Unsupported("halfvec(N)") occurrence
  const halfvecRegex = /Unsupported\("halfvec\((\d+)\)"\)/g;
  const declaredDims = Array.from(schemaContent.matchAll(halfvecRegex)).map(
    (m) => parseInt(m[1], 10)
  );

  it('declares at least one halfvec(N) column (sanity)', () => {
    expect(declaredDims.length).toBeGreaterThan(0);
  });

  it('uses ONE consistent dim across every halfvec column', () => {
    const unique = Array.from(new Set(declaredDims));
    expect(unique).toHaveLength(1);
  });

  it('declared schema dim equals runtime HALFVEC_HNSW_MAX_DIM constant', () => {
    const schemaDim = declaredDims[0];
    expect(schemaDim).toBe(HALFVEC_HNSW_MAX_DIM);
  });

  it('declared dim is ≤ 4000 (pgvector HNSW hard cap for halfvec)', () => {
    const schemaDim = declaredDims[0];
    expect(schemaDim).toBeLessThanOrEqual(4000);
  });

  it('no `Unsupported("halfvec")` without a dim — every column is pinned', () => {
    const unpinnedRegex = /Unsupported\("halfvec"\)(?!\()/g;
    const unpinnedMatches = Array.from(schemaContent.matchAll(unpinnedRegex));
    expect(unpinnedMatches).toHaveLength(0);
  });
});
