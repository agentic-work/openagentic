/**
 * #781 Phase D — ArtifactSlideOutLauncher tests.
 *
 * Phase D contract: when an assistant message has new-pipeline artifact
 * metadata (`tool_result._meta.artifactKind` OR a populated
 * `Message.visualizations[]` entry), MessageBubble mounts THIS launcher
 * — a compact button (title + kind chip + "View" action) that opens
 * `ArtifactSlideOut` with the matching renderer mounted in its body.
 *
 * The legacy `ArtifactRenderer` / `StreamingArtifactRenderer` pipeline
 * is NOT used for these messages.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArtifactSlideOutLauncher } from '../ArtifactSlideOutLauncher.js';

describe('ArtifactSlideOutLauncher — #781 Phase D', () => {
  it('renders a button labelled with the artifact title + kind chip', () => {
    render(
      <ArtifactSlideOutLauncher
        kind="chart"
        title="Tri-cloud cost spike"
        payload={{ kind: 'bar', data: [{ label: 'AWS', value: 12 }] }}
      />,
    );
    const btn = screen.getByTestId('artifact-launcher');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Tri-cloud cost spike');
    expect(screen.getByTestId('artifact-launcher-kind')).toHaveTextContent('chart');
  });

  it('opens the slide-out when clicked', () => {
    render(
      <ArtifactSlideOutLauncher
        kind="table"
        title="VM inventory"
        payload={{
          rows: [{ name: 'vm-1', cost: 12.5 }],
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'cost', label: 'Cost', numeric: true },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId('artifact-slideout-root')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('artifact-launcher'));
    expect(screen.getByTestId('artifact-slideout-root')).toBeInTheDocument();
  });

  it('mounts the matching renderer inside the slide-out for each kind', () => {
    const cases: Array<{ kind: any; payload: any; expectTestid: string }> = [
      {
        kind: 'chart',
        payload: { kind: 'bar', data: [{ label: 'x', value: 1 }] },
        expectTestid: 'chart-root',
      },
      {
        kind: 'table',
        payload: {
          rows: [{ a: 1 }],
          columns: [{ key: 'a', label: 'A', numeric: true }],
        },
        expectTestid: 'table-root',
      },
      {
        kind: 'runbook',
        payload: { id: 'r1', steps: [{ title: 'do the thing' }] },
        expectTestid: 'runbook-root',
      },
      {
        kind: 'python-report',
        payload: { stdout: '# report\n\nbody', executionTimeMs: 142 },
        expectTestid: 'python-report-root',
      },
    ];
    for (const c of cases) {
      const { unmount } = render(
        <ArtifactSlideOutLauncher kind={c.kind} title="t" payload={c.payload} />,
      );
      fireEvent.click(screen.getByTestId('artifact-launcher'));
      expect(screen.getByTestId(c.expectTestid)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders an unknown-kind chip + error body for unknown kinds', () => {
    render(
      <ArtifactSlideOutLauncher
        kind={'whatever' as any}
        title="???"
        payload={{}}
      />,
    );
    expect(screen.getByTestId('artifact-launcher-kind')).toHaveTextContent('unknown');
    fireEvent.click(screen.getByTestId('artifact-launcher'));
    expect(screen.getByTestId('artifact-unknown')).toBeInTheDocument();
  });

  it('closes the slide-out via the close handler', () => {
    render(
      <ArtifactSlideOutLauncher
        kind="chart"
        title="t"
        payload={{ kind: 'bar', data: [{ label: 'x', value: 1 }] }}
      />,
    );
    fireEvent.click(screen.getByTestId('artifact-launcher'));
    fireEvent.click(screen.getByTestId('artifact-slideout-close'));
    expect(screen.queryByTestId('artifact-slideout')).not.toBeInTheDocument();
  });
});
