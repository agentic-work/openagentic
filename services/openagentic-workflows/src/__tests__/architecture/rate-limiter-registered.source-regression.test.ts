/**
 * rate_limiter P1 primitive — source-regression guard.
 *
 * Pins all 4 wire-up sites so a refactor can't silently drop one:
 *   1. registry.ts imports + registers the schema + executor
 *   2. api WorkflowCompiler VALID_NODE_TYPES includes 'rate_limiter'
 *   3. UI workflowValidator covers it
 *   4. UI nodeSummary renders an execution-panel summary
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

describe('rate_limiter P1 primitive — all wire-up sites', () => {
  it('registry.ts imports + registers rate_limiter', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/shared/workflow-engine/src/nodes/registry.ts'),
      'utf8',
    );
    expect(text).toMatch(/import\s+rateLimiterSchemaJson\s+from\s+['"]\.\/rate_limiter\/schema\.json['"]/);
    expect(text).toMatch(/register\(rateLimiterSchemaJson,\s*rateLimiterExecute\)/);
  });

  it('api WorkflowCompiler accepts rate_limiter', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-api/src/services/WorkflowCompiler.ts'),
      'utf8',
    );
    expect(text).toMatch(/['"]rate_limiter['"]/);
  });

  it('UI workflowValidator pins the bucket key', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-ui/src/features/workflows/utils/workflowValidator.ts'),
      'utf8',
    );
    expect(text).toMatch(/rate_limiter:\s*\[[\s\S]*?'key'/);
  });

  it('UI nodeSummary renders rate_limiter cases', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-ui/src/features/workflows/utils/nodeSummary.ts'),
      'utf8',
    );
    expect(text).toMatch(/nodeType === ['"]rate_limiter['"]/);
  });
});
