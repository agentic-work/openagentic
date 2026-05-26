/**
 * Pure TS helpers for verifying the per-user MinIO workspace mount
 * in the openagentic-exec pod. The CSI driver (kubelet) owns the
 * mount itself; these helpers only verify it exists and is
 * isolated (no additional mounts layered under /workspaces).
 *
 * Intentionally pure — no fs imports, no globals — so unit tests
 * do not touch the real /proc/mounts. Task 6 calls these from a
 * node one-liner in docker-entrypoint.sh.
 */

export interface ProcMountEntry {
  device: string;
  mountpoint: string;
  fstype: string;
  opts: string[];
}

export interface IsolationResult {
  ok: boolean;
  detail: string;
}

export interface ProbeOptions {
  timeoutMs: number;
  readProcMounts: () => Promise<string>;
}

export interface ProbeResult {
  ok: boolean;
  elapsedMs: number;
  detail: string;
}

const POLL_INTERVAL_MS = 250;
const WORKSPACES_ROOT = '/workspaces';

/**
 * Parse /proc/mounts format: "device mountpoint fstype opts N N".
 * Blank / comment / malformed lines are skipped (fail-open on parse,
 * fail-closed downstream). Fields may be space- or tab-separated.
 */
export function parseProcMounts(text: string): ProcMountEntry[] {
  const out: ProcMountEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    const fields = line.split(/[ \t]+/);
    if (fields.length < 4) continue;
    const [device, mountpoint, fstype, optsField] = fields;
    if (!device || !mountpoint || !fstype || !optsField) continue;
    out.push({
      device,
      mountpoint,
      fstype,
      opts: optsField.split(','),
    });
  }
  return out;
}

/**
 * Exact-path match — /workspaces MUST NOT match /workspacesX.
 */
export function isWorkspaceMountPresent(
  procMountsText: string,
  mountPath: string,
): boolean {
  const entries = parseProcMounts(procMountsText);
  return entries.some((e) => e.mountpoint === mountPath);
}

/**
 * Verify that the expected mount path is the ONLY mount under
 * /workspaces, is a fuse mount, and has no non-fuse layer on top
 * of it. Fail-closed on any ambiguity.
 */
export function assertMountIsolated(
  procMountsText: string,
  expectedMountPath: string,
): IsolationResult {
  const entries = parseProcMounts(procMountsText);
  const underWorkspaces = entries.filter(
    (e) =>
      e.mountpoint === expectedMountPath ||
      e.mountpoint.startsWith(WORKSPACES_ROOT + '/') ||
      e.mountpoint === WORKSPACES_ROOT,
  );

  if (underWorkspaces.length === 0) {
    return {
      ok: false,
      detail: `no mount found under ${WORKSPACES_ROOT}; expected ${expectedMountPath}`,
    };
  }

  const atExpected = underWorkspaces.filter(
    (e) => e.mountpoint === expectedMountPath,
  );
  if (atExpected.length === 0) {
    return {
      ok: false,
      detail: `expected mount ${expectedMountPath} missing; found ${underWorkspaces
        .map((e) => e.mountpoint)
        .join(', ')}`,
    };
  }

  // A non-fuse entry at the expected path means something was layered on top.
  const nonFuseAtExpected = atExpected.filter(
    (e) => !e.fstype.startsWith('fuse'),
  );
  if (nonFuseAtExpected.length > 0) {
    return {
      ok: false,
      detail: `non-fuse mount layered at ${expectedMountPath}: ${nonFuseAtExpected
        .map((e) => e.fstype)
        .join(', ')}`,
    };
  }

  // Any OTHER mount under /workspaces = tenant-isolation violation.
  const otherUnderWorkspaces = underWorkspaces.filter(
    (e) => e.mountpoint !== expectedMountPath,
  );
  if (otherUnderWorkspaces.length > 0) {
    return {
      ok: false,
      detail: `additional mounts under ${WORKSPACES_ROOT}: ${otherUnderWorkspaces
        .map((e) => e.mountpoint)
        .join(', ')}`,
    };
  }

  return {
    ok: true,
    detail: `isolated fuse mount at ${expectedMountPath}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll /proc/mounts (via injected reader) at POLL_INTERVAL_MS until
 * the expected mount is present or timeoutMs elapses. Transient
 * reader rejections are swallowed — next poll tries again.
 */
export async function probeMountReady(
  mountPath: string,
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const started = Date.now();
  let lastErr: unknown = null;
  // First attempt is immediate so that an already-present mount
  // resolves fast without waiting a poll interval.
  // Subsequent attempts wait POLL_INTERVAL_MS between reads.
  let firstAttempt = true;
  while (Date.now() - started < opts.timeoutMs) {
    if (!firstAttempt) await sleep(POLL_INTERVAL_MS);
    firstAttempt = false;
    try {
      const text = await opts.readProcMounts();
      if (isWorkspaceMountPresent(text, mountPath)) {
        return {
          ok: true,
          elapsedMs: Date.now() - started,
          detail: `mount present at ${mountPath}`,
        };
      }
    } catch (err) {
      lastErr = err;
      // swallow & retry
    }
  }
  const elapsedMs = Date.now() - started;
  const detail = lastErr
    ? `timeout after ${elapsedMs}ms waiting for ${mountPath}; last read error: ${String(
        (lastErr as Error).message ?? lastErr,
      )}`
    : `timeout after ${elapsedMs}ms waiting for ${mountPath}`;
  return { ok: false, elapsedMs, detail };
}
