import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { createHash } from 'crypto';
import * as k8s from '@kubernetes/client-node';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { featureFlags } from '../../config/featureFlags.js';
import { isAllReady } from './boot-events.gating.js';

interface BootDeps { logger: Logger; }

type Status = 'pending' | 'running' | 'ok' | 'warn' | 'fail';
interface CheckState { key: string; status: Status; detail: string; }

const NAMESPACE = featureFlags.k8sNamespace;
const TICK_MS = 2_000;
const SOFT_TIMEOUT_MS = 2_000;

function podNameForUser(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex').slice(0, 12);
  return `openagentic-${hash}`;
}

function getK8sCoreApi(): k8s.CoreV1Api | null {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromCluster();
    return kc.makeApiClient(k8s.CoreV1Api);
  } catch { return null; }
}

/**
 * v1.4 @kubernetes/client-node throws `ApiException` with `.code` (the
 * HTTP status) but NOT `.statusCode`. Boot-events' outer catch branches
 * on `err.statusCode` (`404 → "pod not yet scheduled"`, `403 → "api SA
 * missing RBAC"`) — without normalization the UI shows the raw multi-
 * line `"HTTP-Code: 404\nMessage: ...\nBody: ..."` blob. Mutates the
 * error in place and returns it so callers can `throw normalizeKubeErr(e)`.
 */
function normalizeKubeErr(err: any): any {
  if (err && err.statusCode == null) {
    if (typeof err.code === 'number') {
      err.statusCode = err.code;
    } else {
      const m = /^HTTP-Code:\s*(\d+)/.exec(err.message || '');
      if (m) err.statusCode = Number(m[1]);
    }
  }
  return err;
}

/**
 * Thin wrapper around `CoreV1Api.readNamespacedPod`. v1.4 of
 * @kubernetes/client-node ships `CoreV1Api` as `ObjectCoreV1Api`
 * (object-arg ONLY). Calling positionally triggers the SDK's
 * `RequiredError` validator — which would MASK the real k8s HTTP
 * error (404 / 403 / etc.) behind a useless validator message.
 * So: object-arg only, pass the original error through (normalized
 * so `.statusCode` is always set), and unwrap the `{body: Pod}`
 * shape iff the lib happens to return that form.
 *
 * Exported for the unit test in
 * `boot-events.kube-api-shim.test.ts` — do not dead-code-eliminate.
 */
export async function readPodWithShimFallback(
  k8sApi: { readNamespacedPod: (param: { name: string; namespace: string }) => Promise<any> },
  name: string,
  namespace: string,
): Promise<any> {
  try {
    const res = await k8sApi.readNamespacedPod({ name, namespace });
    return (res && typeof res === 'object' && 'body' in res) ? (res as any).body : res;
  } catch (err: any) {
    throw normalizeKubeErr(err);
  }
}

/**
 * Thin wrapper around `CoreV1Api.listNamespacedEvent`. Same rules
 * as `readPodWithShimFallback`: object-arg only on v1.x, unwrap
 * `{body: {items}}` if present, pass HTTP errors through with
 * their `statusCode` intact.
 *
 * Returns the raw `items[]` — empty array if the server returns
 * no events. Callers handle `resourceVersion` gating themselves.
 *
 * Exported for the unit test in
 * `boot-events.kube-api-shim.test.ts` — do not dead-code-eliminate.
 */
export async function listEventsWithShimFallback(
  k8sApi: {
    listNamespacedEvent: (param: {
      namespace: string;
      fieldSelector: string;
      resourceVersion: string;
    }) => Promise<any>;
  },
  namespace: string,
  fieldSelector: string,
  resourceVersion: string,
): Promise<any[]> {
  try {
    const res = await k8sApi.listNamespacedEvent({ namespace, fieldSelector, resourceVersion });
    const body = (res && typeof res === 'object' && 'body' in res) ? (res as any).body : res;
    return Array.isArray(body?.items) ? body.items : [];
  } catch (err: any) {
    throw normalizeKubeErr(err);
  }
}

