import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';
import { CloudRunGridRenderer } from '../templates/CloudRunGridRenderer.js';

describe('CloudRunGridRenderer — Phase A2', () => {
  it('FrameRendererRegistry.lookup("cloud-run-grid") returns a non-fallback component', () => {
    const C = FrameRendererRegistry.lookup('cloud-run-grid');
    expect(C).toBeDefined();
    expect((C as any).displayName).not.toBe('StreamingMarkdown');
  });

  it('renders one card per service with region pill', () => {
    const { getByTestId, getByText } = render(
      <CloudRunGridRenderer
        title="GCP services"
        services={[
          {
            id: 'a',
            name: 'api',
            region: 'us-central1',
            url: 'https://api-xyz.run.app',
            lastDeploy: '3h ago',
            status: 'running',
            cpu: '1',
            memory: '512Mi',
            concurrency: 80,
            minInstances: 1,
          },
          {
            id: 'b',
            name: 'worker',
            region: 'europe-west1',
            status: 'idle',
          },
        ]}
      />,
    );
    expect(getByTestId('cloud-run-grid-renderer')).toBeTruthy();
    expect(getByText('api')).toBeTruthy();
    expect(getByText('worker')).toBeTruthy();
    expect(getByText('us-central1')).toBeTruthy();
  });

  it('exposes data-status per card', () => {
    const { container } = render(
      <CloudRunGridRenderer
        services={[
          { id: 'a', name: 'a', region: 'us-east1', status: 'running' },
          { id: 'b', name: 'b', region: 'us-east1', status: 'failed' },
        ]}
      />,
    );
    const cards = container.querySelectorAll<HTMLElement>('[data-status]');
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute('data-status')).toBe('running');
    expect(cards[1].getAttribute('data-status')).toBe('failed');
  });

  it('returns null on empty services array', () => {
    const { container } = render(<CloudRunGridRenderer services={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
