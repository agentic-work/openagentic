import { execa } from 'execa';
import { REPO_ROOT } from '../lib/paths.ts';
import type { WizardConfig } from '../lib/types.ts';

/** True when the chosen Ollama endpoint is the bundled compose `ollama` service
 *  (the only case where the wizard should start the `ollama` profile). A remote
 *  or host endpoint the user already runs is reached directly — we don't start
 *  a container for it. */
function isBundledOllama(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const h = new URL(host).hostname;
    return h === 'ollama';
  } catch {
    return /(^|\/\/)ollama(:|\/|$)/.test(host);
  }
}

/** Live progress of the `docker compose up -d` pull/create/start phase. */
export interface StartProgress {
  /** services that have reached a terminal state (Pulled/Created/Started/Healthy). */
  done: number;
  /** total services compose is bringing up (from `docker compose config --services`). */
  total: number;
  /** the service + action currently in flight, e.g. "api Starting" — for display. */
  current?: string;
}

export interface BackendHooks {
  onBuild?: (msg: string) => void;
  /** Fired as `docker compose pull` streams per-image lines, so the UI can render
   *  a bar showing which images are downloading vs already cached. Docker-only —
   *  optional so the Helm backend (which has no pull phase) need not implement it. */
  onBuildProgress?: (p: StartProgress) => void;
  onBuildDone?: () => void;
  onStart?: (msg: string) => void;
  /** Fired as compose streams pull/create/start lines, so the UI can render a bar. */
  onStartProgress?: (p: StartProgress) => void;
  onStartDone?: () => void;
  onHealth?: (msg: string) => void;
  onHealthDone?: () => void;
}

/** Service names compose will act on for the given profile args. Falls back to an
 *  empty list (the caller then derives the total from the streamed lines). */
