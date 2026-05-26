/**
 * Regression test for toolIconGlyph contract.
 *
 * 2026-05-02 audit (codemode-mock-parity-audit.report.md item #12)
 * captured the live tool icon as rgb(30,64,175) — the default emoji
 * blue for 📖 (U+1F4D6 Read). The CSS rule
 * `.cm-tool-icon { color: #d77757 }` was silently ignored because
 * browsers render emoji codepoints with the platform's full-color
 * emoji font.
 *
 * This test pins:
 *   1. Every returned glyph is in the BMP (codepoint < 0x10000), so
 *      it falls outside the U+1F300+ / U+1F600+ emoji ranges that
 *      get the colored-emoji font fallback.
 *   2. Specific tools that the mock pins explicitly (Write→✎, Bash→▶)
 *      keep their canonical glyphs.
 *   3. The default fallback is ● (U+25CF) so plugin-supplied tools
 *      get a colorable bullet rather than the previous default.
 */

import { describe, it, expect } from 'vitest';
import { toolIconGlyph } from '../Part';

describe('toolIconGlyph (mock-parity)', () => {
  it('returns ✎ (U+270E) for Write/Edit/MultiEdit', () => {
    expect(toolIconGlyph('Write')).toBe('✎');
    expect(toolIconGlyph('Edit')).toBe('✎');
    expect(toolIconGlyph('MultiEdit')).toBe('✎');
  });

  it('returns ▶ (U+25B6) for Bash', () => {
    expect(toolIconGlyph('Bash')).toBe('▶');
  });

  it('returns ● (U+25CF) for Read / Grep / Glob / TodoWrite / WebSearch / WebFetch', () => {
    // Previously these returned 📖 / 🔎 / ⚿ / ☑ / 🌐 — the emoji
    // codepoints made the mock-parity coral CSS color silently fail.
    for (const tool of ['Read', 'Grep', 'Glob', 'TodoWrite', 'WebSearch', 'WebFetch']) {
      expect(toolIconGlyph(tool)).toBe('●');
    }
  });

  it('returns ● for unknown / plugin-supplied tools', () => {
    expect(toolIconGlyph('mcp__ghost__navigate')).toBe('●');
    expect(toolIconGlyph('SuperpowersBrainstorm')).toBe('●');
  });

  it('every glyph is a single BMP codepoint (no emoji color override)', () => {
    const tools = [
      'Write', 'Edit', 'MultiEdit', 'Bash', 'Read', 'Grep', 'Glob',
      'TodoWrite', 'WebSearch', 'WebFetch', 'Task', 'Agent', 'Unknown',
    ];
    for (const tool of tools) {
      const glyph = toolIconGlyph(tool);
      // BMP codepoints fit in a single UTF-16 code unit. Emoji
      // codepoints (U+1F000+) are surrogate pairs and have length 2.
      expect(glyph).toHaveLength(1);
      const cp = glyph.codePointAt(0)!;
      expect(cp).toBeLessThan(0x10000);
    }
  });
});
