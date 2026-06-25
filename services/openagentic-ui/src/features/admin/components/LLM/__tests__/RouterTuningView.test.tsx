/**
 * RouterTuningView tests — RTL + vitest
 *
 * Tests:
 *  1. Renders default tuning values (fcaChatPoolFloor = 0.82)
 *  2. Clicking a chip enters edit mode
 *  3. Changing a value marks the view dirty (footer pending count)
 *  4. Discard button clears dirty state
 *  5. Save button calls apiRequest with PUT + patch body, clears dirty
 *  6. Reset button calls POST /reset
 *  7. Live scoring lab — simulated scores match expected values
 *  8. Filtered-out models have .filtered class on their table row
 *  9. Registry-driven lab: rows per registry model (in expanded card)
 * 10. Missing FCA defaults to 0.80
 * 11. Empty registry → info banner
 * 12. Single model → info banner
 * 13. Lab v2: 8 curated prompt cards rendered
 * 14. Lab v2: cards collapsed by default
 * 15. Lab v2: expanding a card shows candidate table
 * 16. Lab v2: destructive-delete filters low-FCA models
 * 17. Lab v2: haiku card top-ranked row has data-rank="1"
 * 18. Lab v2: custom prompt box scores a 9th card
 * 19. analyzePromptText unit tests
 * 20. AdminCard import conformance
 * 21. No hardcoded model IDs in source file
 * 22. Tooltip ? affordances (FieldHelp) — all 16 fields, popover content, learn-more link, Escape closes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before module imports that use them
// ---------------------------------------------------------------------------

const mockApiRequest = vi.fn();
const mockUseAdminQuery = vi.fn();

vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestJson: vi.fn(),
  apiEndpoint: (p: string) => p,
}));

vi.mock('../../../hooks/useAdminQuery', () => ({
  useAdminQuery: (...args: unknown[]) => mockUseAdminQuery(...args),
}));

// ---------------------------------------------------------------------------
// Import the component after mocks are in place
// ---------------------------------------------------------------------------

import RouterTuningView, {
  DEFAULT_TUNING,
  simulateScore,
  getFilterReason,
  LAB_PROMPTS,
  registryRowToLabModel,
  analyzePromptText,
  type LabModel,
} from '../RouterTuningView';

// ---------------------------------------------------------------------------
// Registry fixture factories
// ---------------------------------------------------------------------------

function makeRegistryRow(overrides: Partial<{
  id: string;
  model: string;
  provider: string;
  role: string;
  priority: number;
  enabled: boolean;
  capabilities: Record<string, unknown> | null;
}> = {}) {
  return {
    id: overrides.id ?? 'row-1',
    model: overrides.model ?? 'test/model-a',
    provider: overrides.provider ?? 'test-provider',
    role: overrides.role ?? 'chat',
    priority: overrides.priority ?? 100,
    enabled: overrides.enabled ?? true,
    capabilities: overrides.capabilities ?? {
      functionCallingAccuracy: 0.85,
      cost: { inputPer1kTokens: 0.001 },
      performance: { avgLatencyMs: 300 },
    },
  };
}

/** A "cheap" model — zero cost, low FCA, fast */
const CHEAP_ROW = makeRegistryRow({
  id: 'cheap-1',
  model: 'test/cheap-model',
  role: 'chat',
  capabilities: {
    functionCallingAccuracy: 0.83,
    cost: { inputPer1kTokens: 0 },
    performance: { avgLatencyMs: 150 },
  },
});

