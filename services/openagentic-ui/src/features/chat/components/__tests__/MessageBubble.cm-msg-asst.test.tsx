/**
 * Phase 3 of cm-v2 mock-parity migration — MessageBubble assistant row.
 *
 * MessageBubble is 1195 LOC with a complex props surface that resists a
 * standalone render in vitest (UnifiedActivityTree, AgenticActivityStream,
 * normalizedEvents, ChatStream context, theme provider, etc.).
 *
 * Source-content test (matching the existing transcript-width-parity.ts
 * pattern) freezes the cm-msg-asst grid wiring on the assistant branch.
 *
 * Mock anatomy: mocks/UX/01-cloud-ops.html lines 184-214 + chatmode-v2.css:78-101
 *   <div class="cm-v2 cm-msg-asst">
 *     <div class="cm-avatar cm-av-asst" aria-hidden />
 *     <div class="cm-msg-body">
 *       <MessageHeader ... noAvatar />
 *       {activity stream / content}
 *     </div>
 *   </div>
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('MessageBubble cm-msg-asst grid (mock 01:184-214)', () => {
  it('wraps the assistant branch in a cm-v2 cm-msg-asst grid', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/\{isAssistant && \(\s*<div className="[^"]*\bcm-v2\b[^"]*\bcm-msg-asst\b[^"]*"[^>]*>/);
  });

  it('places a cm-avatar.cm-av-asst as the first child (col-1)', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<div className="[^"]*\bcm-msg-asst\b[^"]*"[^>]*>[\s\S]{0,300}?<div className="cm-avatar cm-av-asst" aria-hidden/);
  });

  it('wraps the message body in a cm-msg-body container (col-2)', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<div className="cm-msg-body[^"]*"/);
  });

  it('passes noAvatar to MessageHeader so col-1 owns the avatar', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<MessageHeader[\s\S]{0,2000}?noAvatar/);
  });
});
