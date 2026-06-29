import { execa } from 'execa';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HELM_CHART } from '../lib/paths.ts';
import { configToHelmValues } from '../lib/helm-values.ts';
import type { WizardConfig } from '../lib/types.ts';
import { verifyStackReady, type BackendHooks } from './docker.ts';

const NAMESPACE = 'openagentic';
const RELEASE = 'openagentic';
/** The api Deployment whose readiness gates "the stack is up". */
const HEALTH_DEPLOY = 'api';

/** The kubeconfig + ns env every helm/kubectl call inherits. */
function k8sEnv(cfg: WizardConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (cfg.kubeconfigPath) env.KUBECONFIG = cfg.kubeconfigPath;
  return env;
}

/** Assert helm + kubectl are on PATH with a clear, actionable error. */
async function assertTooling(env: NodeJS.ProcessEnv): Promise<void> {
  for (const [bin, hint] of [
    ['helm', 'Install Helm: https://helm.sh/docs/intro/install/'],
    ['kubectl', 'Install kubectl: https://kubernetes.io/docs/tasks/tools/'],
  ] as const) {
    try {
      await execa(bin, ['version', '--client'], { env, reject: true, timeout: 10_000 });
    } catch {
      // `helm version` has no --client in some builds; fall back to a plain probe.
      try {
        await execa(bin, ['version'], { env, reject: true, timeout: 10_000 });
      } catch {
        throw new Error(`${bin} is not installed or not on PATH. ${hint}`);
      }
    }
  }
}

// ── pod / workload progress model ──────────────────────────────────────────────

interface PodSnapshot {
  /** app label (or pod name) — what we show the user. */
  app: string;
  phase: string;                 // Pending | Running | Succeeded | Failed | Unknown
  ready: number;                 // ready containers
  total: number;                 // total containers
  /** the most-interesting not-ready container reason, e.g. ContainerCreating / Pulling / CrashLoopBackOff. */
  reason?: string;
  restarts: number;
}

/** A waiting/terminated container reason worth surfacing, ranked so the most
 *  alarming (crash) wins when several pods are mid-flight. */
const REASON_RANK: Record<string, number> = {
  CrashLoopBackOff: 100,
  Error: 95,
  ImagePullBackOff: 90,
  ErrImagePull: 90,
  CreateContainerConfigError: 85,
  RunContainerError: 80,
  Pulling: 40,
  ContainerCreating: 30,
  PodInitializing: 20,
  Pending: 10,
};

interface PodsJson {
  items?: Array<{
    metadata?: { name?: string; labels?: Record<string, string> };
    status?: {
      phase?: string;
      containerStatuses?: Array<{
        ready?: boolean;
        restartCount?: number;
        state?: {
          waiting?: { reason?: string };
          terminated?: { reason?: string };
          running?: Record<string, unknown>;
        };
      }>;
    };
  }>;
}

function parsePods(json: string): PodSnapshot[] {
  let data: PodsJson;
  try { data = JSON.parse(json) as PodsJson; } catch { return []; }
  const out: PodSnapshot[] = [];
  for (const pod of data.items ?? []) {
    const app = pod.metadata?.labels?.app
      || pod.metadata?.labels?.['app.kubernetes.io/name']
      || pod.metadata?.name
      || 'pod';
    const cs = pod.status?.containerStatuses ?? [];
    const total = cs.length || 1;
    let ready = 0;
    let restarts = 0;
    let reason: string | undefined;
    let reasonRank = -1;
    for (const c of cs) {
      if (c.ready) ready++;
      restarts += c.restartCount ?? 0;
      const r = c.state?.waiting?.reason ?? c.state?.terminated?.reason;
      if (r && !c.ready) {
        const rank = REASON_RANK[r] ?? 50;
        if (rank > reasonRank) { reasonRank = rank; reason = r; }
      }
    }
    out.push({ app, phase: pod.status?.phase ?? 'Unknown', ready, total, reason, restarts });
  }
  return out;
}

/** A pod is "done" when all its containers are ready. */
const podReady = (p: PodSnapshot) => p.total > 0 && p.ready === p.total;

