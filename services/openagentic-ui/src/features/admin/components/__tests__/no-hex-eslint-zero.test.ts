import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// UI workspace root: this file is .../openagentic-ui/src/features/admin/components/__tests__/.
// Walk up 5 levels: __tests__ -> components -> admin -> features -> src -> openagentic-ui.
const UI_ROOT = join(__dirname, '..', '..', '..', '..', '..');

interface EslintMessage {
  ruleId: string | null;
  line: number;
  column: number;
  message: string;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

/**
 * Runs ESLint on the admin-component tree with only the
 * `admin-tokens/no-hardcoded-admin-color` rule active. We bypass
 * `.eslintrc.cjs` because that config pulls in @typescript-eslint type
 * checking which is fragile under Node 24 in vitest. The rule itself only
 * walks string Literal / TemplateElement nodes, so a plain ts/tsx parse
 * with @typescript-eslint/parser is sufficient for an honest violation
 * count.
 */
function runHexLint(): EslintFileResult[] {
  const stdout = execFileSync(
    join(UI_ROOT, 'node_modules', '.bin', 'eslint'),
    [
      '--no-eslintrc',
      '--resolve-plugins-relative-to', UI_ROOT,
      '--rulesdir', join(UI_ROOT, 'eslint-plugin-admin-tokens'),
      '--parser', '@typescript-eslint/parser',
      '--plugin', 'admin-tokens',
      '--rule', '{"admin-tokens/no-hardcoded-admin-color":"error"}',
      '--ext', '.ts,.tsx',
      '--ignore-pattern', '**/__tests__/**',
      '--ignore-pattern', '**/*.test.*',
      '--ignore-pattern', '**/*.spec.*',
      '--format', 'json',
      join(UI_ROOT, 'src/features/admin/components'),
    ],
    { cwd: UI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as EslintFileResult[];
}

describe('admin tree has zero hex literals (admin-tokens/no-hardcoded-admin-color)', () => {
  it('every admin source file has 0 violations', () => {
    let results: EslintFileResult[];
    try {
      results = runHexLint();
    } catch (e) {
      // eslint exits non-zero when violations exist; capture stdout from the error
      const err = e as { stdout?: string };
      if (typeof err.stdout !== 'string') throw e;
      results = JSON.parse(err.stdout);
    }
    const hits = results.flatMap(r =>
      r.messages
        .filter(m => m.ruleId === 'admin-tokens/no-hardcoded-admin-color')
        .map(m => `${r.filePath.split('/admin/components/')[1]}:${m.line}:${m.column} ${m.message}`),
    );
    expect(hits).toEqual([]);
  }, 90000);
});
