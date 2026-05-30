/**
 * internalKeyReader — single source of truth for the internal
 * service-to-service key.
 *
 * Mirrors the api's internalKeyReader (#416). Reads from a projected
 * Secret file at INTERNAL_KEY_FILE_PATH (default
 * `/var/run/secrets/openagentic/internal-key`). When the file mtime
 * changes the cache invalidates and the next call re-reads from disk —
 * no process restart required for rotation. Falls back to env vars
 * (CODE_MANAGER_INTERNAL_KEY → OPENAGENTIC_INTERNAL_KEY → INTERNAL_API_KEY)
 * when the file is missing so chart upgrades that haven't yet mounted
 * the projected volume keep working.
 */

import { readFileSync, statSync } from 'node:fs';

const DEFAULT_PATH = '/var/run/secrets/openagentic/internal-key';

interface CacheEntry {
  value: string;
  mtimeMs: number;
}

let cache: CacheEntry | null = null;

function envFallback(): string {
  return process.env.CODE_MANAGER_INTERNAL_KEY
    || process.env.OPENAGENTIC_INTERNAL_KEY
    || process.env.INTERNAL_API_KEY
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

export function _testSetInternalKey(value: string | null): void {
  if (value === null) {
    cache = null;
  } else {
    cache = { value, mtimeMs: Date.now() };
  }
}
