/**
 * FlowExportImportButton — toolbar control that lets the user
 *   - download the current flow as JSON ("Export")
 *   - upload a JSON file and apply it via onImport ("Import")
 *
 * Spec:
 *   - When `getFlowJson` returns valid JSON, clicking Export
 *     triggers a download with filename derived from the flow name.
 *   - When `getFlowJson` returns null, the Export button stays
 *     disabled (nothing to export).
 *   - Clicking Import opens a hidden <input type="file">; selecting
 *     a JSON file resolves with its contents and calls onImport.
 *   - A non-JSON file calls onImport(null) — caller decides how
 *     to surface the error.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FlowExportImportButton } from '../FlowExportImportButton';

describe('FlowExportImportButton', () => {
  beforeEach(() => {
    // Stub URL.createObjectURL / revokeObjectURL — jsdom doesn't ship them.
    (URL as any).createObjectURL = vi.fn(() => 'blob:test');
    (URL as any).revokeObjectURL = vi.fn();
  });

  it('renders an Export and Import button', () => {
    render(
      <FlowExportImportButton
        flowName="My Flow"
        getFlowJson={() => '{"nodes":[],"edges":[]}'}
        onImport={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });

  it('disables Export when getFlowJson returns null', () => {
    render(
      <FlowExportImportButton
        flowName="My Flow"
        getFlowJson={() => null}
        onImport={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('clicking Export creates a blob with the JSON and triggers a download', () => {
    const json = '{"nodes":[{"id":"a"}],"edges":[]}';
    let triggered = false;
    let downloadName: string | null = null;

    // Spy on anchor click to capture the download. jsdom doesn't navigate.
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') {
        const anchor = el as HTMLAnchorElement;
        Object.defineProperty(anchor, 'click', {
          value: () => {
            triggered = true;
            downloadName = anchor.getAttribute('download');
          },
        });
      }
      return el;
    });

    render(
      <FlowExportImportButton
        flowName="My Cool Flow"
        getFlowJson={() => json}
        onImport={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(triggered).toBe(true);
    expect(downloadName).toMatch(/^my-cool-flow.*\.json$/i);
  });

  it('selecting a JSON file fires onImport with the parsed text', async () => {
    const onImport = vi.fn();
    const { container } = render(
      <FlowExportImportButton
        flowName="x"
        getFlowJson={() => '{}'}
        onImport={onImport}
      />,
    );

    const file = new File(
      ['{"nodes":[{"id":"x"}],"edges":[]}'],
      'flow.json',
      { type: 'application/json' },
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith('{"nodes":[{"id":"x"}],"edges":[]}');
  });

  it('selecting a non-JSON file fires onImport(null)', async () => {
    const onImport = vi.fn();
    const { container } = render(
      <FlowExportImportButton
        flowName="x"
        getFlowJson={() => '{}'}
        onImport={onImport}
      />,
    );

    const file = new File(['this is not json {{'], 'broken.json', { type: 'application/json' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith(null);
  });
});
