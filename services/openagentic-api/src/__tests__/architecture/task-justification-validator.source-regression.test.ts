/**
 * Source regression: #844 Task multi_step_justification validator must stay wired.
 *
 * Pins three contract invariants in source so a future refactor can't
 * silently drop the gate:
 *
 *   1. TaskTool.ts imports + invokes validateMultiStepJustification before
 *      ever calling deps.runSubagent
 *   2. TASK_TOOL schema required[] includes 'multi_step_justification'
 *   3. TaskJustificationValidator.ts exports both
 *      validateMultiStepJustification + MIN_TOOL_COUNT_FOR_TASK
 *
 * Behavior is exercised by:
 *   - services/__tests__/TaskJustificationValidator.test.ts (14 unit cases)
 *   - services/__tests__/TaskTool.justificationGate.test.ts (6 integration cases)
 *
 * This file is the structural safety net.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');

function readSource(relPath: string): string {
  return readFileSync(resolve(repoRoot, relPath), 'utf8');
}

describe('#844 Task multi_step_justification validator — source regression', () => {
  it('TaskTool.ts imports validateMultiStepJustification', () => {
    const src = readSource('src/services/TaskTool.ts');
    expect(src).toMatch(/validateMultiStepJustification/);
    expect(src).toMatch(/TaskJustificationValidator/);
  });

  it('TaskTool.ts gates dispatch on validator result BEFORE the role/spec construction', () => {
    const src = readSource('src/services/TaskTool.ts');
    // The validator call must appear in executeTask body, and the
    // rejection branch must return WITHOUT building a SubagentSpec.
    const executeTaskMatch = src.match(/export async function executeTask[\s\S]*?\n\}/m);
    expect(executeTaskMatch).toBeTruthy();
    const body = executeTaskMatch![0];
    const validatorCallIdx = body.indexOf('validateMultiStepJustification');
    const runSubagentCallIdx = body.indexOf('deps.runSubagent(spec');
    expect(validatorCallIdx).toBeGreaterThan(-1);
    expect(runSubagentCallIdx).toBeGreaterThan(-1);
    expect(validatorCallIdx).toBeLessThan(runSubagentCallIdx);
  });

  it('TASK_TOOL schema lists multi_step_justification as required', () => {
    const src = readSource('src/services/TaskTool.ts');
    // The required array on the parameters object must include
    // 'multi_step_justification'.
    expect(src).toMatch(/required:\s*\[[^\]]*'multi_step_justification'/);
    expect(src).toMatch(/multi_step_justification:\s*\{[^}]*type:\s*'object'/);
  });

  it('TaskJustificationValidator.ts exports the validator + threshold constant', () => {
    const src = readSource('src/services/TaskJustificationValidator.ts');
    expect(src).toContain('export function validateMultiStepJustification');
    expect(src).toContain('export const MIN_TOOL_COUNT_FOR_TASK');
  });

  it('validator threshold is 3 (canonical minimum, not silently downgraded)', () => {
    const src = readSource('src/services/TaskJustificationValidator.ts');
    expect(src).toMatch(/MIN_TOOL_COUNT_FOR_TASK\s*=\s*3/);
  });

  it('validator has no hardcoded model IDs (capability-agnostic gate)', () => {
    const src = readSource('src/services/TaskJustificationValidator.ts');
    const forbidden = [
      /\bgpt-5\b/i, /\bsonnet\b/i, /\bopus\b/i, /\bhaiku\b/i,
      /\bgemini\b/i, /\bllama\b/i, /\bgpt-oss\b/i, /\bmini\b/i,
    ];
    for (const re of forbidden) {
      expect(src).not.toMatch(re);
    }
  });
});
