/**
 * Z.7 — FrameRendererRegistry fallback: console.warn + visible error chrome
 *
 * When a frame arrives with an unknown outputTemplate slug:
 * (a) console.warn is called with the unknown slug and available slugs
 * (b) The fallback renders a visible inline error pill "unknown viz: <slug>"
 *     styled with --cm-warn color so users see something didn't render.
 *
 * Tests (RED first on current main where fallback returns null):
 * 1. console.warn called when slug is not registered
 * 2. Fallback DOM contains "unknown viz: <slug>" text
 * 3. Known slugs still resolve normally (no regression)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';

describe('FrameRendererRegistry — unknown slug handling (Z.7)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('console.warn is called when looking up an unknown slug', () => {
    const UNKNOWN = 'totally_unknown_slug_xyz_9999';
    const Fallback = FrameRendererRegistry.lookup(UNKNOWN);
    // Trigger the component render to fire the warn (warn on lookup)
    render(<Fallback slug={UNKNOWN} />);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(UNKNOWN),
      expect.anything(),
    );
  });

  it('fallback DOM contains "unknown viz: <slug>" pill', () => {
    const UNKNOWN = 'totally_unknown_slug_xyz_9999';
    const Fallback = FrameRendererRegistry.lookup(UNKNOWN);
    const { container } = render(<Fallback slug={UNKNOWN} />);
    const text = container.textContent ?? '';
    expect(text).toContain(`unknown viz: ${UNKNOWN}`);
  });

  it('fallback component has the unknown slug in its output', () => {
    const UNKNOWN = 'mystery_template_abc';
    const Fallback = FrameRendererRegistry.lookup(UNKNOWN);
    const { container } = render(<Fallback slug={UNKNOWN} />);
    expect(container.textContent).toContain(UNKNOWN);
  });

  it('known slug (sankey) resolves to a non-fallback component without warning', () => {
    const Resolved = FrameRendererRegistry.lookup('sankey');
    expect((Resolved as any).displayName).not.toBe('StreamingMarkdown');
    // No warn for known slug
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('undefined template falls back silently (no warn needed for undefined)', () => {
    const Fallback = FrameRendererRegistry.lookup(undefined);
    expect((Fallback as any).displayName).toBe('StreamingMarkdown');
  });
});
