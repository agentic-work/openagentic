/**
 * Tests for the entrypoint mount-verification step (Task 6, CSI-S3 rollout).
 *
 * The function is invoked from docker-entrypoint.sh via
 *   node /app/dist/entrypoints/verifyWorkspaceMount.js
 * so it owns its own exit semantics. To keep the unit test deterministic
 * and process-clean, the main function accepts an injectable exitFn and
 * readProcMounts.
 */

import { describe, it, expect, vi } from 'vitest';
import { runVerification } from '../verifyWorkspaceMount.js';

function fuseEntry(path: string): string {
  return `fuse.csi-s3 ${path} fuse rw,relatime 0 0\n`;
}

describe('runVerification (Task 6 entrypoint gate)', () => {
  it('happy path: fuse entry at expected path + isolated => exitFn not called', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = async () =>
      `proc /proc proc rw 0 0\n${fuseEntry('/workspaces/user-123')}`;

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 1000,
    });

    expect(exitFn).not.toHaveBeenCalled();
  });

  it('probe timeout: readProcMounts returns no-match forever => exitFn called with 1', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = async () => 'proc /proc proc rw 0 0\n';

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logged = logFn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/timeout/i);
  });

  it('probe ok but isolation fails (second fuse line under /workspaces) => exit 1, diagnostic mentions isolation violation', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = async () =>
      `${fuseEntry('/workspaces/user-123')}${fuseEntry('/workspaces/user-999')}`;

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 1000,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logged = logFn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged.toLowerCase()).toContain('isolation');
  });

  it('no USER_WORKSPACE_PATH => warning logged, exitFn called with 0', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = vi.fn(async () => '');

    await runVerification({
      env: {},
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 1000,
    });

    expect(exitFn).toHaveBeenCalledWith(0);
    expect(readProcMounts).not.toHaveBeenCalled();
    const logged = logFn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged.toLowerCase()).toMatch(/warn|skip/);
  });

  it('fail-closed: reader throws persistently => exit 1 with diagnostic', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = async () => {
      throw new Error('boom: /proc/mounts unreadable');
    };

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logged = logFn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/boom|unreadable|timeout/i);
  });

  // ─── Fast-path: non-CSI-S3 mode shouldn't poll for 30s ───────────────
  //
  // When the cluster runs the workspace PVC on NFS / local-path / hostPath
  // (i.e. the storage class isn't minio-csi), `/workspaces` itself is a
  // non-fuse mount and the per-user path is a regular subdirectory of it.
  // The probe loop will NEVER see a fuse mount at USER_WORKSPACE_PATH, so
  // waiting the full 30s is pure dead time — startup blocks daemon bind for
  // 30s, readiness probe spuriously connection-refuses for 25+ seconds,
  // and operators see "container killed before binding" even though no
  // liveness probe is configured. Fix: detect non-fuse parent mount on the
  // first /proc/mounts read and short-circuit to legacy-ok immediately.
  it('non-CSI-S3 fast path: parent /workspaces is non-fuse => exit 0 immediately, no polling', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = vi.fn(
      async () =>
        '/dev/mapper/host /workspaces ext4 rw,relatime 0 0\nproc /proc proc rw 0 0\n',
    );

    const t0 = Date.now();
    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 30000,
    });
    const elapsed = Date.now() - t0;

    expect(exitFn).toHaveBeenCalledWith(0);
    // Must NOT have polled 30s — should return in <1s.
    expect(elapsed).toBeLessThan(1000);
    // Should call readProcMounts exactly ONCE for the fast-path detection.
    expect(readProcMounts).toHaveBeenCalledTimes(1);
    const logged = logFn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged.toLowerCase()).toMatch(/legacy|non-csi|nfs|local-path|skip/);
  });

  it('no /workspaces mount and no fuse: NOT a fast-path candidate, regular probe flow runs', async () => {
    // hostPath / emptyDir scenarios where `/workspaces` isn't a mount —
    // this is a real misconfiguration (no place to put user data), so we
    // must NOT silently fast-path to ok. The regular probe loop runs to
    // its timeout, then the mkdir+stat fallback decides legacy-ok or
    // fail-closed based on whether the directory is writable. The point
    // of THIS test is that the fast-path detector is conservative.
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const readProcMounts = vi.fn(
      async () =>
        '/dev/sda1 / ext4 rw,relatime 0 0\nproc /proc proc rw 0 0\ntmpfs /tmp tmpfs rw 0 0\n',
    );

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-456' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 200,
    });

    // The probe should have run multiple times (didn't short-circuit).
    expect(readProcMounts.mock.calls.length).toBeGreaterThan(1);
  });

  it('CSI-S3 mode: only fuse mount under /workspaces, expected one not yet attached => still polls (kubelet may attach mid-startup)', async () => {
    // The fast-path should NOT short-circuit when there IS a CSI-S3 setup
    // but the user's mount is still being attached. We must continue polling
    // until either the mount appears or the timeout fires. Here we feed two
    // reads: first read = no user mount yet, second read = mount appeared.
    const exitFn = vi.fn();
    const logFn = vi.fn();
    let calls = 0;
    const readProcMounts = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        // First read: only a sibling fuse mount, no user mount yet
        return 'fuse.csi-s3 /workspaces/other-user fuse rw,relatime 0 0\nproc /proc proc rw 0 0\n';
      }
      // Subsequent reads: user mount has appeared (alongside sibling)
      return (
        'fuse.csi-s3 /workspaces/other-user fuse rw,relatime 0 0\n' +
        'fuse.csi-s3 /workspaces/user-789 fuse rw,relatime 0 0\n'
      );
    });

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-789' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 5000,
    });

    // The mount appeared on second read — but isolation now sees TWO fuse
    // mounts under /workspaces, which is a tenant-isolation violation by
    // design. So we expect exit 1 with isolation diagnostic. The point of
    // THIS test is: we DID call readProcMounts more than once (i.e. we
    // didn't short-circuit on the fuse parent presence).
    expect(readProcMounts.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(exitFn).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Ancestor fuse-mount fallback (Bug 2 fix — CSI-S3 pod boot loop)
// ---------------------------------------------------------------------------
//
// geesefs mounts the bucket at /workspaces (root), not at /workspaces/<userId>.
// So /proc/mounts will never have an exact entry for /workspaces/<userId>.
// probeMountReady times out → fallback fires.
//
// New behavior: if the ancestor /workspaces is itself a fuse mount AND
// fs.stat(userWorkspacePath) succeeds as a directory → succeed without mkdir.
// The api-side .keep seeding ensures the path exists in S3 → geesefs shows it.

describe('runVerification fuse-ancestor fallback (geesefs / CSI-S3 bucket-root mount)', () => {
  it('probe fails + /workspaces is fuse.geesefs ancestor + stat succeeds => exit 0', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    // /proc/mounts has geesefs at /workspaces (bucket root), NOT at /workspaces/user-123
    const procMountsText = 'geesefs /workspaces fuse.geesefs rw,relatime 0 0\nproc /proc proc rw 0 0\n';
    const readProcMounts = vi.fn(async () => procMountsText);

    // Inject a stat that succeeds (the .keep seed made the dir visible)
    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-123' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
      statFn: async (_path: string) => ({ isDirectory: () => true } as any),
    });

    expect(exitFn).toHaveBeenCalledWith(0);
    const logged = logFn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged.toLowerCase()).toMatch(/ancestor.*fuse|fuse.*ancestor/i);
  });

  it('probe fails + /workspaces is fuse.s3fs ancestor + stat succeeds => exit 0 (any fuse fstype)', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const procMountsText = 's3fs /workspaces fuse.s3fs rw,relatime 0 0\nproc /proc proc rw 0 0\n';
    const readProcMounts = vi.fn(async () => procMountsText);

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-456' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
      statFn: async (_path: string) => ({ isDirectory: () => true } as any),
    });

    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it('probe fails + /workspaces is fuse.geesefs ancestor + stat throws ENOENT => exit 1 (api did not seed .keep)', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    const procMountsText = 'geesefs /workspaces fuse.geesefs rw,relatime 0 0\nproc /proc proc rw 0 0\n';
    const readProcMounts = vi.fn(async () => procMountsText);
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-789' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
      statFn: async (_path: string) => { throw enoent; },
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logged = logFn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toMatch(/FAIL|fail/i);
  });

  it('probe fails + NO fuse ancestor at /workspaces + mkdir+stat succeed => exit 0 (legacy NFS fallback)', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();
    // No fuse entry at /workspaces — NFS/local-path scenario without the fast-path
    // (no non-fuse mount at /workspaces either, so fast-path doesn't fire)
    const procMountsText = 'proc /proc proc rw 0 0\n';
    const readProcMounts = vi.fn(async () => procMountsText);

    // stat succeeds (directory exists via mkdir, legacy path)
    await runVerification({
      env: { USER_WORKSPACE_PATH: '/workspaces/user-nfs' },
      readProcMounts,
      exitFn,
      logFn,
      timeoutMs: 300,
      statFn: async (_path: string) => ({ isDirectory: () => true } as any),
      mkdirFn: async (_path: string, _opts: unknown) => undefined,
    });

    expect(exitFn).toHaveBeenCalledWith(0);
  });
});
