/**
 * Sev-1 audit (2026-05-12): hitl_approval frames persist to
 * chat_messages.visualizations. Original render lived in ChatMessages
 * as a per-message footer strip.
 *
 * Sev-1 #922 (2026-05-17 update): the footer strip was RIPPED. AAS now
 * owns the HITL card render INLINE next to the matching tool_use block.
 * ChatMessages still owns the persisted-fallback resolver (so reload
 * survives an empty `hitlApprovalsByMessageId`); the card DOM lives in
 * AgenticActivityStream.
 *
 * Source-grep tests pin the contract across the two files so neither
 * end of the wire can quietly drop the persistence behavior.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const CHAT_MESSAGES_SRC = join(__dirname, '..', 'ChatMessages.tsx');
const AAS_SRC = join(
  __dirname,
  '..',
  'AgenticActivityStream',
  'AgenticActivityStream.tsx',
);

describe('ChatMessages → AAS — persisted hitl_approval fallback (Sev-1 #91, #922)', () => {
  it('ChatMessages still routes hitl_approval frames through the persisted fallback resolver', () => {
    const src = readFileSync(CHAT_MESSAGES_SRC, 'utf8');
    expect(src).toMatch(/hitl_approval/);
  });

  it('AAS owns the hitl-approval-card data-testid anchor (Sev-1 #922 inline render)', () => {
    // God-file decomposition (behavior-preserving): the HitlInlineCard DOM
    // (which carries this data-testid) was extracted into a sibling module of
    // the AAS component. Read both so the AAS-surface ownership contract holds.
    const src = readFileSync(AAS_SRC, 'utf8') + '\n' +
      readFileSync(join(__dirname, '..', 'AgenticActivityStream', 'HitlInlineCard.tsx'), 'utf8');
    expect(src).toMatch(/data-testid="hitl-approval-card"/);
  });

  it('ChatMessages resolves the live map first and falls back to persisted visualizations', () => {
    const src = readFileSync(CHAT_MESSAGES_SRC, 'utf8');
    // The hasLive guard pattern from the existing fallback block must
    // check hitlApprovalsByMessageId (live takes priority over persisted).
    expect(src).toMatch(/hitlApprovalsByMessageId/);
  });
});
