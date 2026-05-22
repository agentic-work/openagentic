export interface ShouldSendModeOverrideArgs {
  /** The chip's local mode (from usePermissionMode → localStorage). */
  localMode: string;
  /**
   * The daemon's currently-active mode, sourced from
   * sessionMeta.permissionMode (which the daemon emits in the
   * system/init frame). Undefined when sessionMeta hasn't arrived
   * yet — return false in that case so we wait for the first init.
   */
  daemonMode: string | undefined;
  /**
   * The last mode we successfully dispatched as set_permission_mode.
   * Null when no override has been sent in this session.
   */
  lastSentMode: string | null;
}

/**
 * Returns true when the UI should dispatch a set_permission_mode
 * control_request. Pure — no side effects.
 *
 * Rules in order:
 *   1. Daemon hasn't reported yet (no init frame) → false. Wait.
 *   2. Already sent this exact mode → false. No spam.
 *   3. Local matches daemon → false. They agree, no override needed.
 *   4. Otherwise → true. Bring the daemon into sync.
 */
export function shouldSendModeOverride(args: ShouldSendModeOverrideArgs): boolean {
  const { localMode, daemonMode, lastSentMode } = args;
  if (!daemonMode) return false;
  if (lastSentMode === localMode) return false;
  if (localMode === daemonMode) return false;
  return true;
}
