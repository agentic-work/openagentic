/**
 * Phase 1 of the cm-v2 mock-parity migration.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html lines 154-164
 *   .chat-wrap { overflow-y: auto; padding: 24px 32px 200px; }
 *   .chat { max-width: 760px; margin: 0 auto; display: flex;
 *           flex-direction: column; gap: 32px; }
 *
 * cm-v2 contract:
 *   - cm-v2 declares the cm-* design tokens (chatmode-v2.css:10-44)
 *   - cm-chat applies the transcript layout (chatmode-v2.css:68-74)
 *
 * This test guards the load-bearing wrapper on the transcript root so
 * future refactors don't quietly drop the cm-v2 scope (which would
 * desugar every cm-* class on every descendant).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(
  __dirname,
  '..',
  'ChatMessages.tsx',
);

describe('ChatMessages cm-v2 cm-chat transcript shell (mock 01:154-164)', () => {
  it('marks the transcript column with data-transcript-root', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/data-transcript-root/);
  });

  it('applies the cm-v2 cm-chat class pair to the transcript column', () => {
    const src = readFileSync(SRC, 'utf8');
    // Single attribute that contains both classes on the transcript root.
    expect(src).toMatch(/className="[^"]*\bcm-v2\b[^"]*\bcm-chat\b/);
  });

  it('does not duplicate the layout properties cm-chat already declares', () => {
    const src = readFileSync(SRC, 'utf8');
    // cm-chat handles flex/gap. Inline `display: 'flex'` + `gap: '32px'`
    // on the transcript root would conflict with the class — drop them.
    // Capture the full opening element from `data-transcript-root` until
    // the first `>` of the JSX tag (style + className live there).
    const transcriptOpenTag = src.match(/<div\s+data-transcript-root[\s\S]*?>/);
    expect(transcriptOpenTag).not.toBeNull();
    const inline = transcriptOpenTag![0];
    expect(inline).not.toMatch(/display:\s*['"]flex['"]/);
    expect(inline).not.toMatch(/flexDirection:\s*['"]column['"]/);
    expect(inline).not.toMatch(/gap:\s*['"]32px['"]/);
  });
});
