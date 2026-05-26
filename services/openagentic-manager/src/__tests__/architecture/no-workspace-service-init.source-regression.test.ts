/**
 * Source-regression test — task #310.
 *
 * Background: `workspaceStorageService.initializeWorkspace` is a legacy pre-CSI-S3
 * code path. In the new architecture, storage lives INSIDE the openagentic-exec
 * pod via a CSI-S3 PVC — code-manager is a pure provisioner + gatekeeper and
 * does not touch workspace bytes. `NullStorageProvider.uploadFile()` throws a
 * deliberate "remove the call site" error to catch callers that haven't been
 * torn out yet.
 *
 * On 2026-04-24 this error surfaced in production: every codemode login failed
 * with `Workspace initialization failed: code-manager no longer provides cloud
 * storage. Storage is mounted inside openagentic-exec pods via s3fs. Remove the
 * call site.` because `SessionManager.createSession` in all three branches
 * (exec-container, kubernetes, local) still called `initializeWorkspace`.
 *
 * This test asserts that sessionManager.ts has zero `initializeWorkspace` calls.
 * Future additions must use the `/workspaces/<userId>` convention directly; the
 * per-user bucket + PVC are provisioned in k8sSessionManager via
 * `provisionUserBucket` → `/api/internal/code-mode/ensure-user-bucket`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CM_SRC = resolve(__dirname, '../..');

describe('no-workspace-service-init source regression (#310)', () => {
  it('sessionManager.ts does not call workspaceService.initializeWorkspace', () => {
    const src = readFileSync(join(CM_SRC, 'sessionManager.ts'), 'utf8');
    const offenders = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /workspaceService\.initializeWorkspace/.test(line));
    expect(offenders).toEqual([]);
  });
});
