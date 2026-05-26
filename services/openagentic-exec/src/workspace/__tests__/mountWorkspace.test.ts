import { describe, it, expect } from 'vitest';
import {
  parseProcMounts,
  isWorkspaceMountPresent,
  assertMountIsolated,
  probeMountReady,
} from '../mountWorkspace';

describe('parseProcMounts', () => {
  it('parses a single well-formed line with space separators', () => {
    const text = 's3fs /workspaces/alice fuse.s3fs rw,nosuid,nodev 0 0\n';
    expect(parseProcMounts(text)).toEqual([
      {
        device: 's3fs',
        mountpoint: '/workspaces/alice',
        fstype: 'fuse.s3fs',
        opts: ['rw', 'nosuid', 'nodev'],
      },
    ]);
  });

  it('handles tab separators between fields', () => {
    const text = 's3fs\t/workspaces/alice\tfuse.s3fs\trw,nosuid\t0\t0\n';
    expect(parseProcMounts(text)).toEqual([
      {
        device: 's3fs',
        mountpoint: '/workspaces/alice',
        fstype: 'fuse.s3fs',
        opts: ['rw', 'nosuid'],
      },
    ]);
  });

  it('skips blank lines', () => {
    const text = [
      '',
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      '',
      'tmpfs /tmp tmpfs rw 0 0',
      '',
    ].join('\n');
    const mounts = parseProcMounts(text);
    expect(mounts.length).toBe(2);
    expect(mounts[0].mountpoint).toBe('/workspaces/alice');
    expect(mounts[1].mountpoint).toBe('/tmp');
  });

  it('handles a trailing newline without producing an empty entry', () => {
    const text = 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    expect(parseProcMounts(text)).toHaveLength(1);
  });

  it('ignores comment lines starting with #', () => {
    const text = [
      '# this is a comment',
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      '# another comment',
    ].join('\n');
    const mounts = parseProcMounts(text);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].mountpoint).toBe('/workspaces/alice');
  });

  it('splits opts on comma', () => {
    const text = 'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\n';
    const mounts = parseProcMounts(text);
    expect(mounts[0].opts).toEqual(['rw', 'nosuid', 'nodev', 'noexec', 'relatime']);
  });

  it('does not throw on a malformed line — skips it', () => {
    const text = [
      'garbage',
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      'also bad',
    ].join('\n');
    const mounts = parseProcMounts(text);
    expect(mounts).toHaveLength(1);
    expect(mounts[0].mountpoint).toBe('/workspaces/alice');
  });
});

describe('isWorkspaceMountPresent', () => {
  it('returns true for an exact-match mountpoint', () => {
    const text = 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    expect(isWorkspaceMountPresent(text, '/workspaces/alice')).toBe(true);
  });

  it('returns false when the path is absent', () => {
    const text = 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    expect(isWorkspaceMountPresent(text, '/workspaces/bob')).toBe(false);
  });

  it('does NOT match a prefix false-positive (/workspaces vs /workspacesX)', () => {
    const text = 's3fs /workspacesX fuse.s3fs rw 0 0\n';
    expect(isWorkspaceMountPresent(text, '/workspaces')).toBe(false);
  });

  it('returns false on empty /proc/mounts', () => {
    expect(isWorkspaceMountPresent('', '/workspaces/alice')).toBe(false);
  });
});

describe('assertMountIsolated', () => {
  it('ok when exactly one fuse line matches the expected path under /workspaces', () => {
    const text = 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    const res = assertMountIsolated(text, '/workspaces/alice');
    expect(res.ok).toBe(true);
  });

  it('fails when two fuse lines appear under /workspaces', () => {
    const text = [
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      's3fs /workspaces/bob fuse.s3fs rw 0 0',
    ].join('\n');
    const res = assertMountIsolated(text, '/workspaces/alice');
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/additional|multiple|\/workspaces\/bob/);
  });

  it('fails if a non-fuse line is layered at the expected path', () => {
    const text = [
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      'tmpfs /workspaces/alice tmpfs rw 0 0',
    ].join('\n');
    const res = assertMountIsolated(text, '/workspaces/alice');
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/layered|tmpfs|non-fuse/);
  });

  it('fails if the expected mount is missing entirely', () => {
    const text = 'tmpfs /tmp tmpfs rw 0 0\n';
    const res = assertMountIsolated(text, '/workspaces/alice');
    expect(res.ok).toBe(false);
  });

  it('ignores fuse mounts that are NOT under /workspaces', () => {
    const text = [
      's3fs /workspaces/alice fuse.s3fs rw 0 0',
      'fuse.something /mnt/other fuse.something rw 0 0',
    ].join('\n');
    const res = assertMountIsolated(text, '/workspaces/alice');
    expect(res.ok).toBe(true);
  });
});

describe('probeMountReady', () => {
  it('returns ok quickly when the mount is already present on the first read', async () => {
    const reader = async () => 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    const res = await probeMountReady('/workspaces/alice', {
      timeoutMs: 2000,
      readProcMounts: reader,
    });
    expect(res.ok).toBe(true);
    expect(res.elapsedMs).toBeLessThan(250);
  });

  it('times out cleanly when the mount never appears (no infinite loop)', async () => {
    const reader = async () => 'tmpfs /tmp tmpfs rw 0 0\n';
    const res = await probeMountReady('/workspaces/alice', {
      timeoutMs: 600,
      readProcMounts: reader,
    });
    expect(res.ok).toBe(false);
    expect(res.elapsedMs).toBeGreaterThanOrEqual(600);
    expect(res.detail).toMatch(/timeout|timed out/i);
  });

  it('becomes ok once the mount appears on a later poll', async () => {
    let calls = 0;
    const reader = async () => {
      calls++;
      if (calls < 3) return 'tmpfs /tmp tmpfs rw 0 0\n';
      return 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    };
    const res = await probeMountReady('/workspaces/alice', {
      timeoutMs: 3000,
      readProcMounts: reader,
    });
    expect(res.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('does not throw on transient readProcMounts rejection — retries', async () => {
    let calls = 0;
    const reader = async () => {
      calls++;
      if (calls === 1) throw new Error('transient EIO');
      return 's3fs /workspaces/alice fuse.s3fs rw 0 0\n';
    };
    const res = await probeMountReady('/workspaces/alice', {
      timeoutMs: 3000,
      readProcMounts: reader,
    });
    expect(res.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
