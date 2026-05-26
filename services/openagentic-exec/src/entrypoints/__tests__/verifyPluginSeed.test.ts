/**
 * Tests for the entrypoint plugin-seed verification step (Stage A, task #359).
 *
 * The function is invoked from docker-entrypoint.sh via
 *   node /app/dist/entrypoints/verifyPluginSeed.js
 * and owns its own exit semantics. To keep this unit test deterministic, the
 * main function accepts injectable exitFn + stat/read/readdir fakes.
 */

import { describe, it, expect, vi } from 'vitest';
import { runSeedVerification } from '../verifyPluginSeed.js';

type StatFake = { isDirectory: () => boolean; isSymbolicLink?: () => boolean };

function mkStat(isDir = true): StatFake {
  return { isDirectory: () => isDir, isSymbolicLink: () => false };
}

/**
 * Build a filesystem that mirrors the baked layout produced by the Dockerfile:
 *   /opt/openagentic-seed/known_marketplaces.json
 *   /opt/openagentic-seed/marketplaces/claude-plugins-official/<entries>
 *   /opt/openagentic-seed/skills/<entries>
 *   /root/.openagentic/skills → /opt/openagentic-seed/skills  (symlink)
 */
function makeGoodFs() {
  const SEED = '/opt/openagentic-seed';
  const CFG = '/root/.openagentic';
  const validMarketplaces = JSON.stringify({
    'claude-plugins-official': {
      source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
      installLocation: `${SEED}/marketplaces/claude-plugins-official`,
      lastUpdated: '2026-04-23T00:00:00.000Z',
      autoUpdate: false,
    },
  });

  const dirs: Record<string, boolean> = {
    [SEED]: true,
    [`${SEED}/marketplaces`]: true,
    [`${SEED}/marketplaces/claude-plugins-official`]: true,
    [`${SEED}/skills`]: true,
    [`${CFG}`]: true,
    [`${CFG}/skills`]: true, // symlink follow resolves to SEED/skills
  };

  const listings: Record<string, string[]> = {
    [`${SEED}/marketplaces/claude-plugins-official`]: ['plugin-a', 'plugin-b', '.marketplace.json'],
    [`${SEED}/skills`]: ['skill-a', 'skill-b'],
    [`${CFG}/skills`]: ['skill-a', 'skill-b'],
  };

  const files: Record<string, string> = {
    [`${SEED}/known_marketplaces.json`]: validMarketplaces,
  };

  const statFn = vi.fn(async (p: string): Promise<StatFake> => {
    if (!(p in dirs)) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }
    return mkStat(dirs[p]);
  });

  const readFileFn = vi.fn(async (p: string, _enc: 'utf8'): Promise<string> => {
    if (!(p in files)) {
      const err: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
      err.code = 'ENOENT';
      throw err;
    }
    return files[p];
  });

  const readdirFn = vi.fn(async (p: string): Promise<string[]> => {
    if (!(p in listings)) return [];
    return listings[p];
  });

  return { statFn, readFileFn, readdirFn, dirs, listings, files, SEED, CFG };
}

describe('runSeedVerification (task #359 Stage A boot-seed probe)', () => {
  it('happy path: all five seed invariants hold → does not call exitFn with non-zero', async () => {
    const fs = makeGoodFs();
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    // Success path calls exitFn(0) at most, never 1
    const calls = exitFn.mock.calls;
    for (const call of calls) {
      expect(call[0]).not.toBe(1);
    }
    // Log should include an OK marker
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    expect(logs).toMatch(/OK:.*seed checks passed/);
  });

  it('OPENAGENTIC_PLUGIN_SEED_DIR unset → warns and exits 0 (legacy image compat)', async () => {
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: {},
      exitFn,
      logFn,
    });

    expect(exitFn).toHaveBeenCalledWith(0);
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    expect(logs).toMatch(/WARNING.*not set/);
  });

  it('seed dir missing → exit 1', async () => {
    const fs = makeGoodFs();
    // Break: seed dir itself doesn't exist
    delete fs.dirs['/opt/openagentic-seed'];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('known_marketplaces.json missing → exit 1', async () => {
    const fs = makeGoodFs();
    delete fs.files['/opt/openagentic-seed/known_marketplaces.json'];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    expect(logs).toMatch(/known_marketplaces\.json/);
  });

  it('known_marketplaces.json malformed JSON → exit 1', async () => {
    const fs = makeGoodFs();
    fs.files['/opt/openagentic-seed/known_marketplaces.json'] = '{ not json';
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('known_marketplaces.json empty object → exit 1', async () => {
    const fs = makeGoodFs();
    fs.files['/opt/openagentic-seed/known_marketplaces.json'] = '{}';
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('claude-plugins-official marketplace dir missing → exit 1', async () => {
    const fs = makeGoodFs();
    delete fs.dirs['/opt/openagentic-seed/marketplaces/claude-plugins-official'];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    expect(logs).toMatch(/claude-plugins-official/);
  });

  it('claude-plugins-official marketplace dir empty (bad clone) → exit 1', async () => {
    const fs = makeGoodFs();
    fs.listings['/opt/openagentic-seed/marketplaces/claude-plugins-official'] = [];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('skills dir missing → exit 1', async () => {
    const fs = makeGoodFs();
    delete fs.dirs['/opt/openagentic-seed/skills'];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    expect(logs).toMatch(/skills/);
  });

  it('skills dir empty (bad clone) → exit 1', async () => {
    const fs = makeGoodFs();
    fs.listings['/opt/openagentic-seed/skills'] = [];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('config-dir skills symlink dangling (stat throws ENOENT) → exit 1', async () => {
    const fs = makeGoodFs();
    // Simulate dangling symlink: /root/.openagentic/skills statFn rejects.
    delete fs.dirs['/root/.openagentic/skills'];
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it('OPENAGENTIC_CONFIG_DIR unset → falls back to /root/.openagentic', async () => {
    const fs = makeGoodFs();
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED }, // no CONFIG_DIR
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    // Success (fallback path uses /root/.openagentic which is in makeGoodFs())
    const calls = exitFn.mock.calls;
    for (const call of calls) {
      expect(call[0]).not.toBe(1);
    }
  });

  it('reports ALL failures, not just the first, before exiting', async () => {
    const fs = makeGoodFs();
    // Break TWO things: skills dir empty + marketplaces json invalid
    fs.listings['/opt/openagentic-seed/skills'] = [];
    fs.files['/opt/openagentic-seed/known_marketplaces.json'] = 'not json';
    const exitFn = vi.fn();
    const logFn = vi.fn();

    await runSeedVerification({
      env: { OPENAGENTIC_PLUGIN_SEED_DIR: fs.SEED, OPENAGENTIC_CONFIG_DIR: fs.CFG },
      exitFn,
      logFn,
      statFn: fs.statFn,
      readFileFn: fs.readFileFn,
      readdirFn: fs.readdirFn,
    });

    expect(exitFn).toHaveBeenCalledWith(1);
    const logs = logFn.mock.calls.map((c) => c[0] as string).join('\n');
    // Both failures should appear in the output
    expect(logs).toMatch(/known_marketplaces/);
    expect(logs).toMatch(/skills/);
    expect(logs).toMatch(/2 seed check\(s\) failed/);
  });
});
