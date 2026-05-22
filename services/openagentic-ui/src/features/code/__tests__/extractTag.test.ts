/**
 * TDD: extractTag helper — port of openagentic/src/utils/messages.ts:637.
 *
 * Codemode dispatcher (openagentic/src/cli/headlessSlashDispatch.ts) wraps
 * the result of every dispatched slash command in
 *   <local-command-stdout>OUTPUT</local-command-stdout>     (success)
 *   <local-command-stderr>OUTPUT</local-command-stderr>     (error)
 * mirroring the upstream Claude Code TUI's createCommandInputMessage flow
 * (see openagentic/src/screens/REPL.tsx:3228 and ../utils/messages.ts:602).
 *
 * The codemode chat UI needs the same extractor so an `<AssistantTextRow>`
 * whose text starts with one of those tags can render through the special
 * `LocalCommandOutputRow` (matches upstream UserLocalCommandOutputMessage).
 */

import { describe, it, expect } from 'vitest';
import { extractTag } from '../utils/extractTag';

describe('extractTag', () => {
  it('returns null for empty input or empty tag name', () => {
    expect(extractTag('', 'foo')).toBeNull();
    expect(extractTag('hello', '')).toBeNull();
    expect(extractTag('   ', 'foo')).toBeNull();
  });

  it('returns null when the tag is not present', () => {
    expect(extractTag('plain text', 'local-command-stdout')).toBeNull();
    expect(
      extractTag('<other-tag>x</other-tag>', 'local-command-stdout'),
    ).toBeNull();
  });

  it('extracts simple single-line content', () => {
    expect(
      extractTag(
        '<local-command-stdout>hello</local-command-stdout>',
        'local-command-stdout',
      ),
    ).toBe('hello');
  });

  it('extracts multi-line content (incl. embedded newlines)', () => {
    const wrapped =
      '<local-command-stdout>line one\nline two\nline three</local-command-stdout>';
    expect(extractTag(wrapped, 'local-command-stdout')).toBe(
      'line one\nline two\nline three',
    );
  });

  it('extracts content even when surrounded by other text (LLM may prepend a caveat)', () => {
    const wrapped =
      'pre<local-command-stdout>captured</local-command-stdout>post';
    expect(extractTag(wrapped, 'local-command-stdout')).toBe('captured');
  });

  it('matches case-insensitively on the tag name', () => {
    expect(
      extractTag(
        '<LOCAL-COMMAND-STDOUT>upper</LOCAL-COMMAND-STDOUT>',
        'local-command-stdout',
      ),
    ).toBe('upper');
  });

  it('handles a tag with attributes (defensive against future tag shape changes)', () => {
    expect(
      extractTag(
        '<local-command-stdout id="x">attrs</local-command-stdout>',
        'local-command-stdout',
      ),
    ).toBe('attrs');
  });

  it('returns the FIRST occurrence when the tag appears multiple times', () => {
    expect(
      extractTag(
        '<local-command-stdout>first</local-command-stdout><local-command-stdout>second</local-command-stdout>',
        'local-command-stdout',
      ),
    ).toBe('first');
  });

  it('distinguishes stdout vs stderr tags (no false matches)', () => {
    const wrapped =
      '<local-command-stderr>err only</local-command-stderr>';
    expect(extractTag(wrapped, 'local-command-stdout')).toBeNull();
    expect(extractTag(wrapped, 'local-command-stderr')).toBe('err only');
  });

  it('handles markdown content within tags (slash command output is rendered as markdown)', () => {
    const md = `**bold**\n\n- item1\n- item2\n\n\`\`\`js\nconsole.log('hi')\n\`\`\``;
    const wrapped = `<local-command-stdout>${md}</local-command-stdout>`;
    expect(extractTag(wrapped, 'local-command-stdout')).toBe(md);
  });
});
