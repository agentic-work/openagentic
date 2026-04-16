import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
export const ENV_FILE = path.join(REPO_ROOT, '.env');
export const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
export const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.yml');
export const HELM_CHART = path.join(REPO_ROOT, 'helm', 'openagentic');
