/**
 * Regression guard: openagentic-exec image ships the plugin + skills seed
 * and the entrypoint calls verifyPluginSeed BEFORE launching the daemon.
 *
 * Stage A of task #359. The Dockerfile git-clones
 *   anthropics/claude-plugins-official  → /opt/openagentic-seed/marketplaces/claude-plugins-official
 *   anthropics/skills                   → /opt/openagentic-seed/skills
 * and wires OPENAGENTIC_PLUGIN_SEED_DIR + OPENAGENTIC_CONFIG_DIR so the
 * child openagentic process (spawned by the remote-session daemon) picks up
 * the seed via registerSeedMarketplaces() without a runtime network call.
 *
 * These tests are parse-only (source-level), so they catch drift the
 * moment someone deletes one of those RUN steps or ENV lines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCKERFILE_PATH = resolve(__dirname, '..', 'Dockerfile');
const ENTRYPOINT_PATH = resolve(__dirname, '..', 'docker-entrypoint.sh');

describe('Dockerfile: bakes anthropics/claude-plugins-official + anthropics/skills seed', () => {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');

  it('git-clones anthropics/claude-plugins-official into the seed dir', () => {
    // Dockerfile uses `\`-line-continuations, so match across newlines + backslashes.
    expect(dockerfile).toMatch(
      /git clone[\s\S]{0,400}anthropics\/claude-plugins-official[\s\S]{0,400}\/opt\/openagentic-seed\/marketplaces\/claude-plugins-official/,
    );
  });

  it('git-clones anthropics/skills into the seed dir', () => {
    expect(dockerfile).toMatch(
      /git clone[\s\S]{0,400}anthropics\/skills[\s\S]{0,400}\/opt\/openagentic-seed\/skills/,
    );
  });

  it('writes known_marketplaces.json into the seed dir', () => {
    expect(dockerfile).toMatch(/\/opt\/openagentic-seed\/known_marketplaces\.json/);
  });

  it('registers claude-plugins-official in known_marketplaces.json', () => {
    // Find the printf RUN that actually writes the JSON (not the surrounding
    // comment lines). The printf must declare the marketplace + its github
    // source + the upstream repo path.
    const printfMatch = dockerfile.match(/RUN printf[\s\S]{0,1200}>\s*\/opt\/openagentic-seed\/known_marketplaces\.json/);
    expect(printfMatch, 'printf RUN that writes known_marketplaces.json').toBeTruthy();
    const block = printfMatch![0];
    expect(block).toMatch(/claude-plugins-official/);
    expect(block).toMatch(/"source":\s*"github"/);
    expect(block).toMatch(/"repo":\s*"anthropics\/claude-plugins-official"/);
  });

  it('sets OPENAGENTIC_PLUGIN_SEED_DIR=/opt/openagentic-seed', () => {
    expect(dockerfile).toMatch(
      /ENV\s+OPENAGENTIC_PLUGIN_SEED_DIR=\/opt\/openagentic-seed/,
    );
  });

  it('sets OPENAGENTIC_CONFIG_DIR=/root/.openagentic', () => {
    expect(dockerfile).toMatch(
      /ENV\s+OPENAGENTIC_CONFIG_DIR=\/root\/\.openagentic/,
    );
  });

  it('creates config dir and symlinks skills into the config home', () => {
    // Match the RUN step that pre-creates /root/.openagentic and symlinks skills.
    expect(dockerfile).toMatch(/mkdir\s+-p\s+\/root\/\.openagentic/);
    expect(dockerfile).toMatch(
      /ln\s+-sf\s+\/opt\/openagentic-seed\/skills\s+\/root\/\.openagentic\/skills/,
    );
  });

  it('makes the seed world-readable so sandbox users can resolve it', () => {
    expect(dockerfile).toMatch(
      /chmod\s+-R\s+a\+rX\s+\/opt\/openagentic-seed/,
    );
  });
});

describe('docker-entrypoint.sh: verifies plugin seed BEFORE daemon exec', () => {
  const entrypoint = readFileSync(ENTRYPOINT_PATH, 'utf8');

  it('invokes node /app/dist/entrypoints/verifyPluginSeed.js', () => {
    expect(entrypoint).toMatch(
      /node\s+\/app\/dist\/entrypoints\/verifyPluginSeed\.js/,
    );
  });

  it('calls verifyPluginSeed BEFORE `exec dumb-init openagentic`', () => {
    const seedIdx = entrypoint.indexOf('verifyPluginSeed.js');
    const execIdx = entrypoint.indexOf('exec dumb-init openagentic');
    expect(seedIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(seedIdx).toBeLessThan(execIdx);
  });

  it('still runs verifyWorkspaceMount before verifyPluginSeed (mount must be up first)', () => {
    const mountIdx = entrypoint.indexOf('verifyWorkspaceMount.js');
    const seedIdx = entrypoint.indexOf('verifyPluginSeed.js');
    expect(mountIdx).toBeGreaterThan(-1);
    expect(seedIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeLessThan(seedIdx);
  });
});
