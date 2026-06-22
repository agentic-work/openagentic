/**
 * internalKeyReader — single source of truth for the
 * OPENAGENTIC_INTERNAL_KEY value.
 *
 * Reads from a projected Secret file at INTERNAL_KEY_FILE_PATH (default
 * `/var/run/secrets/openagentic/internal-key`). When the file mtime
 * changes the cache invalidates and the next call re-reads from disk —
 * no process restart required for rotation. Falls back to the legacy
 * env var when the file is missing so chart upgrades that haven't yet
 * mounted the projected volume keep working.
 *
 * Architecture (#416): Vault holds the canonical value; ESO syncs Vault
 * to a k8s Secret; the Secret is mounted as a projected volume into the
 * api pod template. When Vault rotates, ESO updates the Secret, kubelet
 * refreshes the mounted file in ~60-90s, and every consumer picks up the
 * new value on its next handshake without a single pod restart.
 */

import { readFileSync, statSync } from 'node:fs';

const DEFAULT_PATH = '/var/run/secrets/openagentic/internal-key';

interface CacheEntry {
  value: string;
  mtimeMs: number;
}

let cache: CacheEntry | null = null;

function envFallback(): string {
  return process.env.OPENAGENTIC_INTERNAL_KEY
    || process.env.INTERNAL_API_KEY
    || '';
}

function filePath(): string {
  return process.env.INTERNAL_KEY_FILE_PATH || DEFAULT_PATH;
}

/**
 * Returns the current internal key. Hot-reloads from the mounted file
 * when mtime changes. Tracks no global state across processes — this is
 * a per-process cache that costs one stat() call per invocation.
 */
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

/**
 * Force a re-read on the next call. Test hook + admin "force-rotate".
 */
export function invalidateInternalKeyCache(): void {
  cache = null;
}

/**
 * Test-only seam — overrides both file read and env.
 */
export function _testSetInternalKey(value: string | null): void {
  if (value === null) {
    cache = null;
  } else {
    cache = { value, mtimeMs: Date.now() };
  }
}
