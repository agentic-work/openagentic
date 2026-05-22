/**
 * #531 — Built-in agent markdown files MUST ship into the docker image's
 * `dist/agents/built-in/` directory.
 *
 * Bug caught live 2026-04-29 21:28 UTC against api `0.7.0-d5e99517`:
 *
 *   ENOENT: no such file or directory, scandir '/app/dist/agents/built-in'
 *     at async loadBuiltInAgents (BuiltInAgentRegistry.js:193)
 *     at async initializeAgentRegistry (BuiltInAgentRegistry.js:224)
 *     at async Object.run (12-agent-registry.js:33)
 *
 * Root cause: `tsc` only emits `.ts -> .js`. The 8 sub-agent markdown
 * files under `src/agents/built-in/*.md` are never copied into `dist/`,
 * so `BuiltInAgentRegistry.loadBuiltInAgents()` (which `readdir`s
 * `dist/agents/built-in/` via its ESM `__dirname`) throws ENOENT and
 * the Task tool silently falls back to a single `general-purpose`
 * agent — none of cloud-operations, code-execution, artifact-creation,
 * data-query, validation, synthesis, reasoning, planning ever load.
 *
 * Architectural guard:
 *   1. The 8 source `.md` files exist (no accidental rename / delete).
 *   2. `package.json`'s `build` script copies the `agents/built-in/`
 *      directory tree into `dist/` after `tsc` runs.
 *
 * The copy mechanism is a Node-based `cp -r` (cross-platform, no extra
 * dep). The test parses package.json + asserts the postbuild step
 * mentions `agents/built-in` and uses `fs.cpSync` (or equivalent
 * recursive copy). It is intentionally a static-source assertion (no
 * `npm run build` invocation) for the same reason every other arch
 * test in this directory is static — fast, no toolchain dependency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// __dirname = services/openagentic-api/src/__tests__/architecture
// ../../../../.. = repo root
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_ROOT = join(REPO_ROOT, 'services/openagentic-api');
const BUILT_IN_DIR = join(API_ROOT, 'src/agents/built-in');
const PACKAGE_JSON = join(API_ROOT, 'package.json');
const DOCKERFILE = join(API_ROOT, 'Dockerfile');

const EXPECTED_AGENTS = [
  'artifact-creation',
  'cloud-operations',
  'code-execution',
  'data-query',
  'planning',
  'reasoning',
  'synthesis',
  'validation',
];

describe('#531 — built-in agent markdown ships into dist/', () => {
  it('all 8 expected sub-agent .md files exist in src/agents/built-in/', () => {
    const files = readdirSync(BUILT_IN_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''))
      .sort();
    expect(files).toEqual(EXPECTED_AGENTS);
  });

  it('package.json `build` script copies agents/built-in into dist/', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
    const buildScript: string = pkg.scripts?.build ?? '';

    // Resolve the full chain of scripts npm run build will execute. We
    // greedily pull in anything reachable from `build` via either npm
    // lifecycle hooks (postbuild) or explicit `npm run <name>` chaining.
    const allScripts = pkg.scripts ?? {};
    const visited = new Set<string>();
    const queue: string[] = ['build', 'postbuild'];
    let combined = '';
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const script: string | undefined = allScripts[name];
      if (!script) continue;
      combined += `\n${script}`;
      // Pull in any `npm run <child>` references for transitive scan.
      for (const m of script.matchAll(/npm\s+run\s+([\w:.-]+)/g)) {
        queue.push(m[1]);
      }
    }

    // Sanity: the build script we started from must have actually been visited.
    expect(buildScript.length).toBeGreaterThan(0);

    // Must reference the agents/built-in path somewhere in the chain.
    expect(combined).toMatch(/agents[\/\\]built-in/);

    // Must use a recursive copy mechanism (Node fs.cpSync, OR cp -r,
    // OR copyfiles, OR cpx). Any of these is acceptable.
    const hasCopyMechanism =
      /cpSync/.test(combined) ||
      /cp\s+-r/.test(combined) ||
      /copyfiles/.test(combined) ||
      /cpx/.test(combined);
    expect(hasCopyMechanism).toBe(true);
  });

  it('Dockerfile invokes the postbuild:assets step after tsc', () => {
    // The Dockerfile runs `pnpm tsc` directly (not `npm run build`), so
    // chaining the asset copy onto the `build` script alone leaves the
    // production image without the .md files. The Dockerfile MUST run
    // `pnpm run postbuild:assets` (or an equivalent recursive copy of
    // src/agents/built-in -> dist/agents/built-in) before the runtime
    // stage's `COPY --from=api-builder /app/dist`.
    const dockerfile = readFileSync(DOCKERFILE, 'utf-8');

    // Two acceptable patterns:
    //   1. RUN pnpm tsc && pnpm run postbuild:assets   (canonical)
    //   2. An explicit COPY/cp/cpSync of src/agents/built-in into dist/
    const usesPostbuildScript = /postbuild:assets/.test(dockerfile);
    const usesExplicitCopy =
      /agents[\/\\]built-in/.test(dockerfile) &&
      (/cpSync/.test(dockerfile) ||
        /cp\s+-r/.test(dockerfile) ||
        /COPY\s+[^\n]*agents[\/\\]built-in/i.test(dockerfile));

    expect(usesPostbuildScript || usesExplicitCopy).toBe(true);
  });
});
