/**
 * Task 5 tests — the admin Models page's data source swap from /discover-models
 * + provider_config.models[] to the Registry SoT endpoint.
 *
 * Covers the pure mapping (Registry row → ModelInfo used by RegistryTab)
 * + the hook that drives the list (loads all rows, groups by provider,
 * exposes toggle/edit actions that PATCH back to the Registry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useAdminRegistry,
  mapRegistryRowToAdminModelInfo,
  type RegistryEndpointRow,
} from '../useAdminRegistry';

const mkRow = (over: Partial<RegistryEndpointRow> = {}): RegistryEndpointRow => ({
  id: 'row-1',
  model: 'claude-sonnet-4-6',
  provider: 'aws-bedrock',
  role: 'chat',
  priority: 100,
  enabled: true,
  temperature: 0.7,
  max_tokens: 4096,
  capabilities: { chat: true, tools: true, streaming: true, vision: false, thinking: false, embeddings: false, imageGeneration: false },
  description: 'Claude Sonnet 4.6',
  options: { auto: true },
  provider_display_name: 'AWS Bedrock',
  provider_enabled: true,
  ...over,
});

describe('mapRegistryRowToAdminModelInfo (pure)', () => {
  it('maps id, name, provider fields', () => {
    const out = mapRegistryRowToAdminModelInfo(mkRow());
    expect(out.id).toBe('row-1');
    expect(out.name).toBe('claude-sonnet-4-6');
    expect(out.providerName).toBe('aws-bedrock');
    expect(out.providerDisplayName).toBe('AWS Bedrock');
  });

  it('carries the enabled flag', () => {
    expect(mapRegistryRowToAdminModelInfo(mkRow({ enabled: true })).enabled).toBe(true);
    expect(mapRegistryRowToAdminModelInfo(mkRow({ enabled: false })).enabled).toBe(false);
  });

  it('records role + priority so the admin UI can sort/group', () => {
    const out = mapRegistryRowToAdminModelInfo(mkRow({ role: 'reasoning', priority: 5 }));
    expect(out.role).toBe('reasoning');
    expect(out.priority).toBe(5);
  });

  it('surfaces capabilities as an array of enabled names', () => {
    const out = mapRegistryRowToAdminModelInfo(
      mkRow({ capabilities: { chat: true, tools: true, streaming: false, vision: true, thinking: true, embeddings: false, imageGeneration: false } })
    );
    expect(out.capabilities).toEqual(expect.arrayContaining(['chat', 'tools', 'vision', 'thinking']));
    expect(out.capabilities).not.toContain('streaming');
    expect(out.capabilities).not.toContain('embeddings');
  });

  it('records provider_enabled (so the UI can gray out rows from disabled providers)', () => {
    expect(mapRegistryRowToAdminModelInfo(mkRow({ provider_enabled: false })).providerEnabled).toBe(false);
  });
});

describe('useAdminRegistry (fetch + mutation)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches /admin/llm-providers/registry?enabledOnly=false on mount', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [mkRow(), mkRow({ id: 'row-2', model: 'gpt-5' })] } as any);

    const { result } = renderHook(() => useAdminRegistry());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/admin/llm-providers/registry?enabledOnly=false');
    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0].name).toBe('claude-sonnet-4-6');
  });

  it('exposes total count, enabled count, and provider count stats', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [
        mkRow({ id: 'a', model: 'a', provider: 'prov-1', enabled: true }),
        mkRow({ id: 'b', model: 'b', provider: 'prov-1', enabled: false }),
        mkRow({ id: 'c', model: 'c', provider: 'prov-2', enabled: true }),
      ],
    } as any);

    const { result } = renderHook(() => useAdminRegistry());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.enabled).toBe(2);
    expect(result.current.stats.providerCount).toBe(2);
  });

  it('toggleEnabled fires PATCH to /admin/llm-providers/registry/:id with { enabled: false } and optimistically flips state', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockImplementation(async (url: any, init: any = {}) => {
      if (String(url).endsWith('/registry?enabledOnly=false')) {
        return { ok: true, json: async () => [mkRow({ id: 'row-tog', model: 'toggle-me', enabled: true })] } as any;
      }
      if ((init.method || '').toUpperCase() === 'PATCH') {
        return { ok: true, json: async () => ({}) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    const { result } = renderHook(() => useAdminRegistry());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleEnabled('row-tog', false);
    });

    // Optimistic state: the row should now show enabled=false
    const row = result.current.models.find(m => m.id === 'row-tog');
    expect(row?.enabled).toBe(false);

    // PATCH call was made with the right payload
    const patchCall = fetchSpy.mock.calls.find(c => (c[1] as any)?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect(String(patchCall![0])).toContain('/admin/llm-providers/registry/row-tog');
    const body = JSON.parse((patchCall![1] as any).body);
    expect(body).toEqual({ enabled: false });
  });
});
