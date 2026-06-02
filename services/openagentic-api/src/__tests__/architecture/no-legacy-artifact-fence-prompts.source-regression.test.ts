/**
 * #781 Phase A4 — arch pin: no legacy `artifact:html|react|svg` fence
 * prompts in production source.
 *
 * Plan: docs/superpowers/plans/2026-05-13-next-gen-artifact-slideouts.md §A4
 *
 * Context: the legacy HTML artifact slide-out pipeline ships
 * model-facing prose telling the model to emit ```artifact:html / react
 * code fences. Those fences are silently failing (legacy HtmlArtifact
 * renderer returns empty content on the new chat-pipeline path) and the
 * next-gen `compose_app` artifact emit replaces them.
 *
 * This test pins the rip — once GREEN, any future PR re-adding
 * `\`\`\`artifact:html` (or `react`/`svg`) to a prompt string fails CI.
 *
 * Allow-list:
 *   - test files (fixtures may reference the legacy syntax for
 *     regression tests against any residual handling)
 *   - this file (the pin describes the pattern it forbids)
 *   - mocks/UX/** (design references — not consumed by the api)
 *   - docs/** (plan + spec docs)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

// Catch all three legacy kinds (html / react / svg) regardless of whether the
// fence-leading backticks are literal triple-backticks or escaped (`\`\``)
// inside a template literal. The string `artifact:html` / `artifact:react` /
// `artifact:svg` appears in source only when prose tells the model to emit
// the legacy fence — that's the problem A4 rips.
const FENCE_PATTERNS = ['artifact:html', 'artifact:react', 'artifact:svg'];

function findHits(): string[] {
  // `grep -rln` returns one file per match; trim repo path; exclude test
  // files + this very pin file.
  let raw: string;
  try {
    const expr = FENCE_PATTERNS.map((p) => `-e '${p}'`).join(' ');
    raw = execSync(`grep -rln --include='*.ts' ${expr} "${API_SRC}"`, {
      encoding: 'utf-8',
    });
  } catch (e: any) {
    // grep exits 1 when no matches. Treat as "no hits".
    if (e.status === 1) return [];
    throw e;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((p) => relative(API_SRC, p))
    .filter(
      (p) =>
        !p.endsWith(
          'no-legacy-artifact-fence-prompts.source-regression.test.ts',
        ) &&
        !p.includes('__tests__/') &&
        !p.includes('.test.ts') &&
        !p.includes('.spec.ts'),
    );
}

describe('#781 Phase A4 — no legacy artifact:html|react|svg fence prompts', () => {
  it(`production source must contain ZERO occurrences of \`${FENCE_PATTERNS.join('|')}\` (excluding tests + this pin)`, () => {
    const hits = findHits();
    expect(
      hits,
      `Legacy artifact-fence prompts found in:\n  - ${hits.join('\n  - ')}\n\nPhase A4 deletes these. Replace with ArtifactRegistry references or rip the prose entirely.`,
    ).toEqual([]);
  });
});
