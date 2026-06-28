/**
 * #781 Phase B — ArtifactActionBar tests.
 *
 * Conditional render per capability flag, click → callback, basic ARIA.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ArtifactActionBar } from '../ArtifactActionBar.js';

describe('ArtifactActionBar — #781 Phase B', () => {
  it('renders nothing when no capabilities are enabled', () => {
    const { container } = render(<ArtifactActionBar />);
    // Root still mounts (so layout slot stays stable) but has zero buttons.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders Copy button when canCopy=true and fires onCopy on click', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<ArtifactActionBar canCopy onCopy={onCopy} />);
    const btn = screen.getByTestId('artifact-action-copy');
    expect(btn).toHaveAttribute('aria-label', 'Copy artifact content');
    await user.click(btn);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('renders Download source button when canDownloadSource=true and fires onDownloadSource', async () => {
    const user = userEvent.setup();
    const onDownloadSource = vi.fn();
    render(<ArtifactActionBar canDownloadSource onDownloadSource={onDownloadSource} />);
    const btn = screen.getByTestId('artifact-action-download-source');
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onDownloadSource).toHaveBeenCalledTimes(1);
  });

  it('renders Export PDF when canExportPdf=true', async () => {
    const user = userEvent.setup();
    const onExportPdf = vi.fn();
    render(<ArtifactActionBar canExportPdf onExportPdf={onExportPdf} />);
    await user.click(screen.getByTestId('artifact-action-export-pdf'));
    expect(onExportPdf).toHaveBeenCalledTimes(1);
  });

  it('renders Export PNG when canExportPng=true', async () => {
    const user = userEvent.setup();
    const onExportPng = vi.fn();
    render(<ArtifactActionBar canExportPng onExportPng={onExportPng} />);
    await user.click(screen.getByTestId('artifact-action-export-png'));
    expect(onExportPng).toHaveBeenCalledTimes(1);
  });

  it('renders Open in new tab when canOpenNewTab=true', async () => {
    const user = userEvent.setup();
    const onOpenNewTab = vi.fn();
    render(<ArtifactActionBar canOpenNewTab onOpenNewTab={onOpenNewTab} />);
    await user.click(screen.getByTestId('artifact-action-open-new-tab'));
    expect(onOpenNewTab).toHaveBeenCalledTimes(1);
  });

  it('renders Re-run when canRerun=true', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    render(<ArtifactActionBar canRerun onRerun={onRerun} />);
    await user.click(screen.getByTestId('artifact-action-rerun'));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });

  it('renders ALL six buttons when all caps enabled', () => {
    render(
      <ArtifactActionBar
        canCopy
        canDownloadSource
        canExportPdf
        canExportPng
        canOpenNewTab
        canRerun
        onCopy={vi.fn()}
        onDownloadSource={vi.fn()}
        onExportPdf={vi.fn()}
        onExportPng={vi.fn()}
        onOpenNewTab={vi.fn()}
        onRerun={vi.fn()}
      />,
    );
    expect(screen.getByTestId('artifact-action-copy')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-action-download-source')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-action-export-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-action-export-png')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-action-open-new-tab')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-action-rerun')).toBeInTheDocument();
  });
});
