import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { tsInterface } from '../../extractors/tsInterface';

const REPO_ROOT = resolve(process.cwd(), '..', '..');

describe('tsInterface extractor (real source)', () => {
  it('extracts fields from every interface in a real file with wildcard', async () => {
    const extractor = tsInterface({
      domain: 'sse-stream-events',
      title: 'SSE Stream Events',
      description: 'Server-sent stream event taxonomy',
      icon: 'flow',
      category: 'core',
      path: 'services/openagentic-api/src/routes/chat/pipeline/chat/types.ts',
      typeName: '*',
    });
    const manifest = await extractor(REPO_ROOT);
    expect(manifest.domain).toBe('sse-stream-events');
    const totalItems = manifest.sections.reduce((s, sec) => s + sec.items.length, 0);
    expect(totalItems).toBeGreaterThanOrEqual(1);
  });
});
