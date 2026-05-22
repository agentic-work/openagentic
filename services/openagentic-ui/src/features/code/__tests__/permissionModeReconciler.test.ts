/**
 * TDD coverage for the permission-mode reconciler.
 *
 * Bug #195 (audit 2026-05-04): the previous useEffect in
 * CodeModeChatView.tsx skipped the first render unconditionally, so a
 * returning user whose chip restored from localStorage to (say)
 * `default` got a UI-vs-daemon mismatch — chip showed default, daemon
 * was still in boot mode `bypassPermissions`. The inline permission
 * card never fired until the user manually cycled the chip.
 *
 * This suite drives the pure decision function that replaces the skip,
 * RED-first per the TDD Iron Law.
 */

import { describe, it, expect } from 'vitest';
import { shouldSendModeOverride } from '../permissionModeReconciler';

describe('shouldSendModeOverride', () => {
  it('returns false when daemon has not reported its mode yet', () => {
    // sessionMeta is null on initial render until the system/init frame
    // arrives. Sending an override before we know the daemon's current
    // state would race against the init.
    expect(
      shouldSendModeOverride({
        localMode: 'default',
        daemonMode: undefined,
        lastSentMode: null,
      }),
    ).toBe(false);
  });

  it('returns true on session restore when local and daemon disagree (THE BUG)', () => {
    // The exact scenario that surfaced in the live audit: chip restored
    // from localStorage to `default`, daemon booted in
    // `bypassPermissions`. Pre-fix, the useEffect skipped this case
    // because it was the first render. The reconciler MUST flag this
    // as a send.
    expect(
      shouldSendModeOverride({
        localMode: 'default',
        daemonMode: 'bypassPermissions',
        lastSentMode: null,
      }),
    ).toBe(true);
  });

  it('returns false when local and daemon agree', () => {
    // Fresh session, nothing in localStorage. Both at the boot mode.
    // No override needed.
    expect(
      shouldSendModeOverride({
        localMode: 'bypassPermissions',
        daemonMode: 'bypassPermissions',
        lastSentMode: null,
      }),
    ).toBe(false);
  });

  it('returns false when we already sent this exact mode (no spam)', () => {
    // After a successful set_permission_mode dispatch, the daemon will
    // catch up but its sessionMeta.permissionMode lag isn't guaranteed
    // to update synchronously in the UI. Don't re-send the same value.
    expect(
      shouldSendModeOverride({
        localMode: 'plan',
        daemonMode: 'bypassPermissions',
        lastSentMode: 'plan',
      }),
    ).toBe(false);
  });

  it('returns true when the user toggles the chip to a new mode', () => {
    // Mid-session: lastSent=default, user clicks chip to acceptEdits,
    // daemon still at default (it lags by one tick). Send the change.
    expect(
      shouldSendModeOverride({
        localMode: 'acceptEdits',
        daemonMode: 'default',
        lastSentMode: 'default',
      }),
    ).toBe(true);
  });

  it('returns false when the chip cycle lands back on the daemon-reported mode', () => {
    // Edge: user cycles chip A→B→A. Final `localMode === daemonMode`
    // (assume the B-send updated the daemon). Don't re-send A — the
    // daemon already reflects A.
    expect(
      shouldSendModeOverride({
        localMode: 'default',
        daemonMode: 'default',
        lastSentMode: 'acceptEdits',
      }),
    ).toBe(false);
  });
});
