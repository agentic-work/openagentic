/**
 * Phase H (task #153) — ArtifactPanel + reducer tests.
 *
 * Covers the reducer contract (pure event → state transitions) and a
 * handful of render assertions for the panel itself. The reducer tests
 * are the interesting ones — they exercise the race-tolerant paths
 * (stray delta for a closed panel, out-of-order seq, multi-file tabs).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  ArtifactPanel,
  INITIAL_ARTIFACT_PANEL_STATE,
  reduceArtifactPanel,
  DEFAULT_FILE_NAME,
} from '../index';
import type { ArtifactPanelState } from '../types';

describe('reduceArtifactPanel', () => {
  it('artifact_open initializes state with a default file', () => {
    const next = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-1',
      kind: 'code',
      title: 'Dashboard',
      language: 'typescript',
    });
    expect(next.artifactId).toBe('art-1');
    expect(next.isOpen).toBe(true);
    expect(next.isComplete).toBe(false);
    expect(next.kind).toBe('code');
    expect(next.files.size).toBe(1);
    expect(next.files.get(DEFAULT_FILE_NAME)?.language).toBe('typescript');
  });

  it('artifact_delta appends content by fileName', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-2',
      kind: 'code',
      title: 'Multi',
    });
    const s1 = reduceArtifactPanel(s0, {
      type: 'artifact_delta',
      artifactId: 'art-2',
      contentDelta: 'export const a =',
      fileName: 'a.ts',
    });
    const s2 = reduceArtifactPanel(s1, {
      type: 'artifact_delta',
      artifactId: 'art-2',
      contentDelta: ' 1;',
      fileName: 'a.ts',
    });
    expect(s2.files.get('a.ts')?.content).toBe('export const a = 1;');
  });

  it('artifact_delta with mismatching artifactId is dropped', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-3',
      kind: 'code',
      title: 'x',
    });
    const s1 = reduceArtifactPanel(s0, {
      type: 'artifact_delta',
      artifactId: 'WRONG',
      contentDelta: 'x',
    });
    expect(s1).toBe(s0);
  });

  it('artifact_delta out-of-order seq is dropped', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-4',
      kind: 'code',
      title: 'x',
    });
    const s1 = reduceArtifactPanel(s0, {
      type: 'artifact_delta',
      artifactId: 'art-4',
      contentDelta: 'a',
      seq: 5,
    });
    const s2 = reduceArtifactPanel(s1, {
      type: 'artifact_delta',
      artifactId: 'art-4',
      contentDelta: 'b',
      seq: 2, // stale
    });
    expect(s2).toBe(s1);
    expect(s2.files.get(DEFAULT_FILE_NAME)?.content).toBe('a');
  });

  it('artifact_close marks complete + persists stats', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-5',
      kind: 'markdown',
      title: 'Report',
    });
    const s1 = reduceArtifactPanel(s0, {
      type: 'artifact_delta',
      artifactId: 'art-5',
      contentDelta: '# Hello\n',
    });
    const s2 = reduceArtifactPanel(s1, {
      type: 'artifact_close',
      artifactId: 'art-5',
      stats: { bytes: 7, lines: 2 },
    });
    expect(s2.isComplete).toBe(true);
    expect(s2.stats).toEqual({ bytes: 7, lines: 2 });
  });

  it('artifact_close finalContent is taken when content is still partial', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-6',
      kind: 'markdown',
      title: 'x',
    });
    const s1 = reduceArtifactPanel(s0, {
      type: 'artifact_delta',
      artifactId: 'art-6',
      contentDelta: 'partial',
    });
    const s2 = reduceArtifactPanel(s1, {
      type: 'artifact_close',
      artifactId: 'art-6',
      finalContent: 'partial + more text',
    });
    expect(s2.files.get(DEFAULT_FILE_NAME)?.content).toBe('partial + more text');
  });

  it('reset returns the INITIAL state', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-7',
      kind: 'code',
      title: 'x',
    });
    const s1 = reduceArtifactPanel(s0, { type: 'reset' });
    expect(s1).toEqual(INITIAL_ARTIFACT_PANEL_STATE);
  });

  it('close_panel sets isOpen=false without losing artifactId/content', () => {
    const s0 = reduceArtifactPanel(INITIAL_ARTIFACT_PANEL_STATE, {
      type: 'artifact_open',
      artifactId: 'art-8',
      kind: 'code',
      title: 'x',
    });
    const s1 = reduceArtifactPanel(s0, { type: 'close_panel' });
    expect(s1.isOpen).toBe(false);
    expect(s1.artifactId).toBe('art-8');
  });
});

describe('<ArtifactPanel />', () => {
  function buildState(overrides: Partial<ArtifactPanelState> = {}): ArtifactPanelState {
    const base: ArtifactPanelState = {
      artifactId: 'art-r',
      kind: 'code',
      title: 'MyArtifact',
      files: new Map([
        [
          DEFAULT_FILE_NAME,
          {
            fileName: DEFAULT_FILE_NAME,
            content: 'hello world\n',
            lastSeq: 0,
          },
        ],
      ]),
      isOpen: true,
      isComplete: false,
      stats: null,
    };
    return { ...base, ...overrides };
  }

  it('returns null when closed', () => {
    const { container } = render(
      <ArtifactPanel state={{ ...INITIAL_ARTIFACT_PANEL_STATE, isOpen: false }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title + kind badge + body', () => {
    render(<ArtifactPanel state={buildState()} />);
    const panel = screen.getByTestId('artifact-panel');
    expect(panel.getAttribute('data-artifact-id')).toBe('art-r');
    expect(panel.getAttribute('data-kind')).toBe('code');
    // Header tag is the fixed "ARTIFACT" literal (matches mockup 03).
    expect(screen.getByTestId('artifact-panel-kind').textContent).toBe('ARTIFACT');
    expect(screen.getByTestId('artifact-panel-title').textContent).toBe('MyArtifact');
    // Body content is rendered by ShikiCodeBlock — a hydration pass may
    // wrap it, so assert we can find the text somewhere in the subtree.
    expect(screen.getByTestId('artifact-panel-body').textContent).toContain('hello world');
  });

  it('shows completion badge + hides cursor when isComplete', () => {
    const state = buildState({ isComplete: true, stats: { bytes: 12, lines: 1 } });
    render(<ArtifactPanel state={state} />);
    const panel = screen.getByTestId('artifact-panel');
    expect(panel.getAttribute('data-complete')).toBe('true');
    expect(screen.getByTestId('artifact-panel-complete-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-panel-cursor')).not.toBeInTheDocument();
  });

  it('shows tabs + renders active file body for multi-file artifacts', () => {
    const state = buildState({
      files: new Map([
        ['a.ts', { fileName: 'a.ts', content: 'A', lastSeq: 0 }],
        ['b.ts', { fileName: 'b.ts', content: 'B', lastSeq: 0 }],
      ]),
    });
    render(<ArtifactPanel state={state} />);
    expect(screen.getByTestId('artifact-panel-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-panel-tab-a.ts')).toBeInTheDocument();
    expect(screen.getByTestId('artifact-panel-tab-b.ts')).toBeInTheDocument();
    // First tab selected by default — its body should render.
    expect(screen.getByTestId('artifact-panel-body').textContent).toContain('A');
  });
});
