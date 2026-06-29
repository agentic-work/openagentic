/**
 * Task 4 test — the new useRegistryModels hook is the toolbar's sole data
 * source, replacing the /chat/models fetch that used to read from
 * providerManager.discoveredCapabilities.
 *
 * Covers the pure mapping function (mapRegistryRowToToolbarModel) + the
 * fetch hook wiring (calls /api/admin/llm-providers/registry?enabledOnly=true
 * and exposes the mapped models).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRegistryModels, mapRegistryRowToToolbarModel, type RegistryModelRow } from '../useRegistryModels';

const mkRow = (over: Partial<RegistryModelRow> = {}): RegistryModelRow => ({
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

describe('mapRegistryRowToToolbarModel (pure)', () => {
  it('maps core fields: id, name, provider, description', () => {
    const row = mkRow();
    const out = mapRegistryRowToToolbarModel(row);
    expect(out.id).toBe('claude-sonnet-4-6');
    expect(out.name).toBe('Claude Sonnet 4.6');
    expect(out.provider).toBe('aws-bedrock');
    expect(out.description).toBe('Claude Sonnet 4.6');
  });

  it('translates capabilities to the toolbar capability strings', () => {
    const row = mkRow({
      capabilities: { chat: true, tools: true, streaming: true, vision: true, thinking: false, embeddings: false, imageGeneration: false },
    });
    const out = mapRegistryRowToToolbarModel(row);
    expect(out.capabilities).toEqual(expect.arrayContaining(['vision', 'function-calling', 'streaming']));
  });

  it('sets type=chat for role=chat', () => {
    expect(mapRegistryRowToToolbarModel(mkRow({ role: 'chat' })).type).toBe('chat');
  });

  it('sets type=embedding for role=embeddings', () => {
    expect(mapRegistryRowToToolbarModel(mkRow({ role: 'embeddings' })).type).toBe('embedding');
  });

  it('sets thinking=true when capabilities.thinking', () => {
    const row = mkRow({ capabilities: { chat: true, tools: false, streaming: false, vision: false, thinking: true, embeddings: false, imageGeneration: false } });
    expect(mapRegistryRowToToolbarModel(row).thinking).toBe(true);
  });

  it('falls back to model id when description is null', () => {
    const row = mkRow({ description: null });
    expect(mapRegistryRowToToolbarModel(row).name).toBe('claude-sonnet-4-6');
  });

  it('exposes max_tokens as maxOutputTokens', () => {
    const row = mkRow({ max_tokens: 8192 });
    expect(mapRegistryRowToToolbarModel(row).maxOutputTokens).toBe(8192);
  });
});

describe('useRegistryModels (fetch + state)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // jsdom envs expose fetch; wipe it so we can spy.
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls /api/admin/llm-providers/registry?enabledOnly=true and exposes mapped models', async () => {
    const rows: RegistryModelRow[] = [mkRow(), mkRow({ id: 'row-2', model: 'gpt-5', description: 'GPT-5', provider: 'openai' })];
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => rows,
    } as any);

    const { result } = renderHook(() => useRegistryModels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/admin/llm-providers/registry?enabledOnly=true');
    expect(result.current.models).toHaveLength(2);
    expect(result.current.models[0].id).toBe('claude-sonnet-4-6');
    expect(result.current.models[1].id).toBe('gpt-5');
    expect(result.current.error).toBeNull();
  });

  it('exposes error state when fetch fails', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as any);

    const { result } = renderHook(() => useRegistryModels());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/503/);
    expect(result.current.models).toHaveLength(0);
  });

  it('passes auth headers from options when provided', async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] } as any);

    const { result } = renderHook(() => useRegistryModels({ getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }) }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as any).headers.Authorization).toBe('Bearer test-token');
  });
});
