/**
 * openagentic-proxy: pure helpers for V1.1 flow_tool agent-catalog injection.
 *
 * The api `/api/workflows/agent-tools` route returns rows of
 * `{ flowId, name, description, input_schema }`. openagentic-proxy projects
 * each row to an OpenAI-shape tool def (the format providers expect on
 * the tools[] field) and maintains a `flowId` lookup so it knows where
 * to dispatch when the model invokes the tool.
 *
 * Runner: Node 24 `node:test` + `--experimental-strip-types`, matching
 * the existing `definitions.test.ts` pattern.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectFlowToolToOpenAi,
  buildFlowToolMap,
  isFlowTool,
} from './flowTools.ts';

const SAMPLE = {
  flowId: 'wf-abc',
  name: 'analyze_logs',
  description: 'Pull last 24h Loki logs for a namespace and summarize.',
  input_schema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'k8s namespace' },
      window: { type: 'string', description: 'Time window, e.g. 1h' },
    },
    required: ['namespace'],
  },
};

test('projectFlowToolToOpenAi — wraps schema in OpenAI function-tool shape', () => {
  const tool = projectFlowToolToOpenAi(SAMPLE);
  assert.strictEqual(tool.type, 'function');
  assert.strictEqual(tool.function.name, 'analyze_logs');
  assert.match(tool.function.description, /Loki/);
  assert.deepStrictEqual(tool.function.parameters, SAMPLE.input_schema);
});

test('projectFlowToolToOpenAi — preserves flowId nowhere on the LLM-visible tool', () => {
  const tool = projectFlowToolToOpenAi(SAMPLE);
  // flowId leaks would confuse the model; routing lookup uses a separate map.
  assert.strictEqual((tool as any).flowId, undefined);
  assert.strictEqual((tool.function as any).flowId, undefined);
});

test('buildFlowToolMap — keys by tool name, value is flowId', () => {
  const map = buildFlowToolMap([
    SAMPLE,
    { flowId: 'wf-xyz', name: 'restart_pod', description: 'x', input_schema: { type: 'object', properties: {} } },
  ]);
  assert.strictEqual(map.get('analyze_logs'), 'wf-abc');
  assert.strictEqual(map.get('restart_pod'), 'wf-xyz');
  assert.strictEqual(map.size, 2);
});

test('buildFlowToolMap — dedupes by name, last-write-wins (newer flow with same slug)', () => {
  const map = buildFlowToolMap([
    { flowId: 'wf-old', name: 'analyze_logs', description: 'old', input_schema: { type: 'object', properties: {} } },
    { flowId: 'wf-new', name: 'analyze_logs', description: 'new', input_schema: { type: 'object', properties: {} } },
  ]);
  assert.strictEqual(map.size, 1);
  assert.strictEqual(map.get('analyze_logs'), 'wf-new');
});

test('isFlowTool — true only when name is in the map', () => {
  const map = buildFlowToolMap([SAMPLE]);
  assert.strictEqual(isFlowTool('analyze_logs', map), true);
  assert.strictEqual(isFlowTool('read_workflow', map), false);
  assert.strictEqual(isFlowTool('', map), false);
});
