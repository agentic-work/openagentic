/**
 * ToolParallelHeader — chatmode v2 contract test.
 *
 * Reference: mocks/UX/01-cloud-ops.html lines 900-905 (`.tool-parallel-hdr`).
 * Collapsed header that wraps multiple parallel tool calls into a single
 * "fan-out" group. Shows label + total / ok / failed / wall stats.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolParallelHeader } from '../ToolParallelHeader';

describe('ToolParallelHeader', () => {
  it('renders the label text', () => {
    render(<ToolParallelHeader label="Parallel fan-out" total={4} />);
    expect(screen.getByText('Parallel fan-out')).toBeInTheDocument();
  });

  it('renders total count with singular plural form for 1', () => {
    render(<ToolParallelHeader label="x" total={1} />);
    expect(screen.getByText('1 tool')).toBeInTheDocument();
  });

  it('renders total count with plural form for 2+', () => {
    render(<ToolParallelHeader label="x" total={4} />);
    expect(screen.getByText('4 tools')).toBeInTheDocument();
  });

  it('shows "{n} ok" when succeeded is set', () => {
    render(<ToolParallelHeader label="x" total={4} succeeded={3} />);
    expect(screen.getByText('3 ok')).toBeInTheDocument();
  });

  it('shows "{n} failed" in red when failed > 0', () => {
    render(<ToolParallelHeader label="x" total={4} failed={2} />);
    const failedSpan = screen.getByText('2 failed');
    expect(failedSpan).toBeInTheDocument();
    expect((failedSpan as HTMLElement).style.color).toBe('rgb(239, 68, 68)');
  });

  it('omits "failed" when failed is 0 or undefined', () => {
    const { rerender } = render(<ToolParallelHeader label="x" total={4} failed={0} />);
    expect(screen.queryByText(/failed/)).toBeNull();
    rerender(<ToolParallelHeader label="x" total={4} />);
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('formats wallMs < 1000 as "{n}ms"', () => {
    render(<ToolParallelHeader label="x" total={2} wallMs={420} />);
    expect(screen.getByText('420ms')).toBeInTheDocument();
  });

  it('formats wallMs >= 1000 as "{n.n}s"', () => {
    render(<ToolParallelHeader label="x" total={2} wallMs={1820} />);
    expect(screen.getByText('1.8s')).toBeInTheDocument();
  });

  it('clicking the button calls onToggle', () => {
    const onToggle = vi.fn();
    render(<ToolParallelHeader label="x" total={2} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('expanded=true rotates chevron 90deg', () => {
    const { container } = render(
      <ToolParallelHeader label="x" total={2} expanded />,
    );
    const chev = container.querySelector('svg');
    expect(chev).not.toBeNull();
    expect((chev as unknown as HTMLElement).style.transform).toContain('rotate(90deg)');
  });

  it('expanded=false leaves chevron at rotate(0deg)', () => {
    const { container } = render(
      <ToolParallelHeader label="x" total={2} expanded={false} />,
    );
    const chev = container.querySelector('svg');
    expect((chev as unknown as HTMLElement).style.transform).toContain('rotate(0deg)');
  });

  it('respects aria-expanded attribute', () => {
    render(<ToolParallelHeader label="x" total={2} expanded />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});
