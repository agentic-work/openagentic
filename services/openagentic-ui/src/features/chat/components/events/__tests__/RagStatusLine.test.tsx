/**
 * RagStatusLine — Phase G render test.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RagStatusLine } from '../RagStatusLine';

describe('RagStatusLine', () => {
  it('shows running state when nothing retrieved yet', () => {
    render(<RagStatusLine />);
    const line = screen.getByTestId('rag-status-line');
    expect(line.getAttribute('data-status')).toBe('running');
    expect(line.textContent).toMatch(/Searching knowledge base/);
  });

  it('shows count when docsRetrieved > 0', () => {
    render(<RagStatusLine docsRetrieved={3} status="complete" />);
    const line = screen.getByTestId('rag-status-line');
    expect(line.getAttribute('data-status')).toBe('complete');
    expect(line.textContent).toMatch(/3 relevant documents/);
  });

  it('surfaces collections + time', () => {
    render(
      <RagStatusLine
        docsRetrieved={5}
        collections={['shared-kb', 'platform-docs']}
        retrievalTimeMs={240}
        status="complete"
      />
    );
    const line = screen.getByTestId('rag-status-line');
    expect(line.textContent).toContain('shared-kb');
    expect(line.textContent).toContain('240ms');
  });
});
