/**
 * Pin: the `isInternalKeyStale` drift detector MUST be called from the
 * pod-reuse path in k8sSessionManager. The detector was originally added
 * for task #343, then silently removed in #416 under the incorrect
 * assumption that exec pods hot-reload the projected Secret like api
 * + code-manager do. They don't — exec pods read `INTERNAL_API_KEY` /
 * `CODE_MANAGER_INTERNAL_KEY` env vars baked in at pod-creation time
 * and never re-read.
 *
 * Without the drift check, when the projected Secret rotates after the
 * exec pod is spawned, api+code-manager move on to the new key while
 * the long-lived pod stays on the old one — every WS handshake then
 * 401s with `auth.denied: missing or invalid internal key`. Observed in
 * prod on dev cluster 2026-05-17 for 10+ hours until manual restart.
 *
 * This test fails (visibly, on import) if anyone tries to rip the
 * drift check out of the reuse branch again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('internalKey drift detector — wired into reuse path', () => {
  const k8sSessionManagerSrc = readFileSync(
    join(__dirname, '..', 'k8sSessionManager.ts'),
    'utf8',
  );

  it('imports isInternalKeyStale from internalKeyDrift', () => {
    expect(k8sSessionManagerSrc).toMatch(
      /import\s*{[^}]*\bisInternalKeyStale\b[^}]*}\s*from\s*['"]\.\/internalKeyDrift\.js['"]/,
    );
  });

  it('calls isInternalKeyStale in the pod-reuse branch (existingSession check)', () => {
    expect(k8sSessionManagerSrc).toMatch(
      /isInternalKeyStale\(\s*existingSession\s*,\s*config\.internalApiKey\s*\)/,
    );
  });

  it('does NOT blindly overwrite lastInternalKeyHash on reuse — that erases the drift signal', () => {
    // Anti-pattern: `existingSession.lastInternalKeyHash = hashInternalKey(config.internalApiKey);`
    // unconditional assignment. The fix only sets the hash when it was
    // previously absent (back-compat for pre-fix session records).
    const ANTI_PATTERN = /existingSession\.lastInternalKeyHash\s*=\s*config\.internalApiKey[\s\S]{0,100}\?\s*hashInternalKey\(config\.internalApiKey\)\s*\n[^}]*:\s*existingSession\.lastInternalKeyHash/;
    expect(k8sSessionManagerSrc).not.toMatch(ANTI_PATTERN);
  });
});
