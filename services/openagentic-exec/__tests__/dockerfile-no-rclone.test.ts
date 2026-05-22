/**
 * Regression guard: openagentic-exec image must NOT install rclone/fuse3/s3fs.
 * The CSI-S3 driver (kubelet-level) owns FUSE; the unprivileged exec pod
 * must not carry FUSE userspace tools (defense-in-depth, Y-option commitment).
 *
 * Also verifies docker-entrypoint.sh runs the mount-verify node step
 * BEFORE `exec dumb-init ...`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCKERFILE_PATH = resolve(__dirname, '..', 'Dockerfile');
const ENTRYPOINT_PATH = resolve(__dirname, '..', 'docker-entrypoint.sh');

const FORBIDDEN_PKGS = ['rclone', 'fuse3', 's3fs', 'fuse'];

function stripComments(line: string): string {
  // Strip shell-style comments so FORBIDDEN tokens inside `# ...` don't trip.
  const hashIdx = line.indexOf('#');
  if (hashIdx === -1) return line;
  return line.slice(0, hashIdx);
}

describe('Dockerfile: no FUSE userspace tools (CSI-S3 T6 guard)', () => {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');

  for (const pkg of FORBIDDEN_PKGS) {
    it(`does not reference \`${pkg}\` in any non-comment line`, () => {
      const offending: string[] = [];
      dockerfile.split('\n').forEach((rawLine, i) => {
        const codeOnly = stripComments(rawLine);
        // whole-word match: allow e.g. "confuse" not to trip "fuse".
        const re = new RegExp(`\\b${pkg}\\b`, 'i');
        if (re.test(codeOnly)) {
          offending.push(`${i + 1}: ${rawLine.trim()}`);
        }
      });
      expect(
        offending,
        `Dockerfile must not install ${pkg}. Offending lines:\n${offending.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('docker-entrypoint.sh: calls mount-verify before exec dumb-init', () => {
  const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');

  it('invokes node /app/dist/entrypoints/verifyWorkspaceMount.js', () => {
    expect(entrypoint).toMatch(
      /node\s+\/app\/dist\/entrypoints\/verifyWorkspaceMount\.js/,
    );
  });

  it('calls verifyWorkspaceMount BEFORE `exec dumb-init openagentic`', () => {
    const verifyIdx = entrypoint.indexOf('verifyWorkspaceMount.js');
    const execIdx = entrypoint.indexOf('exec dumb-init openagentic');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(verifyIdx).toBeLessThan(execIdx);
  });

  it('preserves the canonical `exec dumb-init openagentic --remote-session` line', () => {
    expect(entrypoint).toMatch(
      /exec dumb-init openagentic --remote-session "\$OPENAGENTIC_SESSION_ID"/,
    );
  });
});
