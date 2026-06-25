import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
// The install dir — where the compose bundle, .env, .env.example and
// docker-compose.yml live. install.sh exports OPENAGENTIC_HOME=$INSTALL_DIR before
// launching the wizard, because under `npx` the module lives in the ~/.npm/_npx
// cache (NOT the install dir) — resolving paths relative to the module there reads/
// writes the wrong place (the bug that left .env without its secrets). Fall back to
// the dev-checkout repo root (4 levels up from src/lib) for a bare `npm start`.
export const REPO_ROOT = process.env.OPENAGENTIC_HOME
  ? path.resolve(process.env.OPENAGENTIC_HOME)
  : path.resolve(here, '..', '..', '..', '..');
export const ENV_FILE = path.join(REPO_ROOT, '.env');
export const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
export const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.yml');
export const HELM_CHART = path.join(REPO_ROOT, 'helm', 'openagentic');
