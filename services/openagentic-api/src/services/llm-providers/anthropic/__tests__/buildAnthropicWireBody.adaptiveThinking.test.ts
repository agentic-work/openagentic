/**
 * #cap-sync (2026-06-16) — adaptive thinking wire shape for Opus 4.7/4.8.
 *
 * Opus 4.7/4.8 + Fable 5 REJECT `{type:'enabled', budget_tokens}` with a 400 and
 * require `{type:'adaptive'}` (depth via `effort`, no budget). Before this fix the
 * wire builder could only emit the `enabled` shape → Bedrock 400 → the
 * "thinking not supported" symptom. These tests pin the new branch.
 */
import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';

const req = () => ({ messages: [{ role: 'user', content: 'hi' }] }) as any;

describe('buildAnthropicWireBody — adaptive thinking (#cap-sync)', () => {
  it('emits {type:"adaptive"} with NO budget_tokens when thinkingMode=adaptive', () => {
    const body = buildAnthropicWireBody(req(), {
      model: 'claude-opus-4-8',
      parallelOn: true,
      supportsThinking: true,
      thinkingMode: 'adaptive',
    }) as any;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.thinking.budget_tokens).toBeUndefined();
    // adaptive still requires temperature 1 (any thinking on Anthropic).
    expect(body.temperature).toBe(1);
  });

  it('does NOT apply the budget-floor to max_tokens in adaptive mode', () => {
    // No explicit max_tokens + adaptive → must NOT be bumped to budget+reserve;
    // it should respect the model output cap path / canonical default, not a
    // thinking-budget floor (there is no budget).
    const body = buildAnthropicWireBody(req(), {
      model: 'claude-opus-4-8',
      parallelOn: true,
      supportsThinking: true,
      thinkingMode: 'adaptive',
      modelOutputCap: 128000,
    }) as any;
    expect(body.thinking).toEqual({ type: 'adaptive' });
    // modelOutputCap floor still applies (caller omitted max_tokens), but no
    // budget addition — 128000 exactly, not 128000+reserve.
    expect(body.max_tokens).toBe(128000);
  });

  it('still emits {type:"enabled", budget_tokens} for legacy enabled mode (Opus 4.6)', () => {
    const body = buildAnthropicWireBody(req(), {
      model: 'claude-opus-4-6',
      parallelOn: true,
      supportsThinking: true,
      thinkingMode: 'enabled',
      thinkingBudgetTokens: 8000,
    }) as any;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
  });

  it('defaults to enabled-mode behavior when thinkingMode is unset', () => {
    const body = buildAnthropicWireBody(req(), {
      model: 'claude-sonnet-4-6',
      parallelOn: true,
      supportsThinking: true,
      thinkingBudgetTokens: 4096,
    }) as any;
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('strips thinking entirely under forced tool_choice even in adaptive mode', () => {
    const body = buildAnthropicWireBody(
      { messages: [{ role: 'user', content: 'hi' }], tool_choice: { type: 'any' } } as any,
      {
        model: 'claude-opus-4-8',
        parallelOn: true,
        supportsThinking: true,
        thinkingMode: 'adaptive',
      },
    ) as any;
    expect(body.thinking).toBeUndefined();
  });
});
