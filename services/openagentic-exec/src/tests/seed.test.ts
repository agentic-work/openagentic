/**
 * Regression test: openagentic plugin marketplace + skills seed is present.
 *
 * This test runs INSIDE the built container (e.g. as part of a startup
 * self-check or a CI container-run step). It asserts that the build-time
 * git clones landed at the expected paths so the daemon can resolve
 * `claude-plugins-official` without a runtime network call.
 *
 * Run: ts-node src/tests/seed.test.ts
 * or:  node -e "require('./dist/tests/seed.test.js')" (after build)
 */

import { existsSync } from 'fs';
import { join } from 'path';

const SEED_DIR = process.env.OPENAGENTIC_PLUGIN_SEED_DIR || '/opt/openagentic-seed';
const CONFIG_DIR = process.env.OPENAGENTIC_CONFIG_DIR || '/root/.openagentic';

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

function check(name: string, path: string): TestResult {
  const passed = existsSync(path);
  return { name, passed, detail: passed ? `found: ${path}` : `MISSING: ${path}` };
}

const results: TestResult[] = [
  // Seed root
  check('seed dir exists', SEED_DIR),
  // Plugin marketplace clone
  check('claude-plugins-official cloned', join(SEED_DIR, 'marketplaces', 'claude-plugins-official')),
  // known_marketplaces.json written by Dockerfile RUN
  check('seed known_marketplaces.json present', join(SEED_DIR, 'known_marketplaces.json')),
  // Standalone skills clone from anthropics/skills
  check('anthropics/skills cloned', join(SEED_DIR, 'skills')),
  // Config home pre-created
  check('OPENAGENTIC_CONFIG_DIR pre-created', CONFIG_DIR),
  // Skills symlink in config home
  check('skills symlink in config home', join(CONFIG_DIR, 'skills')),
];

let failures = 0;
for (const r of results) {
  const mark = r.passed ? '  PASS' : '  FAIL';
  console.log(`${mark}  ${r.name}: ${r.detail}`);
  if (!r.passed) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} seed assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} seed assertions passed.`);
}
