/**
 * Entrypoint helper: verify the baked openagentic plugin + skills seed
 * is intact BEFORE the openagentic daemon spawns.
 *
 * Invoked from docker-entrypoint.sh as:
 *   node /app/dist/entrypoints/verifyPluginSeed.js
 *
 * Behavior (Stage A of task #359):
 *   - If $OPENAGENTIC_PLUGIN_SEED_DIR is unset, print warning and exit 0
 *     (backward-compat for older images not yet seeded).
 *   - Otherwise, assert the seed is structurally valid:
 *       1. $OPENAGENTIC_PLUGIN_SEED_DIR exists + is a directory
 *       2. $OPENAGENTIC_PLUGIN_SEED_DIR/known_marketplaces.json exists + parses
 *       3. $OPENAGENTIC_PLUGIN_SEED_DIR/marketplaces/claude-plugins-official exists + non-empty
 *       4. $OPENAGENTIC_PLUGIN_SEED_DIR/skills exists + non-empty
 *       5. $OPENAGENTIC_CONFIG_DIR/skills resolves (through symlink) to a
 *          non-empty directory — this is what the child openagentic process
 *          sees as the skills library at runtime.
 *     All checks run (we accumulate failures so operators see every broken
 *     invariant in one boot log). Any failure → exit 1 so kubelet restarts
 *     the pod and boot-events surfaces it.
 *
 * Rationale: the Dockerfile git-clones anthropics/claude-plugins-official
 * and anthropics/skills at build time. A bad build, a rogue volume mount,
 * or a stale multi-arch layer can silently strip either — the child
 * openagentic's `installPluginsForHeadless()` then "works" without plugins
 * or skills. This probe makes that failure loud at pod boot.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface SeedVerificationOptions {
  env: NodeJS.ProcessEnv;
  exitFn: (code: number) => void;
  logFn: (msg: string) => void;
  statFn?: (p: string) => Promise<{ isDirectory: () => boolean }>;
  readFileFn?: (p: string, enc: 'utf8') => Promise<string>;
  readdirFn?: (p: string) => Promise<string[]>;
}

interface SeedCheck {
  name: string;
  run: () => Promise<void>;
}

export async function runSeedVerification(
  opts: SeedVerificationOptions,
): Promise<void> {
  const {
    env,
    exitFn,
    logFn,
    statFn = async (p: string) => fs.stat(p),
    readFileFn = async (p: string, enc: 'utf8') => fs.readFile(p, enc),
    readdirFn = async (p: string) => fs.readdir(p),
  } = opts;

  const seedDir = env.OPENAGENTIC_PLUGIN_SEED_DIR;
  if (!seedDir) {
    logFn(
      '[plugin-seed] WARNING: OPENAGENTIC_PLUGIN_SEED_DIR not set — skipping plugin seed verification (legacy image).',
    );
    exitFn(0);
    return;
  }

  const configDir = env.OPENAGENTIC_CONFIG_DIR || '/root/.openagentic';

  const checks: SeedCheck[] = [
    {
      name: 'seed directory is a directory',
      run: async () => {
        const s = await statFn(seedDir);
        if (!s.isDirectory()) {
          throw new Error(`${seedDir} is not a directory`);
        }
      },
    },
    {
      name: 'known_marketplaces.json present and valid JSON',
      run: async () => {
        const p = join(seedDir, 'known_marketplaces.json');
        const raw = await readFileFn(p, 'utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          throw new Error(`${p} is not valid JSON: ${detail}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`${p} does not parse to an object`);
        }
        if (Object.keys(parsed as Record<string, unknown>).length === 0) {
          throw new Error(`${p} has zero declared marketplaces`);
        }
      },
    },
    {
      name: 'claude-plugins-official marketplace cloned',
      run: async () => {
        const p = join(seedDir, 'marketplaces', 'claude-plugins-official');
        const s = await statFn(p);
        if (!s.isDirectory()) {
          throw new Error(`${p} exists but is not a directory`);
        }
        const entries = await readdirFn(p);
        if (entries.length === 0) {
          throw new Error(`${p} is empty (git clone produced no files)`);
        }
      },
    },
    {
      name: 'skills library cloned',
      run: async () => {
        const p = join(seedDir, 'skills');
        const s = await statFn(p);
        if (!s.isDirectory()) {
          throw new Error(`${p} exists but is not a directory`);
        }
        const entries = await readdirFn(p);
        if (entries.length === 0) {
          throw new Error(`${p} is empty (git clone produced no files)`);
        }
      },
    },
    {
      name: 'config-dir skills symlink resolves',
      run: async () => {
        const p = join(configDir, 'skills');
        // Follow the symlink — stat() resolves through it. A dangling link
        // throws ENOENT which propagates as a check failure.
        const s = await statFn(p);
        if (!s.isDirectory()) {
          throw new Error(`${p} does not resolve to a directory`);
        }
        const entries = await readdirFn(p);
        if (entries.length === 0) {
          throw new Error(`${p} resolves but is empty`);
        }
      },
    },
  ];

  const failures: string[] = [];
  for (const c of checks) {
    try {
      await c.run();
      logFn(`[plugin-seed]   PASS  ${c.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logFn(`[plugin-seed]   FAIL  ${c.name}: ${msg}`);
      failures.push(`${c.name}: ${msg}`);
    }
  }

  if (failures.length > 0) {
    logFn(
      `[plugin-seed] ERROR: ${failures.length} seed check(s) failed — failing pod boot so kubelet surfaces it`,
    );
    logFn(`[plugin-seed] OPENAGENTIC_PLUGIN_SEED_DIR=${seedDir}`);
    logFn(`[plugin-seed] OPENAGENTIC_CONFIG_DIR=${configDir}`);
    exitFn(1);
    return;
  }

  logFn(
    `[plugin-seed] OK: all ${checks.length} seed checks passed (seed=${seedDir}, config=${configDir})`,
  );
}

// Direct entrypoint when invoked as `node verifyPluginSeed.js`.
// Only runs when the file is the main module — avoids firing during tests.
if (require.main === module) {
  void runSeedVerification({
    env: process.env,
    exitFn: (code) => process.exit(code),
    logFn: (msg) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    },
  });
}
