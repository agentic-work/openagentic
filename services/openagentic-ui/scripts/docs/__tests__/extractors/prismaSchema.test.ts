import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { prismaSchema } from '../../extractors/prismaSchema';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('prismaSchema extractor (real source)', () => {
  it('parses at least 10 models from the API prisma schema (or returns placeholder if absent)', async () => {
    const extractor = prismaSchema({
      path: 'services/openagentic-api/prisma/schema.prisma',
    });
    const manifest = await extractor(REPO_ROOT);
    expect(manifest.domain).toBe('database-schema');
    expect(manifest.sections.length).toBeGreaterThanOrEqual(1);
  });
});
