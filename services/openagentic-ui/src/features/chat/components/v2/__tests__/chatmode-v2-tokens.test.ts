/**
 * ONE-SOT migration — --cm-accent now DERIVES from the canonical theme.
 *
 * Pre-migration the cm-accent fallback was a hardcoded color (purple #8b5cf6,
 * then green #4ade80 to match the mocks). Under the ONE-SOT theme, chatmode-v2
 * no longer holds ANY accent literal: --cm-accent reads the canonical
 * --color-accent (which itself derives from --user-accent, default signal
 * orange) so the chat surface follows the global accent + dark/light flip.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('chatmode-v2.css accent derives from the ONE-SOT theme', () => {
  it('--cm-accent reads the canonical --color-accent (no hardcoded fallback)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('--cm-accent: var(--color-accent)');
    // No hardcoded accent literal (neither the old purple nor the green).
    expect(css).not.toContain('--cm-accent: var(--user-accent-primary, #8b5cf6)');
    expect(css).not.toContain('--cm-accent: var(--user-accent-primary, #4ade80)');
  });

  it('--cm-accent-soft/-line derive from the canonical accent tints', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('--cm-accent-soft: var(--color-accent-soft)');
    expect(css).toContain('--cm-accent-line: var(--color-accent-line)');
    // No hardcoded purple alpha tints remain.
    expect(css).not.toContain('rgba(139, 92, 246, 0.14)');
    expect(css).not.toContain('rgba(139, 92, 246, 0.32)');
  });

  it('the bg/fg/line ramps derive from the canonical --color-* tokens', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('--cm-bg-1: var(--color-surface)');
    expect(css).toContain('--cm-fg-0: var(--color-fg)');
    expect(css).toContain('--cm-line-1: var(--color-rule)');
  });
});
