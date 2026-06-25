import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RiskScoreCardRenderer } from '../RiskScoreCardRenderer';

const example = {
  title: 'acme risk',
  score: 42,
  categories: [
    { name: 'IAM', score: 28 },
    { name: 'Crypto', score: 78 },
    { name: 'Patch', score: 62 },
  ],
  trend: [55, 52, 49, 47, 45, 43, 42],
};

describe('RiskScoreCardRenderer', () => {
  it('renders score, categories, trend sparkline', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RiskScoreCardRenderer {...example} />);
    expect(container.querySelector('[data-testid="risk-score-card-renderer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="risk-score-value"]')).not.toBeNull();
    const cats = container.querySelectorAll('[data-cat]');
    expect(cats.length).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<RiskScoreCardRenderer />);
    expect(container.textContent).toMatch(/no risk data/);
  });
});
