/**
 * #109 — inline HITL approval card must be wired in ChatContainer.
 *
 * A gated (mutating / high-risk) tool emits `mcp_approval_required`; useChatStream
 * parks it in `hitlApprovalsByMessageId` and the transcript chain
 * (ChatMessages → MessageBubble → AgenticActivityStream → HitlInlineCard) already
 * knows how to render an approve/deny card from that state and call
 * `onApproveHitl`/`onDenyHitl`. The bug: ChatContainer never destructured that
 * state from useChatStream nor passed the props down — so the card got no data
 * (never rendered) and had no callbacks, and the tool hung to the 120s timeout.
 *
 * The fix wires it: pass `hitlApprovalsByMessageId` + `onApproveHitl`/`onDenyHitl`
 * to <ChatMessages>; the handlers POST the OSS endpoint
 * `/api/chat/tool-approval/:id` with a Bearer token and flip the card out of
 * "pending" via `setHitlApprovalsByMessageId` so the buttons disappear.
 *
 * (Supersedes the pre-OSS Q1-blocker-8 test, which asserted the removed AAD
 * `/api/permissions/approvals/:id` path.)
 *
 * Source-grep style: ChatContainer is too large to mount in a unit test; the
 * rendered card + button behavior is covered by
 * AgenticActivityStream.hitlInline.test.tsx.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatContainer.tsx');
const src = readFileSync(SRC, 'utf8');

describe('ChatContainer — inline HITL approval wiring (#109)', () => {
  it('passes the inline-approval props down to <ChatMessages>', () => {
    expect(src).toMatch(/hitlApprovalsByMessageId=\{/);
    expect(src).toMatch(/onApproveHitl=\{/);
    expect(src).toMatch(/onDenyHitl=\{/);
  });

  it('resolves an approval via the OSS tool-approval endpoint with a Bearer token', () => {
    // A requestId-parameterized handler (not just the single-modal mcpApproval one)
    // must POST to /chat/tool-approval/:id with an Authorization: Bearer header.
    expect(src).toMatch(/chat\/tool-approval\/\$\{requestId\}/);
    expect(src).toContain('Bearer ${token}');
    expect(src).toMatch(/approved\b/);
  });

  it('flips the card out of "pending" via setHitlApprovalsByMessageId on success', () => {
    expect(src).toMatch(/setHitlApprovalsByMessageId/);
  });
});
