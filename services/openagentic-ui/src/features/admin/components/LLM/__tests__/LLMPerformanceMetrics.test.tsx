/**
 * LLMPerformanceMetrics tests — RTL + vitest
 *
 * Tests:
 *  1.  Renders "Router Health" section heading.
 *  2.  Mocks /api/metrics with sample Prometheus text; asserts 5 panels render.
 *  3.  Decision-by-tier panel shows 3 distinct tier labels.
 *  4.  Escalation panel shows 5 types.
 *  5.  Quality-bonus panel shows 3 applied labels.
 *  6.  Floor-exclusions panel ranks floors by count descending.
 *  7.  Latency panel shows "p50" and "p95" labels.
 *  8.  Current tuning grid shows all 16 field names.
 *  9.  Current defaults grid shows all 5 categories.
 * 10.  Regression guard: source file Router Health section has 0 hex + 0 rgba.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports
// ---------------------------------------------------------------------------

// apiRequest mock: return a fresh Response for each call so .json() doesn't
// double-consume the body across the 7 concurrent calls in fetchMetrics.
vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ),
  apiRequestJson: vi.fn().mockResolvedValue({}),
  apiEndpoint: (p: string) => p,
}));

vi.mock('../../../hooks/useAdminQuery', () => ({
  useAdminQuery: vi.fn().mockReturnValue({ data: null, isLoading: false, error: null }),
}));

// ---------------------------------------------------------------------------
// Sample Prometheus text payload covering all 10 new metrics
// ---------------------------------------------------------------------------

const SAMPLE_PROM = `
# HELP openagentic_router_decision_total Router decisions by resolved_by, selected_model, tier
# TYPE openagentic_router_decision_total counter
openagentic_router_decision_total{resolved_by="cache",selected_model="model-x",tier="frontier"} 1200
openagentic_router_decision_total{resolved_by="score",selected_model="model-y",tier="mid"} 850
openagentic_router_decision_total{resolved_by="score",selected_model="model-z",tier="cheap"} 450

# HELP openagentic_router_escalation_fires_total Escalation triggers by type
# TYPE openagentic_router_escalation_fires_total counter
openagentic_router_escalation_fires_total{type="destructive"} 42
openagentic_router_escalation_fires_total{type="infra_ops"} 130
openagentic_router_escalation_fires_total{type="complexity_bias"} 77
openagentic_router_escalation_fires_total{type="chat_pool_filter"} 320
openagentic_router_escalation_fires_total{type="quality_bonus_gated"} 95

# HELP openagentic_router_floor_excluded_total Floor exclusions
# TYPE openagentic_router_floor_excluded_total counter
openagentic_router_floor_excluded_total{floor="chat_pool",model="model-z"} 980
openagentic_router_floor_excluded_total{floor="simple_tool",model="model-z"} 450
openagentic_router_floor_excluded_total{floor="complex_tool",model="model-y"} 210
openagentic_router_floor_excluded_total{floor="destructive",model="model-y"} 88
openagentic_router_floor_excluded_total{floor="infra_ops",model="model-y"} 55

# HELP openagentic_router_route_request_duration_ms Router latency histogram
# TYPE openagentic_router_route_request_duration_ms histogram
openagentic_router_route_request_duration_ms_bucket{le="1"} 100
openagentic_router_route_request_duration_ms_bucket{le="2"} 200
openagentic_router_route_request_duration_ms_bucket{le="5"} 450
openagentic_router_route_request_duration_ms_bucket{le="10"} 700
openagentic_router_route_request_duration_ms_bucket{le="25"} 850
openagentic_router_route_request_duration_ms_bucket{le="50"} 920
openagentic_router_route_request_duration_ms_bucket{le="100"} 970
openagentic_router_route_request_duration_ms_bucket{le="250"} 990
openagentic_router_route_request_duration_ms_bucket{le="500"} 998
openagentic_router_route_request_duration_ms_bucket{le="+Inf"} 1000
openagentic_router_route_request_duration_ms_sum 12500
openagentic_router_route_request_duration_ms_count 1000

# HELP openagentic_router_quality_bonus_applied_total Quality bonus outcomes
# TYPE openagentic_router_quality_bonus_applied_total counter
openagentic_router_quality_bonus_applied_total{applied="yes"} 600
openagentic_router_quality_bonus_applied_total{applied="no_complexity_gate"} 300
openagentic_router_quality_bonus_applied_total{applied="disabled_globally"} 100

# HELP openagentic_router_tuning_updated_total Tuning field update events
# TYPE openagentic_router_tuning_updated_total counter
openagentic_router_tuning_updated_total{field="costWeight",updated_by="admin@example.com"} 3
openagentic_router_tuning_updated_total{field="qualityWeight",updated_by="admin@example.com"} 2
openagentic_router_tuning_updated_total{field="fcaChatPoolFloor",updated_by="ops@example.com"} 5

# HELP openagentic_router_tuning_current Current tuning values
# TYPE openagentic_router_tuning_current gauge
openagentic_router_tuning_current{field="costWeight"} 0.5
openagentic_router_tuning_current{field="qualityWeight"} 0.5
openagentic_router_tuning_current{field="costBonusMaxPoints"} 25
openagentic_router_tuning_current{field="latencyBonusMaxPoints"} 10
openagentic_router_tuning_current{field="toolCallingBonusMaxPoints"} 50
openagentic_router_tuning_current{field="reasoningBonusMaxPoints"} 30
openagentic_router_tuning_current{field="fcaQualityFloor"} 0.75
openagentic_router_tuning_current{field="fcaQualityMultiplier"} 100
openagentic_router_tuning_current{field="fcaQualityGatedByComplexity"} 1
openagentic_router_tuning_current{field="costNormalizationCeiling"} 0.02
openagentic_router_tuning_current{field="fcaChatPoolFloor"} 0.82
openagentic_router_tuning_current{field="fcaSimpleToolFloor"} 0.83
openagentic_router_tuning_current{field="fcaComplexToolFloor"} 0.9
openagentic_router_tuning_current{field="fcaDestructiveFloor"} 0.93
openagentic_router_tuning_current{field="fcaInfraOpsFloor"} 0.85
openagentic_router_tuning_current{field="fcaComplexityBiasFloor"} 0.93

# HELP openagentic_defaults_updated_total Tenant default update events
# TYPE openagentic_defaults_updated_total counter
openagentic_defaults_updated_total{category="chat",updated_by="admin@example.com"} 2

# HELP openagentic_defaults_current Current tenant defaults (value=1 indicates active model)
# TYPE openagentic_defaults_current gauge
openagentic_defaults_current{category="chat",model="provider/chat-model-a"} 1
openagentic_defaults_current{category="code",model="provider/code-model-b"} 1
openagentic_defaults_current{category="embeddings",model="provider/embed-model-c"} 1
openagentic_defaults_current{category="vision",model="provider/vision-model-d"} 1
openagentic_defaults_current{category="image_gen",model="provider/image-model-e"} 1

# HELP openagentic_subagent_concurrent_dispatch_count Subagent dispatch count histogram
# TYPE openagentic_subagent_concurrent_dispatch_count histogram
openagentic_subagent_concurrent_dispatch_count_bucket{le="1"} 50
openagentic_subagent_concurrent_dispatch_count_bucket{le="+Inf"} 100
openagentic_subagent_concurrent_dispatch_count_sum 150
openagentic_subagent_concurrent_dispatch_count_count 100
`;

// ---------------------------------------------------------------------------
// fetch mock — intercepts native fetch used by RouterHealthSection
// ---------------------------------------------------------------------------

function setupFetchMock(responseText: string, ok = true) {
  // Each call to fetch() returns a fresh object so .text() can be called once per call
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      text: () => Promise.resolve(responseText),
    } as unknown as Response),
  );
}

// ---------------------------------------------------------------------------
// Import component under test after mocks are wired
// ---------------------------------------------------------------------------

import LLMPerformanceMetrics, {
  parsePromText,
  TUNING_FIELDS,
  DEFAULT_CATEGORIES,
} from '../LLMPerformanceMetrics';

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderComponent() {
  return render(<LLMPerformanceMetrics theme="dark" />);
}

// ---------------------------------------------------------------------------
// parsePromText unit tests (pure function, no DOM needed)
// ---------------------------------------------------------------------------

describe('LLMPerformanceMetrics — parsePromText unit tests', () => {
  it('parses a counter line with labels', () => {
    const text = 'openagentic_router_decision_total{tier="frontier",selected_model="model-x"} 1200\n';
    const samples = parsePromText(text);
    expect(samples).toHaveLength(1);
    expect(samples[0].name).toBe('openagentic_router_decision_total');
    expect(samples[0].labels['tier']).toBe('frontier');
    expect(samples[0].labels['selected_model']).toBe('model-x');
    expect(samples[0].value).toBe(1200);
  });

  it('skips comment lines', () => {
    const text = '# HELP foo bar\n# TYPE foo counter\nfoo 42\n';
    const samples = parsePromText(text);
    expect(samples).toHaveLength(1);
    expect(samples[0].name).toBe('foo');
    expect(samples[0].value).toBe(42);
  });

  it('skips empty lines', () => {
    const text = '\nfoo 1\n\nbar 2\n';
    const samples = parsePromText(text);
    expect(samples).toHaveLength(2);
  });

  it('parses metric without labels', () => {
    const samples = parsePromText('simple_counter 99\n');
    expect(samples[0].name).toBe('simple_counter');
    expect(samples[0].labels).toEqual({});
    expect(samples[0].value).toBe(99);
  });

  it('parses float values', () => {
    const samples = parsePromText('openagentic_router_tuning_current{field="costWeight"} 0.5\n');
    expect(samples[0].value).toBe(0.5);
  });

  it('parses the full sample payload without throwing', () => {
    const samples = parsePromText(SAMPLE_PROM);
    expect(samples.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Router Health UI tests
// ---------------------------------------------------------------------------

describe('LLMPerformanceMetrics — Router Health UI', () => {
  beforeEach(() => {
    setupFetchMock(SAMPLE_PROM);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Renders "Router Health" section heading
  // -------------------------------------------------------------------------
  it('renders "Router Health" section heading', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('router-health-section')).toBeDefined();
    }, { timeout: 3000 });
    expect(screen.getByText('Router Health')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 2. All 5 panels render with parsed data
  // -------------------------------------------------------------------------
  it('renders all 5 main panels after data loads', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('panel-decisions-tier')).toBeDefined();
      expect(screen.getByTestId('panel-escalations')).toBeDefined();
      expect(screen.getByTestId('panel-quality-bonus')).toBeDefined();
      expect(screen.getByTestId('panel-floor-exclusions')).toBeDefined();
      expect(screen.getByTestId('panel-latency')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 3. Decision-by-tier panel shows 3 distinct tier labels
  // -------------------------------------------------------------------------
  it('decision-by-tier panel shows 3 distinct tier labels', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('tier-label-frontier')).toBeDefined();
      expect(screen.getByTestId('tier-label-mid')).toBeDefined();
      expect(screen.getByTestId('tier-label-cheap')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 4. Escalation panel shows 5 types
  // -------------------------------------------------------------------------
  it('escalation panel shows all 5 types', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('escalation-type-destructive')).toBeDefined();
      expect(screen.getByTestId('escalation-type-infra_ops')).toBeDefined();
      expect(screen.getByTestId('escalation-type-complexity_bias')).toBeDefined();
      expect(screen.getByTestId('escalation-type-chat_pool_filter')).toBeDefined();
      expect(screen.getByTestId('escalation-type-quality_bonus_gated')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 5. Quality-bonus panel shows 3 applied labels
  // -------------------------------------------------------------------------
  it('quality-bonus panel shows 3 applied labels', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('bonus-label-yes')).toBeDefined();
      expect(screen.getByTestId('bonus-label-no_complexity_gate')).toBeDefined();
      expect(screen.getByTestId('bonus-label-disabled_globally')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 6. Floor-exclusions panel ranks floors by count descending
  // -------------------------------------------------------------------------
  it('floor-exclusions panel renders floors; highest count appears first', async () => {
    renderComponent();
    await waitFor(() => {
      // chat_pool = 980 is highest in sample data
      expect(screen.getByTestId('floor-label-chat_pool')).toBeDefined();
    }, { timeout: 3000 });

    const panel = screen.getByTestId('panel-floor-exclusions');
    const items = panel.querySelectorAll('[data-testid^="floor-label-"]');
    // First visible floor should be chat_pool (980 = highest)
    expect(items[0].getAttribute('data-testid')).toBe('floor-label-chat_pool');
  });

  // -------------------------------------------------------------------------
  // 7. Latency panel shows "p50" and "p95" labels
  // -------------------------------------------------------------------------
  it('latency panel shows p50 and p95 labels', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('latency-p50-label')).toBeDefined();
      expect(screen.getByTestId('latency-p95-label')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // 8. Current tuning grid shows all 16 field names
  // -------------------------------------------------------------------------
  it('current tuning grid renders all 16 field tiles', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('panel-tuning-current')).toBeDefined();
    }, { timeout: 3000 });
    for (const field of TUNING_FIELDS) {
      expect(
        screen.getByTestId(`tuning-field-${field}`),
        `Missing tile for tuning field: ${field}`,
      ).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // 9. Current defaults grid shows all 5 categories
  // -------------------------------------------------------------------------
  it('current defaults grid renders all 5 category boxes', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('panel-defaults-current')).toBeDefined();
    }, { timeout: 3000 });
    for (const cat of DEFAULT_CATEGORIES) {
      expect(
        screen.getByTestId(`defaults-category-${cat}`),
        `Missing defaults tile for category: ${cat}`,
      ).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // Additional: tuning audit trail panel renders
  // -------------------------------------------------------------------------
  it('renders tuning audit trail panel', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByTestId('panel-tuning-audit')).toBeDefined();
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // Additional: current defaults panel shows model ids from parsed data
  // -------------------------------------------------------------------------
  it('current defaults panel shows parsed model ids', async () => {
    renderComponent();
    await waitFor(() => {
      const chatBox = screen.getByTestId('defaults-category-chat');
      // Sample payload sets category=chat → model=provider/chat-model-a
      expect(chatBox.textContent).toContain('provider/chat-model-a');
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // Additional: tuning values show parsed floats
  // -------------------------------------------------------------------------
  it('current tuning panel shows parsed values for costWeight', async () => {
    renderComponent();
    await waitFor(() => {
      const tile = screen.getByTestId('tuning-field-costWeight');
      expect(tile.textContent).toContain('0.5');
    }, { timeout: 3000 });
  });

  // -------------------------------------------------------------------------
  // Additional: quality bonus percentages computed correctly
  // -------------------------------------------------------------------------
  it('quality bonus shows correct percentages (60% applied)', async () => {
    renderComponent();
    await waitFor(() => {
      // yes=600, no_complexity_gate=300, disabled_globally=100 → total=1000 → 60%
      const yesLabel = screen.getByTestId('bonus-label-yes');
      expect(yesLabel.textContent).toContain('60.0%');
    }, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// 10. Regression guard: no hardcoded hex or rgba in Router Health section
// ---------------------------------------------------------------------------
describe('LLMPerformanceMetrics — regression: no hex/rgba in Router Health section', () => {
  it('LLMPerformanceMetrics.tsx Router Health code has 0 hex colors and 0 rgba() calls', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../LLMPerformanceMetrics.tsx'), 'utf8');

    // Isolate the new Router Health section (between the section marker and TIPS block)
    const startMarker = '// ════════════════════════════════════════════════════════════════════════';
    const endMarker = '// ── Tooltip Descriptions';
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker);
    const routerHealthCode = start >= 0 && end > start ? src.slice(start, end) : src;

    // Strip comments so we only check executable code
    const code = routerHealthCode
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const hexMatches = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgbaMatches = code.match(/rgba?\s*\(/g) ?? [];

    expect(
      hexMatches,
      `LLMPerformanceMetrics Router Health section must not contain hardcoded hex colors. Found: ${hexMatches.slice(0, 5).join(', ')}`,
    ).toHaveLength(0);
    expect(
      rgbaMatches,
      `LLMPerformanceMetrics Router Health section must not contain rgba() — use color-mix(var(--color-*)) instead. Found: ${rgbaMatches.length}`,
    ).toHaveLength(0);
  });
});
