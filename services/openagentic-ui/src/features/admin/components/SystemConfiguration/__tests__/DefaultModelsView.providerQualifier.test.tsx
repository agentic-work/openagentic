/**
 * DefaultModelsView — model picker must render the provider qualifier
 * alongside each model row so duplicates can be told apart.
 *
 * Live regression captured 2026-05-01: user adds the in-cluster
 * ollama-embedding pod (a second GPU node) as a second Ollama provider. Both the
 * bootstrap `ollama-hal` provider and the new `hal` (a second GPU node) provider
 * have `nomic-embed-text:latest` in their model list, so the Registry
 * has two rows with identical `model` strings but different `provider`
 * values. The picker option only rendered `m.model`, leaving the user
 * with no way to tell which one was which.
 *
 * Contract pinned here:
 *   - When two registry rows share the same `model` ID, each option in
 *     the picker dropdown renders both the model id AND the provider
 *     qualifier (preferring `provider_display_name`, falling back to
 *     `provider`).
 *   - The qualifier is rendered in a way the user can read — visible
 *     text, not just an aria attribute or a tooltip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mockApiRequest = vi.fn();
const mockUseAdminQuery = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

vi.mock('../../../hooks/useAdminQuery', () => ({
  useAdminQuery: (...args: unknown[]) => mockUseAdminQuery(...args),
  useAdminInvalidate: () => vi.fn(),
}));

import DefaultModelsView from '../DefaultModelsView';

// Live-shape fixtures matching what /admin/llm-providers/registry returns
// (captured from chat-dev 2026-05-01).
const REGISTRY_WITH_DUPLICATE_NOMIC = [
  {
    id: 'b3d993a3-813f-4221-80ce-eda397f99662',
    model: 'nomic-embed-text:latest',
    provider: 'hal',
    provider_display_name: 'hal',
    enabled: true,
    capabilities: { embeddings: true, chat: true },
    roles: ['embeddings'],
  },
  {
    id: '580ffaaa-75fd-4c3a-89b0-9aaab09de665',
    model: 'nomic-embed-text:latest',
    provider: 'ollama-hal',
    provider_display_name: 'Ollama (hal)',
    enabled: true,
    capabilities: { embeddings: true, chat: true },
    roles: ['embeddings'],
  },
  {
    id: 'de2d10e5-ce05-4410-b152-43f4e4b20d8c',
    model: 'gpt-oss:20b',
    provider: 'ollama-hal',
    provider_display_name: 'Ollama (hal)',
    enabled: true,
    capabilities: { chat: true, tools: true },
    roles: ['chat'],
  },
];

const DEFAULT_DEFAULTS = {
  chat: 'gpt-oss:20b',
  code: 'gpt-oss:20b',
  embedding: 'nomic-embed-text:latest',
  vision: null,
  imageGen: null,
};

const TUNING_DATA = {
  tuning: { fcaChatPoolFloor: 0.82, fcaDestructiveFloor: 0.95, costWeight: 0.5, qualityWeight: 0.5 },
};

function setupMocks() {
  mockUseAdminQuery.mockImplementation((_k: string[], endpoint: string) => {
    if (endpoint.includes('llm-providers/default-models'))
      return { data: { defaults: DEFAULT_DEFAULTS }, isLoading: false, error: null };
    if (endpoint.includes('llm-providers/registry'))
      return { data: REGISTRY_WITH_DUPLICATE_NOMIC, isLoading: false, error: null };
    if (endpoint.includes('router-tuning'))
      return { data: TUNING_DATA, isLoading: false, error: null };
    return { data: null, isLoading: false, error: null };
  });
  mockApiRequest.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ defaults: DEFAULT_DEFAULTS, changed: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })),
  );
}

describe('DefaultModelsView — provider qualifier on duplicate-model picker rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('embedding picker shows BOTH nomic-embed-text rows with their provider qualifier', async () => {
    render(<DefaultModelsView />);

    // Open the embedding picker.
    fireEvent.click(screen.getByLabelText('model picker for embedding'));
    await waitFor(() => expect(screen.getByTestId('dropdown-embedding')).toBeDefined());

    const dropdown = screen.getByTestId('dropdown-embedding');

    // Both nomic options should be present (different ids).
    const nomicOptions = Array.from(
      dropdown.querySelectorAll('[data-value="nomic-embed-text:latest"]'),
    );
    expect(nomicOptions.length).toBe(2);

    // The dropdown text content must include BOTH provider qualifiers so
    // the user can tell the rows apart.
    const dropdownText = dropdown.textContent || '';
    expect(dropdownText).toMatch(/Ollama \(hal\)/);
    expect(dropdownText).toMatch(/\bhal\b/); // the user-named "hal" provider
  });

  it('embedding picker option carries the provider name in its visible text — not just aria', async () => {
    render(<DefaultModelsView />);

    fireEvent.click(screen.getByLabelText('model picker for embedding'));
    await waitFor(() => expect(screen.getByTestId('dropdown-embedding')).toBeDefined());

    const nomicOptions = Array.from(
      screen.getByTestId('dropdown-embedding').querySelectorAll('[data-value="nomic-embed-text:latest"]'),
    ) as HTMLElement[];
    expect(nomicOptions.length).toBe(2);

    // Each option's textContent must contain its provider's display name.
    const haveOllamaHalOption = nomicOptions.some(opt => (opt.textContent || '').includes('Ollama (hal)'));
    const haveBareHalOption = nomicOptions.some(opt => /(?:^|\W)hal(?:\W|$)/.test(opt.textContent || ''));
    expect(haveOllamaHalOption).toBe(true);
    expect(haveBareHalOption).toBe(true);
  });
});
