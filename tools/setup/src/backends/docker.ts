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

export interface BackendHooks {
  onBuild?: (msg: string) => void;
  onBuildDone?: () => void;
  onStart?: (msg: string) => void;
  onStartDone?: () => void;
  onHealth?: (msg: string) => void;
  onHealthDone?: () => void;
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
  const wantsOllama =
    (cfg.llmStrategy === 'ollama' || cfg.llmStrategy === 'both') &&
    isBundledOllama(cfg.ollama?.host);
  const profileArgs = wantsOllama ? ['--profile', 'ollama'] : [];

  const desc = wantsOllama ? 'docker compose --profile ollama' : 'docker compose';
  hooks.onBuild?.(`${desc} build (first run may take several minutes)`);
  await execa('docker', ['compose', ...profileArgs, 'build'], { cwd: REPO_ROOT });
  hooks.onBuildDone?.();

  hooks.onStart?.(`${desc} up -d`);
  await execa('docker', ['compose', ...profileArgs, 'up', '-d'], { cwd: REPO_ROOT });
  hooks.onStartDone?.();

  const url = `http://localhost:${cfg.uiPort}`;
  hooks.onHealth?.(`waiting for ${url}/api/health`);
  const started = Date.now();
  // Poll up to 10 minutes for the API to be healthy. This matches the api
  // container's HEALTHCHECK start-period (600s): a first "Both" install pulls
  // every MCP server + runs full tool indexing + the secondary-provider seed,
  // so first boot is ~4-7 min. A shorter poll would falsely error out mid-boot.
  while (Date.now() - started < 10 * 60_000) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        hooks.onHealthDone?.();
        return url;
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`API did not become healthy within 10 minutes. Run 'docker compose logs api' to investigate.`);
}
