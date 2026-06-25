/**
 * RunInputsModal — collects required trigger inputs before submitting Run.
 *
 * Templates declare required parameters on `trigger.data.inputs` (e.g.
 * Multi-Agent Research Team requires `topic`). Clicking Run on a flow
 * with any required input that is empty pops this modal first; submitting
 * fires Run with body.input populated. Cancelling does nothing.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

afterEach(() => cleanup());

import { RunInputsModal } from '../RunInputsModal';

describe('RunInputsModal — TDD', () => {
  const baseInputs = [
    { name: 'topic', label: 'Research Topic', required: true, description: 'What to research' },
    { name: 'depth', label: 'Depth', required: false, description: 'How deep' },
  ];

  it('RED 1: renders nothing when isOpen=false', () => {
    const { container } = render(
      <RunInputsModal isOpen={false} inputs={baseInputs} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('RED 2: renders one field per input + heading', () => {
    render(<RunInputsModal isOpen={true} inputs={baseInputs} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/research topic/i)).toBeInTheDocument();
    expect(screen.getByText(/^depth$/i)).toBeInTheDocument();
  });

  it('RED 3: submit blocks when a required input is empty', () => {
    const onSubmit = vi.fn();
    render(<RunInputsModal isOpen={true} inputs={baseInputs} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /run flow/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('RED 4: submit fires with collected values when required filled', () => {
    const onSubmit = vi.fn();
    render(<RunInputsModal isOpen={true} inputs={baseInputs} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/research topic/i), { target: { value: 'Quantum cryptography' } });
    fireEvent.click(screen.getByRole('button', { name: /run flow/i }));
    expect(onSubmit).toHaveBeenCalledWith({ topic: 'Quantum cryptography' });
  });

  it('RED 5: cancel button fires onCancel', () => {
    const onCancel = vi.fn();
    render(<RunInputsModal isOpen={true} inputs={baseInputs} onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('RED 6: pre-fills from defaultValues prop', () => {
    render(
      <RunInputsModal
        isOpen={true}
        inputs={baseInputs}
        defaultValues={{ topic: 'Pre-filled topic', depth: 'shallow' }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/research topic/i) as HTMLInputElement).value).toBe('Pre-filled topic');
    expect((screen.getByLabelText(/^depth$/i) as HTMLInputElement).value).toBe('shallow');
  });
});
