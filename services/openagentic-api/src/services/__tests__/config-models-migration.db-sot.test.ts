/**
 * Regression lock: Task 6b — migrate non-provider MODELS.* consumers to DB (ModelConfigurationService).
 *
 * Pre-fix pattern (server.ts):
 *   codeModel: MODELS.code, compactionModel: MODELS.compaction, ...
 *
 * Post-fix (server.ts):
 *   mc = await ModelConfigurationService.getConfig().catch(() => null);
 *   defaultModel: mc?.defaultModel.modelId ?? '(db-unreachable)', ...
 *
 * These are static-source (grep) tests. They lock out the specific regression
 * vector (MODELS.* references in non-provider consumers) without requiring a
 * fully-mocked Fastify stack.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

function read(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Task 6b: non-provider MODELS.* consumers migrated to DB', () => {
  // ── server.ts startup log ──────────────────────────────────────────────────

  it('server.ts startup log block does not reference MODELS.*', () => {
    const src = read('src/server.ts');
    // Find the log block around "Model configuration loaded"
    const logBlock = src.match(
      /logger\.info\(\{[\s\S]{0,600}Model configuration loaded[\s\S]{0,200}\}/
    )?.[0] ?? '';
    expect(logBlock.length).toBeGreaterThan(10);
    // Must NOT reference MODELS.* in the log block
    expect(logBlock).not.toMatch(/MODELS\./);
    // Must NOT call getDefaultModel() in the log block (env-backed)
    expect(logBlock).not.toMatch(/getDefaultModel\(\)/);
    // Positive: must reference ModelConfigurationService.getConfig
    expect(logBlock).toMatch(/ModelConfigurationService\.getConfig/);
  });

  // ── WorkflowExecutionEngine ────────────────────────────────────────────────

  it('WorkflowExecutionEngine.ts does not reference MODELS.default', () => {
    const src = read('src/services/WorkflowExecutionEngine.ts');
    // Provider-class transitive use is NOT in this file — all usages must be gone.
    expect(src).not.toMatch(/MODELS\.default/);
  });

  it('WorkflowExecutionEngine.ts does not reference MODELS.vertexChat', () => {
    const src = read('src/services/WorkflowExecutionEngine.ts');
    expect(src).not.toMatch(/MODELS\.vertexChat/);
  });

  it('WorkflowExecutionEngine.ts does not reference MODELS.azureOpenai', () => {
    const src = read('src/services/WorkflowExecutionEngine.ts');
    expect(src).not.toMatch(/MODELS\.azureOpenai/);
  });

  // ── docs/chat.handler.ts — unused import ──────────────────────────────────

  it('routes/docs/chat.handler.ts does not import MODELS', () => {
    const src = read('src/routes/docs/chat.handler.ts');
    // The import was confirmed unused — it must be dropped.
    expect(src).not.toMatch(/import.*MODELS.*from/);
  });
});
