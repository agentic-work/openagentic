/**
 * Phase H (task #153) — MemoryWritePill render tests.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryWritePill } from '../MemoryWritePill';

describe('MemoryWritePill', () => {
  it('renders summary + scope + floppy', () => {
    render(
      <MemoryWritePill
        memoryKey="mem-123"
        summary="User prefers Sonnet 4.6 for coding tasks."
        scope="user"
      />
    );
    const el = screen.getByTestId('memory-write-pill');
    expect(el.getAttribute('data-memory-key')).toBe('mem-123');
    expect(el.getAttribute('data-scope')).toBe('user');
    expect(el.textContent).toMatch(/Remembered/);
    expect(el.textContent).toMatch(/user/);
    expect(el.textContent).toMatch(/Sonnet 4.6/);
  });

  it('truncates long summaries in the body', () => {
    const long = 'A'.repeat(200);
    render(
      <MemoryWritePill memoryKey="mem-2" summary={long} scope="session" />
    );
    const el = screen.getByTestId('memory-write-pill');
    // Should include the first 79 chars plus ellipsis.
    expect(el.textContent).toMatch(/A{70,80}…/);
  });

  it('renders token count when provided', () => {
    render(
      <MemoryWritePill
        memoryKey="mem-3"
        summary="short"
        scope="shared"
        tokenCount={42}
      />
    );
    expect(screen.getByTestId('memory-write-pill').textContent).toMatch(/42t/);
  });

  it('carries scope in data attribute', () => {
    render(
      <MemoryWritePill memoryKey="mem-4" summary="x" scope="shared" />
    );
    expect(screen.getByTestId('memory-write-pill').getAttribute('data-scope')).toBe(
      'shared'
    );
  });
});
