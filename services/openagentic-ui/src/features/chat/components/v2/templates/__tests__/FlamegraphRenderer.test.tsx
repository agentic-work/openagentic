import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FlamegraphRenderer } from '../FlamegraphRenderer';

const example = {
  title: 'CPU flamegraph',
  unit: 'samples',
  root: {
    name: 'all',
    value: 450,
    children: [
      {
        name: 'runChat',
        value: 380,
        children: [
          { name: 'stream', value: 240 },
          { name: 'dispatch', value: 110 },
          { name: 'audit', value: 30 },
        ],
      },
      { name: 'other', value: 70 },
    ],
  },
};

describe('FlamegraphRenderer', () => {
  it('renders one rect per frame', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<FlamegraphRenderer {...example} />);
    expect(container.querySelector('[data-testid="flamegraph-renderer"]')).not.toBeNull();
    // 1 root + 2 children + 3 grandchildren = 6 frames
    expect(container.querySelectorAll('rect[data-name]').length).toBe(6);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<FlamegraphRenderer />);
    expect(container.textContent).toMatch(/no flamegraph data/);
  });
});
