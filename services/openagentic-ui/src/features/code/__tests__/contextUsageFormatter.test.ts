/**
 * TDD coverage for the /context get_context_usage formatter.
 *
 * AC#2 T38 (audit 2026-05-04): the openagentic child's
 * `get_context_usage` control_response carries a ContextData shape
 * (totalTokens, rawMaxTokens, percentage, model, categories[],
 * mcpTools[], agents[], skills, memoryFiles[]). Codemode renders it
 * as a system-row markdown table — these tests pin the rendering
 * contract so the daemon's payload format is stable across changes.
 */

import { describe, it, expect } from 'vitest';
import {
  formatContextUsage,
  type ContextUsagePayload,
} from '../contextUsageFormatter';

describe('formatContextUsage', () => {
  it('renders the token usage line', () => {
    const out = formatContextUsage({
      totalTokens: 12345,
      rawMaxTokens: 200000,
      percentage: '6.2',
      model: 'gpt-oss:20b',
    });
    // Heading
    expect(out).toContain('## Context Usage');
    // Token line — 12.3k / 200.0k (6.2%)
    expect(out).toMatch(/12\.3k\s*\/\s*200\.0k/);
    expect(out).toContain('(6.2%)');
    expect(out).toContain('gpt-oss:20b');
  });

  it('survives a partial payload (daemon mid-load)', () => {
    // The daemon may emit pieces while collectContextData is still
    // running. Don't crash, just skip missing fields.
    const out = formatContextUsage({});
    expect(out).toContain('## Context Usage');
    // Question marks render where numbers are missing — better than NaN
    expect(out).toMatch(/\?\s*\/\s*\?/);
  });

  it('renders the categories table for non-empty buckets', () => {
    const out = formatContextUsage({
      totalTokens: 1000,
      rawMaxTokens: 200000,
      percentage: '0.5',
      categories: [
        { name: 'System prompt', tokens: 500 },
        { name: 'Messages', tokens: 500 },
      ],
    });
    expect(out).toContain('### Estimated usage by category');
    expect(out).toContain('System prompt');
    expect(out).toContain('Messages');
    expect(out).toMatch(/\| Category \| Tokens \|/);
  });

  it('omits the categories table when nothing is non-empty', () => {
    const out = formatContextUsage({
      totalTokens: 0,
      rawMaxTokens: 200000,
      percentage: '0.0',
      categories: [],
    });
    expect(out).not.toContain('### Estimated usage by category');
  });

  it('hides synthetic Free-space / Autocompact-buffer categories', () => {
    // The daemon emits these as bookkeeping rows; they would just
    // clutter the codemode transcript view.
    const out = formatContextUsage({
      totalTokens: 1000,
      rawMaxTokens: 200000,
      percentage: '0.5',
      categories: [
        { name: 'System prompt', tokens: 500 },
        { name: 'Free space', tokens: 199000 },
        { name: 'Autocompact buffer', tokens: 0 },
      ],
    });
    expect(out).toContain('System prompt');
    expect(out).not.toContain('Free space');
    expect(out).not.toContain('Autocompact buffer');
  });

  it('formats sub-1000 tokens as plain integers (no .0k)', () => {
    const out = formatContextUsage({
      totalTokens: 42,
      rawMaxTokens: 200000,
      percentage: '0.0',
    });
    // "42 / 200.0k" — no "0.0k" or "0k" for the 42
    expect(out).toMatch(/\b42\s*\//);
  });
});