/** Pick the most-interesting not-ready pod to describe in the live line. */
function mostInterestingPending(pods: PodSnapshot[]): PodSnapshot | undefined {
  const pending = pods.filter((p) => !podReady(p));
  if (pending.length === 0) return undefined;
  pending.sort((a, b) => {
    const ra = a.reason ? (REASON_RANK[a.reason] ?? 50) : 0;
    const rb = b.reason ? (REASON_RANK[b.reason] ?? 50) : 0;
    return rb - ra;
  });
  return pending[0];
}

/** A rich, human "current" line for the progress bar. */
function describe(p: PodSnapshot): string {
  if (p.reason === 'CrashLoopBackOff' || p.reason === 'Error') {
    return `${p.app}: ${p.reason} (${p.restarts} restarts)`;
  }
  if (p.reason) return `${p.app}: ${p.reason}`;
  return `${p.app} ${p.ready}/${p.total} ${p.phase}`;
}

/** Desired pod count across every Deployment / StatefulSet / DaemonSet the
 *  release created — the denominator for the progress bar. Falls back to the
 *  count of observed pods if the workload query fails. */
async function expectedWorkloadPods(env: NodeJS.ProcessEnv): Promise<number> {
  try {
    const { stdout } = await execa(
      'kubectl',
      ['get', 'deploy,statefulset,daemonset', '-n', NAMESPACE, '-o', 'json'],
      { env, timeout: 15_000 },
    );
    const data = JSON.parse(stdout) as {
      items?: Array<{ kind?: string; spec?: { replicas?: number }; status?: { desiredNumberScheduled?: number } }>;
    };
    let total = 0;
    for (const w of data.items ?? []) {
      if (w.kind === 'DaemonSet') total += w.status?.desiredNumberScheduled ?? 1;
      else total += w.spec?.replicas ?? 1;
    }
    return total;
  } catch {
    return 0;
  }
}

