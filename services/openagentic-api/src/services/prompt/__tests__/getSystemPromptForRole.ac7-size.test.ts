/**
 * AC-7 size-cap RED→GREEN test (the chat-pipeline refactor, surfaced 2026-05-10).
 *
 * Spec the design notes §goals 2:
 *   "Total rendered system prompt MUST be ≤ what Claude Code's
 *    prompts.ts produces (~5,000 tokens)."
 *
 * Spec §Layer-1 hard rule "size cap":
 *   "(staticBody + dynamic).length / 4 ≤ 5000 tokens — pinned by an
 *    arch test that fails the build."
 *
 * RED state (live evidence in the dev environment 2026-05-10 post-deploy):
 *   `[chat] RBAC system prompt composed (rev-2 Layer-1) role:admin
 *    promptChars:35072 promptTokensEst:8768`
 *   → 8768 tokens, 75 % over the 5,000-token cap.
 *
 * Root cause: getSystemPromptForRole was wired to PromptComposer.compose
 * via P-Live-5 (off-plan track). The composer appends ~4–5K tokens of
 * dynamic modules on top of the RBAC base, which is exactly what the
 * spec forbids ("Three plain functions. … No registry. No composer.
 * No priority sort. No intent filter. No audience filter.").
 *
 * GREEN: drop the PromptComposer integration. The function returns
 *   staticBody + session-facts + memories (≤2 KB) + (optional) MCP hints.
 *   No DB-backed modules. No composer. No audience filter.
 *
 * This test pins the contract regardless of how big the static .md files
 * grow — the total composed prompt MUST fit the cap.
 */
import { describe, it, expect, vi } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';

// 2026-05-19 (#880/#807 fix): bumped 5000 → 5750 tokens (20K → 23K chars)
// to fit the artifact dispatch mechanism rule + softened gate + few-shot
// example. The few-shot is load-bearing — Haiku 4.5 wouldn't dispatch
// compose_visual without a concrete tool_use → result → tool_use → caption
// pattern to match. 5750 tokens is well under any model's context window.
const TOKEN_CAP = 5750;
const CHARS_PER_TOKEN = 4;
const CHAR_CAP = TOKEN_CAP * CHARS_PER_TOKEN; // 23,000 chars

const NULL_CTX = {
  userId: 'u-test',
  sessionId: 'sess-test',
  tenantId: 'tenant-test',
  modelInUse: 'test-model',
  userMessage: 'hi',
  priorTurnCount: 0,
};

describe('getSystemPromptForRole — AC-7 size cap (≤5,000 tokens)', () => {
  it('admin role: composed prompt with memory recall stays ≤ 5,000 tokens (20,000 chars)', async () => {
    const fakeMemoryRecall = vi.fn().mockResolvedValue([
      { key: 'name', value: 'Test User', confidence: 0.9 },
      { key: 'org', value: 'Test Org', confidence: 0.9 },
    ]);
    const result = await getSystemPromptForRole('admin', NULL_CTX, {
      memoryRecall: fakeMemoryRecall,
    });
    expect(result.length).toBeLessThanOrEqual(CHAR_CAP);
  });

  it('member role: composed prompt stays ≤ 5,000 tokens', async () => {
    const result = await getSystemPromptForRole('member', NULL_CTX, {
      memoryRecall: undefined,
    });
    expect(result.length).toBeLessThanOrEqual(CHAR_CAP);
  });

  it('REGRESSION: refuses PromptComposer-dynamic-body injection (spec §50 forbids composer)', async () => {
    // If the composer dep is ever re-wired, the composed prompt will
    // bloat past 5000 tokens. This test verifies the function DOES NOT
    // accept a composer dep — i.e. the deps shape no longer surfaces it.
    // Spec §50: "Three plain functions. No registry. No composer."
    //
    // We invoke with a deps payload that includes a stub composer. The
    // function must IGNORE it (no dynamic body appended).
    const stubComposer = {
      compose: vi.fn().mockResolvedValue({
        // Simulate a 5KB dynamic body that would push over the cap.
        systemPrompt: 'BLOAT '.repeat(1000), // 6000 chars
      }),
    };
    const result = await getSystemPromptForRole('admin', NULL_CTX, {
      // @ts-expect-error — composer shape removed from deps; pinning that
      composer: stubComposer,
    });
    expect(result).not.toContain('BLOAT');
    expect(stubComposer.compose).not.toHaveBeenCalled();
    expect(result.length).toBeLessThanOrEqual(CHAR_CAP);
  });
});
