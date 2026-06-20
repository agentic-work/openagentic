/**
 * Audit L1-2 / Phase A3 — ToolCard.outputTemplate render wiring.
 *
 * Without this fix, every compose_visual / compose_app tool_result with a
 * registered `_meta.outputTemplate` slug fell through to the raw JsonView
 * pre-formatted code block — even though all 4 Phase A2 templates
 * (sankey, build-progress, cloud-run-grid, multi-region-eks-dashboard)
 * were registered in FrameRendererRegistry. The registry was wired in
 * but unused in production: zero callers of `FrameRendererRegistry.lookup`
 * outside test files prior to this commit.
 *
 * the design notes
 *       §Phase 2.2.3 — A3 tool_result outputTemplate lookup miss.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ToolCard } from '../ToolCard.js';

describe('ToolCard — Audit L1-2 outputTemplate render wiring', () => {
  it('renders the registered FrameRendererRegistry component when outputTemplate is set', () => {
    const { getByTestId, queryByTestId } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        outputTemplate="sankey"
        result={{
          title: 'Spend by region',
          columns: [
            {
              id: 'r',
              label: 'Region',
              nodes: [
                { id: 'r:us', label: 'US', value: 600, tone: 'ok' },
                { id: 'r:eu', label: 'EU', value: 400, tone: 'warn' },
              ],
            },
          ],
          flows: [],
        }}
      />,
    );
    // Sankey renderer mounts (its [data-testid] is "sankey-renderer").
    expect(getByTestId('sankey-renderer')).toBeTruthy();
    // The RESULT section still wraps it (not the JsonView fallback).
    expect(getByTestId('tool-result')).toBeTruthy();
    // JsonView default rendering would have produced a <pre> with the raw
    // serialized object. Confirm by querying for the sankey-only DOM
    // anchor — sankey-renderer is the only test-id sankey emits.
    expect(queryByTestId('sankey-renderer')).toBeTruthy();
  });

  it('renders the build-progress template when outputTemplate matches', () => {
    const { getByTestId } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        outputTemplate="build-progress"
        result={{
          title: 'capstone',
          steps: [
            { id: 'a', label: 'tsc', status: 'ok', duration: '4.2s' },
            { id: 'b', label: 'eslint', status: 'warn', duration: '2.1s' },
          ],
        }}
      />,
    );
    expect(getByTestId('build-progress-renderer')).toBeTruthy();
  });

  it('renders cloud-run-grid template when outputTemplate matches', () => {
    const { getByTestId } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        outputTemplate="cloud-run-grid"
        result={{
          title: 'GCP services',
          services: [{ id: 'a', name: 'api', region: 'us-central1', status: 'running' }],
        }}
      />,
    );
    expect(getByTestId('cloud-run-grid-renderer')).toBeTruthy();
  });

  it('renders multi-region-eks-dashboard template when outputTemplate matches', () => {
    const { getByTestId } = render(
      <ToolCard
        name="compose_visual"
        status="ok"
        outputTemplate="multi-region-eks-dashboard"
        result={{
          regions: ['us-east-1'],
          rows: [{ id: 'p', cluster: 'p', cells: [{ status: 'ok', nodes: 4 }] }],
        }}
      />,
    );
    expect(getByTestId('multi-region-eks-dashboard-renderer')).toBeTruthy();
  });

  it('falls through to JsonView when outputTemplate is unknown / unregistered', () => {
    const { container, queryByTestId } = render(
      <ToolCard
        name="generic_tool"
        status="ok"
        outputTemplate="not-a-real-slug"
        result={{ hello: 'world' }}
      />,
    );
    // None of the rich-media renderers should fire.
    expect(queryByTestId('sankey-renderer')).toBeNull();
    expect(queryByTestId('build-progress-renderer')).toBeNull();
    expect(queryByTestId('cloud-run-grid-renderer')).toBeNull();
    expect(queryByTestId('multi-region-eks-dashboard-renderer')).toBeNull();
    // The RESULT section still renders (with JsonView as fallback).
    expect(container.querySelector('[data-testid="tool-result"]')).toBeTruthy();
  });

  it('falls through to JsonView when outputTemplate is absent (no regression)', () => {
    const { queryByTestId, container } = render(
      <ToolCard name="generic" status="ok" result={{ items: [1, 2, 3] }} />,
    );
    expect(queryByTestId('sankey-renderer')).toBeNull();
    expect(container.querySelector('[data-testid="tool-result"]')).toBeTruthy();
  });
});
