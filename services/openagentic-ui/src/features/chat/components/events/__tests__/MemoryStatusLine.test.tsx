/**
 * MemoryStatusLine — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryStatusLine } from '../MemoryStatusLine';

describe('MemoryStatusLine', () => {
  it('shows running state when nothing found yet', () => {
    render(<MemoryStatusLine />);
    const line = screen.getByTestId('memory-status-line');
    expect(line.getAttribute('data-status')).toBe('running');
    expect(line.textContent).toMatch(/Checking memory/);
  });

  it('shows count when contextInjected is true', () => {
    render(<MemoryStatusLine contextInjected tokenEstimate={240} processingTime={85} />);
    const line = screen.getByTestId('memory-status-line');
    expect(line.getAttribute('data-status')).toBe('complete');
    expect(line.textContent).toMatch(/relevant memor/);
    expect(line.textContent).toMatch(/240t/);
    expect(line.textContent).toMatch(/85ms/);
  });

  it('says "No relevant memories" when contextInjected is false', () => {
    render(<MemoryStatusLine contextInjected={false} />);
    expect(screen.getByTestId('memory-status-line').textContent).toMatch(
      /No relevant memories/
    );
  });
});
