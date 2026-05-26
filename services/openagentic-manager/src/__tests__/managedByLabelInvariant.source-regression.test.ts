/**
 * #1056 — Pin the `app.kubernetes.io/managed-by: openagentic-manager` label
 * on every Pod and PVC created by k8sSessionManager.
 *
 * The Helm pre-uninstall hook (templates/hooks/pre-uninstall-codemode-cleanup.yaml
 * in the openagentic-helm chart) deletes resources matching THIS exact selector
 * before MinIO + csi-s3-admin-creds are torn down. If the label drifts on the
 * code-manager side, the hook silently no-ops and orphan exec Pods + their
 * CSI-S3 PVCs survive the uninstall → next `helm install` produces the
 * "MountVolume.MountDevice ... Timeout waiting for mount" failure mode.
 *
 * This source-regression test reads the k8sSessionManager.ts file as text
 * and asserts that every metadata block in the three resource-create paths
 * (ensureUserPVC, ensureUserCsiS3PVC, createRunnerPod) stamps the
 * canonical label. No mocked k8s client — the contract is purely textual.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'k8sSessionManager.ts'),
  'utf-8',
);

const CANONICAL_LABEL_RE = /'app\.kubernetes\.io\/managed-by':\s*'openagentic-manager'/g;

describe('#1056 managed-by label invariant', () => {
  test('source contains the canonical label at least 3 times (PVC + CSI-S3 PVC + Pod)', () => {
    const matches = SOURCE.match(CANONICAL_LABEL_RE) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test('label appears inside the createRunnerPod Pod metadata block', () => {
    const podBlockStart = SOURCE.indexOf('const pod: k8s.V1Pod');
    const podBlockEnd = SOURCE.indexOf('await this.coreApi.createNamespacedPod', podBlockStart);
    expect(podBlockStart).toBeGreaterThan(0);
    expect(podBlockEnd).toBeGreaterThan(podBlockStart);
    const podBlock = SOURCE.slice(podBlockStart, podBlockEnd);
    expect(podBlock).toMatch(CANONICAL_LABEL_RE);
  });

  test('label appears in ensureUserPVC PVC metadata block', () => {
    // ensureUserPVC is `async ensureUserPVC` (public — called from sessionsRoute)
    // while ensureUserCsiS3PVC is `private async`. Match both shapes.
    const fnStart = SOURCE.search(/(?:private\s+)?async\s+ensureUserPVC\s*\(/);
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = SOURCE.search(/(?:private\s+)?async\s+ensureUserCsiS3PVC\s*\(/);
    const fnBody = SOURCE.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(CANONICAL_LABEL_RE);
  });

  test('label appears in ensureUserCsiS3PVC PVC metadata block', () => {
    const fnStart = SOURCE.search(/(?:private\s+)?async\s+ensureUserCsiS3PVC\s*\(/);
    expect(fnStart).toBeGreaterThan(0);
    const fnEnd = SOURCE.search(/(?:private\s+)?async\s+createRunnerPod\s*\(/);
    const fnBody = SOURCE.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(CANONICAL_LABEL_RE);
  });
});
