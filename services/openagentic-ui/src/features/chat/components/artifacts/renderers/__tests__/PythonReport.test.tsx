/**
 * #781 Phase C1 — PythonReport renderer tests.
 *
 * Renders synth_execute stdout-as-markdown payloads. Inherits editorial-prestige
 * aesthetic (cream paper + serif headings + JetBrains-Mono code blocks).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PythonReport } from '../PythonReport.js';

describe('PythonReport renderer — #781 Phase C1', () => {
  it('renders the stdout markdown as HTML with headings + paragraphs', () => {
    const stdout = '# Cost Report\n\nTop services this month.\n\n## Foundry\n\nUsage is high.';
    render(<PythonReport stdout={stdout} />);
    expect(screen.getByRole('heading', { level: 1, name: /Cost Report/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Foundry/i })).toBeInTheDocument();
    expect(screen.getByText(/Top services this month/)).toBeInTheDocument();
    expect(screen.getByText(/Usage is high/)).toBeInTheDocument();
  });

  it('renders fenced code blocks with the language attr', () => {
    const stdout = '```python\nprint(1)\n```';
    render(<PythonReport stdout={stdout} />);
    const code = screen.getByText('print(1)');
    expect(code.tagName).toBe('CODE');
    expect(code).toHaveAttribute('data-lang', 'python');
  });

  it('shows an empty-state when stdout is empty', () => {
    render(<PythonReport stdout="" />);
    expect(screen.getByTestId('python-report-empty')).toBeInTheDocument();
  });

  it('renders the executionTimeMs as a footer when provided', () => {
    render(<PythonReport stdout="# x" executionTimeMs={1234} />);
    expect(screen.getByTestId('python-report-footer')).toHaveTextContent(/1234\s*ms/);
  });

  it('renders an unordered list from markdown -', () => {
    const stdout = '- alpha\n- beta\n- gamma';
    render(<PythonReport stdout={stdout} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('alpha');
    expect(items[2]).toHaveTextContent('gamma');
  });
});
