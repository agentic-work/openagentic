import { execa } from 'execa';
import { REPO_ROOT } from '../lib/paths.ts';
import type { WizardConfig } from '../lib/types.ts';

export interface BackendHooks {
  onBuild?: (msg: string) => void;
  onBuildDone?: () => void;
  onStart?: (msg: string) => void;
  onStartDone?: () => void;
  onHealth?: (msg: string) => void;
  onHealthDone?: () => void;
}

export async function launchDocker(cfg: WizardConfig, hooks: BackendHooks): Promise<string> {
  // Milvus is mandatory — the api exits on boot without a reachable vector store
  // (see server.ts + commit 6a375998c). The `milvus` compose profile starts
  // etcd + minio + milvus alongside the core stack; install.sh uses the same
  // profile on both its paths. A bare `up` would crash the api at boot.
  hooks.onBuild?.('docker compose --profile milvus build (first run may take several minutes)');
  await execa('docker', ['compose', '--profile', 'milvus', 'build'], { cwd: REPO_ROOT });
  hooks.onBuildDone?.();

  hooks.onStart?.('docker compose --profile milvus up -d');
  await execa('docker', ['compose', '--profile', 'milvus', 'up', '-d'], { cwd: REPO_ROOT });
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