/** A "frontier" model — expensive, high FCA */
const FRONTIER_ROW = makeRegistryRow({
  id: 'frontier-1',
  model: 'test/frontier-model',
  role: 'reasoning',
  capabilities: {
    functionCallingAccuracy: 0.95,
    cost: { inputPer1kTokens: 0.015 },
    performance: { avgLatencyMs: 900 },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkResponse(ok = true, body: unknown = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/**
 * Set up useAdminQuery to return different values depending on which
 * query key is being called (router-tuning vs llm-registry).
 */
function setupQueryMock(registryRows: unknown[] = [CHEAP_ROW, FRONTIER_ROW]) {
  mockUseAdminQuery.mockImplementation((key: unknown[]) => {
    const firstKey = Array.isArray(key) ? key[0] : key;
    if (firstKey === 'llm-registry') {
      return { data: registryRows, isLoading: false, error: null };
    }
    // router-tuning
    return { data: { tuning: DEFAULT_TUNING, podCount: 3 }, isLoading: false, error: null };
  });
}

function renderView() {
  return render(<RouterTuningView />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RouterTuningView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupQueryMock();
    mockApiRequest.mockImplementation(() => mkResponse(true, {}));
  });

  // -------------------------------------------------------------------------
  // 1. Renders with default values
  // -------------------------------------------------------------------------
  it('renders fcaChatPoolFloor default value 0.82', () => {
    renderView();
    // Floor cards show the value — 0.82 is fcaChatPoolFloor default
    const cells = screen.getAllByText('0.82');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('renders the tenant-defaults scope note clarifying what this page does NOT tune', () => {
    renderView();
    const note = screen.getByTestId('router-tuning-scope-note');
    expect(note).toBeDefined();
    // Must mention Smart Router scope + tenant defaults are separate
    expect(note.textContent?.toLowerCase()).toContain('smart router');
    expect(note.textContent?.toLowerCase()).toContain('tenant default');
    expect(note.textContent?.toLowerCase()).toContain('default models');
  });

  it('source file uses theme CSS vars — no hardcoded hex or rgba() tints', async () => {
    // Regression guard: the rendered component must not hardcode
    // colors. Every color should come from a --color-* token so the
    // page re-themes when the user toggles light/dark or changes
    // accent. Hex + rgba() literals are banned outside a single doc
    // comment.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../RouterTuningView.tsx'), 'utf8');
    // Strip line comments and block comments so we only match executable code.
    const code = src
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // Hex literals: 3, 6, or 8 digits. Tokens like `var(--x, #abc)`
    // were removed in the same commit that ships this test.
    const hexMatches = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgbaMatches = code.match(/rgba?\s*\(/g) ?? [];
    expect(
      hexMatches,
      `RouterTuningView.tsx must not contain hardcoded hex colors. Found: ${hexMatches.slice(0, 5).join(', ')}`,
    ).toHaveLength(0);
    expect(
      rgbaMatches,
      `RouterTuningView.tsx must not contain rgba() tints — use color-mix(var(--color-*)) instead. Found ${rgbaMatches.length} occurrences.`,
    ).toHaveLength(0);
  });

  it('renders the "Scoring Formula" section heading', () => {
    renderView();
    expect(screen.getByText('Scoring Formula')).toBeDefined();
  });

  it('renders FCA Floors section heading', () => {
    renderView();
    expect(screen.getByText(/FCA Floors/i)).toBeDefined();
  });

  it('renders Live Scoring Lab heading', () => {
    renderView();
    expect(screen.getByText(/Live Scoring Lab/i)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 2. Clicking a chip enters edit mode
  // -------------------------------------------------------------------------
  it('clicking a formula chip shows an input in edit mode', () => {
    renderView();
    // costWeight chip has a val span with "0.5"
    const chip = screen.getByTitle(/edit costWeight/i);
    fireEvent.click(chip);
    const input = screen.getByLabelText(/edit costWeight/i);
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).tagName).toBe('INPUT');
  });

  it('clicking a floor card shows an input for the floor value', () => {
    renderView();
    // Floor card text "fcaChatPoolFloor" is visible in the DOM; click its parent div
    const floorLabel = screen.getByText('fcaChatPoolFloor');
    // The parent div is the clickable card
    fireEvent.click(floorLabel.parentElement!);
    // An input should now appear with the aria-label for that floor
    const input = screen.getByLabelText(/edit fcaChatPoolFloor/i);
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).tagName).toBe('INPUT');
  });

  // -------------------------------------------------------------------------
  // 3. Changing a value marks the view dirty
  // -------------------------------------------------------------------------
  it('editing costWeight to a new value shows "1 change pending" in footer', async () => {
    renderView();

    // open chip edit
    const chip = screen.getByTitle(/edit costWeight/i);
    fireEvent.click(chip);
    const input = screen.getByLabelText(/edit costWeight/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/1 change pending/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Discard button clears dirty state
  // -------------------------------------------------------------------------
  it('Discard button clears pending changes', async () => {
    renderView();

    // Make a dirty change
    fireEvent.click(screen.getByTitle(/edit costWeight/i));
    const input = screen.getByLabelText(/edit costWeight/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.9' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/change.*pending/i)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() => {
      expect(screen.getByText(/no pending changes/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Save calls apiRequest PUT with patch body and clears dirty
  // -------------------------------------------------------------------------
  it('Save button calls PUT /api/admin/router-tuning with patch body', async () => {
    renderView();

    // Make a dirty change
    fireEvent.click(screen.getByTitle(/edit costWeight/i));
    const input = screen.getByLabelText(/edit costWeight/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.6' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/change.*pending/i)).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save.*apply/i }));
    });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/api/admin/router-tuning',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('costWeight'),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/no pending changes/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5b. Save with a non-ok (500) response must NOT report success and must
  //     KEEP the pending edits (no silent-success / data loss).
  // -------------------------------------------------------------------------
  it('Save with a 500 response surfaces an error and keeps pending changes', async () => {
    mockApiRequest.mockImplementation(() => mkResponse(false, { message: 'weight out of range' }));
    renderView();

    // Make a dirty change
    fireEvent.click(screen.getByTitle(/edit costWeight/i));
    const input = screen.getByLabelText(/edit costWeight/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0.6' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText(/change.*pending/i)).toBeDefined());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save.*apply/i }));
    });

    // Error surfaced from the response body
    await waitFor(() => {
      expect(screen.getByText(/weight out of range/i)).toBeDefined();
    });

    // Pending edits are NOT cleared (no false "Saved successfully")
    expect(screen.getByText(/change.*pending/i)).toBeDefined();
    expect(screen.queryByText(/saved successfully/i)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 6. Reset calls POST /api/admin/router-tuning/reset
  // -------------------------------------------------------------------------
  it('Reset button calls POST /api/admin/router-tuning/reset', async () => {
    renderView();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/api/admin/router-tuning/reset',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. Live scoring lab — simulateScore / getFilterReason unit tests
  //    (use inline LabModel objects — no hardcoded model IDs)
  // -------------------------------------------------------------------------
  describe('simulateScore', () => {
    const tuning = DEFAULT_TUNING; // costWeight=0.5, qualityWeight=0.5

    it('free model gets cost-dominant score on simple haiku prompt (no complexity)', () => {
      const model: LabModel = { id: 'test/free-model', fca: 0.85, cost: 0, latency: 180, tier: 'chat' };
      const analysis = LAB_PROMPTS[0].analysis; // haiku — no tools, no multi-step
      const score = simulateScore(model, tuning, analysis);

      // costBonus = (1 - 0/0.02) * 25 * 0.5 = 12.5
      // latBonus = (1 - 180/1000) * 10 * 0.5 = 0.82 * 5 = 4.1
      // quality: gated OFF (no complexity) → 0
      // total = 16.6
      expect(score).toBeCloseTo(16.6, 1);
    });

    it('low-FCA model is filtered by fcaChatPoolFloor on simple chat prompt', () => {
      const lowFcaModel: LabModel = { id: 'test/low-fca', fca: 0.80, cost: 0, latency: 150, tier: 'chat' };
      const analysis = LAB_PROMPTS[0].analysis; // simple chat (haiku)
      const reason = getFilterReason(lowFcaModel, tuning, analysis);
      expect(reason).toMatch(/fcaChatPoolFloor/);
    });

    it('high-FCA model is not filtered on multicloud architecture prompt', () => {
      const highFcaModel: LabModel = { id: 'test/high-fca', fca: 0.95, cost: 0.015, latency: 900, tier: 'reasoning' };
      const analysis = LAB_PROMPTS[4].analysis; // multicloud-arch, complexityBias (index 4)
      const reason = getFilterReason(highFcaModel, tuning, analysis);
      expect(reason).toBeNull();
    });

    it('model gets quality bonus when tools are present', () => {
      const model: LabModel = { id: 'test/mid-model', fca: 0.87, cost: 0.001, latency: 300, tier: 'chat' };
      const noTools = LAB_PROMPTS[0].analysis;   // haiku — no tools
      const withTools = LAB_PROMPTS[2].analysis;  // list-subs — hasTools
      const scoreNoTools = simulateScore(model, tuning, noTools);
      const scoreWithTools = simulateScore(model, tuning, withTools);
      // With tools → quality bonus unlocked + tool bonus → higher score
      expect(scoreWithTools).toBeGreaterThan(scoreNoTools);
    });

    it('any model computes a non-negative score for any prompt', () => {
      const models: LabModel[] = [
        { id: 'test/a', fca: 0.80, cost: 0, latency: 150, tier: 'chat' },
        { id: 'test/b', fca: 0.87, cost: 0.001, latency: 300, tier: 'chat' },
        { id: 'test/c', fca: 0.94, cost: 0.003, latency: 600, tier: 'reasoning' },
        { id: 'test/d', fca: 0.95, cost: 0.015, latency: 900, tier: 'reasoning' },
      ];
      for (const model of models) {
        for (const prompt of LAB_PROMPTS) {
          const score = simulateScore(model, tuning, prompt.analysis);
          expect(score).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Filtered models have .filtered class on their table row (in expanded card)
  // -------------------------------------------------------------------------
  it('low-FCA model row has className filtered on simple chat prompt (haiku card expanded)', () => {
    // Provide a low-FCA cheap model that will be filtered on simple chat
    const lowFcaRow = makeRegistryRow({
      id: 'low-fca-1',
      model: 'test/low-fca-model',
      role: 'chat',
      capabilities: {
        functionCallingAccuracy: 0.80, // below fcaChatPoolFloor 0.82
        cost: { inputPer1kTokens: 0 },
        performance: { avgLatencyMs: 150 },
      },
    });
    const normalRow = makeRegistryRow({
      id: 'normal-1',
      model: 'test/normal-model',
      role: 'chat',
      capabilities: {
        functionCallingAccuracy: 0.85,
        cost: { inputPer1kTokens: 0.001 },
        performance: { avgLatencyMs: 300 },
      },
    });
    setupQueryMock([lowFcaRow, normalRow]);
    renderView();

    // Expand the haiku card (first prompt)
    const haikuToggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(haikuToggle);

    // Also enable "show filtered" so filtered rows are visible
    const showFilteredToggle = screen.getByTestId('lab-show-filtered-toggle');
    fireEvent.click(showFilteredToggle);

    // low-fca (fca=0.80) < fcaChatPoolFloor (0.82) → filtered
    const filteredRow = screen.getByTestId('lab-row-test/low-fca-model');
    expect(filteredRow.classList.contains('filtered')).toBe(true);
  });

  it('normal-FCA model row is NOT filtered on simple chat prompt', () => {
    const normalRow = makeRegistryRow({
      id: 'normal-2',
      model: 'test/above-floor-model',
      role: 'chat',
      capabilities: {
        functionCallingAccuracy: 0.85,
        cost: { inputPer1kTokens: 0.001 },
        performance: { avgLatencyMs: 300 },
      },
    });
    setupQueryMock([normalRow, FRONTIER_ROW]);
    renderView();

    // Expand the haiku card
    const haikuToggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(haikuToggle);

    const row = screen.getByTestId('lab-row-test/above-floor-model');
    expect(row.classList.contains('filtered')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 9. Registry-driven lab: renders a row per registry model (in expanded card)
  // -------------------------------------------------------------------------
  it('renders one table row per registry model returned from the API', () => {
    const rows = [
      makeRegistryRow({ id: 'r1', model: 'prov/model-x' }),
      makeRegistryRow({ id: 'r2', model: 'prov/model-y' }),
      makeRegistryRow({ id: 'r3', model: 'prov/model-z' }),
    ];
    setupQueryMock(rows);
    renderView();

    // Expand the haiku card (first prompt)
    const haikuToggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(haikuToggle);

    expect(screen.getByTestId('lab-row-prov/model-x')).toBeDefined();
    expect(screen.getByTestId('lab-row-prov/model-y')).toBeDefined();
    expect(screen.getByTestId('lab-row-prov/model-z')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 10. Missing capabilities.functionCallingAccuracy → defaults to 0.80
  // -------------------------------------------------------------------------
  it('registryRowToLabModel defaults fca to 0.80 when functionCallingAccuracy is missing', () => {
    const row = makeRegistryRow({
      model: 'prov/no-fca-model',
      capabilities: {
        // no functionCallingAccuracy
        cost: { inputPer1kTokens: 0.001 },
        performance: { avgLatencyMs: 300 },
      },
    });
    const labModel = registryRowToLabModel(row);
    expect(labModel.fca).toBe(0.80);
    expect(labModel.id).toBe('prov/no-fca-model');
  });

  it('model row with missing fca still renders in the table (defaults to 0.80)', () => {
    const rowNoFca = makeRegistryRow({
      id: 'no-fca-row',
      model: 'prov/no-fca-model',
      capabilities: { cost: { inputPer1kTokens: 0.001 }, performance: { avgLatencyMs: 300 } },
    });
    setupQueryMock([rowNoFca, FRONTIER_ROW]);
    renderView();

    // Expand the haiku card — rows only exist when card is expanded
    const haikuToggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(haikuToggle);

    // Enable show-filtered so any filtered rows are visible too
    const showFilteredToggle = screen.getByTestId('lab-show-filtered-toggle');
    fireEvent.click(showFilteredToggle);

    expect(screen.getByTestId('lab-row-prov/no-fca-model')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 11. Empty registry → info banner
  // -------------------------------------------------------------------------
  it('shows insufficient-models banner when registry returns 0 models', () => {
    setupQueryMock([]);
    renderView();
    const banner = screen.getByTestId('lab-insufficient-models-banner');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('At least 2 enabled models are required');
    expect(banner.textContent).toContain('Admin → LLM → Providers');
  });

  // -------------------------------------------------------------------------
  // 12. Single model → info banner (needs 2 for meaningful scoring)
  // -------------------------------------------------------------------------
  it('shows insufficient-models banner when only 1 model in registry', () => {
    setupQueryMock([CHEAP_ROW]);
    renderView();
    const banner = screen.getByTestId('lab-insufficient-models-banner');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('At least 2 enabled models are required');
  });

  // -------------------------------------------------------------------------
  // 13. Lab v2: 8 curated prompt cards rendered
  // -------------------------------------------------------------------------
  it('Lab v2 renders all 8 curated prompt cards', () => {
    renderView();
    const expectedIds = ['haiku', 'summarize-thread', 'list-subs', 'destructive-delete', 'multicloud-arch', 'aks-provision', 'cost-compare', 'migration-plan'];
    for (const id of expectedIds) {
      expect(screen.getByTestId(`lab-prompt-${id}`), `Missing card for prompt id: ${id}`).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // 14. Lab v2: cards are collapsed by default (expanded content absent)
  // -------------------------------------------------------------------------
  it('Lab v2: prompt cards are collapsed by default — expanded content is not visible', () => {
    renderView();
    // Expanded content uses data-testid="lab-prompt-expanded-{id}"
    expect(screen.queryByTestId('lab-prompt-expanded-haiku')).toBeNull();
    expect(screen.queryByTestId('lab-prompt-expanded-destructive-delete')).toBeNull();
    expect(screen.queryByTestId('lab-prompt-expanded-multicloud-arch')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 15. Lab v2: expanding a card shows candidate table
  // -------------------------------------------------------------------------
  it('Lab v2: clicking haiku card toggle shows candidate table', () => {
    setupQueryMock([CHEAP_ROW, FRONTIER_ROW]);
    renderView();

    // Initially collapsed
    expect(screen.queryByTestId('lab-prompt-expanded-haiku')).toBeNull();

    // Click toggle
    const toggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(toggle);

    // Now expanded content should be visible
    expect(screen.getByTestId('lab-prompt-expanded-haiku')).toBeDefined();

    // Both model rows should appear in the table
    expect(screen.getByTestId(`lab-row-${CHEAP_ROW.model}`)).toBeDefined();
    expect(screen.getByTestId(`lab-row-${FRONTIER_ROW.model}`)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 16. Lab v2: destructive-delete — models with FCA < 0.93 filtered
  // -------------------------------------------------------------------------
  it('Lab v2: destructive-delete card — low-FCA models filtered when show-filtered OFF', () => {
    setupQueryMock([CHEAP_ROW, FRONTIER_ROW]);
    renderView();

    // Expand the destructive-delete card
    const toggle = screen.getByTestId('lab-prompt-toggle-destructive-delete');
    fireEvent.click(toggle);

    // CHEAP_ROW.fca=0.83 < fcaDestructiveFloor=0.93 → filtered
    // Show filtered is OFF by default, so filtered rows should NOT appear
    expect(screen.queryByTestId(`lab-row-${CHEAP_ROW.model}`)).toBeNull();

    // FRONTIER_ROW.fca=0.95 >= 0.93 → survives
    expect(screen.getByTestId(`lab-row-${FRONTIER_ROW.model}`)).toBeDefined();
  });

  it('Lab v2: destructive-delete card — filtered rows visible when show-filtered ON', () => {
    setupQueryMock([CHEAP_ROW, FRONTIER_ROW]);
    renderView();

    // Enable show-filtered toggle
    const showFilteredToggle = screen.getByTestId('lab-show-filtered-toggle');
    fireEvent.click(showFilteredToggle);

    // Expand the destructive-delete card
    const toggle = screen.getByTestId('lab-prompt-toggle-destructive-delete');
    fireEvent.click(toggle);

    // Now filtered row should appear with class 'filtered'
    const cheapRow = screen.getByTestId(`lab-row-${CHEAP_ROW.model}`);
    expect(cheapRow).toBeDefined();
    expect(cheapRow.classList.contains('filtered')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 17. Lab v2: haiku card top-ranked row has data-rank="1"
  // -------------------------------------------------------------------------
  it('Lab v2: haiku card — top-ranked row has data-rank="1"', () => {
    setupQueryMock([CHEAP_ROW, FRONTIER_ROW]);
    renderView();

    // Expand the haiku card
    const toggle = screen.getByTestId('lab-prompt-toggle-haiku');
    fireEvent.click(toggle);

    // Find the row with data-rank="1"
    const rank1Row = screen.getByTestId('lab-prompt-expanded-haiku')
      .querySelector('[data-rank="1"]');
    expect(rank1Row).not.toBeNull();
    // CHEAP_ROW (cost=0, fast) wins haiku (cost-dominant, no quality gating)
    expect(rank1Row!.textContent).toContain(CHEAP_ROW.model);
  });

  // -------------------------------------------------------------------------
  // 18. Lab v2: custom prompt box → 9th card appears with flags
  // -------------------------------------------------------------------------
  it('Lab v2: custom prompt "compare azure vs aws spend" produces a 9th card with multiCloud + complexReasoning flags', async () => {
    setupQueryMock([CHEAP_ROW, FRONTIER_ROW]);
    renderView();

    // Type into custom prompt input
    const input = screen.getByTestId('lab-custom-prompt-input');
    fireEvent.change(input, { target: { value: 'compare azure vs aws spend' } });

    // Click Score button
    const scoreBtn = screen.getByTestId('lab-custom-prompt-score-btn');
    fireEvent.click(scoreBtn);

    // A custom result card should appear (data-testid="lab-prompt-custom" from LabPromptCard)
    await waitFor(() => {
      expect(screen.getByTestId('lab-prompt-custom')).toBeDefined();
    });

    // The LabPromptCard renders with defaultExpanded=true → expanded content visible
    const expandedContent = screen.getByTestId('lab-prompt-expanded-custom');
    expect(expandedContent).toBeDefined();

    // isMultiCloud and isComplexReasoning flags should be active
    expect(expandedContent.textContent).toContain('isMultiCloud ✓');
    expect(expandedContent.textContent).toContain('isComplexReasoning ✓');
  });

  // -------------------------------------------------------------------------
  // 19. analyzePromptText unit tests
  // -------------------------------------------------------------------------
  describe('analyzePromptText', () => {
    it('"Delete rg-prod-01" → destructive=true, hasTools=true', () => {
      const result = analyzePromptText('Delete resource group rg-prod-01');
      expect(result.destructive).toBe(true);
      expect(result.hasTools).toBe(true);
    });

    it('"write a haiku" → all flags false, no destructive', () => {
      const result = analyzePromptText('write a haiku');
      expect(result.hasTools).toBe(false);
      expect(result.isMultiStep).toBe(false);
      expect(result.isComplexReasoning).toBe(false);
      expect(result.isMultiCloud).toBe(false);
      expect(result.destructive).toBe(false);
      expect(result.complexityBias).toBe(false);
    });

    it('"multicloud architecture for enterprise scale" → complexityBias=true, isMultiCloud=true', () => {
      const result = analyzePromptText('multicloud architecture for enterprise scale');
      expect(result.complexityBias).toBe(true);
      expect(result.isMultiCloud).toBe(true);
    });

    it('estimatedTokens is proportional to text length (clamped 20–400)', () => {
      const short = analyzePromptText('hi');
      const long = analyzePromptText('a'.repeat(2000));
      expect(short.estimatedTokens).toBeGreaterThanOrEqual(20);
      expect(long.estimatedTokens).toBeLessThanOrEqual(400);
    });

    it('"provision an AKS cluster then deploy" → hasTools=true, isMultiStep=true', () => {
      const result = analyzePromptText('provision an AKS cluster then deploy my chart');
      expect(result.hasTools).toBe(true);
      expect(result.isMultiStep).toBe(true);
    });

    it('"compare azure vs aws" → isMultiCloud=true, isComplexReasoning=true', () => {
      const result = analyzePromptText('compare azure vs aws spend');
      expect(result.isMultiCloud).toBe(true);
      expect(result.isComplexReasoning).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 20. AdminCard import conformance — typography parity
  // -------------------------------------------------------------------------
  it('RouterTuningView.tsx imports AdminCard from ../Shared', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../RouterTuningView.tsx'), 'utf8');
    expect(src).toContain('AdminCard');
    expect(src).toContain("from '../Shared'");
  });

  // -------------------------------------------------------------------------
  // 16. Tooltip ? affordances — FieldHelp renders for every editable field
  // -------------------------------------------------------------------------

  it('renders a ? affordance for all 16 editable fields', () => {
    renderView();
    const allFieldNames = [
      'fcaChatPoolFloor', 'fcaSimpleToolFloor', 'fcaComplexToolFloor',
      'fcaDestructiveFloor', 'fcaInfraOpsFloor', 'fcaComplexityBiasFloor',
      'fcaQualityFloor', 'fcaQualityMultiplier', 'fcaQualityGatedByComplexity',
      'costWeight', 'qualityWeight', 'costBonusMaxPoints',
      'costNormalizationCeiling', 'latencyBonusMaxPoints',
      'toolCallingBonusMaxPoints', 'reasoningBonusMaxPoints',
    ];
    for (const fieldName of allFieldNames) {
      expect(
        screen.getByTestId(`field-help-${fieldName}`),
        `Missing ? affordance for field: ${fieldName}`,
      ).toBeDefined();
    }
  });

  it('clicking the ? for fcaChatPoolFloor renders popover with summary text', async () => {
    renderView();
    const helpBtn = screen.getByTestId('field-help-fcaChatPoolFloor');
    fireEvent.click(helpBtn);
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toBeDefined();
      expect(screen.getByRole('tooltip').textContent).toContain('Minimum FCA for pure chat');
    });
  });

  it('fcaChatPoolFloor popover has a "Learn more" link to the correct doc anchor', async () => {
    renderView();
    const helpBtn = screen.getByTestId('field-help-fcaChatPoolFloor');
    fireEvent.click(helpBtn);
    await waitFor(() => {
      const link = screen.getByTestId('field-help-link-fcaChatPoolFloor');
      expect(link).toBeDefined();
      expect((link as HTMLAnchorElement).href).toContain('/docs/admin/router-tuning#fcaChatPoolFloor');
    });
  });

  it('pressing Escape closes the FieldHelp popover', async () => {
    renderView();
    const helpBtn = screen.getByTestId('field-help-fcaChatPoolFloor');
    fireEvent.click(helpBtn);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeNull());
    fireEvent.keyDown(helpBtn.parentElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('RouterTuningView.tsx introduces no hardcoded hex or rgba() colors (tooltip regression)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../RouterTuningView.tsx'), 'utf8');
    const code = src
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const hexMatches = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgbaMatches = code.match(/rgba?\s*\(/g) ?? [];
    expect(hexMatches, `No hardcoded hex colors allowed. Found: ${hexMatches.slice(0, 5).join(', ')}`).toHaveLength(0);
    expect(rgbaMatches, `No rgba() tints allowed — use color-mix(). Found: ${rgbaMatches.length}`).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 21. No hardcoded model IDs in RouterTuningView.tsx
  //     Regression scan enforcing no-hardcoded-models.md rule
  // -------------------------------------------------------------------------
  it('RouterTuningView.tsx contains no hardcoded model ID literals', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../RouterTuningView.tsx'), 'utf8');
    // Strip comments so we only check executable code
    const code = src
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const forbidden = ['gpt-oss', 'ministral', 'claude-', 'anthropic', 'ollama/'];
    for (const pattern of forbidden) {
      expect(
        code,
        `RouterTuningView.tsx must not contain hardcoded model literal: "${pattern}"`,
      ).not.toContain(pattern);
    }
  });
});
