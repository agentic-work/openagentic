/**
 * CorrectionBlock — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CorrectionBlock } from '../CorrectionBlock';

describe('CorrectionBlock', () => {
  it('renders strikethrough wrongText + green correctedText', () => {
    render(
      <CorrectionBlock wrongText="OOM events: 47 in 7d" correctedText="OOM events: 12 in 7d" />
    );
    const block = screen.getByTestId('correction-block');
    expect(block).toBeInTheDocument();
    expect(screen.getByTestId('correction-wrong').textContent).toContain('47');
    expect(screen.getByTestId('correction-corrected').textContent).toContain('12');
  });

  it('includes reason text when provided', () => {
    render(
      <CorrectionBlock
        wrongText="a"
        correctedText="b"
        reason="initial count double-counted"
      />
    );
    expect(screen.getByTestId('correction-block').textContent).toMatch(
      /initial count double-counted/
    );
  });

  it('truncates very long texts to prevent layout blow-up', () => {
    const longText = 'x'.repeat(1000);
    render(<CorrectionBlock wrongText={longText} correctedText={longText} />);
    const wrong = screen.getByTestId('correction-wrong');
    expect((wrong.textContent?.length ?? 0)).toBeLessThan(500);
  });
});
