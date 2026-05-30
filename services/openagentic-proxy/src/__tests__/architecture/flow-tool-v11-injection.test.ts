/**
 * V1.1 flow_tool agent-catalog injection — source-regression guard.
 *
 * Pins that AgentRunner.run() actually invokes the flow-tools helpers it
 * imports. Without this, an unrelated refactor could delete the call sites
 * and the import statements would still typecheck — agents would silently
 * stop offering saved-flow tools with zero visible error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNNER = readFileSync(
  join(__dirname, '..', '..', 'services', 'AgentRunner.ts'),
  'utf8',
);

test('AgentRunner imports the flowTools helper module', () => {
  assert.match(
    RUNNER,
    /import\s*\{[\s\S]*?(?:projectFlowToolToOpenAi|buildFlowToolMap|isFlowTool)[\s\S]*?\}\s*from\s*['"]\.\.\/tools\/flowTools['"]/,
  );
});

test('AgentRunner injects user saved-flow tools via loadUserFlowTools', () => {
  assert.match(RUNNER, /loadUserFlowTools\s*\(/);
  assert.match(RUNNER, /projectFlowToolToOpenAi/);
});

test('AgentRunner dispatches flow-tool invocations via the routing map', () => {
  assert.match(RUNNER, /isFlowTool\s*\(\s*toolName\s*,\s*flowToolMap\s*\)/);
  assert.match(RUNNER, /executeFlowToolInvocation\s*\(/);
});

test('AgentRunner calls the api /agent-tools route to populate the map', () => {
  assert.match(RUNNER, /\/api\/workflows\/agent-tools/);
});

test('flow-tool invocation POSTs to the standard execute endpoint', () => {
  assert.match(RUNNER, /\/api\/workflows\/\$\{flowId\}\/execute/);
});
