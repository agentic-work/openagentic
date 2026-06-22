import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GpuUtilizationChartRenderer } from '../GpuUtilizationChartRenderer';

const example = {
  title: 'GPU util',
  threshold: 85,
  buckets: ['14:00', '14:05', '14:10', '14:15', '14:20'],
  series: [
    { node: 'gpu-01', values: [62, 71, 78, 81, 84] },
    { node: 'gpu-02', values: [58, 64, 69, 72, 75] },
    { node: 'gpu-03', values: [88, 92, 94, 95, 96] },
  ],
};

describe('GpuUtilizationChartRenderer', () => {
  it('renders one polyline per series + threshold line', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<GpuUtilizationChartRenderer {...example} />);
    expect(container.querySelector('[data-testid="gpu-utilization-chart-renderer"]')).not.toBeNull();
    const lines = container.querySelectorAll('polyline[data-node]');
    expect(lines.length).toBe(3);
    expect(container.querySelector('[data-testid="gpu-threshold-line"]')).not.toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<GpuUtilizationChartRenderer />);
    expect(container.textContent).toMatch(/no GPU data/);
  });
});
