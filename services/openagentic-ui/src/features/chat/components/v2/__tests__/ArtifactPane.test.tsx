/**
 * Phase 20 — ArtifactPane primitive (mocks 02, 03, 06, 07, 08, 09).
 *
 * Mock anatomy:
 *   <aside class="cm-artifact-panel">
 *     <header class="cm-art-head">
 *       <span class="cm-tag">artifact</span>
 *       <span class="cm-title">k8s-health-report.md</span>
 *       <span class="cm-meta">· markdown</span>
 *       <span class="cm-spacer" />
 *       <button class="cm-action">copy</button>
 *       <button class="cm-action">export</button>
 *       <button class="cm-action">fullscreen</button>
 *       <button class="cm-action">close</button>
 *     </header>
 *     <div class="cm-art-tabs">
 *       <button class="cm-art-tab cm-active">report.md</button>
 *       <button class="cm-art-tab">severity-matrix.csv</button>
 *     </div>
 *     <div class="cm-art-body">{children}</div>
 *   </aside>
 *
 * Single-file mode: drop the cm-art-tabs row.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ArtifactPane } from '../ArtifactPane';

describe('ArtifactPane (mocks 02, 03, 06, 07, 08, 09)', () => {
  it('renders aside.cm-artifact-panel with cm-art-head + cm-art-body', () => {
    const { container } = render(
      <ArtifactPane title="report.md" meta="markdown" onClose={() => {}}>
        <p>body</p>
      </ArtifactPane>,
    );
    const panel = container.querySelector('aside.cm-artifact-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.cm-art-head')).not.toBeNull();
    expect(panel!.querySelector('.cm-art-head .cm-title')).toHaveTextContent('report.md');
    expect(panel!.querySelector('.cm-art-head .cm-meta')).toHaveTextContent('markdown');
    expect(panel!.querySelector('.cm-art-body')).toHaveTextContent('body');
  });

  it('renders cm-art-tabs with one cm-art-tab per file when multiple', () => {
    const tabs = [
      { id: 'a', label: 'report.md' },
      { id: 'b', label: 'severity.csv' },
      { id: 'c', label: 'remediation.yaml' },
    ];
    const { container } = render(
      <ArtifactPane
        title="report.md"
        tabs={tabs}
        activeTabId="a"
        onTabChange={() => {}}
        onClose={() => {}}
      >
        x
      </ArtifactPane>,
    );
    const tabsRoot = container.querySelector('.cm-art-tabs');
    expect(tabsRoot).not.toBeNull();
    expect(tabsRoot!.querySelectorAll('.cm-art-tab').length).toBe(3);
    expect(tabsRoot!.querySelector('.cm-art-tab.cm-active')).toHaveTextContent('report.md');
  });

  it('omits cm-art-tabs when no tabs provided (single-file mode)', () => {
    const { container } = render(
      <ArtifactPane title="x" onClose={() => {}}>x</ArtifactPane>,
    );
    expect(container.querySelector('.cm-art-tabs')).toBeNull();
  });

  it('fires onTabChange when an inactive tab is clicked', () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <ArtifactPane
        title="x"
        tabs={[{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }]}
        activeTabId="a"
        onTabChange={onTabChange}
        onClose={() => {}}
      >
        x
      </ArtifactPane>,
    );
    const tabs = container.querySelectorAll('.cm-art-tab');
    fireEvent.click(tabs[1]);
    expect(onTabChange).toHaveBeenCalledWith('b');
  });

  it('fires onClose when the close action is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ArtifactPane title="x" onClose={onClose}>x</ArtifactPane>,
    );
    const closeBtn = container.querySelector('[data-action="close"]') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onCopy + onExport when their actions are clicked', () => {
    const onCopy = vi.fn();
    const onExport = vi.fn();
    const { container } = render(
      <ArtifactPane title="x" onClose={() => {}} onCopy={onCopy} onExport={onExport}>x</ArtifactPane>,
    );
    fireEvent.click(container.querySelector('[data-action="copy"]') as HTMLButtonElement);
    fireEvent.click(container.querySelector('[data-action="export"]') as HTMLButtonElement);
    expect(onCopy).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalled();
  });
});
