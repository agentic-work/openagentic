/**
 * boot-events.gating — pure helpers for the codemode boot stream.
 *
 * Extracted from boot-events.handler.ts so unit tests can import the
 * blocking-list + readiness logic without dragging in prisma / k8s /
 * the rest of the api at module load. Keep this file dependency-free.
 *
 * Requirement A (2026-04-28): codemode session must NOT open until the
 * default-code-model 1-token probe RESPONDS. We accomplish that by
 * including 'model_ping' in the blocking list — every entry must reach
 * status 'ok' before the boot stream emits all_ready and the UI lifts
 * the modal.
 */

export const BOOT_BLOCKING_CHECKS: ReadonlyArray<string> = [
  'pod_scheduled',
  'workspace_mounted',
  'daemon_health',
  'relay_ws',
  'model_ping',
];

export interface CheckEntry {
  key: string;
  status: 'pending' | 'running' | 'ok' | 'warn' | 'fail';
  detail?: string;
}

export type CheckState = Record<string, CheckEntry>;

/**
 * True only when every key in BOOT_BLOCKING_CHECKS exists in `state`
 * AND its status === 'ok'. Anything else (pending/running/warn/fail/
 * missing) holds the modal closed.
 */
export function isAllReady(state: CheckState): boolean {
  for (const key of BOOT_BLOCKING_CHECKS) {
    const entry = state[key];
    if (!entry || entry.status !== 'ok') return false;
  }
  return true;
}
