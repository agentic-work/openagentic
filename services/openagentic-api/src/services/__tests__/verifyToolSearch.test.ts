import { describe, expect, it, vi } from 'vitest';
import { verifyToolSearch } from '../startup-helpers/verifyToolSearch.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

describe('verifyToolSearch', () => {
  it('returns ok=true with sample names when cache returns non-empty results', async () => {
    const cache = {
      searchToolsAsOpenAIFunctions: vi
        .fn()
        .mockResolvedValue([
          { function: { name: 'admin_system_postgres_raw_query' } },
          { function: { name: 'k8s_list_pods' } },
        ]),
    };
    const result = await verifyToolSearch(cache as any, 5_000, logger);
    expect(result.ok).toBe(true);
    expect(result.sampleToolNames).toEqual([
      'admin_system_postgres_raw_query',
      'k8s_list_pods',
    ]);
    expect(result.reason).toBeUndefined();
  });

  it('returns ok=false with reason when cache returns empty array', async () => {
    const cache = {
      searchToolsAsOpenAIFunctions: vi.fn().mockResolvedValue([]),
    };
    const result = await verifyToolSearch(cache as any, 5_000, logger);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('search returned 0 results');
  });

  it('returns ok=false with timeout reason when cache hangs past deadline', async () => {
    const cache = {
      searchToolsAsOpenAIFunctions: vi
        .fn()
        .mockImplementation(() => new Promise(() => {})),
    };
    const start = Date.now();
    const result = await verifyToolSearch(cache as any, 50, logger);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/timed out after 50ms/);
    expect(elapsed).toBeLessThan(500);
  });

  it('returns ok=false with error message when cache throws', async () => {
    const cache = {
      searchToolsAsOpenAIFunctions: vi
        .fn()
        .mockRejectedValue(new Error('milvus dial error')),
    };
    const result = await verifyToolSearch(cache as any, 5_000, logger);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('milvus dial error');
  });

  it('does not throw for any of the above failure modes', async () => {
    const cache = {
      searchToolsAsOpenAIFunctions: vi.fn().mockResolvedValue(null),
    };
    await expect(verifyToolSearch(cache as any, 5_000, logger)).resolves
      .toBeDefined();
  });
});
