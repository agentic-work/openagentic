import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrainingRunsDashboardRenderer } from '../TrainingRunsDashboardRenderer';

const example = {
  title: 'Training runs',
  runs: [
    { run_id: 'rcm-a', model: 'router-3.1', dataset: 'q2-v4', status: 'completed' as const, loss_final: 0.184, eval_metric_name: 'f1', eval_metric_value: 0.912, duration_min: 184, started_at: '2026-05-13T09Z' },
    { run_id: 'rcm-b', model: 'router-3.1', dataset: 'q2-v4', status: 'failed' as const, loss_final: 0.46, eval_metric_name: 'f1', eval_metric_value: 0.62, duration_min: 12, started_at: '2026-05-13T13Z' },
    { run_id: 'rcm-c', model: 'router-3.2', dataset: 'q2-v5', status: 'running' as const, duration_min: 42, started_at: '2026-05-13T15Z' },
    { run_id: 'rcm-d', model: 'router-3.2', dataset: 'q2-v5', status: 'queued' as const },
  ],
};

describe('TrainingRunsDashboardRenderer', () => {
  it('renders one row per run', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<TrainingRunsDashboardRenderer {...example} />);
    expect(container.querySelector('[data-testid="training-runs-dashboard-renderer"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(4);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<TrainingRunsDashboardRenderer />);
    expect(container.textContent).toMatch(/no training runs/);
  });
});
