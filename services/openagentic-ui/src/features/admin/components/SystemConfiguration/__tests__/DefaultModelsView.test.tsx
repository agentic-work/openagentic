/**
 * DefaultModelsView tests — RTL + vitest
 *
 * Tests:
 *  1.  Renders with 5 category rows + 3-step precedence flow
 *  2.  Model picker for "chat" lists only models from registry?enabledOnly=true
 *  3.  Saved value not in registry → inline error banner
 *  4.  PUT fires when "Save" clicked with only the dirty category's patch
 *  5.  400 from PUT renders error toast with server's error message
 *  6.  "Reset to helm seed" calls POST /api/admin/llm-providers/default-models/reset
 *  7.  Dirty tracking: editing one category shows "1 change pending"
 *  8.  Scope note renders with "Router Tuning" link text
 *  9.  Applied-to tags render per category (chat shows ChatCompletionService)
 *  10. FCA-floor warning banner renders when chat/code default is below router tuning's fcaChatPoolFloor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// ── Import component after mocks ──────────────────────────────────────────────

import DefaultModelsView from '../DefaultModelsView';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REGISTRY_MODELS = [
  {
    id: '1',
    model: 'global.anthropic.claude-haiku-4-5',
    provider: 'anthropic',
    enabled: true,
    fca_score: 0.87,
    cost_per_1k_tokens: 0.001,
    capabilities: { chat: true },
  },
  {
    id: '2',
    model: 'global.anthropic.claude-sonnet-4-6',
    provider: 'anthropic',
    enabled: true,
    fca_score: 0.94,
    cost_per_1k_tokens: 0.003,
    capabilities: { chat: true },
  },
  {
    id: '3',
    model: 'vertex-ai/text-embedding-005',
    provider: 'vertex-ai',
    enabled: true,
    fca_score: 0.90,
    cost_per_1k_tokens: 0.0001,
    capabilities: { embeddings: true },
  },
];

const DEFAULT_DEFAULTS = {
  chat: 'global.anthropic.claude-haiku-4-5',
  code: 'global.anthropic.claude-haiku-4-5',
  embedding: 'vertex-ai/text-embedding-005',
  vision: 'global.anthropic.claude-sonnet-4-6',
  imageGen: null,
};

const TUNING_DATA = {
  tuning: {
    fcaChatPoolFloor: 0.82,
    fcaDestructiveFloor: 0.95,
    costWeight: 0.5,
    qualityWeight: 0.5,
  },
};

function mkResponse(ok = true, body: unknown = {}, status = ok ? 200 : 400) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function setupDefaultMocks() {
  mockUseAdminQuery.mockImplementation((key: string[], endpoint: string) => {
    if (endpoint.includes('llm-providers/default-models')) {
      return { data: { defaults: DEFAULT_DEFAULTS }, isLoading: false, error: null };
    }
    if (endpoint.includes('llm-providers/registry')) {
      return { data: REGISTRY_MODELS, isLoading: false, error: null };
    }
    if (endpoint.includes('router-tuning')) {
      return { data: TUNING_DATA, isLoading: false, error: null };
    }
    return { data: null, isLoading: false, error: null };
  });
  mockApiRequest.mockImplementation(() => mkResponse(true, { defaults: DEFAULT_DEFAULTS, changed: [] }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DefaultModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ── 1. 5 category rows + 3-step precedence flow ───────────────────────────
  it('renders 5 category rows and a 3-step precedence flow', () => {
    render(<DefaultModelsView />);

    // 5 category rows
    expect(screen.getByTestId('category-row-chat')).toBeDefined();
    expect(screen.getByTestId('category-row-code')).toBeDefined();
    expect(screen.getByTestId('category-row-embedding')).toBeDefined();
    expect(screen.getByTestId('category-row-vision')).toBeDefined();
    expect(screen.getByTestId('category-row-imageGen')).toBeDefined();

    // Precedence flow section
    const flow = screen.getByTestId('precedence-flow');
    expect(flow).toBeDefined();

    // All 3 steps present
    expect(flow.textContent).toContain('WINS FIRST');
    expect(flow.textContent).toContain('FALLBACK');
    expect(flow.textContent).toContain('YOU ARE HERE');
  });

  // ── 2. Model picker lists only registry models ────────────────────────────
  it('model picker for chat opens and lists registry models', async () => {
    render(<DefaultModelsView />);

    // Open the chat picker
    const chatPicker = screen.getByLabelText('model picker for chat');
    fireEvent.click(chatPicker);

    await waitFor(() => {
      expect(screen.getByTestId('dropdown-chat')).toBeDefined();
    });

    // Should show registry models
    expect(screen.getByTestId('option-chat-global.anthropic.claude-haiku-4-5-anthropic')).toBeDefined();
    expect(screen.getByTestId('option-chat-global.anthropic.claude-sonnet-4-6-anthropic')).toBeDefined();
  });

  // ── 3. Stale model (not in registry) → inline error banner ───────────────
  it('shows stale banner when saved value is not in the enabled registry', () => {
    mockUseAdminQuery.mockImplementation((key: string[], endpoint: string) => {
      if (endpoint.includes('llm-providers/default-models')) {
        return {
          data: { defaults: { ...DEFAULT_DEFAULTS, chat: 'deprecated.model.that-is-gone' } },
          isLoading: false, error: null,
        };
      }
      if (endpoint.includes('llm-providers/registry')) {
        return { data: REGISTRY_MODELS, isLoading: false, error: null };
      }
      return { data: TUNING_DATA, isLoading: false, error: null };
    });

    render(<DefaultModelsView />);

    const banner = screen.getByTestId('stale-banner-chat');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('deprecated.model.that-is-gone');
    expect(banner.textContent).toContain('no longer in the registry');
  });

  // ── 4. PUT fires only dirty category patch ────────────────────────────────
  it('Save button fires PUT with only the dirty category patch', async () => {
    mockApiRequest.mockImplementation(() =>
      mkResponse(true, {
        defaults: { ...DEFAULT_DEFAULTS, code: 'global.anthropic.claude-sonnet-4-6' },
        changed: ['code'],
      }),
    );

    render(<DefaultModelsView />);

    // Open code picker and select a new model
    const codePicker = screen.getByLabelText('model picker for code');
    fireEvent.click(codePicker);

    await waitFor(() => {
      expect(screen.getByTestId('option-code-global.anthropic.claude-sonnet-4-6-anthropic')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('option-code-global.anthropic.claude-sonnet-4-6-anthropic'));

    // Now save
    await act(async () => {
      fireEvent.click(screen.getByTestId('save-button'));
    });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/api/admin/llm-providers/default-models',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('code'),
        }),
      );
    });

    // The body should NOT contain other categories that weren't changed
    const callArgs = mockApiRequest.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body).toHaveProperty('code', 'global.anthropic.claude-sonnet-4-6');
    // chat was NOT changed, so should not be in patch
    expect(body).not.toHaveProperty('chat');
  });

  // ── 5. 400 from PUT renders error toast ───────────────────────────────────
  it('shows error toast with server message on 400 PUT response', async () => {
    mockApiRequest.mockImplementation(() =>
      mkResponse(false, { message: 'UNREGISTERED_MODEL: model not in registry', error: 'UNREGISTERED_MODEL' }, 400),
    );

    render(<DefaultModelsView />);

    // Change chat model to trigger dirty state
    const chatPicker = screen.getByLabelText('model picker for chat');
    fireEvent.click(chatPicker);

    await waitFor(() => {
      expect(screen.getByTestId('option-chat-global.anthropic.claude-sonnet-4-6-anthropic')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('option-chat-global.anthropic.claude-sonnet-4-6-anthropic'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('save-button'));
    });

    await waitFor(() => {
      // Toast with error message should appear
      const toasts = document.querySelectorAll('[class*="toast"], [data-testid*="toast"]');
      const body = document.body.textContent || '';
      expect(body).toMatch(/UNREGISTERED_MODEL/i);
    });
  });

  // ── 6. "Reset All to Helm Seed" calls POST /reset ────────────────────────
  it('"Reset All to Helm Seed" calls POST /api/admin/llm-providers/default-models/reset', async () => {
    mockApiRequest.mockImplementation(() =>
      mkResponse(true, { defaults: DEFAULT_DEFAULTS }),
    );

    render(<DefaultModelsView />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset all to helm seed/i }));
    });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/api/admin/llm-providers/default-models/reset',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // ── 7. Dirty tracking — 1 change pending ─────────────────────────────────
  it('shows "1 change pending" after editing one category', async () => {
    render(<DefaultModelsView />);

    // Initially no pending changes
    expect(screen.getByText(/no pending changes/i)).toBeDefined();

    // Open vision picker and select a different model
    const visionPicker = screen.getByLabelText('model picker for vision');
    fireEvent.click(visionPicker);

    await waitFor(() => {
      expect(screen.getByTestId('option-vision-global.anthropic.claude-haiku-4-5-anthropic')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('option-vision-global.anthropic.claude-haiku-4-5-anthropic'));

    await waitFor(() => {
      expect(screen.getByText(/1 change pending/i)).toBeDefined();
    });
  });

  // ── 8. Scope note with "Router Tuning" text ───────────────────────────────
  it('scope note renders with "Router Tuning" reference', () => {
    render(<DefaultModelsView />);

    const note = screen.getByTestId('scope-note');
    expect(note).toBeDefined();
    expect(note.textContent).toContain('Router Tuning');
    expect(note.textContent?.toLowerCase()).toContain('tenant default');
  });

  // ── 9. Applied-to tags render per category ────────────────────────────────
  it('chat category shows ChatCompletionService applied-to tag', () => {
    render(<DefaultModelsView />);

    const tag = screen.getByTestId('applied-tag-chat-ChatCompletionService');
    expect(tag).toBeDefined();
    expect(tag.textContent).toBe('ChatCompletionService');
  });

  it('embeddings category shows UniversalEmbeddingService applied-to tag', () => {
    render(<DefaultModelsView />);

    const tag = screen.getByTestId('applied-tag-embedding-UniversalEmbeddingService');
    expect(tag).toBeDefined();
    expect(tag.textContent).toBe('UniversalEmbeddingService');
  });

  // ── 10. Breadcrumb shows "LLM" not "System Configuration" ────────────────
  it("breadcrumb contains 'LLM' not 'System Configuration'", () => {
    render(<DefaultModelsView />);

    const nav = document.querySelector('nav');
    expect(nav).not.toBeNull();
    const breadcrumbText = nav!.textContent ?? '';
    expect(breadcrumbText).toContain('LLM');
    expect(breadcrumbText).toContain('Default Models');
    expect(breadcrumbText).not.toContain('System Configuration');
  });

  // ── 11. FCA floor warning banner ─────────────────────────────────────────
  it('shows FCA floor warning when chat default is below fcaChatPoolFloor', async () => {
    // The chat model has fca=0.87 which is ABOVE the floor of 0.82 by default.
    // We need a model BELOW the floor.
    // We override the tuning floor to be 0.90 (above the haiku fca of 0.87)
    mockUseAdminQuery.mockImplementation((key: string[], endpoint: string) => {
      if (endpoint.includes('llm-providers/default-models')) {
        return { data: { defaults: DEFAULT_DEFAULTS }, isLoading: false, error: null };
      }
      if (endpoint.includes('llm-providers/registry')) {
        return { data: REGISTRY_MODELS, isLoading: false, error: null };
      }
      if (endpoint.includes('router-tuning')) {
        return { data: { tuning: { ...TUNING_DATA.tuning, fcaChatPoolFloor: 0.90 } }, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });

    render(<DefaultModelsView />);

    // The current chat default (claude-haiku-4-5, fca=0.87) is below floor=0.90
    // But this is the savedValue, not draftValue — the warning only fires on draft changes.
    // We need to select the haiku model (which is already selected) as draft to trigger it.
    // Let's select another model and then switch back to haiku to see the warning.

    const chatPicker = screen.getByLabelText('model picker for chat');
    fireEvent.click(chatPicker);

    await waitFor(() => {
      expect(screen.getByTestId('option-chat-global.anthropic.claude-haiku-4-5-anthropic')).toBeDefined();
    });

    // Select sonnet (0.94, above floor — no warning)
    fireEvent.click(screen.getByTestId('option-chat-global.anthropic.claude-sonnet-4-6-anthropic'));

    // Now select haiku again (0.87, below floor=0.90 — warning should appear)
    fireEvent.click(screen.getByLabelText('model picker for chat'));

    await waitFor(() => {
      expect(screen.getByTestId('option-chat-global.anthropic.claude-haiku-4-5-anthropic')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('option-chat-global.anthropic.claude-haiku-4-5-anthropic'));

    await waitFor(() => {
      const warn = screen.getByTestId('fca-warn-chat');
      expect(warn).toBeDefined();
      expect(warn.textContent).toContain('fcaChatPoolFloor');
    });
  });

  // ── 12. No hardcoded hex or rgba() tints in source ────────────────────────
  it('source file uses theme CSS vars — no hardcoded hex or rgba() tints', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../DefaultModelsView.tsx'), 'utf8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hexMatches = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgbaMatches = code.match(/rgba?\s*\(/g) ?? [];
    expect(hexMatches, `hex found: ${hexMatches.slice(0,5).join(', ')}`).toHaveLength(0);
    expect(rgbaMatches, `rgba count: ${rgbaMatches.length}`).toHaveLength(0);
  });
});