async function composeServices(profileArgs: string[]): Promise<string[]> {
  try {
    const { stdout } = await execa('docker', ['compose', ...profileArgs, 'config', '--services'], {
      cwd: REPO_ROOT,
    });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Terminal states a service reaches once compose is done pulling/creating/starting it. */
const TERMINAL = new Set(['Pulled', 'Created', 'Started', 'Running', 'Healthy']);
/** In-flight states — used only to surface the "current" action, not to count done. */
const IN_FLIGHT = new Set(['Pulling', 'Creating', 'Starting', 'Waiting']);

/** Parse one compose progress line and fold it into the per-service state map.
 *  Compose writes two shapes to stderr:
 *    - image pulls:      "Pulling <svc> ..."  /  "<svc> Pulled"
 *    - container ops:    "Container openagentic-<svc>-1  Creating|Created|Starting|Started|Healthy"
 *  We key on the service name and keep the furthest-along state seen for it. */
function foldProgressLine(line: string, state: Map<string, string>): string | undefined {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;

  // "Container openagentic-api-1  Started"  (also matches bare "<name>-1 Started")
  let m = /(?:Container\s+)?[A-Za-z0-9._-]*?-([A-Za-z0-9_]+)-\d+\s+(Pulling|Pulled|Creating|Created|Starting|Started|Running|Waiting|Healthy)\b/.exec(clean);
  if (m) {
    state.set(m[1], m[2]);
    return `${m[1]} ${m[2]}`;
  }
  // "Pulling api ..."  /  "api Pulled"
  m = /^Pulling\s+([A-Za-z0-9_.-]+)\b/.exec(clean);
  if (m) {
    const svc = m[1];
    if (!TERMINAL.has(state.get(svc) || '')) state.set(svc, 'Pulling');
    return `${svc} Pulling`;
  }
  m = /^([A-Za-z0-9_.-]+)\s+Pulled\b/.exec(clean);
  if (m) {
    state.set(m[1], 'Pulled');
    return `${m[1]} Pulled`;
  }
  return undefined;
}

// ── `docker compose pull` line parsing ───────────────────────────────────────
// We ALWAYS pull the prebuilt `:latest` ghcr.io/agentic-work images before
// `up -d`, and surface live status: which services are downloading vs already
// cached locally. A service is terminal once it is Pulled OR confirmed local.
type PullState = 'downloading' | 'pulled' | 'local';
/** A pull line is terminal once the image is fully pulled OR already local. */
const PULL_TERMINAL = new Set<PullState>(['pulled', 'local']);

/** A human label for the bar's "current" string, e.g. "api: downloading". */
function pullLabel(svc: string, st: PullState): string {
  switch (st) {
    case 'downloading': return `${svc}: downloading`;
    case 'pulled':      return `${svc}: pulled`;
    case 'local':       return `${svc}: already local`;
  }
}

/** Fold one `docker compose pull` line into the per-service pull-state map.
 *  Compose writes per-service status lines to stderr in shapes like:
 *    - "Pulling api ..."                          → downloading
 *    - "api Pulled"  /  "api Pull complete"       → pulled (terminal)
 *    - "api Already exists"                       → already local (terminal)
 *    - "api Skipped - Image is already being pulled by ..." → already local
 *    - "Image is up to date for ghcr.io/...:latest"         → already local
 *  Once a service is terminal we don't downgrade it back to downloading. */
function foldPullLine(line: string, state: Map<string, PullState>): string | undefined {
  const clean = line.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;

  const setIfNotTerminal = (svc: string, st: PullState): string => {
    const cur = state.get(svc);
    if (cur && PULL_TERMINAL.has(cur)) return pullLabel(svc, cur);
    state.set(svc, st);
    return pullLabel(svc, st);
  };

  // already-local terminals (check before "Pulling …" so "already being pulled" wins)
  let m = /^([A-Za-z0-9_.-]+)\s+(?:Already exists|Skipped\b.*already being pulled)/i.exec(clean);
  if (m) { state.set(m[1], 'local'); return pullLabel(m[1], 'local'); }
  // "Image is up to date for ghcr.io/agentic-work/<svc>…:latest"
  m = /Image is up to date for\s+\S*?\/([A-Za-z0-9_.-]+?)(?::[A-Za-z0-9_.-]+)?\s*$/i.exec(clean);
  if (m) { state.set(m[1], 'local'); return pullLabel(m[1], 'local'); }

  // pulled terminals: "<svc> Pulled" / "<svc> Pull complete"
  m = /^([A-Za-z0-9_.-]+)\s+(?:Pulled|Pull complete)\b/i.exec(clean);
  if (m) { state.set(m[1], 'pulled'); return pullLabel(m[1], 'pulled'); }

  // in-flight: "Pulling <svc> ..."
  m = /^Pulling\s+([A-Za-z0-9_.-]+)\b/i.exec(clean);
  if (m) return setIfNotTerminal(m[1], 'downloading');

  return undefined;
}

// ── post-boot verification: PROVE the model + chosen MCPs actually work ──────
// The api becoming "healthy" (a 200 on GET /api/health) only proves the api
// process + its DB are up — NOT that the chosen LLM model answers or that the
// selected MCPs are serving tools. Before we open the one-shot magic link (which
// auto-logs the user in), we PROVE both, so the user never lands on a stack that
// looks up but can't actually chat or call a tool.
//
//   * Model  — GET /api/health/comprehensive runs a REAL chat completion against
//              the configured model and reports checks.chat_model.healthy. PUBLIC
//              (no auth) — registered at prefix /api with no auth preHandler.
//   * MCPs   — GET /api/admin/mcp-tools/status proxies the live mcp-proxy and
//              returns { byServer: { <server>: [tools…] }, totalTools }. This is
//              the REAL running fleet (the comprehensive check's mcp_orchestrator
//              block is count-only and unwired in the default install, so it can't
//              prove the *chosen* MCPs serve tools). This route is admin-guarded,
//              so we first mint a JWT via POST /api/auth/local/login using the
//              seeded admin creds. We deliberately do NOT call /api/auth/magic —
//              that one-shot token must stay valid for the browser auto-login.

/** Servers in the running fleet are keyed `openagentic_<id>` (e.g. openagentic_web)
 *  while the wizard tracks short ids (web/aws/…). Match either form. */
function fleetHasMcp(id: string, byServer: Record<string, unknown[]>): boolean {
  const candidates = [id, `openagentic_${id}`];
  for (const [server, tools] of Object.entries(byServer)) {
    const tcount = Array.isArray(tools) ? tools.length : 0;
    if (tcount > 0 && candidates.includes(server)) return true;
  }
  return false;
}

/** MCPs that serve tools out-of-the-box with NO user-supplied credentials. These
 *  MUST come up — if a no-auth MCP the user chose isn't serving tools, the stack
 *  is genuinely broken. Cred-gated MCPs (aws/azure/gcp/github/kubernetes) only
 *  spawn when the user actually provided creds, so a missing one there is a
 *  config choice (skip-and-configure-later), not a broken stack → warn, not fail. */
const NO_AUTH_MCPS = new Set(['web', 'admin', 'prometheus', 'loki']);

/** Mint a short-lived admin JWT via local login. Returns undefined (with a hint
 *  surfaced via onHealth) if login is unavailable — the MCP gate then degrades to
 *  the public comprehensive-health signal rather than blocking the whole install
 *  on an auth hiccup. */
async function loginAdminToken(
  base: string,
  cfg: WizardConfig,
  hooks: BackendHooks,
): Promise<string | undefined> {
  const email = cfg.admin.email || 'admin@openagentic.local';
  const password = cfg.admin.password;
  if (!password) return undefined;
  try {
    const res = await fetch(`${base}/api/auth/local/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    });
    if (!res.ok) {
      hooks.onHealth?.(`admin login returned ${res.status} — MCP check will use public health only`);
      return undefined;
    }
    const data = (await res.json()) as { token?: string };
    return data.token;
  } catch {
    return undefined;
  }
}

/**
 * Block until the chosen MODEL responds AND the chosen MCPs serve tools, or throw
 * a clear, actionable error. `base` is the origin that fronts the api (the UI
 * nginx proxies /api/* to the api), e.g. http://localhost:8080 or https://<host>.
 * `logsHint` tailors the error to the backend (docker logs vs kubectl logs).
 * Bounded: ~3 min, polled every ~9s — never hangs.
 */
export async function verifyStackReady(
  base: string,
  cfg: WizardConfig,
  hooks: BackendHooks,
  logsHint: { ollama: string; mcpProxy: string },
): Promise<void> {
  const DEADLINE = Date.now() + 3 * 60_000;
  const INTERVAL = 9_000;

  // Chosen MCPs we treat as MUST-serve (no creds needed to spawn).
  const requiredMcps = cfg.mcps.filter((m) => NO_AUTH_MCPS.has(m));
  const optionalMcps = cfg.mcps.filter((m) => !NO_AUTH_MCPS.has(m));

  let modelOk = false;
  let mcpsOk = false;
  let lastModelErr = '';
  let lastMcpErr = '';

  // ── 1. MODEL — real completion via comprehensive health (public) ───────────
  hooks.onHealth?.('verifying model responds…');
  while (Date.now() < DEADLINE && !modelOk) {
    try {
      const res = await fetch(`${base}/api/health/comprehensive`);
      // 503 still carries the checks body — read it either way.
      const body = (await res.json().catch(() => null)) as
        | { checks?: { chat_model?: { healthy?: boolean; details?: { model?: string; response_time?: unknown; error?: string } } } }
        | null;
      const cm = body?.checks?.chat_model;
      if (cm?.healthy) {
        const name = cm.details?.model ? `${cm.details.model}` : 'configured model';
        const ms = cm.details?.response_time != null ? ` (${cm.details.response_time}ms)` : '';
        hooks.onHealth?.(`✓ model responds: ${name}${ms}`);
        modelOk = true;
        break;
      }
      lastModelErr = cm?.details?.error || 'model health check not yet healthy';
      hooks.onHealth?.(`waiting for model… (${lastModelErr})`);
    } catch (e) {
      lastModelErr = e instanceof Error ? e.message : String(e);
      hooks.onHealth?.(`waiting for model… (${lastModelErr})`);
    }
    if (Date.now() < DEADLINE) await new Promise((r) => setTimeout(r, INTERVAL));
  }
  if (!modelOk) {
    throw new Error(
      `chosen model did not respond within 3 minutes — last error: ${lastModelErr}. ` +
      `Check: ${logsHint.ollama}`,
    );
  }

  // ── 2. MCPs — real fleet via /api/admin/mcp-tools/status (admin-guarded) ────
  // Skip cleanly if the user enabled zero MCPs.
  if (cfg.mcps.length === 0) {
    hooks.onHealth?.('no MCPs selected — skipping MCP verification');
    return;
  }
  hooks.onHealth?.('verifying MCPs serve tools…');
  const token = await loginAdminToken(base, cfg, hooks);
  while (Date.now() < DEADLINE && !mcpsOk) {
    try {
      const res = await fetch(`${base}/api/admin/mcp-tools/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { totalTools?: number; servers?: number; byServer?: Record<string, unknown[]> }
          | null;
        const byServer = body?.byServer ?? {};
        const totalTools = body?.totalTools ?? 0;
        const serverCount = body?.servers ?? Object.keys(byServer).length;
        // Required MCPs (no creds needed) MUST be present with tools.
        const missingRequired = requiredMcps.filter((m) => !fleetHasMcp(m, byServer));
        if (totalTools > 0 && missingRequired.length === 0) {
          const missingOptional = optionalMcps.filter((m) => !fleetHasMcp(m, byServer));
          hooks.onHealth?.(`✓ ${serverCount} MCPs · ${totalTools} tools`);
          if (missingOptional.length > 0) {
            // Not fatal — these need creds the user may have skipped.
            hooks.onHealth?.(
              `note: ${missingOptional.join(', ')} not serving tools yet ` +
              `(needs credentials — configure later or check ${logsHint.mcpProxy})`,
            );
          }
          mcpsOk = true;
          break;
        }
        lastMcpErr = missingRequired.length
          ? `missing: ${missingRequired.join(', ')}`
          : 'no tools served yet';
        hooks.onHealth?.(`waiting for MCPs… (${lastMcpErr})`);
      } else {
        lastMcpErr = `mcp-tools/status returned ${res.status}`;
        hooks.onHealth?.(`waiting for MCPs… (${lastMcpErr})`);
      }
    } catch (e) {
      lastMcpErr = e instanceof Error ? e.message : String(e);
      hooks.onHealth?.(`waiting for MCPs… (${lastMcpErr})`);
    }
    if (Date.now() < DEADLINE) await new Promise((r) => setTimeout(r, INTERVAL));
  }
  if (!mcpsOk) {
    const which = requiredMcps.length ? `required MCP(s) [${requiredMcps.join(', ')}]` : 'MCPs';
    throw new Error(
      `${which} are not serving tools within 3 minutes — last error: ${lastMcpErr}. ` +
      `Check: ${logsHint.mcpProxy}`,
    );
  }
}

export async function launchDocker(cfg: WizardConfig, hooks: BackendHooks): Promise<string> {
  // Compose profiles are OPT-IN. We start ONLY the profiles the user's choices
  // imply — nothing is force-started:
  //   - `ollama`: the bundled Ollama + its model-pull init. Started ONLY when
  //     the user explicitly chose an Ollama-backed strategy AND points at the
  //     bundled container (not a remote/host Ollama they already run). The api
  //     boots fine with NO Ollama, so a non-Ollama choice never starts it.
  //   - `milvus`: the heavyweight vector trio (etcd + minio + milvus). The api
  //     defaults to pgvector-only and boots healthy without it, so the wizard
  //     leaves Milvus OFF (a large-RAG operator enables it via .env + profile).
  //   - `monitoring`: the in-stack observability backends (prometheus + loki +
  //     promtail + otel-collector). Started ONLY when the user picked the
  //     prometheus or loki MCP — those MCPs install their bundled backend, so
  //     the profile must be up. Composes with `ollama` (both profiles passed).
  const wantsOllama =
    cfg.llmStrategy === 'ollama' &&
    isBundledOllama(cfg.ollama?.host);
  const wantsMonitoring =
    cfg.mcps.includes('prometheus') || cfg.mcps.includes('loki');
  const profileArgs = [
    ...(wantsOllama ? ['--profile', 'ollama'] : []),
    ...(wantsMonitoring ? ['--profile', 'monitoring'] : []),
  ];

  const desc = profileArgs.length
    ? `docker compose ${profileArgs.join(' ')}`
    : 'docker compose';

  // Determine the service count up front so both bars have a real denominator; if
  // `config --services` failed we fall back to the count of distinct services
  // observed in the streamed lines (total grows as new services appear).
  const knownServices = await composeServices(profileArgs);
  const totalFloor = knownServices.length;

  // ── PULL: always fetch the prebuilt :latest ghcr.io/agentic-work images ──────
  // The end-user install is PULL-ONLY — the wizard NEVER builds. We stream the
  // pull so the UI can show which images are downloading vs already cached.
  hooks.onBuild?.(`${desc} pull — fetching prebuilt :latest images from ghcr.io/agentic-work`);
  const pullState = new Map<string, PullState>();
  const reportPull = (current?: string) => {
    let done = 0;
    for (const s of pullState.values()) if (PULL_TERMINAL.has(s)) done++;
    const total = Math.max(totalFloor, pullState.size);
    hooks.onBuildProgress?.({ done, total, current });
  };
  const pullChild = execa('docker', ['compose', ...profileArgs, 'pull'], {
    cwd: REPO_ROOT,
    all: true,
    buffer: false,
  });
  if (pullChild.all) {
    let pbuf = '';
    pullChild.all.on('data', (chunk: Buffer) => {
      pbuf += chunk.toString();
      const lines = pbuf.split('\n');
      pbuf = lines.pop() ?? '';
      for (const line of lines) {
        const current = foldPullLine(line, pullState);
        if (current !== undefined) reportPull(current);
      }
    });
  }
  await pullChild;
  // Final settle — anything compose pulls for is terminal by now.
  for (const svc of knownServices) {
    if (!pullState.has(svc)) pullState.set(svc, 'local');
  }
  reportPull();
  hooks.onBuildDone?.();

  hooks.onStart?.(`${desc} up -d`);
  const seenState = new Map<string, string>();

  const reportProgress = (current?: string) => {
    let done = 0;
    for (const s of seenState.values()) if (TERMINAL.has(s)) done++;
    const total = Math.max(totalFloor, seenState.size);
    hooks.onStartProgress?.({ done, total, current });
  };

  // Stream stdout+stderr — compose writes pull/create/start progress to stderr.
  const child = execa('docker', ['compose', ...profileArgs, 'up', '-d'], {
    cwd: REPO_ROOT,
    all: true,
    buffer: false,
  });
  if (child.all) {
    let buf = '';
    child.all.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const current = foldProgressLine(line, seenState);
        if (current !== undefined) reportProgress(current);
      }
    });
  }
  await child;
  // Final settle — count everything compose created as done.
  for (const svc of knownServices) {
    if (!seenState.has(svc)) seenState.set(svc, 'Started');
  }
  reportProgress();
  hooks.onStartDone?.();

  const url = `http://localhost:${cfg.uiPort}`;
  hooks.onHealth?.(`waiting for ${url}/api/health`);
  const started = Date.now();
  // Poll up to 10 minutes for the API to be healthy. This matches the api
  // container's HEALTHCHECK start-period (600s): a first install pulls every
  // MCP server + runs full tool indexing + the bootstrap-provider seed, so
  // first boot is ~4-7 min. A shorter poll would falsely error out mid-boot.
  while (Date.now() - started < 10 * 60_000) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        // api is up — now PROVE the chosen model + MCPs actually work before we
        // hand back the url (the caller opens the auto-login magic link next).
        await verifyStackReady(url, cfg, hooks, {
          ollama: "docker compose logs ollama   (or 'docker logs openagentic-ollama-1')",
          mcpProxy: "docker compose logs mcp-proxy   (or 'docker logs openagentic-mcp-proxy-1')",
        });
        hooks.onHealthDone?.();
        return url;
      }
    } catch (err) {
      // A thrown verifyStackReady error means the api is up but the model/MCPs
      // are broken — surface it immediately rather than silently re-polling
      // (which would just burn the deadline and never recover).
      if (err instanceof Error && /did not respond|not serving tools/.test(err.message)) {
        throw err;
      }
      /* api not ready yet — keep polling */
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`API did not become healthy within 10 minutes. Run 'docker compose logs api' to investigate.`);
}