/**
 * Workspace probe (PVC-based, replaces the s3fs/MinIO probe ripped
 * 2026-04-22). The runner pod declares a per-user PVC named
 * `workspace` mounted at /workspaces. Three shapes are accepted:
 *   - inline ephemeral PVC (pre-#324, legacy)
 *   - retained persistentVolumeClaim.claimName (#324, current cm)
 *   - minio-csi FUSE-backed PVC, flagged via pod annotation
 *     `openagentic.io/workspace-mount=minio-csi` (CSI-S3 T8)
 *
 * For all three shapes, k8s binds/mounts the volume before the
 * container starts — so a Ready container with a correctly-typed
 * volume entry is all we need to call the workspace mounted. For
 * minio-csi specifically, the exec pod's entrypoint (Task 6)
 * already fail-closes on a missing/polluted FUSE mount, so
 * ContainersReady=True is authoritative.
 *
 * Exported for the unit test in boot-events.pvc-workspace-check.test.ts.
 * Takes a V1Pod (or null when the pod-read call hasn't populated yet)
 * and returns the status/detail pair the NDJSON stream emits.
 */
export function probeWorkspaceFromPod(
  pod: k8s.V1Pod | null | undefined
): { status: 'ok' | 'running' | 'fail' | 'warn'; detail: string } {
  if (!pod) {
    return { status: 'warn', detail: 'no pod yet — waiting for scheduler' };
  }
  const volumes = pod.spec?.volumes || [];
  const ws = volumes.find((v: any) => v.name === 'workspace');
  if (!ws) {
    return {
      status: 'fail',
      detail: 'no workspace volume declared in pod spec (expected PVC)',
    };
  }
  // Accept either an inline ephemeral PVC (pre-#324) or a retained
  // per-user PVC (post-#324, current cm). Reject hostPath or other
  // legacy drift patterns — those signal the s3fs-era rollback.
  const ephemeral = (ws as any).ephemeral?.volumeClaimTemplate;
  const pvcClaimName = (ws as any).persistentVolumeClaim?.claimName;
  if (!ephemeral && !pvcClaimName) {
    return {
      status: 'fail',
      detail: 'workspace is not a PVC (legacy s3fs/hostPath drift)',
    };
  }
  const phase = pod.status?.phase;
  const conditions = pod.status?.conditions || [];
  const containersReady = conditions.find((c: any) => c.type === 'ContainersReady')?.status === 'True';
  const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
  if (phase === 'Pending' || phase === 'Unknown' || !phase) {
    return { status: 'running', detail: `${phase || 'pending'} — PVC binding` };
  }
  if (!containersReady || !ready) {
    const cs = pod.status?.containerStatuses?.[0];
    const waiting = (cs as any)?.state?.waiting?.reason;
    const detail = waiting ? `${phase} · ${waiting}` : `${phase} · ContainersReady=false`;
    return { status: 'running', detail };
  }
  // CSI-S3 T8 — when the pod is annotated `workspace-mount=minio-csi`,
  // kubelet performed the FUSE mount before container start and Task 6's
  // entrypoint has already fail-closed on any missing/polluted mount.
  // No further introspection is needed past ContainersReady=true.
  const mountType = (pod.metadata?.annotations as any)?.['openagentic.io/workspace-mount'];
  if (mountType === 'minio-csi') {
    return { status: 'ok', detail: `minio-csi mount @ ${pvcClaimName}` };
  }
  if (ephemeral) {
    const accessModes = ephemeral.spec?.accessModes?.join?.(',') || 'ReadWriteOnce';
    const sc = ephemeral.spec?.storageClassName || 'cluster-default';
    return { status: 'ok', detail: `PVC ${accessModes} · ${sc}` };
  }
  return { status: 'ok', detail: `PVC ${pvcClaimName} (retained, #324)` };
}

