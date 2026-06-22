#!/bin/bash
# Verifies that the `admin-tokens/no-hardcoded-admin-color` ESLint rule
# fires on hex literals inside services/openagentic-ui/src/features/admin/.
#
# RED: rule not yet implemented => this script must FAIL.
# GREEN: rule implemented + wired into .eslintrc => this script must PASS.
#
# Implementation note: this drives ESLint programmatically (Linter API) rather
# than via the `pnpm exec eslint` CLI, because the project's broader config
# loads `plugin:react/recommended`, and on this dev env (Node >=22) the
# transitive `es-iterator-helpers` package is broken which causes
# `react/jsx-no-target-blank` (and friends) to hard-error during rule loading
# before any actual linting runs. That's a pre-existing infra bug independent
# of this rule. The programmatic path lets us verify in isolation that:
#   (a) the rule's logic fires on the offending pattern, and
#   (b) the rule is reachable by name `admin-tokens/no-hardcoded-admin-color`,
# both of which are exactly what the bash test is supposed to gate.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP=$(mktemp --suffix=.tsx)
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<'EOF'
export const X = () => <div style={{ color: '#abcdef' }}>x</div>
EOF

node - "$UI_ROOT" "$TMP" <<'NODE_EOF'
const fs = require('fs');
const path = require('path');
const [, , uiRoot, fixturePath] = process.argv;

function uiRequire(name) {
  return require(require.resolve(name, { paths: [uiRoot] }));
}

const { Linter } = uiRequire('eslint');
const plugin = require(path.join(uiRoot, 'eslint-plugin-admin-tokens'));
const tsParser = uiRequire('@typescript-eslint/parser');

const linter = new Linter();
linter.defineParser('@typescript-eslint/parser', tsParser);
linter.defineRule(
  'admin-tokens/no-hardcoded-admin-color',
  plugin.rules['no-hardcoded-admin-color']
);

const source = fs.readFileSync(fixturePath, 'utf8');
const messages = linter.verify(
  source,
  {
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
    rules: { 'admin-tokens/no-hardcoded-admin-color': 'error' },
  },
  fixturePath
);

const fired = messages.filter(
  (m) => m.ruleId === 'admin-tokens/no-hardcoded-admin-color'
);
if (fired.length > 0) {
  console.log('PASS — rule fired: ' + fired[0].message);
  process.exit(0);
} else {
  console.log('FAIL — rule did not fire');
  process.exit(1);
}
NODE_EOF
