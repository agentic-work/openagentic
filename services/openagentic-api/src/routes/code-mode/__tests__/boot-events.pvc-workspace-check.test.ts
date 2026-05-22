/**
 * PVC-workspace probe (replaces the minio/s3fs probe ripped 2026-04-22).
 *
 * The runner pod mounts `/workspaces` via a per-user PVC (task #324
 * switched from ephemeral.volumeClaimTemplate to a retained
 * persistentVolumeClaim.claimName so the workspace survives pod
 * restarts). Both shapes are valid workspace backings; the probe
 * rejects only the legacy hostPath / missing-volume cases, which
 * indicate a drift back to the pre-ephemeral era.
 *
 * Once k8s has bound the PVC and the container is Ready, the workspace
 * IS mounted — no separate MinIO listObjects call is needed.
 *
 * The boot-events handler inspects pod.spec.volumes + pod.status and
 * reports one of: ok / running / fail / warn. This test pins the
 * decision table so future edits can't silently drift the semantics.
 */
import { describe, it, expect } from 'vitest';
import { probeWorkspaceFromPod } from '../boot-events.handler.js';

describe('probeWorkspaceFromPod (PVC-based workspace_mounted check)', () => {
  const readyContainer = { name: 'runner', ready: true, restartCount: 0, image: 'openagentic-exec:latest', imageID: '', state: { running: {} } };
  const workspaceVolume = {
    name: 'workspace',
    ephemeral: {
      volumeClaimTemplate: {
        spec: {
          accessModes: ['ReadWriteOnce'],
          storageClassName: 'local-path',
          resources: { requests: { storage: '5120Mi' } },
        },
      },
    },
  };

  it('returns ok when pod declares workspace ephemeral volume and the runner container is Ready', () => {
    const pod: any = {
      spec: { volumes: [workspaceVolume, { name: 'tools-cache', emptyDir: {} }] },
      status: {
        phase: 'Running',
        containerStatuses: [readyContainer],
        conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
      },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('ok');
    expect(r.detail).toMatch(/PVC.*ReadWriteOnce|workspace.*ready/i);
  });

  it('returns running when pod is Pending (PVC not yet bound)', () => {
    const pod: any = {
      spec: { volumes: [workspaceVolume] },
      status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False' }] },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('running');
    expect(r.detail.toLowerCase()).toMatch(/pending|scheduling|binding/);
  });

  it('returns running when pod is Running but ContainersReady is False (PVC mounting)', () => {
    const pod: any = {
      spec: { volumes: [workspaceVolume] },
      status: {
        phase: 'Running',
        containerStatuses: [{ ...readyContainer, ready: false, state: { waiting: { reason: 'ContainerCreating' } } }],
        conditions: [{ type: 'ContainersReady', status: 'False' }],
      },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('running');
  });

  it('returns fail when pod declares no workspace volume (misconfigured spec)', () => {
    const pod: any = {
      spec: { volumes: [{ name: 'tools-cache', emptyDir: {} }] },
      status: { phase: 'Running', containerStatuses: [readyContainer], conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('fail');
    expect(r.detail.toLowerCase()).toMatch(/no workspace|volume.*missing|workspace.*not declared/);
  });

  it('returns fail when workspace volume is hostPath (legacy s3fs drift)', () => {
    const pod: any = {
      spec: { volumes: [{ name: 'workspace', hostPath: { path: '/mnt/user-data', type: 'Directory' } }] },
      status: { phase: 'Running', containerStatuses: [readyContainer], conditions: [{ type: 'Ready', status: 'True' }] },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('fail');
    expect(r.detail.toLowerCase()).toMatch(/not a pvc|hostpath|wrong volume type|legacy/);
  });

  // ── #324 — retained per-user PVC (current cm behavior) ─────────────
  const pvcWorkspaceVolume = {
    name: 'workspace',
    persistentVolumeClaim: { claimName: 'ws-ae13351f140e' },
  };

  it('returns ok when pod declares a retained persistentVolumeClaim workspace and is Ready (#324)', () => {
    const pod: any = {
      spec: { volumes: [pvcWorkspaceVolume, { name: 'tools-cache', emptyDir: {} }] },
      status: {
        phase: 'Running',
        containerStatuses: [readyContainer],
        conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
      },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('ok');
    expect(r.detail.toLowerCase()).toMatch(/pvc|workspace/);
  });

  it('returns running when pod with retained PVC is still scheduling (#324)', () => {
    const pod: any = {
      spec: { volumes: [pvcWorkspaceVolume] },
      status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False' }] },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('running');
  });

  it('returns running when retained-PVC pod is Running but ContainersReady is False (#324)', () => {
    const pod: any = {
      spec: { volumes: [pvcWorkspaceVolume] },
      status: {
        phase: 'Running',
        containerStatuses: [{ ...readyContainer, ready: false, state: { waiting: { reason: 'ContainerCreating' } } }],
        conditions: [{ type: 'ContainersReady', status: 'False' }],
      },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('running');
  });

  it('returns warn when pod cannot be read (pod object is null)', () => {
    const r = probeWorkspaceFromPod(null as any);
    expect(r.status).toBe('warn');
    expect(r.detail.toLowerCase()).toMatch(/no pod|pod not found|waiting/);
  });

  // ── CSI-S3 T8 — minio-csi annotation branch (FUSE-backed PVC) ──────
  // Exec pods mounted via the minio-csi driver carry the annotation
  // `openagentic.io/workspace-mount=minio-csi`. kubelet performs the
  // FUSE mount BEFORE container start — Task 6's entrypoint already
  // fail-closes on a missing/polluted mount — so once the container
  // is Ready, no further introspection of the mount is required.
  const minioCsiAnnotatedPod = (overrides: any = {}): any => ({
    metadata: {
      annotations: { 'openagentic.io/workspace-mount': 'minio-csi' },
    },
    spec: {
      volumes: [
        { name: 'workspace', persistentVolumeClaim: { claimName: 'ws-deadbeef' } },
        { name: 'tools-cache', emptyDir: {} },
      ],
    },
    status: {
      phase: 'Running',
      containerStatuses: [readyContainer],
      conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
    },
    ...overrides,
  });

  it('returns ok when minio-csi annotation is present and container is Ready (CSI-S3 T8)', () => {
    const pod = minioCsiAnnotatedPod();
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('ok');
    expect(r.detail.toLowerCase()).toContain('minio-csi');
    expect(r.detail).toContain('ws-deadbeef');
  });

  it('returns running when minio-csi annotation is present but ContainersReady is False (CSI-S3 T8)', () => {
    const pod = minioCsiAnnotatedPod({
      status: {
        phase: 'Running',
        containerStatuses: [{ ...readyContainer, ready: false, state: { waiting: { reason: 'ContainerCreating' } } }],
        conditions: [{ type: 'ContainersReady', status: 'False' }],
      },
    });
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('running');
  });

  it('falls through to existing PVC logic when minio-csi annotation is absent (backward-compat, CSI-S3 T8)', () => {
    // No annotations at all — must preserve the retained-PVC detail
    // format (#324) so unrelated deployments don't regress.
    const pod: any = {
      spec: { volumes: [{ name: 'workspace', persistentVolumeClaim: { claimName: 'ws-ae13351f140e' } }] },
      status: {
        phase: 'Running',
        containerStatuses: [readyContainer],
        conditions: [{ type: 'Ready', status: 'True' }, { type: 'ContainersReady', status: 'True' }],
      },
    };
    const r = probeWorkspaceFromPod(pod);
    expect(r.status).toBe('ok');
    expect(r.detail).toMatch(/retained, #324/);
    expect(r.detail.toLowerCase()).not.toContain('minio-csi');
  });

  it('the returned detail string NEVER references MinIO, s3fs, or a bucket (rip regression guard)', () => {
    const pods: any[] = [
      { spec: { volumes: [workspaceVolume] }, status: { phase: 'Running', containerStatuses: [readyContainer], conditions: [{ type: 'Ready', status: 'True' }] } },
      { spec: { volumes: [workspaceVolume] }, status: { phase: 'Pending' } },
      { spec: { volumes: [] }, status: { phase: 'Running' } },
      null,
    ];
    for (const p of pods) {
      const r = probeWorkspaceFromPod(p as any);
      expect(r.detail).not.toMatch(/minio|s3fs|bucket|s3:\/\//i);
    }
  });
});
