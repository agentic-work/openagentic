/**
 * #781 Phase B — ArtifactSlideOut primitive tests.
 *
 * Contract pinned:
 *   - When open=false, slide-out is NOT rendered (no leftover DOM)
 *   - When open=true, header (title, kind badge, status) + close button
 *     + actions slot + children body all render
 *   - Close button click → onOpenChange(false)
 *   - ESC key while open → onOpenChange(false)
 *   - Full-screen toggle button click → calls onFullScreenChange OR
 *     toggles a [data-fullscreen="true"] attribute on the root
 *   - Status string maps to a status indicator with data-status attr
 *   - kind shows as a kind badge with data-kind attr
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ArtifactSlideOut } from '../ArtifactSlideOut.js';

describe('ArtifactSlideOut — #781 Phase B primitive', () => {
  it('renders nothing when open=false', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <ArtifactSlideOut
        open={false}
        onOpenChange={onOpenChange}
        title="Test Artifact"
        kind="python-report"
        status="success"
      >
        <div data-testid="body">hello</div>
      </ArtifactSlideOut>,
    );
    expect(screen.queryByTestId('artifact-slideout-root')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="body"]')).not.toBeInTheDocument();
  });

  it('renders title + kind badge + status indicator + body when open=true', () => {
    const onOpenChange = vi.fn();
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={onOpenChange}
        title="Cost Report"
        kind="python-report"
        status="success"
      >
        <div data-testid="body">my report body</div>
      </ArtifactSlideOut>,
    );
    expect(screen.getByTestId('artifact-slideout-root')).toBeInTheDocument();
    expect(screen.getByText('Cost Report')).toBeInTheDocument();
    expect(
      screen.getByTestId('artifact-slideout-kind-badge'),
    ).toHaveAttribute('data-kind', 'python-report');
    expect(
      screen.getByTestId('artifact-slideout-status'),
    ).toHaveAttribute('data-status', 'success');
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });

  it('clicking close button fires onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={onOpenChange}
        title="x"
        kind="chart"
        status="success"
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    await user.click(screen.getByTestId('artifact-slideout-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('pressing ESC fires onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={onOpenChange}
        title="x"
        kind="chart"
        status="success"
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('full-screen toggle button flips [data-fullscreen] on root', async () => {
    const user = userEvent.setup();
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={vi.fn()}
        title="x"
        kind="chart"
        status="success"
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    const root = screen.getByTestId('artifact-slideout-root');
    expect(root).toHaveAttribute('data-fullscreen', 'false');
    await user.click(screen.getByTestId('artifact-slideout-fullscreen'));
    expect(root).toHaveAttribute('data-fullscreen', 'true');
  });

  it('renders the actions slot when provided', () => {
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={vi.fn()}
        title="x"
        kind="chart"
        status="success"
        actions={<button data-testid="my-action">Action</button>}
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    expect(screen.getByTestId('my-action')).toBeInTheDocument();
  });

  it('status="running" shows running indicator', () => {
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={vi.fn()}
        title="x"
        kind="chart"
        status="running"
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    expect(screen.getByTestId('artifact-slideout-status')).toHaveAttribute(
      'data-status',
      'running',
    );
  });

  it('status="error" shows error indicator', () => {
    render(
      <ArtifactSlideOut
        open={true}
        onOpenChange={vi.fn()}
        title="x"
        kind="chart"
        status="error"
      >
        <div>body</div>
      </ArtifactSlideOut>,
    );
    expect(screen.getByTestId('artifact-slideout-status')).toHaveAttribute(
      'data-status',
      'error',
    );
  });
});
