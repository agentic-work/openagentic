/**
 * boot-events — model_ping must BLOCK all_ready.
 *
 * Bug being fixed (2026-04-28): code-mode would silently emit all_ready
 * the moment pod / workspace / daemon / relay went green, even if the
 * default-code-model 1-token probe was still pending or had failed.
 * Result: user sees "READY", types a prompt, sits at "Formulating…"
 * forever because the upstream model is unreachable. Requirement A
 * from the user is "session must NOT open until the default model
 * RESPONDS".
 *
 * The fix is mechanical: add 'model_ping' to the BLOCKING_CHECKS list
 * that maybeAllReady uses to gate the all_ready emit. This file is
 * the RED-first proof of that gate.
 */

import { describe, it, expect } from 'vitest';
import { BOOT_BLOCKING_CHECKS, isAllReady } from '../boot-events.gating.js';

const CHECK_KEYS = [
  'pod_scheduled',
  'workspace_mounted',
  'daemon_health',
  'model_ping',
  'relay_ws',
] as const;

type Status = 'pending' | 'running' | 'ok' | 'warn' | 'fail';

function buildState(overrides: Partial<Record<(typeof CHECK_KEYS)[number], Status>> = {}) {
  const out: Record<string, { key: string; status: Status; detail: string }> = {};
  for (const k of CHECK_KEYS) {
    out[k] = { key: k, status: overrides[k] ?? 'ok', detail: '' };
  }
  return out;
}

describe('boot-events — BOOT_BLOCKING_CHECKS', () => {
  it('includes model_ping (Requirement A: gate session on default-model probe)', () => {
    expect(BOOT_BLOCKING_CHECKS).toContain('model_ping');
  });

  it('also includes the historic blockers (pod, workspace, daemon, relay)', () => {
    expect(BOOT_BLOCKING_CHECKS).toEqual(
      expect.arrayContaining(['pod_scheduled', 'workspace_mounted', 'daemon_health', 'relay_ws']),
    );
  });
});

describe('boot-events — isAllReady', () => {
  it('returns true only when every blocking check is ok', () => {
    expect(isAllReady(buildState())).toBe(true);
  });

  it('returns false when model_ping is still pending — even if everything else is ok', () => {
    expect(isAllReady(buildState({ model_ping: 'pending' }))).toBe(false);
  });

  it('returns false when model_ping is running', () => {
    expect(isAllReady(buildState({ model_ping: 'running' }))).toBe(false);
  });

  it('returns false when model_ping is fail (provider down, jwt expired, etc.)', () => {
    expect(isAllReady(buildState({ model_ping: 'fail' }))).toBe(false);
  });

  it('returns false when model_ping is warn (empty response — model alive but not answering)', () => {
    expect(isAllReady(buildState({ model_ping: 'warn' }))).toBe(false);
  });

  it('still gates on the historic blockers — daemon_health fail keeps it false', () => {
    expect(isAllReady(buildState({ daemon_health: 'fail' }))).toBe(false);
  });
});
