/**
 * RED-first TDD: GoogleVertexProvider.resolveModelGardenPath must throw an
 * explicit error when called with undefined/null/empty string instead of
 * crashing on `.toLowerCase()` of undefined.
 *
 * Bug: live pod log:
 *   TypeError: Cannot read properties of undefined (reading 'toLowerCase')
 *     at GoogleVertexProvider.resolveModelGardenPath
 *
 * Happens when request.model, VERTEX_DEFAULT_MODEL, and DEFAULT_MODEL are
 * all unset — the caller passes undefined to resolveModelGardenPath.
 *
 * Fix: throw an explicit Error at function entry when model is falsy, so the
 * real config error surfaces upstream instead of crashing on .toLowerCase().
 */

import { describe, it, expect, vi } from 'vitest';

// Stub heavy transitive deps so the file can be imported
vi.mock('../../ProviderManager.js', () => ({ ProviderManager: class {} }));
vi.mock('../../../utils/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  loggers: { services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));

import { GoogleVertexProvider } from '../GoogleVertexProvider.js';

const minimalConfig = {
  id: 'test-vertex',
  name: 'Test Vertex',
  type: 'google-vertex' as const,
  enabled: true,
  priority: 1,
  credentials: {
    project: 'test-project',
    location: 'us-central1',
  },
  models: [],
  settings: {},
};

describe('GoogleVertexProvider.resolveModelGardenPath', () => {
  it('throws an explicit error when model is undefined', () => {
    const provider = new GoogleVertexProvider(minimalConfig, {} as any);
    // Access the private method via cast to test it in isolation
    const resolveModelGardenPath = (provider as any).resolveModelGardenPath.bind(provider);
    expect(() => resolveModelGardenPath(undefined)).toThrow(
      'resolveModelGardenPath requires a model argument'
    );
  });

  it('throws an explicit error when model is null', () => {
    const provider = new GoogleVertexProvider(minimalConfig, {} as any);
    const resolveModelGardenPath = (provider as any).resolveModelGardenPath.bind(provider);
    expect(() => resolveModelGardenPath(null)).toThrow(
      'resolveModelGardenPath requires a model argument'
    );
  });

  it('throws an explicit error when model is empty string', () => {
    const provider = new GoogleVertexProvider(minimalConfig, {} as any);
    const resolveModelGardenPath = (provider as any).resolveModelGardenPath.bind(provider);
    expect(() => resolveModelGardenPath('')).toThrow(
      'resolveModelGardenPath requires a model argument'
    );
  });

  it('still resolves claude models correctly when model is defined', () => {
    const provider = new GoogleVertexProvider(minimalConfig, {} as any);
    const resolveModelGardenPath = (provider as any).resolveModelGardenPath.bind(provider);
    const result = resolveModelGardenPath('claude-sonnet-4-6');
    expect(result).toBe('publishers/anthropic/models/claude-sonnet-4-6');
  });

  it('returns model as-is for gemini models (no publisher prefix needed)', () => {
    const provider = new GoogleVertexProvider(minimalConfig, {} as any);
    const resolveModelGardenPath = (provider as any).resolveModelGardenPath.bind(provider);
    const result = resolveModelGardenPath('gemini-2.0-flash');
    expect(result).toBe('gemini-2.0-flash');
  });
});
