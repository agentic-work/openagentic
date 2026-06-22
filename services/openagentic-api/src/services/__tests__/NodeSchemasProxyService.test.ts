/**
 * NodeSchemasProxyService — unit tests (TDD RED-first)
 *
 * 5 scenarios:
 *   S1. Happy proxy — workflows-service returns data; service returns it.
 *   S2. Workflows-service unreachable (network error) — falls back to empty registry.
 *   S3. Workflows-service returns HTTP 500 — falls back to empty registry.
 *   S4. Workflows-service returns empty/malformed body — falls back to empty registry.
 *   S5. Cache hit — second call within 60 s does NOT fire another axios request.
 *
 * Mocking strategy:
 *   - vi.mock('axios') — intercept outbound HTTP.
 *   - WORKFLOW_SERVICE_URL is set per-test via process.env manipulation.
 *   - Service module is dynamically imported AFTER env vars are set so
 *     module-level constants pick up the right values.
 *   - Cache is reset between tests by calling service.__resetCache().
 *
 * Bun-compatibility rules applied (lessons 2, 3, 9, 10):
 *   - vi.fn() factories captured BEFORE dynamic import.
 *   - vi.mock hoisted before test body.
 *   - No raw `any` in production interface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock axios — must be hoisted before any dynamic import of the module under test
// ---------------------------------------------------------------------------
vi.mock('axios', () => {
  const get = vi.fn();
  return {
    default: { get },
    get,
  };
});

// ---------------------------------------------------------------------------
// Types for the service interface (mirrors what we will implement)
// ---------------------------------------------------------------------------
export interface NodeSchemasPayload {
  schemas: unknown[];
  aiPromptFragment: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the module registry so WORKFLOW_SERVICE_URL re-resolves on next import. */
async function freshService() {
  // Use unstable_moduleEnvironment reset where available; fall back to dynamic re-import
  // using a cache-busting query that vitest ignores.  The simplest portable approach for
  // vitest: call vi.resetModules() then re-import.
  vi.resetModules();
  const mod = await import('../NodeSchemasProxyService.js');
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NodeSchemasProxyService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear module registry so service cache is fresh each test
    vi.resetModules();
    // Reset env
    delete process.env.WORKFLOW_SERVICE_URL;
  });

  // -------------------------------------------------------------------------
  // S1. Happy proxy
  // -------------------------------------------------------------------------
  it('S1: returns data from workflows-service when reachable', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://openagentic-workflows:3400';
    const axios = (await import('axios')).default;

    const mockPayload: NodeSchemasPayload = {
      schemas: [{ type: 'llm_completion', category: 'ai' }],
      aiPromptFragment: '### Ai\n- **llm_completion**',
    };
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: mockPayload, status: 200 });

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();
    const result = await svc.getNodeSchemas();

    expect(result.schemas).toHaveLength(1);
    expect(result.aiPromptFragment).toContain('llm_completion');
    expect(axios.get).toHaveBeenCalledOnce();
    expect(axios.get).toHaveBeenCalledWith(
      'http://openagentic-workflows:3400/node-schemas',
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  // -------------------------------------------------------------------------
  // S2. Workflows-service unreachable (network error)
  // -------------------------------------------------------------------------
  it('S2: falls back to empty registry when workflows-service is unreachable', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://openagentic-workflows:3400';
    const axios = (await import('axios')).default;

    (axios.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();
    const result = await svc.getNodeSchemas();

    expect(result.schemas).toEqual([]);
    expect(result.aiPromptFragment).toBe('');
  });

  // -------------------------------------------------------------------------
  // S3. Workflows-service returns HTTP 500
  // -------------------------------------------------------------------------
  it('S3: falls back to empty registry when workflows-service returns 500', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://openagentic-workflows:3400';
    const axios = (await import('axios')).default;

    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      isAxiosError: true,
      response: { status: 500, data: { error: 'Internal Server Error' } },
    });
    (axios.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(axiosError);

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();
    const result = await svc.getNodeSchemas();

    expect(result.schemas).toEqual([]);
    expect(result.aiPromptFragment).toBe('');
  });

  // -------------------------------------------------------------------------
  // S4. Empty/malformed response body
  // -------------------------------------------------------------------------
  it('S4: falls back to empty registry when workflows-service returns malformed body', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://openagentic-workflows:3400';
    const axios = (await import('axios')).default;

    // Respond with null data — service should not crash
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null, status: 200 });

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();
    const result = await svc.getNodeSchemas();

    expect(result.schemas).toEqual([]);
    expect(result.aiPromptFragment).toBe('');
  });

  // -------------------------------------------------------------------------
  // S5. Cache hit — second call must NOT fire axios again
  // -------------------------------------------------------------------------
  it('S5: caches successful response and does not re-fetch within 60 s', async () => {
    process.env.WORKFLOW_SERVICE_URL = 'http://openagentic-workflows:3400';
    const axios = (await import('axios')).default;

    const mockPayload: NodeSchemasPayload = {
      schemas: [{ type: 'condition', category: 'logic' }],
      aiPromptFragment: '### Logic\n- **condition**',
    };
    (axios.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockPayload, status: 200 });

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();

    const first = await svc.getNodeSchemas();
    const second = await svc.getNodeSchemas();

    // Both calls should return same data
    expect(first).toEqual(second);
    // axios.get should have been called exactly once (cache hit on second call)
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // S6 (bonus): WORKFLOW_SERVICE_URL unset — immediate empty registry, no HTTP
  // -------------------------------------------------------------------------
  it('S6: returns empty registry immediately when WORKFLOW_SERVICE_URL is not set', async () => {
    // env already cleared in beforeEach
    const axios = (await import('axios')).default;

    const { NodeSchemasProxyService } = await freshService();
    const svc = new NodeSchemasProxyService();
    const result = await svc.getNodeSchemas();

    expect(result.schemas).toEqual([]);
    expect(result.aiPromptFragment).toBe('');
    expect(axios.get).not.toHaveBeenCalled();
  });
});
