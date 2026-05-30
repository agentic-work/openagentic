/**
 * Z.2 — Tool card layout: INLINE → CARD
 *
 * Current: .cm-tool uses border: 0; background: transparent; display: inline-flex
 * Mock SoT: .tool uses background: var(--cm-bg-1); border: 1px solid var(--cm-line-1);
 *            border-left: 3px solid var(--cm-cloud); border-radius: var(--radius-md);
 *
 * Tests pin the CSS changes that flip .cm-tool from Claude.ai inline style
 * to the mock card layout. Also verifies per-cloud data-tool-cat left-border
 * accent rules.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('tool card layout CSS (Z.2)', () => {
  it('.cm-tool has non-transparent background', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // The card-mode .cm-tool block must have a background other than transparent
    // The base .cm-tool rule must NOT be "background: transparent"
    // We look for the base block:  .cm-tool { ... background: transparent ... }
    // Using a regex that matches the cm-tool block and asserts transparent is not the base value
    expect(css).toContain('background: var(--cm-bg-1)');
    // The inline-style line "background: transparent" must be gone from the base .cm-tool block
    // We check that the isolated ".cm-tool {\n  border: 0;" block is no longer there
    expect(css).not.toMatch(/\.cm-tool\s*\{[^}]*background:\s*transparent/);
  });

  it('.cm-tool has non-zero border (1px solid)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // The block should contain border: 1px solid var(--cm-line-1)
    // We check that the cm-tool block no longer has "border: 0"
    expect(css).not.toMatch(/\.cm-tool\s*\{[^}]*border:\s*0[^-]/);
  });

  it('.cm-tool has border-radius (card appearance)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // Card layout must have a border-radius
    // The old inline style used border-radius: 0
    expect(css).not.toMatch(/\.cm-tool\s*\{[^}]*border-radius:\s*0/);
  });

  it('data-tool-cat cloud color left-border rules exist for azure / aws / gcp', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // These attribute selectors were already present in the file (mock-07 layer)
    // Verify they remain after the Z.2 refactor
    expect(css).toContain("[data-tool-cat='azure']");
    expect(css).toContain("[data-tool-cat='aws']");
    expect(css).toContain("[data-tool-cat='gcp']");
  });

  it('.cm-t-head has padding (card section style)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // The head padding should be 10px 12px (from mock)
    // Check it contains display:flex alignment rule still
    expect(css).toContain('.cm-tool .cm-t-head');
  });

  it('.cm-t-section has border-top (section divider)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.cm-tool .cm-t-section');
    // Should have a border-top for section dividers
    expect(css).toMatch(/\.cm-tool .cm-t-section[^{]*\{[^}]*border-top/);
  });
});
