import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';
import { MultiRegionEksDashboardRenderer } from '../templates/MultiRegionEksDashboardRenderer.js';

describe('MultiRegionEksDashboardRenderer — Phase A2', () => {
  it('FrameRendererRegistry.lookup("multi-region-eks-dashboard") returns non-fallback component', () => {
    const C = FrameRendererRegistry.lookup('multi-region-eks-dashboard');
    expect(C).toBeDefined();
    expect((C as any).displayName).not.toBe('StreamingMarkdown');
  });

  it('renders the table with one row per cluster and one column per region', () => {
    const { getByTestId, container } = render(
      <MultiRegionEksDashboardRenderer
        title="EKS fleet"
        regions={['us-east-1', 'us-west-2', 'eu-central-1']}
        rows={[
          {
            id: 'prod',
            cluster: 'prod-main',
            cells: [
              { status: 'ok', nodes: 12, pods: 84, ready: 84, total: 84 },
              { status: 'warn', nodes: 6, pods: 32, ready: 30, total: 32, alert: 'CrashLoopBackOff' },
              { status: 'unknown' },
            ],
          },
          {
            id: 'staging',
            cluster: 'staging',
            cells: [
              { status: 'ok', nodes: 4, pods: 22, ready: 22, total: 22 },
              undefined,
              { status: 'err', nodes: 0, alert: 'unreachable' },
            ],
          },
        ]}
      />,
    );
    expect(getByTestId('multi-region-eks-dashboard-renderer')).toBeTruthy();
    // 2 cluster rows × 3 region columns + header.
    const headerCells = container.querySelectorAll('th[scope="col"]');
    expect(headerCells.length).toBe(4); // cluster + 3 regions
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(2);
    const dataCells = container.querySelectorAll<HTMLElement>('td[data-status]');
    expect(dataCells.length).toBe(6);
    // First row 3 cells: ok / warn / unknown
    expect(dataCells[0].getAttribute('data-status')).toBe('ok');
    expect(dataCells[1].getAttribute('data-status')).toBe('warn');
    expect(dataCells[2].getAttribute('data-status')).toBe('unknown');
    // Second row 3 cells: ok / unknown (missing) / err
    expect(dataCells[3].getAttribute('data-status')).toBe('ok');
    expect(dataCells[4].getAttribute('data-status')).toBe('unknown');
    expect(dataCells[5].getAttribute('data-status')).toBe('err');
  });

  it('renders alert pill when cell has alert', () => {
    const { getByText } = render(
      <MultiRegionEksDashboardRenderer
        regions={['us-east-1']}
        rows={[
          {
            id: 'p',
            cluster: 'p',
            cells: [{ status: 'warn', alert: 'CrashLoopBackOff' }],
          },
        ]}
      />,
    );
    expect(getByText('CrashLoopBackOff')).toBeTruthy();
  });

  it('returns null on empty rows or empty regions', () => {
    const a = render(<MultiRegionEksDashboardRenderer regions={['us-east-1']} rows={[]} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(
      <MultiRegionEksDashboardRenderer
        regions={[]}
        rows={[{ id: 'a', cluster: 'a', cells: [] }]}
      />,
    );
    expect(b.container.firstChild).toBeNull();
  });
});
