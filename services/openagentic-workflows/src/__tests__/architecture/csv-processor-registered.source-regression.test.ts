/**
 * csv_processor P1 primitive — source-regression guard.
 *
 * Pins all 4 wire-up sites so a refactor can't silently drop one:
 *   1. registry.ts imports + registers the schema + executor
 *   2. api WorkflowCompiler VALID_NODE_TYPES includes 'csv_processor'
 *   3. UI workflowValidator covers it
 *   4. UI nodeSummary renders an execution-panel summary
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

describe('csv_processor P1 primitive — all wire-up sites', () => {
  it('registry.ts imports + registers csv_processor', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/shared/workflow-engine/src/nodes/registry.ts'),
      'utf8',
    );
    expect(text).toMatch(/import\s+csvProcessorSchemaJson\s+from\s+['"]\.\/csv_processor\/schema\.json['"]/);
    expect(text).toMatch(/register\(csvProcessorSchemaJson,\s*csvProcessorExecute\)/);
  });

  it('api WorkflowCompiler accepts csv_processor', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-api/src/services/WorkflowCompiler.ts'),
      'utf8',
    );
    expect(text).toMatch(/['"]csv_processor['"]/);
  });

  it('UI workflowValidator pins the csv field', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-ui/src/features/workflows/utils/workflowValidator.ts'),
      'utf8',
    );
    expect(text).toMatch(/csv_processor:\s*\[[\s\S]*?'csv'/);
  });

  it('UI nodeSummary renders csv_processor cases', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-ui/src/features/workflows/utils/nodeSummary.ts'),
      'utf8',
    );
    expect(text).toMatch(/nodeType === ['"]csv_processor['"]/);
  });
});