export async function registerCodeModeBootEventsRoute(server: FastifyInstance, deps: BootDeps): Promise<void> {
  const { logger } = deps;

  server.get('/api/code/v2/boot-events', async (request, reply) => {
    const token = (request.query as any)?.token as string | undefined;
    const sessionId = (request.query as any)?.sessionId as string | undefined;
    if (!token || !sessionId) { reply.code(400).send({ error: 'token + sessionId required' }); return; }
    const tok = await validateAnyToken(token, { logger });
    if (!tok.isValid || !tok.user) { reply.code(401).send({ error: 'invalid token' }); return; }

    const userId = tok.user.userId;
    const podName = podNameForUser(userId);
    const serviceBase = `http://${podName}-svc.${NAMESPACE}.svc.cluster.local`;
    const bootStartedAt = Date.now();

    reply.raw.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const emit = (obj: Record<string, unknown>) => {
      try { reply.raw.write(JSON.stringify({ ts: Date.now(), ...obj }) + '\n'); } catch {}
    };

    // Seed the modal header immediately — UI shows session + pod before
    // the first kube poll completes. nodeName arrives in a later update
    // once the pod has been scheduled.
    emit({
      type: 'session_info',
      sessionId,
      podName,
      nodeName: null,
      namespace: NAMESPACE,
      startedAt: bootStartedAt,
    });
    let emittedNodeName: string | null = null;

    const state: Record<string, CheckState> = {
      pod_scheduled:     { key:'pod_scheduled',     status:'pending', detail:'queued' },
      workspace_mounted: { key:'workspace_mounted', status:'pending', detail:'PVC check' },
      daemon_health:     { key:'daemon_health',     status:'pending', detail:':3070/health' },
      model_ping:        { key:'model_ping',        status:'pending', detail:'admin-default · 1-token ping' },
      relay_ws:          { key:'relay_ws',          status:'pending', detail:'chat WS dry-run' },
    };
    let allReadyEmitted = false;
    const set = (key: string, status: Status, detail: string) => {
      const prev = state[key];
      if (prev.status === status && prev.detail === detail) return;
      state[key] = { key, status, detail };
      emit({ type: 'check', key, status, detail });
    };

    const k8sApi = getK8sCoreApi();
    if (!k8sApi) {
      set('pod_scheduled', 'fail', 'k8s client unavailable');
      emit({ type: 'error', message: 'k8s config load failed' });
      reply.raw.end();
      return;
    }

    let cachedPod: k8s.V1Pod | null = null;
    let lastRV = '0';
    const pollKube = async () => {
      // Events + pod-read are independent — a transient list failure must
      // NOT also drop the pod-read path (which is what pod_scheduled relies
      // on to transition).
      try {
        // v1.4 @kubernetes/client-node is object-arg only; the helper
        // preserves statusCode on any real k8s HTTP error instead of
        // masking it with a client-side RequiredError from a spurious
        // positional retry (see helper doc for full rationale).
        const items: any[] = await listEventsWithShimFallback(
          k8sApi as any,
          NAMESPACE,
          `involvedObject.name=${podName}`,
          lastRV,
        );
        // On the FIRST poll (lastRV === '0') show the most recent 20 events
        // regardless of age — useful for a long-lived pod whose Scheduled/
        // Pulled/Started events happened minutes ago but are still the
        // relevant lifecycle story for the panel. After the first poll,
        // resourceVersion gating means we only get truly new events.
        const isFirstPoll = lastRV === '0';
        const toEmit = isFirstPoll
          ? items
              .slice()
              .sort((a, b) =>
                (Date.parse(b.lastTimestamp || b.eventTime || b.firstTimestamp || '') || 0) -
                (Date.parse(a.lastTimestamp || a.eventTime || a.firstTimestamp || '') || 0),
              )
              .slice(0, 20)
              .reverse() // emit oldest→newest so the UI reads top-down
          : items;
        for (const ev of toEmit) {
          emit({
            type: 'kube_event',
            kind: ev.type || 'Normal',
            reason: ev.reason || '',
            source: ev.source?.component || 'k8s',
            message: ev.message || '',
          });
        }
        for (const ev of items) {
          lastRV = ev.metadata?.resourceVersion || lastRV;
        }
      } catch (err: any) {
        logger.debug({ err: err?.message || err, podName }, '[codemode-boot] listNamespacedEvent failed');
      }
      try {
        const pbody = await readPodWithShimFallback(k8sApi as any, podName, NAMESPACE);
        cachedPod = pbody;
        const nodeName = pbody.spec?.nodeName || null;
        if (nodeName && nodeName !== emittedNodeName) {
          emittedNodeName = nodeName;
          emit({ type: 'session_info', sessionId, podName, nodeName, namespace: NAMESPACE, startedAt: bootStartedAt });
        }
        const ready = (pbody.status?.conditions || []).find((c: any) => c.type === 'Ready')?.status === 'True';
        if (ready) set('pod_scheduled', 'ok', `${nodeName || podName} · Ready`);
        else set('pod_scheduled', 'running', pbody.status?.phase || 'starting');
      } catch (err: any) {
        const detail = err?.statusCode === 404 ? 'pod not yet scheduled'
          : err?.statusCode === 403 ? 'api SA missing RBAC on pods'
          : `k8s err: ${(err?.message || 'unknown').slice(0, 80)}`;
        set('pod_scheduled', 'running', detail);
      }
    };

    const probeDaemon = async () => {
      try {
        const t0 = Date.now();
        const r = await fetch(`${serviceBase}:3070/health`, { signal: AbortSignal.timeout(SOFT_TIMEOUT_MS) });
        if (r.ok) set('daemon_health', 'ok', `200 · ${Date.now() - t0}ms`);
        else set('daemon_health', 'fail', `HTTP ${r.status}`);
      } catch (e: any) {
        set('daemon_health', 'running', `connect refused (retrying)`);
      }
    };

    const probeWorkspace = async () => {
      const result = probeWorkspaceFromPod(cachedPod);
      set('workspace_mounted', result.status, result.detail);
    };

    const probeRelayWs = async () => {
      // Approximate: the CCR relay path works iff the api pod can TCP
      // connect the daemon. Dial pod:3070 directly — if /health is 200,
      // the relay will also succeed. Piggyback on daemon_health's result
      // here since it's the same reachability.
      if (state.daemon_health.status === 'ok') {
        set('relay_ws', 'ok', 'pod:3070 reachable from api pod');
      } else {
        set('relay_ws', 'running', 'awaiting daemon');
      }
    };

    const probeModel = async () => {
      // Real inference round-trip. Calls the codemode endpoint with a
      // 1-token prompt to verify gpt-5.3-codex is actually reachable via
      // the api's provider pool. A 200 with non-empty text proves the
      // whole model path works.
      if (state.daemon_health.status !== 'ok') {
        set('model_ping', 'running', 'waiting for daemon');
        return;
      }
      // The codex and gpt-5-pro families on AIF REJECT the chat/completions
      // path (HTTP 400 "operation unsupported"). Only the streaming code path
      // in AzureAIFoundryProvider routes correctly to /openai/v1/responses.
      // Use stream:true + NDJSON, consume the first text delta, and close.
      try {
        const t0 = Date.now();
        const r = await fetch(`http://localhost:8000/api/openagentic/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
            'Authorization': `Bearer ${token}`,
            'x-boot-probe': '1',
          },
          body: JSON.stringify({
            // Responses API (codex / gpt-5-pro) enforces a minimum
            // max_output_tokens (≥16 per Azure docs). Use 32 as a safe
            // floor — this is a one-off boot probe, a few extra tokens
            // cost nothing.
            max_tokens: 32,
            stream: true,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          const bodyText = await r.text().catch(() => '');
          let reason = '';
          try {
            const eb = JSON.parse(bodyText);
            reason = eb?.error?.message || eb?.message || '';
          } catch { /* fallback to bodyText */ }
          const detail = (reason || bodyText || '').replace(/\s+/g, ' ').slice(0, 180);
          set('model_ping', 'fail', `HTTP ${r.status} · ${detail || 'no error body'}`);
          return;
        }
        let modelUsed = '';
        let gotText = false;
        const reader = r.body?.getReader();
        if (!reader) {
          set('model_ping', 'fail', 'no response body');
          return;
        }
        const decoder = new TextDecoder();
        let buf = '';
        try {
          outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const ev = JSON.parse(line);
                if (ev.type === 'message_start' && ev.message?.model) {
                  modelUsed = ev.message.model;
                }
                if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
                  if (ev.delta.text.trim().length > 0) { gotText = true; break outer; }
                }
                if (ev.type === 'error') {
                  set('model_ping', 'fail', `stream error: ${(ev.error?.message || '').slice(0, 140)}`);
                  return;
                }
              } catch { /* tolerate partial lines */ }
            }
          }
        } finally {
          try { await reader.cancel(); } catch { /* tolerant */ }
        }
        const dur = Date.now() - t0;
        if (gotText) {
          set('model_ping', 'ok', `${modelUsed || 'admin default'} · ${dur}ms`);
        } else {
          set('model_ping', 'warn', `empty response · ${dur}ms`);
        }
      } catch (e: any) {
        set('model_ping', 'fail', `err: ${e.message?.slice(0, 80) || 'timeout'}`);
      }
    };

    const maybeAllReady = () => {
      // Requirement A (2026-04-28): the session MUST NOT open until the
      // default-code-model 1-token probe responds. Source of truth for
      // the blocking list lives in boot-events.gating.ts so the unit
      // test can pin the contract without dragging the whole handler.
      if (allReadyEmitted) return;
      if (isAllReady(state as any)) {
        allReadyEmitted = true;
        emit({ type: 'all_ready' });
      }
    };

    // initial check burst
    emit({ type: 'check', key: 'pod_scheduled',     status: 'running', detail: 'querying…' });
    emit({ type: 'check', key: 'workspace_mounted', status: 'running', detail: 'querying…' });
    emit({ type: 'check', key: 'daemon_health',     status: 'running', detail: 'querying…' });
    emit({ type: 'check', key: 'model_ping',        status: 'running', detail: 'querying…' });
    emit({ type: 'check', key: 'relay_ws',          status: 'running', detail: 'querying…' });

    let killed = false;
    request.raw.on('close', () => { killed = true; });

    // Hard ceiling so a hung k8s / fetch call can't stall the tick.
    // Individual probes have their own fetch timeouts, but the k8s client
    // doesn't expose an AbortSignal for the object-arg API, so we belt-
    // and-braces with Promise.race per probe.
    const TICK_HARD_CEILING_MS = 3_500;
    const raceTimeout = <T>(p: Promise<T>, ms: number, tag: string): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${tag} tick-timeout`)), ms)),
      ]);

    const loop = async () => {
      while (!killed) {
        // 1. Kube poll first — populates cachedPod for the workspace probe.
        await raceTimeout(pollKube(), TICK_HARD_CEILING_MS, 'pollKube');
        // 2. Workspace probe reads cachedPod set above (PVC / pod-spec check).
        await raceTimeout(probeWorkspace(), TICK_HARD_CEILING_MS, 'probeWorkspace');
        // 3. Daemon + editor only once the pod is scheduled — prevents
        //    connect-refused noise while k8s is still binding the PVC.
        if (state.pod_scheduled.status === 'ok') {
          await raceTimeout(probeDaemon(), TICK_HARD_CEILING_MS, 'probeDaemon');
        }
        await raceTimeout(probeRelayWs(), TICK_HARD_CEILING_MS, 'probeRelayWs').catch(() => {});
        await raceTimeout(probeModel(), 16_000, 'probeModel').catch(() => {});
        maybeAllReady();
        if (allReadyEmitted) {
          // keep the stream warm but slow the tick
          await new Promise(r => setTimeout(r, 10_000));
        } else {
          await new Promise(r => setTimeout(r, TICK_MS));
        }
      }
      try { reply.raw.end(); } catch {}
    };
    void loop();
  });

  logger.info('[codemode-boot] /api/code/v2/boot-events registered');
}
