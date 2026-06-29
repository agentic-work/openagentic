/**
 * RegistryTab.toggle.test.tsx — StateMachineToggle integration tests (MC-H)
 *
 * Verifies that RegistryTab uses StateMachineToggle for per-model enable/disable
 * with the full state-machine feedback contract:
 *   idle → optimistic → busy → confirmed | rollback
 *
 * Mirrors the ProviderCard.toggle.test.tsx pattern from MC-G (commit 73470f16).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { RegistryTab } from '../RegistryTab';
import type { ModelInfo, DbProvider } from '../constants';

// ── Module stubs ────────────────────────────────────────────────────────────

// Stub apiRequest so tests control HTTP responses.
const mockApiRequest = vi.fn();
vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiEndpoint: (p: string) => p,
}));

vi.mock('@/utils/modelSync', () => ({
  emitModelsChanged: vi.fn(),
}));

// ── Factories ───────────────────────────────────────────────────────────────

/**
 * Minimal ModelInfo with a registry-style UUID id so the PATCH branch is taken.
 */
function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: '11111111-2222-3333-4444-555555555555', // UUID → registry PATCH path
    name: 'gpt-4o',
    provider: 'Azure OpenAI',
    providerId: 'azure-openai-prod',
    providerType: 'azure-openai',
    providerName: 'azure-openai-prod',
    capabilities: {
      chat: true, embeddings: false, tools: true,
      vision: true, thinking: false, imageGeneration: false, streaming: true,
    },
    maxTokens: 4096,
    contextWindow: 128000,
    tier: 'balanced',
    enabled: true,
    ...overrides,
  };
}

function makeAifClaudeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return makeModel({
    id: '22222222-3333-4444-5555-666666666666',
    name: 'claude-3-5-sonnet',
    provider: 'Azure AI Foundry',
    providerId: 'aif-prod',
    providerType: 'azure-ai-foundry',
    providerName: 'aif-prod',
    enabled: false,
    ...overrides,
  });
}

const baseProviders: DbProvider[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

function okResponse(body = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResponse(status = 500, text = 'Internal Server Error'): Response {
  return new Response(text, { status });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RegistryTab StateMachineToggle (MC-H)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Renders StateMachineToggle for each row ───────────────────────────

  it('renders StateMachineToggle for each registry row', () => {
    const models = [
      makeModel({ id: '11111111-2222-3333-4444-000000000001', name: 'gpt-4o' }),
      makeModel({ id: '11111111-2222-3333-4444-000000000002', name: 'gpt-4-turbo' }),
      makeModel({ id: '11111111-2222-3333-4444-000000000003', name: 'gpt-3.5-turbo' }),
    ];

    render(
      <RegistryTab models={models} providers={baseProviders} onRefresh={vi.fn()} />,
    );

    // StateMachineToggle renders as role="switch"
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
  });

  // ── 2. Fires PATCH on click ──────────────────────────────────────────────

  it('flips PATCH /admin/llm-providers/registry/:id when clicked', async () => {
    mockApiRequest.mockResolvedValue(okResponse());
    const model = makeModel({ enabled: true });

    render(
      <RegistryTab models={[model]} providers={baseProviders} onRefresh={vi.fn()} />,
    );

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(200);
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      `/admin/llm-providers/registry/${model.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }), // was true → toggling to false
      }),
    );
  });

  // ── 3. Returns true and calls onRefresh on 200 ───────────────────────────

  it('returns true and refreshes on 200', async () => {
    mockApiRequest.mockResolvedValue(okResponse());
    const onRefresh = vi.fn();
    const model = makeModel({ enabled: false });

    render(
      <RegistryTab models={[model]} providers={baseProviders} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByRole('switch'));

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(200);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // ── 4. Returns false and shows error toast on non-OK response ────────────

  it('returns false on non-OK response and shows error toast', async () => {
    mockApiRequest.mockResolvedValue(errResponse(500, 'DB down'));
    const onRefresh = vi.fn();
    const model = makeModel({ enabled: true });

    render(
      <RegistryTab models={[model]} providers={baseProviders} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByRole('switch'));

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(200);
    });

    // onRefresh must NOT be called on failure
    expect(onRefresh).not.toHaveBeenCalled();

    // An error toast should appear in the DOM
    expect(screen.getByText(/failed to toggle/i)).toBeTruthy();
  });

  // ── 5. Disabled when isAnthropicOnAIF(model) === true ───────────────────

  it('is disabled when isAnthropicOnAIF(model) === true', async () => {
    mockApiRequest.mockResolvedValue(okResponse());
    const onRefresh = vi.fn();
    const aifModel = makeAifClaudeModel();

    render(
      <RegistryTab models={[aifModel]} providers={baseProviders} onRefresh={onRefresh} />,
    );

    const toggle = screen.getByRole('switch');

    // The toggle must carry the disabled attribute
    expect(toggle).toHaveAttribute('disabled');

    // Clicking a disabled toggle must not fire the API
    fireEvent.click(toggle);

    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(200);
    });

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
