/**
 * useMergedNodeConfigs — TDD test for the audit's "9 missing palette
 * nodes" finding (AUDIT-2026-05-03).
 *
 * Backend has 51 schema-driven nodes in services/shared/workflow-engine.
 * UI palette only renders ~42 because NodePaletteDrawer was wired to
 * useBackendNodes() — a hook that calls a `/nodes` endpoint that does
 * not exist on workflows-service (only `/node-schemas` exists). The
 * fetch silently fails → useBackendNodes returns {} → drawer falls
 * back to the hand-maintained legacy nodeTypeConfigs and the 9 newer
 * schema-only nodes never appear.
 *
 * useMergedNodeConfigs is the existing fix that was never consumed by
 * production code — it merges legacy + schema-driven so every node is
 * in the palette.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/nodeSchemasApi', () => ({
  nodeSchemasApi: { fetchSchemas: vi.fn() },
}));

import { useMergedNodeConfigs } from '../useMergedNodeConfigs';
import { nodeSchemasApi } from '../../services/nodeSchemasApi';
import { invalidateNodeSchemasCache } from '../useNodeSchemas';

const legacyConfigs = {
  // Pretend the legacy palette knows about 2 nodes (trigger + http_request)
  trigger: {
    type: 'trigger' as const,
    label: 'Trigger',
    description: 'Start a flow',
    icon: '⚡',
    color: '#f59e0b',
    category: 'trigger' as const,
    defaultData: {},
  },
  http_request: {
    type: 'http_request' as const,
    label: 'HTTP Request (legacy)',
    description: 'Legacy HTTP node',
    icon: '🌐',
    color: '#3b82f6',
    category: 'http' as const,
    defaultData: { method: 'GET' },
  },
} as any;

const schemaNodes = [
  {
    type: 'http_request',
    category: 'http',
    label: 'HTTP Request',
    description: 'Schema HTTP node',
    icon: 'globe',
    ports: { inputs: [], outputs: [] },
    settings: [],
    ai: { shortDescription: '', whenToUse: '' },
    outputAssertions: [],
  },
  // anomaly_detect would be a NEW schema-only node, not in legacy
  {
    type: 'anomaly_detect',
    category: 'data',
    label: 'Anomaly Detect',
    description: 'Detect anomalies in time-series',
    icon: 'activity',
    ports: { inputs: [], outputs: [] },
    settings: [],
    ai: { shortDescription: '', whenToUse: '' },
    outputAssertions: [],
  },
];

describe('useMergedNodeConfigs', () => {
  beforeEach(() => {
    invalidateNodeSchemasCache();
    (nodeSchemasApi.fetchSchemas as any).mockReset();
  });
  afterEach(() => { invalidateNodeSchemasCache(); });

  it('returns legacy configs synchronously while schemas are still loading', () => {
    (nodeSchemasApi.fetchSchemas as any).mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));
    // The merge runs even before schemas resolve — legacy is the seed
    expect(result.current.merged.trigger).toBeDefined();
    expect(result.current.merged.http_request).toBeDefined();
    expect(result.current.loading).toBe(true);
  });

  it('merges schema-only types into the palette (the audit fix)', async () => {
    (nodeSchemasApi.fetchSchemas as any).mockResolvedValue({
      schemas: schemaNodes,
      aiPromptFragment: '',
    });

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // anomaly_detect was schema-only — must appear in merged palette
    expect(result.current.merged.anomaly_detect).toBeDefined();
    expect(result.current.merged.anomaly_detect.label).toBe('Anomaly Detect');
    expect(result.current.schemaTypes.has('anomaly_detect')).toBe(true);

    // legacy-only trigger still present
    expect(result.current.merged.trigger).toBeDefined();
    expect(result.current.legacyTypes.has('trigger')).toBe(true);
  });

  it('schema wins for shared types but preserves legacy color/icon when schema icon is empty', async () => {
    const schemaWithoutIcon = [{ ...schemaNodes[0], icon: '' }];
    (nodeSchemasApi.fetchSchemas as any).mockResolvedValue({
      schemas: schemaWithoutIcon,
      aiPromptFragment: '',
    });

    const { result } = renderHook(() => useMergedNodeConfigs(legacyConfigs));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // schema wins on label
    expect(result.current.merged.http_request.label).toBe('HTTP Request');
    // legacy color preserved (schema doesn't carry color)
    expect(result.current.merged.http_request.color).toBe('#3b82f6');
    // legacy emoji preserved when schema icon is empty
    expect(result.current.merged.http_request.icon).toBe('🌐');
  });
});
