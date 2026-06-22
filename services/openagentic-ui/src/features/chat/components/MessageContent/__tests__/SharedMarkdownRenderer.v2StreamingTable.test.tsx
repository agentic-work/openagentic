/**
 * SharedMarkdownRenderer must render markdown tables through the v2
 * `<StreamingTable>` primitive (mock 01:385-462) — NOT the legacy
 * `excel-table` skin. This unifies the two table render paths:
 *
 *   - model-prose markdown tables (this path)
 *   - autoEmitStreamingTable NDJSON frames (already v2)
 *
 * …so every table the user sees has the same anatomy: `.streaming-table`
 * wrapper, `.tt-hdr` header, semantic columns, and the staggered
 * row-fade-in animation declared in chatmode-v2.css.
 *
 * Live regression captured 2026-05-01: Azure subs Markdown table rendered
 * with the Excel grid skin even after the prose-split safety net fired,
 * diverging visually from the v2 StreamingTable mock anatomy.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../EnhancedShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../ShikiCodeBlock', () => ({ default: () => null }));
vi.mock('../EnhancedCodeBlock', () => ({ default: () => null }));
vi.mock('../ChartRenderer', () => ({ default: () => null }));

import { SharedMarkdownRenderer } from '../SharedMarkdownRenderer';

const SUBSCRIPTIONS_TABLE = [
  '| Subscription ID | Name | State |',
  '|---|---|---|',
  '| 6ed638e7-7deb-4773-b516-a2a2b9dbb948 | Azure subscription 1 | Enabled |',
  '| 815a115d-bf32-495c-a89f-b5ce6b349b57 | openagentic-example | Enabled |',
].join('\n');

describe('SharedMarkdownRenderer — markdown tables route through v2 StreamingTable', () => {
  it('renders a `[data-testid="streaming-table"]` wrapper for a markdown table', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={SUBSCRIPTIONS_TABLE} theme="dark" />,
    );
    expect(container.querySelector('[data-testid="streaming-table"]')).not.toBeNull();
  });

  it('does NOT emit the legacy .excel-table skin anywhere in the DOM', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={SUBSCRIPTIONS_TABLE} theme="dark" />,
    );
    expect(container.querySelector('.excel-table')).toBeNull();
    expect(container.querySelector('.excel-table-container')).toBeNull();
    expect(container.querySelector('.excel-tbody')).toBeNull();
    expect(container.querySelector('.excel-data-row')).toBeNull();
  });

  it('renders one <th> per markdown header column with the original label text', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={SUBSCRIPTIONS_TABLE} theme="dark" />,
    );
    // Mock-07 — sortable headers carry an arrow glyph in a .cm-arr child;
    // we read the column label from the first text-node child so the
    // arrow doesn't pollute the assertion.
    const ths = Array.from(container.querySelectorAll('thead th')).map((th) => {
      // strip the trailing arrow glyph if present (▼ or ▲)
      const text = th.textContent?.trim() ?? '';
      return text.replace(/[▼▲]\s*$/, '').trim();
    });
    expect(ths).toEqual(['Subscription ID', 'Name', 'State']);
  });

  it('renders one <tr> per markdown data row with the right <td> text', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={SUBSCRIPTIONS_TABLE} theme="dark" />,
    );
    const dataRows = container.querySelectorAll('tbody tr');
    expect(dataRows.length).toBe(2);

    const firstCells = Array.from(dataRows[0].querySelectorAll('td')).map(
      (td) => td.textContent?.trim(),
    );
    expect(firstCells).toEqual([
      '6ed638e7-7deb-4773-b516-a2a2b9dbb948',
      'Azure subscription 1',
      'Enabled',
    ]);

    const secondCells = Array.from(dataRows[1].querySelectorAll('td')).map(
      (td) => td.textContent?.trim(),
    );
    expect(secondCells).toEqual([
      '815a115d-bf32-495c-a89f-b5ce6b349b57',
      'openagentic-example',
      'Enabled',
    ]);
  });

  it('still renders a v2 StreamingTable when prose precedes the header on the same line', () => {
    // Combines the prose-split safety net (already shipped) with the
    // v2 routing — the table coming out of remark-gfm must still flow
    // through StreamingTable, not the Excel skin.
    const proseThenTable = [
      "I'm checking the Azure subscriptions visible to your signed-in account.| Subscription ID | Name | State |",
      '|---|---|---|',
      '| 6ed638e7-7deb-4773-b516-a2a2b9dbb948 | Azure subscription 1 | Enabled |',
    ].join('\n');

    const { container } = render(
      <SharedMarkdownRenderer content={proseThenTable} theme="dark" />,
    );
    expect(container.querySelector('[data-testid="streaming-table"]')).not.toBeNull();
    expect(container.querySelector('.excel-table')).toBeNull();
  });
});
