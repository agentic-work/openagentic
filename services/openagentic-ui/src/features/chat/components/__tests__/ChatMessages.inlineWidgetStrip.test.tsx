/**
 * #502 — ChatMessages must thread `inlineWidgetsByMessageId` into the
 * <InlineWidgetStrip /> per-message dispatcher. This is a source-grep
 * test (mirrors ChatMessages.cm-v2-shell.test.tsx) — fast, narrow,
 * gates that the wire is present without spinning up the full DOM.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatMessages.tsx');

describe('ChatMessages inline-widget strip wire (#502)', () => {
  it('imports InlineWidgetStrip from ./v2', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/from ['"]\.\/v2\/InlineWidgetStrip['"]|InlineWidgetStrip[^;]*from ['"]\.\/v2['"]/);
  });

  it('declares the inlineWidgetsByMessageId prop on ChatMessagesProps', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/inlineWidgetsByMessageId\??\s*:\s*Record<string,\s*[^>]*InlineWidget\[\]>/);
  });

  it('destructures the prop in the function body', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/inlineWidgetsByMessageId,/);
  });

  it('renders <InlineWidgetStrip widgets={inlineWidgetsByMessageId?.[message.id] ?? []} />', () => {
    const src = readFileSync(SRC, 'utf8');
    // The wire pattern: pass the per-message array (or empty) through.
    // Allow either spread syntax — we just need the lookup + the JSX usage.
    expect(src).toMatch(/<InlineWidgetStrip[\s\S]*?inlineWidgetsByMessageId\?\.\[message\.id\][\s\S]*?\/>/);
  });
});
