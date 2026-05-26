/**
 * stripMarkdownTables — TDD RED → GREEN
 *
 * When a chat turn emits a `compose_visual({template:'table'})` artifact
 * (which renders as a canonical <V2StreamingTable>), the model frequently
 * ALSO writes the same data as a markdown table in its prose. The UI's
 * SharedMarkdownRenderer swaps every markdown `<table>` to a
 * <V2StreamingTable>, so the user sees the same data twice.
 *
 * This helper strips markdown table nodes from prose using a proper
 * remark/mdast AST walk — no regex. Other markdown (headings, lists,
 * paragraphs, code blocks, blockquotes) is preserved byte-identical.
 *
 * Called from the chat-message finalize site (ChatStorageService) BEFORE
 * persisting `chat_messages.content` and `content_blocks[type=text]`, so:
 *   - The streamed turn flickers a markdown table briefly (acceptable)
 *   - The saved + reloaded state has no markdown table
 *   - Only the canonical <V2StreamingTable> from compose_visual remains
 *
 * Pins:
 *  - Removes GFM-style pipe tables (| col1 | col2 |\n|---|---|...)
 *  - Removes simple 2-col tables
 *  - Preserves all other markdown verbatim
 *  - Preserves inline pipes that are NOT tables
 *  - No-op when input has zero tables (returns input unchanged)
 *  - No-op when shouldStrip=false (gate flag from caller)
 *  - Multiple tables in same prose all removed
 *  - Preserves leading/trailing prose around the table
 */
import { describe, it, expect } from 'vitest';

import { stripMarkdownTables } from '../stripMarkdownTables.js';

describe('stripMarkdownTables — gated no-op', () => {
  it('returns input verbatim when shouldStrip=false', () => {
    const input = 'before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter';
    expect(stripMarkdownTables(input, false)).toBe(input);
  });

  it('returns input verbatim when shouldStrip=true but no tables present', () => {
    const input = '# Heading\n\nSome **bold** prose with `inline code`.\n\n- list item';
    expect(stripMarkdownTables(input, true)).toBe(input);
  });
});

describe('stripMarkdownTables — actual stripping', () => {
  it('removes a 2-column GFM table, keeps surrounding prose', () => {
    const input = [
      'Here are the resource groups:',
      '',
      '| Subscription | RG Count |',
      '| --- | --- |',
      '| sub-1 | 3 |',
      '| sub-2 | 5 |',
      '',
      'Total: 8 resource groups.',
    ].join('\n');

    const out = stripMarkdownTables(input, true);
    expect(out).toContain('Here are the resource groups');
    expect(out).toContain('Total: 8 resource groups');
    expect(out).not.toContain('| sub-1 |');
    expect(out).not.toContain('| Subscription |');
    expect(out).not.toMatch(/\|.+\|/); // no leftover pipe-cells
  });

  it('removes ALL tables when multiple are present', () => {
    const input = [
      'First table:',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Then prose.',
      '',
      '| x | y |',
      '| --- | --- |',
      '| 9 | 8 |',
      '',
      'End.',
    ].join('\n');

    const out = stripMarkdownTables(input, true);
    expect(out).toContain('First table:');
    expect(out).toContain('Then prose.');
    expect(out).toContain('End.');
    expect(out).not.toContain('| 1 |');
    expect(out).not.toContain('| 9 |');
  });

  it('preserves headings, lists, code blocks, and blockquotes around the stripped table', () => {
    const input = [
      '# Azure Resources',
      '',
      '> Live data from Azure API.',
      '',
      '| Subscription | RG Count |',
      '| --- | --- |',
      '| sub-1 | 3 |',
      '',
      '- bullet one',
      '- bullet two',
      '',
      '```bash',
      'az group list',
      '```',
    ].join('\n');

    const out = stripMarkdownTables(input, true);
    expect(out).toContain('# Azure Resources');
    expect(out).toContain('> Live data');
    expect(out).toContain('- bullet one');
    expect(out).toContain('```bash');
    expect(out).toContain('az group list');
    expect(out).not.toContain('| sub-1 |');
  });

  it('preserves inline pipes that are NOT table cells', () => {
    const input = 'Use `awk -F"|" \'{print $1}\'` or `grep -E "foo|bar"` for filtering.';
    const out = stripMarkdownTables(input, true);
    expect(out).toContain('awk -F"|"');
    expect(out).toContain('grep -E "foo|bar"');
  });
});
