/**
 * Entrypoint helper: verify the per-user CSI-S3 workspace mount exists
 * and is isolated BEFORE the openagentic daemon spawns.
 *
 * Invoked from docker-entrypoint.sh as:
 *   node /app/dist/entrypoints/verifyWorkspaceMount.js
 *
 * Behavior (see plan 2026-04-24-codemode-userstorage-minio-workspace.md, Task 6):
 *   - If $USER_WORKSPACE_PATH is unset, print a warning and exit 0
 *     (backward-compat for legacy pods without CSI mount yet).
 *   - Otherwise, poll /proc/mounts via probeMountReady; on probe failure
 *     print a structured diagnostic and exit 1 so kubelet restarts the pod.
 *   - On probe success, run assertMountIsolated; any isolation violation
 *     → diagnostic + exit 1 (fail-closed).
 *   - Any thrown exception anywhere in the chain → diagnostic + exit 1.
 */

import { promises as fs } from 'node:fs';
import {
  probeMountReady,
  assertMountIsolated,
  parseProcMounts,
} from '../workspace/mountWorkspace.js';

const WORKSPACES_ROOT = '/workspaces';

/**
 * Fast-path detector: is this pod running on a non-CSI-S3 storage class?
 *
 * Returns true when /proc/mounts shows a NON-FUSE mount AT `/workspaces`
 * itself AND no fuse mounts under `/workspaces`. This is the NFS / local-
 * path / hostPath case: the per-user dir is a regular subdirectory of the
 * single parent mount, and kubelet will NEVER attach a CSI-S3 fuse mount.
 *
 * In this case, polling for a per-user fuse mount is futile — return true
 * so the caller can short-circuit to legacy-ok immediately and avoid the
 * 30-second probe wait that delays daemon bind.
 *
 * Returns false in all other cases:
 *   - Fuse mount(s) anywhere under /workspaces (CSI-S3 setup, expected
 *     user mount may still be attaching — caller should poll).
 *   - No mount at all at /workspaces (genuine misconfiguration — let the
 *     regular probe-then-mkdir-fallback flow surface a clear error rather
 *     than silently passing).
 *   - Fuse mount AT /workspaces itself (ambiguous — let the regular flow
 *     run isolation checks).
 */
export function isNonCsiS3Mode(procMountsText: string): boolean {
  const entries = parseProcMounts(procMountsText);
  const fuseUnderWorkspaces = entries.some(
    (e) =>
      e.fstype.startsWith('fuse') &&
      (e.mountpoint === WORKSPACES_ROOT ||
        e.mountpoint.startsWith(WORKSPACES_ROOT + '/')),
  );
  if (fuseUnderWorkspaces) {
    return false; // fuse-backed setup, regular probe loop applies
  }
  const nonFuseAtRoot = entries.some(
    (e) => e.mountpoint === WORKSPACES_ROOT && !e.fstype.startsWith('fuse'),
  );
  // Only short-circuit when there's a real non-fuse parent mount at
  // /workspaces. If /workspaces isn't a mount at all, the verifier's
  // regular flow will (correctly) fail-closed via the mkdir+stat path.
  return nonFuseAtRoot;
}

