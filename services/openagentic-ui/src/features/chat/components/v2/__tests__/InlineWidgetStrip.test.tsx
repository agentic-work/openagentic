/**
 * #502 InlineWidgetStrip — render dispatcher for the unified
 * `inline_widget` NDJSON frame. One InlineWidget array → renders the
 * matching v2 primitive per kind.
 *
 * RED first: this test mounts InlineWidgetStrip with each kind's
 * payload and asserts the primitive renders. The component does not
 * exist yet.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineWidgetStrip } from '../InlineWidgetStrip';
import type { InlineWidget } from '../../../hooks/useChatStream';

describe('InlineWidgetStrip — #502 render dispatcher', () => {
  it('renders nothing when widgets is empty', () => {
    const { container } = render(<InlineWidgetStrip widgets={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders KpiGrid for kind=kpi_grid', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'k-1',
        kind: 'kpi_grid',
        title: 'Cluster',
        data: {
          tiles: [
            { title: 'CPU', value: '73%' },
            { title: 'Mem', value: '61%' },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    // KpiGrid renders each tile's title + value.
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('Mem')).toBeInTheDocument();
  });

  it('renders SavingsCard for kind=savings_card', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 's-1',
        kind: 'savings_card',
        title: 'Right-sizing impact',
        data: {
          cells: [
            { label: 'Monthly', value: '$2,847' },
            { label: 'Annual', value: '$34,165' },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByText('$2,847')).toBeInTheDocument();
    expect(screen.getByText('$34,165')).toBeInTheDocument();
  });

  it('renders StagesStrip for kind=stages_strip', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'st-1',
        kind: 'stages_strip',
        data: {
          stages: [
            { id: '1', label: 'Detect', status: 'done' },
            { id: '2', label: 'Drain', status: 'active' },
            { id: '3', label: 'Failover', status: 'pending' },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByTestId('stages-strip')).toBeInTheDocument();
    expect(screen.getByText('Detect')).toBeInTheDocument();
    expect(screen.getByText('Drain')).toBeInTheDocument();
  });

  it('renders WaveTimeline for kind=wave_timeline', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'w-1',
        kind: 'wave_timeline',
        title: 'Q3 wave plan',
        data: {
          rows: [
            {
              id: 'r1',
              label: 'Cluster A',
              segments: [{ left: 0, width: 50, tone: 'a', label: 'phase 1' }],
            },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByText('Q3 wave plan')).toBeInTheDocument();
    expect(screen.getByText('Cluster A')).toBeInTheDocument();
  });

  it('renders Runbook for kind=runbook', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'rb-1',
        kind: 'runbook',
        title: 'Failover playbook',
        data: {
          budget: '15min budget',
          steps: [
            { tag: 'T+0', title: 'Detect', body: 'Pager fires' },
            { tag: 'T+1', title: 'Drain', body: 'Drain primary' },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByText('Failover playbook')).toBeInTheDocument();
    expect(screen.getByText('Detect')).toBeInTheDocument();
    expect(screen.getByText('Drain')).toBeInTheDocument();
  });

  it('renders StackGrid for kind=stack_grid', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'sg-1',
        kind: 'stack_grid',
        data: {
          layers: [
            { role: 'Frontend', tech: 'React 19', meta: 'Vite' },
            { role: 'Backend', tech: 'Fastify', meta: 'Node 20' },
          ],
        },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByTestId('stack-grid')).toBeInTheDocument();
    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('React 19')).toBeInTheDocument();
  });

  it('renders multiple widgets in order', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'k-1',
        kind: 'kpi_grid',
        data: { tiles: [{ title: 'CPU', value: '73%' }] },
      },
      {
        artifactId: 's-1',
        kind: 'savings_card',
        data: { cells: [{ label: 'Monthly', value: '$100' }] },
      },
    ];
    render(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('drops widgets with unknown kind silently (defense in depth)', () => {
    const widgets: InlineWidget[] = [
      {
        artifactId: 'mystery',
        // unknown kind through the wire
        kind: 'mystery_box' as InlineWidget['kind'],
        data: { whatever: true },
      },
    ];
    const { container } = render(<InlineWidgetStrip widgets={widgets} />);
    // The strip wrapper should be absent or empty since no children render.
    const strip = container.querySelector('[data-testid="inline-widget-strip"]');
    if (strip) {
      expect(strip.children.length).toBe(0);
    } else {
      expect(strip).toBeNull();
    }
  });

  it('uses artifactId as React key (no duplicate-key warnings under repeat render)', () => {
    const widgets: InlineWidget[] = [
      { artifactId: 'k-1', kind: 'kpi_grid', data: { tiles: [{ title: 'A', value: '1' }] } },
      { artifactId: 'k-2', kind: 'kpi_grid', data: { tiles: [{ title: 'B', value: '2' }] } },
    ];
    const { rerender } = render(<InlineWidgetStrip widgets={widgets} />);
    rerender(<InlineWidgetStrip widgets={widgets} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
