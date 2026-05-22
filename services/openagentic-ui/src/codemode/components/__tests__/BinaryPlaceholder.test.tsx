import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BinaryPlaceholder } from '../BinaryPlaceholder';

describe('BinaryPlaceholder', () => {
  it('renders the content type', () => {
    render(
      <BinaryPlaceholder
        contentType="application/octet-stream"
        size={1024}
        reason="binary"
      />
    );
    expect(screen.getByText(/application\/octet-stream/i)).toBeTruthy();
  });

  it('renders human-readable size', () => {
    render(
      <BinaryPlaceholder
        contentType="application/zip"
        size={2500000}
        reason="binary"
      />
    );
    expect(screen.getByText(/2\.4 MB/)).toBeTruthy();
  });

  it('shows Binary file message for reason binary', () => {
    render(
      <BinaryPlaceholder
        contentType="application/octet-stream"
        size={500}
        reason="binary"
      />
    );
    expect(screen.getByText(/binary file/i)).toBeTruthy();
  });

  it('shows File exceeds message for reason too_large', () => {
    render(
      <BinaryPlaceholder
        contentType="text/plain"
        size={3000000}
        reason="too_large"
      />
    );
    expect(screen.getByText(/file exceeds 2 mb preview limit/i)).toBeTruthy();
  });

  it('renders a download button and calls handler on click', () => {
    const handler = vi.fn();
    render(
      <BinaryPlaceholder
        contentType="application/zip"
        size={1024}
        reason="binary"
        onDownload={handler}
      />
    );
    const btn = screen.getByRole('button', { name: /download/i });
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledOnce();
  });
});
