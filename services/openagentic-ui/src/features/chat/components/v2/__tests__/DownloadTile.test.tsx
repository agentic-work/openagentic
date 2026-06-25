/**
 * AC-D2 — DownloadTile render dispatcher.
 *
 * Renders one ArtifactEmit entry as a clickable download chip:
 *   icon (mimetype-driven) + filename + formatted size + "Download" CTA
 *
 * Click on the anchor takes the user to the presigned MinIO URL.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadTile } from '../DownloadTile';
import type { ArtifactEmit } from '../../../hooks/useChatStream';

const sample = (overrides: Partial<ArtifactEmit> = {}): ArtifactEmit => ({
  artifactId: 'a-1',
  filename: 'report.pdf',
  contentType: 'application/pdf',
  sizeBytes: 102400,
  downloadUrl: '/api/storage/users/u1/objects/a-1?token=xyz',
  producedBy: 'synth_execute',
  ...overrides,
});

describe('DownloadTile — AC-D2 render', () => {
  it('renders filename + size + download anchor for PDFs', () => {
    render(<DownloadTile artifact={sample()} />);
    expect(screen.getByText(/report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/100\.0\s*KB|102\.4\s*KB|102400\s*B/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/api/storage/users/u1/objects/a-1?token=xyz');
  });

  it('renders DOCX with the right filename', () => {
    const a = sample({
      filename: 'data.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 51200,
    });
    render(<DownloadTile artifact={a} />);
    expect(screen.getByText(/data\.docx/)).toBeInTheDocument();
  });

  it('exposes the contentType via data-mime for downstream selectors', () => {
    const { container } = render(<DownloadTile artifact={sample()} />);
    const tile = container.querySelector('[data-testid="download-tile"]');
    expect(tile?.getAttribute('data-mime')).toBe('application/pdf');
  });

  it('marks the link with download attribute matching filename', () => {
    render(<DownloadTile artifact={sample()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('download', 'report.pdf');
  });

  it('formats bytes (5_300_000) as MB with one decimal', () => {
    const a = sample({ sizeBytes: 5_300_000 });
    render(<DownloadTile artifact={a} />);
    // 5.05 MB or 5.0 MB depending on rounding — accept both
    expect(screen.getByText(/5\.\d\s*MB/)).toBeInTheDocument();
  });

  it('shows producedBy chip when present', () => {
    render(<DownloadTile artifact={sample({ producedBy: 'synth_execute' })} />);
    expect(screen.getByText(/synth_execute/)).toBeInTheDocument();
  });
});
