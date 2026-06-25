import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LatencyHeatmapRenderer } from '../LatencyHeatmapRenderer';

const example = {
  title: 'p99 latency',
  unit: 'ms',
  services: ['auth', 'payments', 'orders'],
  buckets: ['14:00', '14:05', '14:10'],
  values: [
    [0, 0, 120], [0, 1, 110], [0, 2, 130],
    [1, 0, 240], [1, 1, 260], [1, 2, 410],
    [2, 0, 88],  [2, 1, 92],  [2, 2, 87],
  ] as ReadonlyArray<readonly [number, number, number]>,
};

describe('LatencyHeatmapRenderer', () => {
  it('renders one cell per service×bucket', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<LatencyHeatmapRenderer {...example} />);
    expect(container.querySelector('[data-testid="latency-heatmap-renderer"]')).not.toBeNull();
    const cells = container.querySelectorAll('rect[data-row]');
    expect(cells.length).toBe(example.services.length * example.buckets.length);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<LatencyHeatmapRenderer />);
    expect(container.textContent).toMatch(/no heatmap data/);
  });
});
