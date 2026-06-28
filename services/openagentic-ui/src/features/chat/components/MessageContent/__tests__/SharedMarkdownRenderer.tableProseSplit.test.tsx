/**
 * Models occasionally emit a paragraph and the first row of a markdown table on
 * the same line, with no blank line between them, like:
 *
 *   I'm checking the Azure subscriptions visible to your signed-in account.| Subscription ID | Name | State |
 *   |---|---|---|
 *   | id-1 | name-1 | Enabled |
 *
 * remark-gfm will not recognise that as a table because the first line
 * starts with prose, not `|`. The renderer must split the prose from the
 * header row and inject a blank line so GFM detects the table.
 *
 * Live regression captured 2026-05-01 — gpt-5.4-mini via AIF rendered as
 * "looks like shit" because the table came out as one giant pipe-laden
 * paragraph.
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

const PROSE_THEN_TABLE_SAME_LINE = [
  // prose and header row glued onto the same line
  "I'm checking the Azure subscriptions visible to your signed-in account.| Subscription ID | Name | State |",
  '|---|---|---|',
  '| 6ed638e7-7deb-4773-b516-a2a2b9dbb948 | Azure subscription 1 | Enabled |',
  '| 815a115d-bf32-495c-a89f-b5ce6b349b57 | openagentic-example | Enabled |',
].join('\n');

describe('SharedMarkdownRenderer — splits prose from table header on same line', () => {
  it('renders a real <table> when prose abuts the header row with no blank line', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={PROSE_THEN_TABLE_SAME_LINE} theme="dark" />,
    );

    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    const headers = Array.from(container.querySelectorAll('th')).map(
      (th) => th.textContent?.trim(),
    );
    expect(headers).toEqual(['Subscription ID', 'Name', 'State']);

    const dataRows = container.querySelectorAll('tbody tr');
    expect(dataRows.length).toBe(2);

    // First row's cells contain the subscription id + name + state.
    const firstRow = Array.from(dataRows[0].querySelectorAll('td')).map(
      (td) => td.textContent?.trim(),
    );
    expect(firstRow).toEqual([
      '6ed638e7-7deb-4773-b516-a2a2b9dbb948',
      'Azure subscription 1',
      'Enabled',
    ]);
  });

  it('preserves the prose sentence as its own paragraph above the table', () => {
    const { container } = render(
      <SharedMarkdownRenderer content={PROSE_THEN_TABLE_SAME_LINE} theme="dark" />,
    );
    const paragraphText = Array.from(container.querySelectorAll('p'))
      .map((p) => p.textContent?.trim())
      .filter((t): t is string => !!t);
    expect(
      paragraphText.some((t) =>
        t.startsWith("I’m checking the Azure subscriptions") ||
        t.startsWith("I'm checking the Azure subscriptions"),
      ),
    ).toBe(true);
    // The prose paragraph should NOT contain pipe characters (the table
    // header must have been split off into the table).
    const proseP = paragraphText.find((t) =>
      t.startsWith("I’m checking the Azure subscriptions") ||
      t.startsWith("I'm checking the Azure subscriptions"),
    );
    expect(proseP).toBeDefined();
    expect(proseP).not.toMatch(/\|/);
  });
});