async function getPods(env: NodeJS.ProcessEnv): Promise<PodSnapshot[]> {
  try {
    const { stdout } = await execa('kubectl', ['get', 'pods', '-n', NAMESPACE, '-o', 'json'], {
      env,
      timeout: 15_000,
    });
    return parsePods(stdout);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create the `gcp-adc` Secret (the user Application Default Credentials) in the
 * release namespace so the chart's adcSecret volume mounts it into the api +
 * mcp-proxy (Vertex provider + gcp MCP run as that ADC identity). Idempotent:
 * we `kubectl apply` a client-side dry-run manifest, so a re-run updates in
 * place. Best-effort: a missing ADC file or kubectl error is surfaced as a
 * warning (the install proceeds; the pods will report an auth error until the
 * Secret exists), never a hard failure of the whole deploy.
 */
async function ensureAdcSecret(
  env: NodeJS.ProcessEnv,
  secretName: string,
  hooks: BackendHooks,
): Promise<void> {
  const adcFile = path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  if (!fs.existsSync(adcFile)) {
    hooks.onBuild?.(
      `ADC not found at ${adcFile} — run: gcloud auth application-default login ` +
      '(Vertex + the gcp MCP will lack credentials until the gcp-adc Secret exists)',
    );
    return;
  }
  try {
    // Ensure the namespace exists (the chart's --create-namespace runs later, but
    // the Secret must land first). Ignore "already exists".
    await execa('kubectl', ['create', 'namespace', NAMESPACE], { env, timeout: 30_000 }).catch(() => {});
    // Build the Secret manifest with a client-side dry-run, then apply it — the
    // idempotent create-or-update idiom (avoids "already exists" on a re-run).
    const dryRun = await execa(
      'kubectl',
      [
        '-n', NAMESPACE,
        'create', 'secret', 'generic', secretName,
        `--from-file=application_default_credentials.json=${adcFile}`,
        '--dry-run=client', '-o', 'yaml',
      ],
      { env, timeout: 30_000 },
    );
    await execa('kubectl', ['apply', '-f', '-'], { env, input: dryRun.stdout, timeout: 30_000 });
    hooks.onBuild?.(`Created Secret ${secretName} (user ADC) in namespace ${NAMESPACE}`);
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr || (err as Error).message;
    hooks.onBuild?.(`Could not create the ${secretName} Secret (${msg.split('\n')[0]}) — Vertex/gcp MCP may lack ADC.`);
  }
}

export async function launchHelm(cfg: WizardConfig, hooks: BackendHooks): Promise<string> {
  const env = k8sEnv(cfg);
  await assertTooling(env);

  // ── 1. RENDER CHART ──────────────────────────────────────────────────────────
  hooks.onBuild?.('Rendering chart with your configuration…');

  // One-shot magic-link boot token — threaded into the api via extraEnv so
  // /auth/magic auto-login works exactly like the Docker path.
  const magicToken = crypto.randomBytes(24).toString('base64url');
  const { values, warnings } = configToHelmValues(cfg, magicToken);

  // helm reads JSON values files by extension (JSON is a strict YAML subset).
  const valuesFile = path.join(os.tmpdir(), `openagentic-helm-values-${process.pid}.json`);
  fs.writeFileSync(valuesFile, JSON.stringify(values, null, 2), { mode: 0o600 });

  const baseArgs = [RELEASE, HELM_CHART, '-n', NAMESPACE, '-f', valuesFile];

  // Validate the chart actually renders with these values before we touch the
  // cluster. A template/values error surfaces here with helm's own message.
  try {
    await execa('helm', ['template', ...baseArgs], { env, timeout: 120_000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr || (err as Error).message;
    cleanup(valuesFile);
    throw new Error(`Chart failed to render with your configuration:\n${stderr}`);
  }
  if (warnings.length) {
    // Surface mapping caveats on the render row (non-fatal — the install proceeds).
    hooks.onBuild?.(`rendered with ${warnings.length} note(s): ${warnings[0]}`);
  }
  hooks.onBuildDone?.();

  // ── 1b. ADC SECRET (Vertex/ADC + gcp MCP) ────────────────────────────────────
  // When the chosen provider is Vertex(ADC), the chart mounts the `gcp-adc`
  // Secret (the user ADC) into the api + mcp-proxy. Create it from
  // ~/.config/gcloud/application_default_credentials.json BEFORE the upgrade so
  // the pods come up with their ADC mount on the first roll-out. Idempotent
  // (apply of a dry-run manifest), gated on adcSecret.enabled.
  if (values.adcSecret?.enabled) {
    await ensureAdcSecret(env, values.adcSecret.secretName, hooks);
  }

  // ── 2. APPLY RELEASE ─────────────────────────────────────────────────────────
  // We deliberately do NOT pass --wait: we drive our own live pod progress below.
  hooks.onStart?.(`helm upgrade --install ${RELEASE} (namespace ${NAMESPACE})`);
  try {
    await execa(
      'helm',
      ['upgrade', '--install', ...baseArgs, '--create-namespace'],
      { env, timeout: 300_000 },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr || (err as Error).message;
    cleanup(valuesFile);
    throw new Error(`helm upgrade --install failed:\n${stderr}`);
  }

  // Poll pods until every expected workload pod has scheduled + (where it can)
  // become ready. We report done/total + the most-interesting in-flight pod.
  let total = await expectedWorkloadPods(env);
  const APPLY_DEADLINE = Date.now() + 10 * 60_000;   // bound: don't hang forever
  let lastCrashSeen = '';
  while (Date.now() < APPLY_DEADLINE) {
    const pods = await getPods(env);
    const done = pods.filter(podReady).length;
    // total may have been 0 (query failed) — fall back to observed pod count, and
    // never let total dip below what we can already see.
    total = Math.max(total, pods.length);
    const pending = mostInterestingPending(pods);
    const current = pending
      ? describe(pending)
      : `all ${done} pods ready`;
    hooks.onStartProgress?.({ done, total: Math.max(total, 1), current });
    hooks.onStart?.(current);

    // Surface a crashlooping workload immediately (but keep going — it may
    // recover as its dependencies come up; the bounded health wait below is the
    // real backstop so we never hang indefinitely).
    if (pending?.reason === 'CrashLoopBackOff' && pending.app !== lastCrashSeen) {
      lastCrashSeen = pending.app;
      hooks.onStart?.(`${pending.app} is CrashLoopBackOff (${pending.restarts} restarts) — still waiting`);
    }

    // Done with the apply phase once every expected pod has SCHEDULED (a pod
    // object exists for each) — readiness is the next row's job.
    if (pods.length >= total && total > 0 && pending === undefined) break;
    if (pods.length >= total && total > 0 && pods.every((p) => p.phase !== 'Pending')) {
      // All scheduled (no longer Pending); ready-wait handles the rest.
      break;
    }
    await sleep(2_000);
  }
  hooks.onStartDone?.();

  // ── 3. WAIT FOR HEALTH ───────────────────────────────────────────────────────
  hooks.onHealth?.(`waiting for ${HEALTH_DEPLOY} readiness probe`);
  const HEALTH_DEADLINE = Date.now() + 10 * 60_000;
  let healthy = false;
  while (Date.now() < HEALTH_DEADLINE) {
    const pods = (await getPods(env)).filter((p) => p.app === HEALTH_DEPLOY);
    if (pods.length > 0) {
      const apiPod = pods[0];
      if (podReady(apiPod)) { healthy = true; break; }
      // Live detail: ready count + any waiting reason (e.g. "api 0/1 · Pulling").
      const detail = apiPod.reason
        ? `${HEALTH_DEPLOY} ${apiPod.ready}/${apiPod.total} · ${apiPod.reason}`
        : `${HEALTH_DEPLOY} ${apiPod.ready}/${apiPod.total} → waiting for readiness probe`;
      hooks.onHealth?.(detail);
      // Bound: a crashlooping api will never go ready — fail fast with its reason
      // + logs hint instead of burning the full deadline.
      if (apiPod.reason === 'CrashLoopBackOff' && apiPod.restarts >= 4) {
        cleanup(valuesFile);
        throw new Error(
          `api is CrashLoopBackOff (${apiPod.restarts} restarts) and is not becoming ready. ` +
          `Investigate: kubectl logs deploy/${HEALTH_DEPLOY} -n ${NAMESPACE}`,
        );
      }
    } else {
      hooks.onHealth?.(`${HEALTH_DEPLOY} pod not scheduled yet`);
    }
    await sleep(3_000);
  }
  if (!healthy) {
    cleanup(valuesFile);
    throw new Error(
      `${HEALTH_DEPLOY} did not become ready within 10 minutes. ` +
      `Investigate: kubectl get pods -n ${NAMESPACE} ; kubectl logs deploy/${HEALTH_DEPLOY} -n ${NAMESPACE}`,
    );
  }

  // ── 4. RESOLVE THE BASE URL + PROVE MODEL/MCPS ───────────────────────────────
  // The api readiness probe passing only means the api process is up — NOT that
  // the chosen model answers or the selected MCPs serve tools. Establish the base
  // URL that fronts the api (the UI nginx proxies /api/* to the api), then PROVE
  // both before returning the auto-login magic link.
  //   * ingress    → the chart host (api reachable at https://<host>/api/*).
  //   * no ingress → port-forward svc/ui to localhost NOW (not at the very end),
  //                  so the verification calls have a reachable api; the same
  //                  detached forward is then reused for the opened magic link.
  let base: string;
  let magicUrl: string;
  const port = cfg.uiPort || 8080;
  if (values.ingress.enabled && values.ingress.host) {
    const scheme = values.ingress.tlsSecret ? 'https' : 'http';
    base = `${scheme}://${values.ingress.host}`;
    magicUrl = `${base}/auth/magic?token=${magicToken}`;
  } else {
    // No ingress — port-forward the UI Service to localhost. Detached so it
    // survives past this process step (the wizard opens the URL right after).
    try {
      const child = execa(
        'kubectl',
        ['port-forward', 'svc/ui', `${port}:80`, '-n', NAMESPACE],
        { env, detached: true, stdio: 'ignore' },
      );
      child.unref();
      // Give the forward a beat to bind before we probe / open the URL.
      await sleep(1_500);
    } catch {
      // Best-effort — if the forward can't start, the URL still documents the path
      // and verifyStackReady will surface a clear connect error.
    }
    base = `http://localhost:${port}`;
    magicUrl = `${base}/auth/magic?token=${magicToken}`;
  }

  try {
    await verifyStackReady(base, cfg, hooks, {
      ollama: `kubectl logs -n ${NAMESPACE} deploy/ollama   (model-serving pod)`,
      mcpProxy: `kubectl logs -n ${NAMESPACE} deploy/mcp-proxy`,
    });
  } catch (err) {
    cleanup(valuesFile);
    throw err;
  }
  hooks.onHealthDone?.();

  cleanup(valuesFile);

  // ── 5. RETURN URL + magic-link ───────────────────────────────────────────────
  return magicUrl;
}

function cleanup(file: string): void {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}
