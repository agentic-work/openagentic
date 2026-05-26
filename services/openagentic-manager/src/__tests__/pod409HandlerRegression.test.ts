/**
 * Task #360 — second fix. The `createRunnerPod` 409 handler only matched
 * `error.statusCode === 409`, but the @kubernetes/client-node v1.x error
 * surface uses `error.code === 409` (the same surface regression already
 * fixed for 404 via `isK8s404`). Net effect:
 *
 *   - User's permanent pod exists.
 *   - Two concurrent WS reconnects both hit getOrCreateSession.
 *   - Both race through the 404-read-then-fall-through path.
 *   - Both call createRunnerPod. First wins, second gets 409.
 *   - The v1.x-shaped 409 is NOT matched → error propagates up →
 *     "Failed to create session" → UI fails the whole reconnect.
 *
 * This test locks in the shape-agnostic 409 matcher.
 */

import { describe, it, expect } from 'vitest';
import { isK8sConflict409 } from '../k8sSessionManager';

describe('isK8sConflict409 — matches all client-node v0/v1 error shapes', () => {
  it('matches the legacy v0 shape (error.statusCode)', () => {
    expect(isK8sConflict409({ statusCode: 409 })).toBe(true);
  });

  it('matches the v1.x shape (error.code)', () => {
    // This is the shape observed in the 2026-04-24 live cluster logs:
    //   {"code":409,"body":"{\"reason\":\"AlreadyExists\"}"}
    expect(isK8sConflict409({ code: 409 })).toBe(true);
  });

  it('matches the wrapped response shape (error.response.statusCode)', () => {
    expect(isK8sConflict409({ response: { statusCode: 409 } })).toBe(true);
  });

  it('matches by body.reason as a last-ditch fallback', () => {
    expect(isK8sConflict409({ body: { reason: 'AlreadyExists' } })).toBe(true);
  });

  it('does NOT match 404 errors', () => {
    expect(isK8sConflict409({ statusCode: 404 })).toBe(false);
    expect(isK8sConflict409({ code: 404 })).toBe(false);
  });

  it('does NOT match unrelated errors', () => {
    expect(isK8sConflict409(new Error('network down'))).toBe(false);
    expect(isK8sConflict409({})).toBe(false);
    expect(isK8sConflict409(null)).toBe(false);
    expect(isK8sConflict409(undefined)).toBe(false);
  });
});
