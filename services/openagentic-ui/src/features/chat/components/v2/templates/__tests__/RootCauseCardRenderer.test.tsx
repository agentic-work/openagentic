import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RootCauseCardRenderer } from '../RootCauseCardRenderer';

const example = {
  title: 'RCA — gateway storm',
  scope: 'INC-4827',
  hypothesis: 'pool exhaustion',
  confidence: 85,
  evidence: [
    { source: 'dd', detail: 'pool wait=212' },
    { source: 'cw', detail: 'timeouts at 14:24' },
    { source: 'git', detail: 'pool max=64 set in 2025' },
  ],
  next_steps: [
    { action: 'raise pool', owner: 'platform' },
    { action: 'add alert', owner: 'sre' },
  ],
};

describe('RootCauseCardRenderer', () => {
  it('renders hypothesis, evidence, next steps, confidence', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RootCauseCardRenderer {...example} />);
    expect(container.querySelector('[data-testid="root-cause-card-renderer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="root-cause-confidence"]')).not.toBeNull();
    expect(container.textContent).toMatch(/pool exhaustion/);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<RootCauseCardRenderer />);
    expect(container.textContent).toMatch(/no root cause data/);
  });
});
