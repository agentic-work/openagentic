/**
 * Transcript width parity guard.
 *
 * Chat-mode and code-mode MUST render the assistant/user transcript at the
 * same max-width so flipping between sidebar buttons does not produce a
 * visible width jump. The single source of truth is the
 * `--transcript-max-width` CSS custom property defined in
 * `src/styles/design-tokens.css`.
 *
 * This guard enforces three properties:
 *   1. The token is defined exactly once (in design-tokens.css) and at
 *      the value picked by the design — currently 902px (820 * 1.10).
 *   2. The four files that drive transcript width (3 in chat, 1 in code)
 *      consume the token via `var(--transcript-max-width)` rather than
 *      hardcoding a literal pixel value.
 *   3. No other source file in the chat or code feature trees sneaks in
 *      a competing `maxWidth: 820`-style literal on a transcript-bound
 *      container. (Self-contained cards like InlineBootStream's boot card
 *      are explicitly allowlisted — they are not the inline transcript.)
 *
 * If you need to bump the width, change the token in design-tokens.css.
 * If you need to add a new transcript consumer, add it to TRANSCRIPT_CONSUMERS
 * below — do NOT hardcode the px literal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI_SRC = join(__dirname, '..');

const TOKEN_FILE = join(UI_SRC, 'styles/design-tokens.css');
const TOKEN_NAME = '--transcript-max-width';
const TOKEN_VALUE = '902px';

const TRANSCRIPT_CONSUMERS = [
  'features/chat/components/ChatMessages.tsx',
  'features/chat/components/MessageBubble.tsx',
  'features/chat/components/MessageContent/SharedMarkdownRenderer.tsx',
];

// Files that legitimately use a hardcoded px value adjacent to the
// transcript width range but are NOT the inline transcript itself.
const HARDCODED_WIDTH_ALLOWLIST = new Set<string>([]);

describe('transcript width parity (chat <-> code)', () => {
  it('defines --transcript-max-width exactly once, in design-tokens.css', () => {
    const css = readFileSync(TOKEN_FILE, 'utf8');
    // Match `--transcript-max-width:` followed by a value (declaration only,
    // not consumption via `var(...)`).
    const declMatches = css.match(/--transcript-max-width\s*:/g) ?? [];
    expect(declMatches.length).toBe(1);
    // And the value should be the agreed-upon 902px (820 * 1.10).
    const decl = css.match(/--transcript-max-width\s*:\s*([^;]+);/);
    expect(decl).not.toBeNull();
    expect(decl![1].trim()).toBe(TOKEN_VALUE);
  });

  for (const rel of TRANSCRIPT_CONSUMERS) {
    it(`${rel} consumes var(${TOKEN_NAME})`, () => {
      const src = readFileSync(join(UI_SRC, rel), 'utf8');
      expect(src).toContain(`var(${TOKEN_NAME})`);
    });

    it(`${rel} has no hardcoded maxWidth: 820 literal`, () => {
      const src = readFileSync(join(UI_SRC, rel), 'utf8');
      // Strip block comments so the token-rationale notes don't trip the
      // guard. Keep line comments — they're rare on the same line as a style.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
      // Forbid both JS-object form (maxWidth: 820) and CSS string form
      // (maxWidth: '820px').
      expect(code).not.toMatch(/maxWidth\s*:\s*820\b/);
      expect(code).not.toMatch(/maxWidth\s*:\s*['"]820px['"]/);
    });
  }

  it('no other file in features/chat or features/code hardcodes the prior 820px transcript width', () => {
    // Walk the two feature trees, skip the consumers (they're already
    // covered above) and the explicit allowlist, and assert nobody else
    // is silently overriding the token with the legacy literal.
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');

    const roots = [
      join(UI_SRC, 'features/chat'),
      join(UI_SRC, 'features/code'),
    ];

    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) {
          continue;
        }
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue;
        if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;

        const rel = full.slice(UI_SRC.length + 1).replace(/\\/g, '/');
        if (TRANSCRIPT_CONSUMERS.includes(rel)) continue;
        if (HARDCODED_WIDTH_ALLOWLIST.has(rel)) continue;

        const raw = readFileSync(full, 'utf8');
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, '');
        if (/maxWidth\s*:\s*820\b/.test(code) || /maxWidth\s*:\s*['"]820px['"]/.test(code)) {
          const lines = raw.split('\n');
          const idx = lines.findIndex((l) => /maxWidth\s*:\s*820\b/.test(l) || /maxWidth\s*:\s*['"]820px['"]/.test(l));
          offenders.push(`${rel}:${idx + 1}: ${lines[idx]?.trim()}`);
        }
      }
    }

    for (const root of roots) walk(root);

    if (offenders.length > 0) {
      throw new Error(
        `Found stale 820px transcript-width literal(s) outside the allowlist. ` +
          `Either consume var(${TOKEN_NAME}) or add the file to ` +
          `HARDCODED_WIDTH_ALLOWLIST in this test if it is a non-transcript card:\n` +
          offenders.join('\n'),
      );
    }
    expect(offenders).toEqual([]);
  });
});
