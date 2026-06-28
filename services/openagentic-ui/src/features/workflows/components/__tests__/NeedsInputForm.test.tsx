/**
 * NeedsInputForm — flows "human_input" HITL typed-form tests.
 *
 * The flows engine pauses on a `human_input` node and emits a `needs_input`
 * NDJSON frame. This form renders the typed fields, blocks submit on missing
 * required fields, surfaces inline validation errors, and POSTs `{ values }`
 * to the data-request route on a valid submit.
 *
 * Runner: vitest (jsdom) + @testing-library/react.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { NeedsInputForm } from '../NeedsInputForm';
import type { NeedsInputRequest } from '../NeedsInputForm';

// framer-motion → plain divs (no animation in jsdom)
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: any) => <div {...props} /> }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// icons → simple stubs
vi.mock('@/shared/icons', () => ({
  Send: () => <span>send</span>,
  Loader2: () => <span>loading</span>,
  AlertCircle: () => <span>alert</span>,
  Check: () => <span>check</span>,
  Eye: () => <span>eye</span>,
  EyeOff: () => <span>eyeoff</span>,
  Calendar: () => <span>cal</span>,
  Lock: () => <span>lock</span>,
  FileText: () => <span>file</span>,
  ChevronDown: () => <span>chev</span>,
  X: () => <span>x</span>,
}));

const baseRequest: NeedsInputRequest = {
  requestId: 'req-1',
  nodeId: 'node-1',
  title: 'Approve deploy',
  description: 'Provide the parameters to continue the workflow.',
  fields: [
    { name: 'env', label: 'Environment', type: 'enum', required: true, options: ['dev', 'prod'] },
    { name: 'replicas', label: 'Replicas', type: 'number', required: true },
    { name: 'token', label: 'API Token', type: 'secret', required: false },
    { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: true },
    { name: 'notes', label: 'Notes', type: 'string', required: false, placeholder: 'optional notes' },
    { name: 'schedule', label: 'Run date', type: 'date', required: false },
    { name: 'payload', label: 'JSON Payload', type: 'json', required: false },
  ],
};

afterEach(() => cleanup());

describe('NeedsInputForm', () => {
  it('renders the title + description header', () => {
    render(<NeedsInputForm request={baseRequest} onSubmit={vi.fn()} />);
    expect(screen.getByText('Approve deploy')).toBeInTheDocument();
    expect(screen.getByText(/Provide the parameters to continue/)).toBeInTheDocument();
  });

  it('renders a field control matched to each field type', () => {
    render(<NeedsInputForm request={baseRequest} onSubmit={vi.fn()} />);
    // enum → <select> with the declared options
    const select = screen.getByLabelText(/Environment/) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'dev' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'prod' })).toBeInTheDocument();
    // number → input[type=number]
    const num = screen.getByLabelText(/Replicas/) as HTMLInputElement;
    expect(num.type).toBe('number');
    // secret → input[type=password] (masked)
    const secret = screen.getByLabelText(/API Token/) as HTMLInputElement;
    expect(secret.type).toBe('password');
    // boolean → checkbox
    const bool = screen.getByLabelText(/Enabled/) as HTMLInputElement;
    expect(bool.type).toBe('checkbox');
    // date → input[type=date]
    const date = screen.getByLabelText(/Run date/) as HTMLInputElement;
    expect(date.type).toBe('date');
    // json → textarea
    const json = screen.getByLabelText(/JSON Payload/) as HTMLTextAreaElement;
    expect(json.tagName).toBe('TEXTAREA');
    // string → text input
    const str = screen.getByLabelText(/Notes/) as HTMLInputElement;
    expect(str.tagName === 'INPUT' || str.tagName === 'TEXTAREA').toBe(true);
  });

  it('honors boolean default value', () => {
    render(<NeedsInputForm request={baseRequest} onSubmit={vi.fn()} />);
    const bool = screen.getByLabelText(/Enabled/) as HTMLInputElement;
    expect(bool.checked).toBe(true);
  });

  it('blocks submit and shows inline errors when a required field is empty', () => {
    const onSubmit = vi.fn();
    render(<NeedsInputForm request={baseRequest} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    // onSubmit must NOT have been called — required env + replicas are empty
    expect(onSubmit).not.toHaveBeenCalled();
    // at least one inline required error surfaces
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);
  });

  it('submits collected values once required fields are filled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<NeedsInputForm request={baseRequest} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Environment/), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText(/Replicas/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'ship it' } });

    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.env).toBe('prod');
    expect(submitted.replicas).toBe(3); // coerced to number
    expect(submitted.notes).toBe('ship it');
    expect(submitted.enabled).toBe(true); // default boolean carried through
  });

  it('shows a submitting state while onSubmit is in flight', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<NeedsInputForm request={baseRequest} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Environment/), { target: { value: 'dev' } });
    fireEvent.change(screen.getByLabelText(/Replicas/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(screen.getByText(/submitting/i)).toBeInTheDocument());
    resolve();
  });

  it('renders a "use defaults" affordance when defaults are allowed', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <NeedsInputForm
        request={{ ...baseRequest, allowDefaults: true }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('button', { name: /use defaults/i })).toBeInTheDocument();
  });

  it('does not render "use defaults" when not allowed', () => {
    render(<NeedsInputForm request={baseRequest} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /use defaults/i })).toBeNull();
  });

  it('surfaces a server error message when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom from server'));
    render(<NeedsInputForm request={baseRequest} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Environment/), { target: { value: 'dev' } });
    fireEvent.change(screen.getByLabelText(/Replicas/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/boom from server/)).toBeInTheDocument());
  });
});
