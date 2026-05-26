/**
 * internalKeyReader (code-manager) — hot-reloads `OPENAGENTIC_INTERNAL_KEY`
 * from the projected Secret mount at INTERNAL_KEY_FILE_PATH (default
 * `/var/run/secrets/openagentic/internal-key`).
 *
 * Architecture (#416): Vault → ESO → k8s Secret → projected volume.
 * Each WS handshake reads fresh; rotation propagates in ~60-90s without
 * pod restarts. Falls back to legacy env vars for back-compat.
 */

import { readFileSync, statSync } from 'node:fs';

const DEFAULT_PATH = '/var/run/secrets/openagentic/internal-key';

interface CacheEntry {
  value: string;
  mtimeMs: number;
}

let cache: CacheEntry | null = null;

function envFallback(): string {
  return process.env.INTERNAL_API_KEY
    || process.env.OPENAGENTIC_INTERNAL_KEY
    || process.env.CODE_MANAGER_INTERNAL_KEY
    || '';
}

function filePath(): string {
  return process.env.INTERNAL_KEY_FILE_PATH || DEFAULT_PATH;
}

export function getInternalKey(): string {
  const p = filePath();
  try {
    const st = statSync(p);
    if (cache && cache.mtimeMs === st.mtimeMs) {
      return cache.value;
    }
    const value = readFileSync(p, 'utf8').trim();
    cache = { value, mtimeMs: st.mtimeMs };
    return value;
  } catch {
    return envFallback();
  }
}

export function invalidateInternalKeyCache(): void {
  cache = null;
}
