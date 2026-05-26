/**
 * A.13 — FilePanel post-refactor: editor-only pane.
 *
 * After A.13 the FilePanel renders ONLY the editor (tabs + EditorPane).
 * The chrome row (.fp-chrome), left explorer column (.fp-left), and
 * center column (.fp-center) are removed. FilePanel becomes a pure
 * right-pane editor.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('@monaco-editor/react', () => ({
  Editor: ({ value }: { value: string }) => (
    <div data-testid="mock-monaco">{value}</div>
  ),
  loader: { config: () => {} },
}));

vi.mock('../../monaco/monacoLoader', () => ({
  getMonaco: vi.fn().mockResolvedValue({
    editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
  }),
  registerCmThemes: vi.fn(),
}));

// Directly mock EditorPane to avoid monacoLoader resolution issues in this
// test suite's module context (the suite tests FilePanel structure, not
// EditorPane behavior).
vi.mock('../EditorPane', () => ({
  EditorPane: () => <div data-testid="mock-editor-pane" />,
}));

vi.mock('../../state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('../../state/fileStatusStore');
  const store = createFileStatusStore();
  return {
    useFileStatusStore: store,
    useOpenTabs: () => store((s: any) => s.tabs),
    useActivePath: () => store((s: any) => s.activePath),
    useExpandedPaths: () => store((s: any) => s.expandedPaths),
    useIsDirty: (p: string) => store((s: any) => s.dirtyPaths.has(p)),
    useIsEditing: (p: string) => store((s: any) => s.editingPath === p),
    useIsRecentlyModified: (p: string) => store((s: any) => s.recentlyModifiedPaths.has(p)),
    createFileStatusStore,
  };
});

vi.mock('../../state/daemonRPCBridge', () => ({
  useDaemonRPCBridgeCall: () => vi.fn().mockResolvedValue({ entries: [] }),
  useDaemonRPCBridge: Object.assign(
    (selector: any) => selector({ call: vi.fn(), setCall: () => {} }),
    { getState: () => ({ call: vi.fn(), setCall: () => {} }) },
  ),
}));

import { FilePanel } from '../FilePanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FilePanel — editor-only post A.13', () => {
  it('renders the file-panel root', async () => {
    await act(async () => {
      render(<FilePanel rootPath="/workspaces/test" />);
    });

    expect(document.querySelector('[data-testid="file-panel"]')).not.toBeNull();
  });

  it('does NOT render .fp-chrome (chrome tab bar removed)', async () => {
    await act(async () => {
      render(<FilePanel rootPath="/workspaces/test" />);
    });

    expect(document.querySelector('.fp-chrome')).toBeNull();
  });

  it('does NOT render .fp-left (explorer column removed)', async () => {
    await act(async () => {
      render(<FilePanel rootPath="/workspaces/test" />);
    });

    expect(document.querySelector('.fp-left')).toBeNull();
  });

  it('does NOT render .fp-center (center column removed)', async () => {
    await act(async () => {
      render(<FilePanel rootPath="/workspaces/test" />);
    });

    expect(document.querySelector('.fp-center')).toBeNull();
  });

  it('still renders .fp-right (editor pane remains)', async () => {
    await act(async () => {
      render(<FilePanel rootPath="/workspaces/test" />);
    });

    expect(document.querySelector('.fp-right')).not.toBeNull();
  });
});
