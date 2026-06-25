/**
 * canvasViewportStorage — persists ReactFlow viewport (zoom + pan) per
 * workflow id in localStorage so reopening a flow restores the user's
 * last camera state instead of always re-fitting.
 *
 * Falls back gracefully when localStorage isn't available (SSR / private
 * browsing) — read returns null, write becomes a no-op.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveViewport,
  loadViewport,
  clearViewport,
} from '../canvasViewportStorage';

describe('canvasViewportStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null for an unknown workflow id', () => {
    expect(loadViewport('flow-nope')).toBeNull();
  });

  it('round-trips zoom + x/y per workflow id', () => {
    saveViewport('flow-a', { x: 120, y: -30, zoom: 1.4 });
    expect(loadViewport('flow-a')).toEqual({ x: 120, y: -30, zoom: 1.4 });
  });

  it('keeps separate state per workflow id', () => {
    saveViewport('flow-a', { x: 0, y: 0, zoom: 1 });
    saveViewport('flow-b', { x: 50, y: 50, zoom: 0.5 });
    expect(loadViewport('flow-a')).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(loadViewport('flow-b')).toEqual({ x: 50, y: 50, zoom: 0.5 });
  });

  it('clearViewport removes the entry', () => {
    saveViewport('flow-x', { x: 1, y: 2, zoom: 1 });
    clearViewport('flow-x');
    expect(loadViewport('flow-x')).toBeNull();
  });

  it('returns null and does not throw on malformed stored value', () => {
    localStorage.setItem('openagentic.workflow.viewport.flow-broken', '{not-json');
    expect(loadViewport('flow-broken')).toBeNull();
  });

  it('does not throw if save value is missing required fields', () => {
    expect(() =>
      saveViewport('flow-y', { x: 0, y: 0 } as any),
    ).not.toThrow();
    // partial save is rejected — we keep the storage clean
    expect(loadViewport('flow-y')).toBeNull();
  });

  it('write is a no-op when localStorage throws (e.g. quota exceeded)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() =>
      saveViewport('flow-q', { x: 1, y: 2, zoom: 1 }),
    ).not.toThrow();
    setItem.mockRestore();
  });
});
