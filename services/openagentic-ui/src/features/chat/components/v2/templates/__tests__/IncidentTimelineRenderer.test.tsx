import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IncidentTimelineRenderer } from '../IncidentTimelineRenderer';

const example = {
  title: 'Incident #4827 — payment-gateway 5xx storm',
  subtitle: 'eu-west-1',
  events: [
    { ts: '14:22:01', severity: 'critical' as const, source: 'cw', message: 'p99 > 3500ms' },
    { ts: '14:22:14', severity: 'high' as const, source: 'pd', message: 'Sev-1 paged' },
    { ts: '14:48:11', severity: 'high' as const, source: 'dd', message: 'pool exhaustion' },
    { ts: '15:08:00', severity: 'low' as const, source: 'cw', message: 'alarm cleared' },
  ],
};

describe('IncidentTimelineRenderer', () => {
  it('renders one li per event', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<IncidentTimelineRenderer {...example} />);
    expect(container.querySelector('[data-testid="incident-timeline-renderer"]')).not.toBeNull();
    const items = container.querySelectorAll('[data-testid="incident-timeline-list"] li');
    expect(items.length).toBe(example.events.length);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('renders placeholder for empty payload', () => {
    const { container } = render(<IncidentTimelineRenderer />);
    expect(container.textContent).toMatch(/no timeline events/);
  });
});
