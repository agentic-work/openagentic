/**
 * SelfCritiqueBlock — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SelfCritiqueBlock } from '../SelfCritiqueBlock';

describe('SelfCritiqueBlock', () => {
  it('renders contradiction count in header', () => {
    render(<SelfCritiqueBlock contradictions={3} status="completed" />);
    const block = screen.getByTestId('self-critique-block');
    expect(block.textContent).toMatch(/3 issues flagged/);
    expect(block.getAttribute('data-status')).toBe('completed');
  });

  it('expands to show detail on click', () => {
    render(
      <SelfCritiqueBlock
        critique="Claim about OOM count exceeds actual by 4×"
        contradictions={1}
      />
    );
    expect(screen.queryByTestId('self-critique-body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const body = screen.getByTestId('self-critique-body');
    expect(body.textContent).toContain('exceeds actual');
  });

  it('shows revising status badge', () => {
    render(<SelfCritiqueBlock status="revising" contradictions={2} />);
    expect(screen.getByTestId('self-critique-block').textContent).toMatch(/revising/);
  });
});
