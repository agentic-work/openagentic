import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ClusterInventoryRenderer } from '../ClusterInventoryRenderer';

const example = {
  title: 'K8s inventory',
  clusters: [
    { name: 'prod-eks-1', region: 'us-east-1', k8s_version: '1.29.6', node_count: 28, pods: 412, status: 'healthy' as const, owner: 'platform' },
    { name: 'staging-eks', region: 'us-east-1', k8s_version: '1.29.6', node_count: 6, pods: 92, status: 'healthy' as const, owner: 'platform' },
    { name: 'edge-cdg', region: 'eu-west-3', k8s_version: '1.28.5', node_count: 4, pods: 38, status: 'critical' as const, owner: 'edge' },
  ],
};

describe('ClusterInventoryRenderer', () => {
  it('renders one row per cluster', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<ClusterInventoryRenderer {...example} />);
    expect(container.querySelector('[data-testid="cluster-inventory-renderer"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<ClusterInventoryRenderer />);
    expect(container.textContent).toMatch(/no clusters/);
  });
});
