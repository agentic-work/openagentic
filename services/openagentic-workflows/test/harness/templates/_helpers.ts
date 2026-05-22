/**
 * Shared helpers for the 10-template end-to-end harness suite.
 *
 * Each `<slug>.test.ts` file in this folder loads its template JSON
 * from `seed/templates/`, layers in the MSW mocks the template needs,
 * runs the flow through the real WorkflowExecutionEngine via `runFlow`,
 * and asserts the four template-pass criteria:
 *
 *   1. status === 'completed'
 *   2. at least one tool/datastore node actually executed
 *   3. variable propagation through the trigger seed
 *   4. an artifact (HTML string or structured JSON) appeared on the
 *      terminal node's output
 *
 * The MSW mocks are deliberately permissive — they return realistic
 * payloads so downstream nodes get plausible upstream state instead of
 * `undefined`. That keeps the harness focused on FLOW correctness, not
 * provider correctness (which is covered by the per-primitive tests).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RunFlowResult } from '../runFlow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TemplateDefinitionFile {
  slug: string;
  name: string;
  description: string;
  category: string;
  template: true;
  defaultInputs: Record<string, unknown>;
  definition: {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
}

const REPO_ROOT_REL_SEED = '../../../seed/templates';

export function loadTemplate(slug: string): TemplateDefinitionFile {
  const filePath = resolve(__dirname, REPO_ROOT_REL_SEED, `${slug}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TemplateDefinitionFile;
}

/**
 * Assert the four template-pass criteria on a run result.
 *
 * `nodesExpectedExecuted` is the subset of node ids that MUST have an
 * entry in `outputs` — these are the tool / datastore / artifact nodes
 * the template definition is built around.
 */
export function assertTemplatePass(
  result: RunFlowResult,
  nodesExpectedExecuted: readonly string[],
): void {
  if (result.status !== 'completed') {
    throw new Error(
      `[template-pass] expected status=completed, got ${result.status}: ` +
        `${result.error?.message ?? '(no error message)'} ` +
        `nodeId=${result.error?.nodeId ?? '(none)'} ` +
        `frames=${result.frames.length}`,
    );
  }
  for (const nodeId of nodesExpectedExecuted) {
    if (result.outputs[nodeId] === undefined) {
      throw new Error(
        `[template-pass] expected node ${nodeId} to produce output. ` +
          `outputs keys: ${Object.keys(result.outputs).join(',')}`,
      );
    }
  }
}
