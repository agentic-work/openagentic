import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LogAnomalyChartRenderer } from '../LogAnomalyChartRenderer';

const example = {
  title: 'error log counts',
  source: 'cw:/payment-gateway',
  points: [
    { ts: '14:00', count: 12, lower_band: 5, upper_band: 35, is_anomaly: false },
    { ts: '14:05', count: 14, lower_band: 5, upper_band: 35, is_anomaly: false },
    { ts: '14:25', count: 320, lower_band: 5, upper_band: 35, is_anomaly: true },
    { ts: '14:30', count: 480, lower_band: 5, upper_band: 35, is_anomaly: true },
    { ts: '14:45', count: 88, lower_band: 5, upper_band: 35, is_anomaly: false },
  ],
};

describe('LogAnomalyChartRenderer', () => {
  it('renders line, band, anomaly markers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<LogAnomalyChartRenderer {...example} />);
    expect(container.querySelector('[data-testid="log-anomaly-chart-renderer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="log-anomaly-line"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="log-anomaly-band"]')).not.toBeNull();
    const markers = container.querySelectorAll('[data-testid="log-anomaly-marker"]');
    expect(markers.length).toBe(2);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<LogAnomalyChartRenderer />);
    expect(container.textContent).toMatch(/no log data/);
  });
});
