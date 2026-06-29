/**
 * Memory.3 — RED test: runChat memoryRecall closure uses opts.userMessage
 * (semantic path), NOT opts.key (old substring-match path).
 *
 * The smoking gun: the old code passed `{ key: input.userMessage }` to recall,
 * which did a substring match of the full user message against memory keys.
 * "what's my Azure subscription id?" has zero substring overlap with stored
 * key "azure_sub_id" → recall returned empty → model asked again.
 *
 * After Memory.3, BOTH recall sites in runChat.ts must pass
 * `{ userMessage: ... }` so AgentMemoryService routes to the Milvus
 * semantic path.
 *
 * We test this by:
 * 1. Spying on AgentMemoryService.recall
 * 2. Triggering a minimal runChat execution path that hits the two recall sites
 * 3. Asserting recall() was called with opts.userMessage (not opts.key) on
 *    the userMessage-driven paths.
 *
 * Note: full runChat integration is complex to mock. We test the two specific
 * call sites by reading the source file and verifying the opts shape used —
 * this is the "call signature" verification approach used by other source
 * regression tests in this codebase.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Source regression: verify the two recall call sites in runChat.ts use
// opts.userMessage instead of opts.key.
//
// This approach (grep-the-source) mirrors how existing source-regression
// tests in this codebase verify architectural contracts at a structural level
// without needing a full test harness. See:
//   architecture/cascade-tool-array-instrumentation.source-regression.test.ts
// ---------------------------------------------------------------------------

const RUN_CHAT_PATH = resolve(
  __dirname,
  '../runChat.ts',
);

const source = readFileSync(RUN_CHAT_PATH, 'utf-8');

describe('runChat.ts — memoryRecall call sites use opts.userMessage (semantic path)', () => {
  it('memoryRecall closure (getSystemPromptForRole callback) uses userMessage not key', () => {
    // The closure at runChat.ts:562 was: memSvc.recall(userId, { key, limit: 5 })
    // After Memory.3 it must be: memSvc.recall(userId, { userMessage: key, limit: 5 })
    // OR: memSvc.recall(userId, { userMessage, limit: 5 }) if the parameter is renamed.
    //
    // We look for the recall call inside the memoryRecall closure. The closure
    // param is `key` (historical name for the userMessage string passed in).
    // After fix, the opts object must contain `userMessage:` not just `key:`.

    // Find the memoryRecall closure block
    const memoryRecallClosureMatch = source.match(
      /memoryRecall:\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\},/m
    );
    expect(memoryRecallClosureMatch, 'memoryRecall closure must exist in runChat.ts').toBeTruthy();

    const closureText = memoryRecallClosureMatch![0];

    // Must use userMessage: not key: (the old substring-match path)
    expect(closureText).toContain('userMessage');

    // Must NOT use `{ key:` as the primary recall filter on the user message
    // (key: is OK for category/TTL opts but the recall search param must be userMessage)
    expect(closureText).not.toMatch(/recall\s*\([^)]*\{\s*key\s*:/);
  });

  it('Phase 9 memory injection recall (line ~658) uses userMessage not key', () => {
    // The Phase 9 block was: memSvc.recall(ctx.userId ?? 'anonymous', { key: input.userMessage, limit: recallLimit })
    // After Memory.3 it must be: memSvc.recall(..., { userMessage: input.userMessage, limit: recallLimit })

    // Find the Phase 9 memory injection recall call — identified by the comment
    const phase9BlockMatch = source.match(
      /Phase 9[^]*?memSvc\.recall\([^)]+\{[^}]+\}/m
    );
    expect(phase9BlockMatch, 'Phase 9 memory injection recall block must exist').toBeTruthy();

    const phase9Text = phase9BlockMatch![0];

    // Must use userMessage: for the free-text recall param
    expect(phase9Text).toContain('userMessage');

    // Must NOT use `key: input.userMessage` (the old broken path)
    expect(phase9Text).not.toContain('key: input.userMessage');
  });

  it('MemorySearchTool still uses opts.key for explicit model tool calls', () => {
    // MemorySearchTool passes `key: input.query` — the model explicitly searches
    // by key. This should REMAIN as key (legacy/exact search), not change to userMessage.
    // This test verifies we did NOT accidentally break the tool call path.
    const MEMORY_SEARCH_PATH = resolve(
      __dirname,
      '../../../../../services/MemorySearchTool.ts',
    );
    const memSearchSource = readFileSync(MEMORY_SEARCH_PATH, 'utf-8');

    // The deps.recall call should pass key: input.query (explicit key search from model)
    expect(memSearchSource).toContain('key: input.query');

    // Should NOT have been changed to userMessage (that would break explicit key lookup)
    const recallCallMatch = memSearchSource.match(/deps\.recall\([^,]+,\s*\{[^}]+\}/);
    expect(recallCallMatch).toBeTruthy();
    expect(recallCallMatch![0]).not.toContain('userMessage');
  });
});
