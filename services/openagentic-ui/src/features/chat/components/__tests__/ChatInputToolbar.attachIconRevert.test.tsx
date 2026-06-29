/**
 * P0 #941 — attach-icon revert pin (2026-05-18).
 *
 * User direction post-#940: "leave the + for now". Reverts ONLY the attach
 * glyph swap from `AttachDropTray` back to the original `Plus`. The grounding
 * toggle (SearchCheck/magnifying-glass-checkmark) STAYS.
 *
 * The bug is a one-line source regression in ChatInputToolbar.tsx (the
 * `<AttachDropTray />` JSX inside the attach button). The toolbar is too
 * deeply integrated (auth, model store, etc.) to mount in isolation, so this
 * test asserts the contract at the SOURCE level: the file must reference
 * `<Plus ` inside the attach button and must NOT reference `<AttachDropTray `.
 *
 * RED: currently AttachDropTray is rendered. The "must not contain
 * AttachDropTray JSX" check FAILS until the revert lands.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolbarSrc = readFileSync(
  resolve(__dirname, '..', 'ChatInputToolbar.tsx'),
  'utf8',
);

describe('ChatInputToolbar — #941 attach-icon revert (Plus glyph, not drop-tray)', () => {
  it('attach button JSX uses <Plus />, NOT <AttachDropTray />', () => {
    // Find the attach button block (delimited by data-testid="chat-attach-button"
    // up to the closing </motion.button>).
    const start = toolbarSrc.indexOf('data-testid="chat-attach-button"');
    expect(start).toBeGreaterThan(0);
    const end = toolbarSrc.indexOf('</motion.button>', start);
    expect(end).toBeGreaterThan(start);
    const attachButtonBlock = toolbarSrc.slice(start, end);

    // The revert restores the Plus glyph and removes AttachDropTray.
    expect(attachButtonBlock).not.toMatch(/<AttachDropTray\b/);
    expect(attachButtonBlock).toMatch(/<Plus\b/);
  });

  it('AttachDropTray is NOT imported from @/shared/icons in the toolbar (no dead import)', () => {
    // Grab the import line for @/shared/icons.
    const m = toolbarSrc.match(/import \{([^}]+)\} from ['"]@\/shared\/icons['"];/);
    expect(m).toBeTruthy();
    const importList = m![1];
    expect(importList).not.toMatch(/\bAttachDropTray\b/);
    expect(importList).toMatch(/\bPlus\b/);
  });
});
