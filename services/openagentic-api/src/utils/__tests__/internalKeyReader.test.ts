import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getInternalKey,
  invalidateInternalKeyCache,
  _testSetInternalKey,
} from '../internalKeyReader.js';

describe('internalKeyReader', () => {
  let dir: string;
  let file: string;
  const origPath = process.env.INTERNAL_KEY_FILE_PATH;
  const origEnv = process.env.CODE_MANAGER_INTERNAL_KEY;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ikey-'));
    file = path.join(dir, 'internal-key');
    process.env.INTERNAL_KEY_FILE_PATH = file;
    delete process.env.CODE_MANAGER_INTERNAL_KEY;
    invalidateInternalKeyCache();
    _testSetInternalKey(null);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.INTERNAL_KEY_FILE_PATH = origPath;
    process.env.CODE_MANAGER_INTERNAL_KEY = origEnv;
    invalidateInternalKeyCache();
  });

  it('reads the key from the mounted file', () => {
    writeFileSync(file, 'sekret-v1');
    expect(getInternalKey()).toBe('sekret-v1');
  });

  it('strips trailing whitespace from the file contents', () => {
    writeFileSync(file, 'sekret-v1\n');
    expect(getInternalKey()).toBe('sekret-v1');
  });

  it('falls back to CODE_MANAGER_INTERNAL_KEY env when the file is missing', () => {
    process.env.CODE_MANAGER_INTERNAL_KEY = 'fallback-from-env';
    expect(getInternalKey()).toBe('fallback-from-env');
  });

  it('returns an empty string when neither file nor env is set', () => {
    expect(getInternalKey()).toBe('');
  });

  it('hot-reloads when the file mtime changes (rotation case)', () => {
    writeFileSync(file, 'sekret-v1');
    expect(getInternalKey()).toBe('sekret-v1');
    // Simulate ESO updating the mounted file: new contents + bumped mtime.
    writeFileSync(file, 'sekret-v2');
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    expect(getInternalKey()).toBe('sekret-v2');
  });

  it('caches the value when mtime is unchanged (no extra reads)', () => {
    writeFileSync(file, 'sekret-v1');
    const fixedAt = new Date(Date.now() - 60_000);
    utimesSync(file, fixedAt, fixedAt);
    expect(getInternalKey()).toBe('sekret-v1');
    // Even if we change the contents WITHOUT touching mtime, the cache
    // should hold (kubelet always bumps mtime, so this matches reality).
    writeFileSync(file, 'sekret-v2');
    utimesSync(file, fixedAt, fixedAt);
    expect(getInternalKey()).toBe('sekret-v1');
  });
});
