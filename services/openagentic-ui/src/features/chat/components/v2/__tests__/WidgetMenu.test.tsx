/**
 * WidgetMenu — RED→GREEN contract for the v2 widget ellipsis menu.
 *
 * Pattern: Claude.ai's artifact card has a top-right ellipsis menu with
 * Copy / Download / Expand / Open-in-new-tab items. We mirror that order
 * + iconography. Reference: docs.anthropic.com/en/docs/build-with-claude/artifacts.
 *
 * Contract:
 *   - Renders a single MoreHorizontal trigger button at top-right.
 *   - Click opens a popover with 4 menu items (Copy SVG, Download, Expand, Open in new tab).
 *   - Items are accessible via getByRole('menuitem', { name: /…/i }).
 *   - Copy → writes the SVG/HTML content to navigator.clipboard.
 *   - Download → triggers a Blob URL anchor click with a sensible filename.
 *   - Expand → calls onExpand prop.
 *   - Open in new tab → window.open() with a Blob URL of the rendered srcdoc.
 *   - ESC closes the menu.
 *   - Click-outside closes the menu.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WidgetMenu } from '../WidgetMenu.js';

const SAMPLE_SVG = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="red"/></svg>';

describe('WidgetMenu — v2 ellipsis menu', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders a single trigger button labeled "More options"', () => {
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc="<!doctype html><html><body><svg/></body></html>"
        onExpand={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: /more options/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the popover with 4 items in Claude.ai order on trigger click', () => {
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc=""
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveAccessibleName(/copy/i);
    expect(items[1]).toHaveAccessibleName(/download/i);
    expect(items[2]).toHaveAccessibleName(/expand/i);
    expect(items[3]).toHaveAccessibleName(/open in new tab/i);
  });

  it('Copy item writes the SVG content to navigator.clipboard', async () => {
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc=""
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /copy/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SAMPLE_SVG);
    });
  });

  it('Download item creates a Blob URL anchor with the title-derived filename', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    // Spy on anchor click — the standard Blob-download trick.
    const anchorClicks: HTMLAnchorElement[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      anchorClicks.push(this);
    };

    try {
      render(
        <WidgetMenu
          kind="svg"
          content={SAMPLE_SVG}
          title="cost_flow"
          srcdoc=""
          onExpand={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /more options/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));

      expect(createObjectURL).toHaveBeenCalled();
      expect(anchorClicks.length).toBeGreaterThan(0);
      const a = anchorClicks[0];
      expect(a.download).toMatch(/cost_flow.*\.svg$/);
      expect(a.href).toContain('blob:');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  it('Expand item calls onExpand prop', () => {
    const onExpand = vi.fn();
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc=""
        onExpand={onExpand}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /expand/i }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('Open in new tab item calls window.open with a Blob URL', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });

    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc="<!doctype html><html>...</html>"
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /open in new tab/i }));

    expect(openSpy).toHaveBeenCalled();
    const url = openSpy.mock.calls[0][0];
    expect(String(url)).toContain('blob:');
    openSpy.mockRestore();
  });

  it('Escape closes the open menu', () => {
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="cost_flow"
        srcdoc=""
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('html kind: Copy writes the themed srcdoc (not bare content) so the clipboard payload is portable', async () => {
    const fragment = '<div class="pod-health-report"><h2>title</h2></div>';
    const themedSrcdoc = '<!DOCTYPE html><html><head><style>:root{--bg-0:#000}</style></head><body>'
      + fragment + '</body></html>';
    render(
      <WidgetMenu
        kind="html"
        content={fragment}
        title="report"
        srcdoc={themedSrcdoc}
        onExpand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /copy/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(themedSrcdoc);
    });
  });

  it('html kind: Download saves the themed srcdoc so the file renders standalone', () => {
    const fragment = '<div class="pod-health-report"><h2>title</h2></div>';
    const themedSrcdoc = '<!DOCTYPE html><html><head><style>:root{--bg-0:#000}</style></head><body>'
      + fragment + '</body></html>';
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    let capturedBlob: Blob | undefined;
    const origCreate = URL.createObjectURL;
    (URL as any).createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock-url';
    });
    const anchorClicks: HTMLAnchorElement[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      anchorClicks.push(this);
    };
    try {
      render(
        <WidgetMenu
          kind="html"
          content={fragment}
          title="report"
          srcdoc={themedSrcdoc}
          onExpand={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /more options/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
      expect(anchorClicks[0].download).toMatch(/\.html$/);
      expect(capturedBlob).toBeDefined();
      // The bytes downloaded MUST be the themed srcdoc, not the bare fragment.
      // We confirm by checking blob size matches themedSrcdoc length, not fragment.
      expect(capturedBlob!.size).toBe(new TextEncoder().encode(themedSrcdoc).length);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      (URL as any).createObjectURL = origCreate;
    }
  });

  it('html kind: download filename ends in .html', () => {
    Object.assign(URL, {
      createObjectURL: vi.fn().mockReturnValue('blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
    const anchorClicks: HTMLAnchorElement[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      anchorClicks.push(this);
    };
    try {
      render(
        <WidgetMenu
          kind="html"
          content="<div>hello</div>"
          title="kpis"
          srcdoc=""
          onExpand={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /more options/i }));
      fireEvent.click(screen.getByRole('menuitem', { name: /download/i }));
      expect(anchorClicks[0].download).toMatch(/\.html$/);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Sprint B (2026-05-18) — Excel export menu item.
  // The item only appears when the parent passes onDownloadExcel; it MUST
  // NOT show for SVG/HTML widgets without exportable data (charts only).
  // ─────────────────────────────────────────────────────────────────────

  it('Sprint B — "Download as Excel" menu item is absent without onDownloadExcel', () => {
    render(
      <WidgetMenu kind="svg" content={SAMPLE_SVG} title="x" srcdoc="" onExpand={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.queryByRole('menuitem', { name: /excel/i })).toBeNull();
  });

  it('Sprint B — "Download as Excel" menu item appears WHEN onDownloadExcel is provided', () => {
    render(
      <WidgetMenu
        kind="svg"
        content={SAMPLE_SVG}
        title="x"
        srcdoc=""
        onExpand={vi.fn()}
        onDownloadExcel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menuitem', { name: /excel/i })).toBeInTheDocument();
  });

  it('Sprint B — clicking "Download as Excel" calls onDownloadExcel', () => {
    const onDownloadExcel = vi.fn();
    render(
      <WidgetMenu
        kind="chart"
        content="{}"
        title="cost"
        srcdoc=""
        onExpand={vi.fn()}
        onDownloadExcel={onDownloadExcel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /more options/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /excel/i }));
    expect(onDownloadExcel).toHaveBeenCalledOnce();
  });
});
