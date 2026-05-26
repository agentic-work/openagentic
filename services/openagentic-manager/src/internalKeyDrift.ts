/**
 * Task #343 — Pure helpers for detecting internal-key drift on long-lived
 * exec pods.
 *
 * Background:
 *   code-manager's `INTERNAL_API_KEY` used to be derived from
 *   `.Chart.Version` in the helm helper, so every chart upgrade rotated
 *   it. When cm reused a per-user exec pod that had been provisioned
 *   under the previous value, the daemon in that pod still believed the
 *   OLD key was authoritative. api→daemon WS handshakes carrying the
 *   NEW key were silently 401'd and the codemode UI hung on
 *   "Considering…" indefinitely.
 *
 *   The helm helper was fixed to stop hashing `.Chart.Version` (stable
 *   across upgrades), and this module is the second line of defence:
 *   cm stamps the current key's fingerprint on every session it
 *   provisions, and invalidates the session on reuse if the fingerprint
 *   no longer matches — forcing a fresh pod with a correct key.
 */

import { createHash } from 'crypto';

/**
 * Cheap fingerprint of the internal key for stored-vs-current
 * comparisons. SHA-256, truncated to 16 hex chars (64 bits — plenty
 * for collision-avoidance of a deployment-lived secret). Mirrors the
 * existing `hashApiKey` helper in k8sSessionManager.ts but is exported
 * so it can be unit-tested in isolation.
 */
export function hashInternalKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Narrow structural type — so callers can pass either a full
 * K8sSession or a minimal test fixture without pulling in the whole
 * session-manager type surface.
 */
interface SessionWithKeyFingerprint {
  lastInternalKeyHash?: string;
}

/**
 * Returns true when the cm session record's recorded internal-key
 * fingerprint differs from the fingerprint of the currently-configured
 * internal key.
 *
 * Semantics:
 *   - match           → NOT stale (safe to reuse the pod).
 *   - mismatch        → stale (pod was provisioned under a different
 *                       key; recreate it so the daemon inherits the
 *                       current one at spawn time).
 *   - missing/empty   → stale (treat pre-fix session records as
 *                       suspect so first post-deploy reuse self-heals).
 *   - currentKey=""   → NOT stale (cm is already running in INSECURE
 *                       mode; don't compound the problem by churning
 *                       every pod on every reuse).
 */
export function isInternalKeyStale(
  session: SessionWithKeyFingerprint,
  currentKey: string,
): boolean {
  if (!currentKey) return false;
  if (!session.lastInternalKeyHash) return true;
  return session.lastInternalKeyHash !== hashInternalKey(currentKey);
}
