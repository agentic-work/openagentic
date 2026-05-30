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
  hooks.onBuild?.('docker compose build (first run may take several minutes)');
  await execa('docker', ['compose', 'build'], { cwd: REPO_ROOT });
  hooks.onBuildDone?.();

  hooks.onStart?.('docker compose up -d');
  await execa('docker', ['compose', 'up', '-d'], { cwd: REPO_ROOT });
  hooks.onStartDone?.();

  const url = `http://localhost:${cfg.uiPort}`;
  hooks.onHealth?.(`waiting for ${url}/api/health`);
  const started = Date.now();
  // Poll up to 5 minutes for the API to be healthy.
  while (Date.now() - started < 5 * 60_000) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        hooks.onHealthDone?.();
        return url;
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`API did not become healthy within 5 minutes. Run 'docker compose logs api' to investigate.`);
}
