import type { WizardConfig } from '../lib/types.ts';
import type { BackendHooks } from './docker.ts';

export async function launchHelm(_cfg: WizardConfig, _hooks: BackendHooks): Promise<string> {
  throw new Error(
    'Helm deploy is not wired up yet — the chart at helm/openagentic needs a cleanup pass before the wizard can drive it. Use the Docker path for now.'
  );
}
