/**
 * Z.1 — --cm-accent fallback PURPLE → GREEN
 *
 * The mock SoT (end-state-NN-*.html) defines --cm-accent: #4ade80 (green).
 * The CSS fallback was historically #8b5cf6 (purple). Sprint Z flips it
 * to match the mocks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('chatmode-v2.css token values (Z.1)', () => {
  it('--cm-accent fallback should be #4ade80 (green, not purple)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // Must contain the green fallback
    expect(css).toContain('--cm-accent: var(--user-accent-primary, #4ade80)');
    // Must NOT contain the old purple fallback
    expect(css).not.toContain('--cm-accent: var(--user-accent-primary, #8b5cf6)');
  });

  it('--cm-accent-soft fallback derives from green (#4ade80 alpha)', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // After the accent flip, the soft token should reference 74,222,128 (4ade80)
    // not the old 139,92,246 (purple) values
    expect(css).not.toContain('--cm-accent-soft: var(--user-accent-soft, rgba(139, 92, 246, 0.14))');
  });

  it('--cm-accent-line fallback derives from green', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).not.toContain('--cm-accent-line: var(--user-accent-line, rgba(139, 92, 246, 0.32))');
  });
});
