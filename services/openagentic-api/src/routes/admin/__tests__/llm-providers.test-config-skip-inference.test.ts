/**
 * #577 follow-up — Test Connection MUST NOT call createCompletion when
 * no test model can be derived.
 *
 * Live regression captured 2026-05-01: user clicks "Test Connection" on
 * the Add-Provider wizard for Bedrock BEFORE saving (no model chosen).
 * The handler picks `testModel` via:
 *
 *   const testModel = userModel
 *     || models?.[0]?.id
 *     || models?.[0]?.name
 *     || normalized.config?.model
 *     || normalized.config?.chatModel
 *     || normalized.config?.deploymentName;
 *
 * For a fresh Bedrock add, all of those are undefined: the user didn't
 * pick a model, listModels() throws or returns [] (the IAM might not
 * have bedrock:ListFoundationModels), and the form wasn't given any
 * default. Then the handler still calls:
 *
 *   tempProvider.createCompletion({ model: undefined, ... })
 *
 * which trips the #577 "No Bedrock model configured" guard — surfacing
 * a runtime error message in a wizard step that is supposed to validate
 * credentials, not run inference.
 *
 * Contract pinned here:
 *   - When `testModel` cannot be derived, the handler emits a synthetic
 *     test result documenting "auth/region OK, pick a model to validate
 *     inference" and DOES NOT call createCompletion. Status code 200.
 *   - The contract is wiring-grep enforced (handler does not call
 *     createCompletion on the no-model branch).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The /llm-providers/test-config handler moved into the testing sub-module
// during the routes/admin/llm-providers.ts split.
const routeSrcPath = join(__dirname, '..', 'llm-providers', 'testing.routes.ts');

describe('POST /api/admin/llm-providers/test-config — no-model branch (#577 follow-up)', () => {
  const src = readFileSync(routeSrcPath, 'utf-8');

  // Locate the test-config handler block.
  const handlerStart = src.indexOf("'/llm-providers/test-config'");
  const nextHandler = src.indexOf('fastify.', handlerStart + 1);
  const block = src.slice(handlerStart, nextHandler > 0 ? nextHandler : handlerStart + 8000);

  it('handler block contains a no-model guard before createCompletion', () => {
    // The guard must appear textually before the createCompletion call.
    const ccIdx = block.indexOf('createCompletion(');
    expect(ccIdx).toBeGreaterThan(0);

    // Some form of "if no testModel, skip inference" guard must exist
    // upstream of the createCompletion call.
    const upstream = block.slice(0, ccIdx);
    expect(upstream).toMatch(/if\s*\(\s*!testModel\s*\)/);
  });

  it('the no-model branch records a "skipped inference" / "no model derived" result without calling createCompletion', () => {
    // The branch body should set tests.basic to a success-with-note
    // shape, not call createCompletion. We assert the literal flag the
    // handler uses to mark this branch so the UI can render it.
    expect(block).toMatch(/skippedInference|noModelDerived|inferenceSkipped/);
  });
});