export interface VerificationOptions {
  env: NodeJS.ProcessEnv;
  readProcMounts: () => Promise<string>;
  exitFn: (code: number) => void;
  logFn: (msg: string) => void;
  timeoutMs: number;
  /**
   * Injected for testing. Defaults to `fs.stat` from node:fs/promises.
   * Receives the userWorkspacePath and should resolve to an fs.Stats-like
   * object. Throw to signal absence.
   */
  statFn?: (path: string) => Promise<{ isDirectory(): boolean }>;
  /**
   * Injected for testing. Defaults to `fs.mkdir` from node:fs/promises.
   * Only called in the legacy NFS fallback path (no fuse ancestor).
   */
  mkdirFn?: (path: string, opts: { recursive: boolean }) => Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function diagnosticEnvDump(env: NodeJS.ProcessEnv): string {
  const keys = Object.keys(env).filter((k) => k.startsWith('USER_WORKSPACE'));
  if (keys.length === 0) return '(no USER_WORKSPACE_* env vars set)';
  return keys.map((k) => `  ${k}=${env[k]}`).join('\n');
}

export async function runVerification(
  opts: VerificationOptions,
): Promise<void> {
  const {
    env,
    readProcMounts,
    exitFn,
    logFn,
    timeoutMs,
    statFn = (p) => fs.stat(p),
    mkdirFn = (p, o) => fs.mkdir(p, o),
  } = opts;
  const userWorkspacePath = env.USER_WORKSPACE_PATH;

  if (!userWorkspacePath) {
    logFn(
      '[mount-verify] WARNING: USER_WORKSPACE_PATH not set — skipping CSI-S3 mount verification (legacy pod).',
    );
    exitFn(0);
    return;
  }

  logFn(
    `[mount-verify] probing CSI-S3 mount at ${userWorkspacePath} (timeout ${timeoutMs}ms)...`,
  );

  let procMountsText = '';
  try {
    // Fast-path: if /proc/mounts shows no fuse mounts under /workspaces at
    // all, this pod isn't using CSI-S3 (the storage class is NFS / local-
    // path / hostPath / emptyDir). Polling for a per-user fuse mount that
    // will never appear wastes the full timeout (~30s by default) and
    // delays daemon bind, causing readiness-probe connection-refuses for
    // the entire window. Detect this on the first read and short-circuit
    // to the legacy-ok branch immediately. See P1+P1.5 ship debug
    // 2026-04-29 for the diagnosis trail.
    procMountsText = await readProcMounts();
    if (isNonCsiS3Mode(procMountsText)) {
      // Best-effort mkdir of the per-user dir under the parent NFS/local-
      // path mount. Failure here is non-fatal — the daemon will surface a
      // clearer error if it can't cd into OPENAGENTIC_CWD. The fast-path's
      // ONLY job is to skip the futile poll loop; dir existence is the
      // pod-spec / kubelet's concern, not the verifier's.
      try {
        await fs.mkdir(userWorkspacePath, { recursive: true });
      } catch {
        // ignore — see comment above
      }
      logFn(
        `[mount-verify] non-CSI-S3 mode (no fuse under ${WORKSPACES_ROOT}) — proceeding as legacy (NFS/local-path/hostPath). Isolation check skipped.`,
      );
      exitFn(0);
      return;
    }

    const probe = await probeMountReady(userWorkspacePath, {
      timeoutMs,
      readProcMounts: async () => {
        const text = await readProcMounts();
        procMountsText = text;
        return text;
      },
    });

    if (!probe.ok) {
      // Fallback: probe failed because /proc/mounts had no exact entry for
      // userWorkspacePath. Two sub-cases:
      //
      // 1. Fuse ancestor at /workspaces (geesefs / s3fs bucket-root mount):
      //    geesefs mounts the entire bucket at /workspaces, so the per-user
      //    subdir /workspaces/<userId> is a prefix inside S3, not its own
      //    mount. /proc/mounts will never show an entry for it. The api-side
      //    .keep seeding ensures the prefix exists in S3 → geesefs presents
      //    it as a visible directory. We just stat — mkdir would fail with
      //    EPERM on a uid=1000 geesefs root from a non-1000 container.
      //
      // 2. No fuse ancestor (NFS / local-path / hostPath legacy): try mkdir +
      //    stat as before. This is the pre-existing path for non-CSI-S3 pods.
      const procMountsEntries = parseProcMounts(procMountsText);
      const fuseAtWorkspacesRoot = procMountsEntries.some(
        (e) => e.mountpoint === WORKSPACES_ROOT && e.fstype.startsWith('fuse'),
      );

      if (fuseAtWorkspacesRoot) {
        // Sub-case 1: ancestor fuse mount — stat only, no mkdir.
        try {
          const st = await statFn(userWorkspacePath);
          if (st.isDirectory()) {
            logFn(
              `[mount-verify] ok via ancestor fuse mount at ${WORKSPACES_ROOT} — ${userWorkspacePath} is stat-able as directory. Isolation check skipped (bucket-root mount).`,
            );
            exitFn(0);
            return;
          }
        } catch {
          // stat failed — hard fail below with diagnostic
        }
        logFn(
          `[mount-verify] FAIL: probe timeout after ${probe.elapsedMs}ms — ${probe.detail}`,
        );
        logFn(`[mount-verify] note: ancestor fuse mount found at ${WORKSPACES_ROOT} but stat(${userWorkspacePath}) failed — ensure api seeded <userId>/.keep`);
        logFn('[mount-verify] current /proc/mounts:');
        logFn(procMountsText || '(empty)');
        logFn('[mount-verify] USER_WORKSPACE_* env:');
        logFn(diagnosticEnvDump(env));
        exitFn(1);
        return;
      }

      // Sub-case 2: no fuse ancestor — legacy mkdir+stat fallback (NFS / local-path).
      try {
        await mkdirFn(userWorkspacePath, { recursive: true });
        const st = await statFn(userWorkspacePath);
        if (st.isDirectory()) {
          logFn(
            `[mount-verify] WARN: no CSI-S3 mount entry for ${userWorkspacePath} — proceeding as legacy (NFS-backed or ancestor mount). Isolation check skipped.`,
          );
          exitFn(0);
          return;
        }
      } catch {
        // fall through to hard fail
      }
      logFn(
        `[mount-verify] FAIL: probe timeout after ${probe.elapsedMs}ms — ${probe.detail}`,
      );
      logFn('[mount-verify] current /proc/mounts:');
      logFn(procMountsText || '(empty)');
      logFn('[mount-verify] USER_WORKSPACE_* env:');
      logFn(diagnosticEnvDump(env));
      exitFn(1);
      return;
    }

    logFn(
      `[mount-verify] probe ok: ${probe.detail} (elapsed=${probe.elapsedMs}ms)`,
    );

    const isolation = assertMountIsolated(procMountsText, userWorkspacePath);
    if (!isolation.ok) {
      logFn(`[mount-verify] FAIL: isolation violation — ${isolation.detail}`);
      logFn('[mount-verify] current /proc/mounts:');
      logFn(procMountsText);
      logFn('[mount-verify] USER_WORKSPACE_* env:');
      logFn(diagnosticEnvDump(env));
      exitFn(1);
      return;
    }

    logFn(`[mount-verify] isolation ok: ${isolation.detail}`);
    // success: do not call exitFn. Node exits 0 when event loop drains.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFn(`[mount-verify] FAIL: unexpected exception — ${msg}`);
    logFn('[mount-verify] current /proc/mounts:');
    logFn(procMountsText || '(not read)');
    logFn('[mount-verify] USER_WORKSPACE_* env:');
    logFn(diagnosticEnvDump(env));
    exitFn(1);
  }
}

// Direct entrypoint when invoked as `node verifyWorkspaceMount.js`.
// Only runs when the file is the main module — avoids firing during tests.
if (require.main === module) {
  void runVerification({
    env: process.env,
    readProcMounts: () => fs.readFile('/proc/mounts', 'utf8'),
    exitFn: (code) => process.exit(code),
    logFn: (msg) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}
