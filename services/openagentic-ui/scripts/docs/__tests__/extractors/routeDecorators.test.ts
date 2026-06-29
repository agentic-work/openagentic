import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { routeDecorators } from '../../extractors/routeDecorators';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('routeDecorators extractor (real source)', () => {
  it('discovers at least 30 Fastify routes', async () => {
    const extractor = routeDecorators({
      rootDir: 'services/openagentic-api/src/routes',
    });
    const manifest = await extractor(REPO_ROOT);
    const totalItems = manifest.sections.reduce((s, sec) => s + sec.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(30);
  });
});
