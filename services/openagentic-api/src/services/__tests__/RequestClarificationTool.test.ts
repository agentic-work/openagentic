/**
 * RequestClarificationTool — TDD for the ambiguity-escape tool.
 *
 * Anthropic's tool-writing rubric and the LangChain agent docs both
 * recommend a dedicated "ask the user" tool so the model has an
 * explicit alternative to guessing or delegating. Without it, models
 * fall back to delegating ambiguous prompts to sub-agents that then
 * confabulate — exactly the failure mode the user has been hitting.
 *
 * The tool emits a single `request_clarification` NDJSON frame; the UI
 * renders it as an inline question card with multiple-choice options
 * (or a free-text field if no options provided).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */
import { describe, it, expect, vi } from 'vitest';
import {
  REQUEST_CLARIFICATION_TOOL,
  isRequestClarificationTool,
  executeRequestClarification,
  type RequestClarificationInput,
} from '../RequestClarificationTool.js';

function makeCtx(emit = vi.fn()) {
  return {
    emit,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test',
    userId: 'user-test',
  } as any;
}

describe('REQUEST_CLARIFICATION_TOOL — schema shape', () => {
  it('is a valid OpenAI/Anthropic function-tool definition', () => {
    expect(REQUEST_CLARIFICATION_TOOL.type).toBe('function');
    expect(REQUEST_CLARIFICATION_TOOL.function.name).toBe('request_clarification');
  });

  it('description is at least 200 chars and follows when-to-use rubric', () => {
    expect(REQUEST_CLARIFICATION_TOOL.function.description.length).toBeGreaterThanOrEqual(200);
    const desc = REQUEST_CLARIFICATION_TOOL.function.description.toLowerCase();
    expect(desc).toMatch(/use when|when to use/);
    expect(desc).toMatch(/do not use|don't use|when not to use/);
  });

  it('input schema requires question; options are optional', () => {
    const params = REQUEST_CLARIFICATION_TOOL.function.parameters as any;
    expect(params.required).toEqual(['question']);
    expect(params.properties.question).toBeDefined();
    expect(params.properties.options).toBeDefined();
  });
});

describe('isRequestClarificationTool — name match', () => {
  it('matches canonical and common variants', () => {
    expect(isRequestClarificationTool('request_clarification')).toBe(true);
    expect(isRequestClarificationTool('requestClarification')).toBe(true);
    expect(isRequestClarificationTool('ask_user')).toBe(true);
    expect(isRequestClarificationTool('ask_question')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(isRequestClarificationTool('Task')).toBe(false);
    expect(isRequestClarificationTool('render_artifact')).toBe(false);
    expect(isRequestClarificationTool('')).toBe(false);
  });
});

describe('executeRequestClarification', () => {
  it('emits a request_clarification NDJSON frame with the question', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRequestClarification(ctx, {
      question: 'Did you want a cost breakdown by service or by resource group?',
    });
    expect(result.ok).toBe(true);
    // 2 emits expected: synthetic `ttft` (clarification deadlock fix —
    // see RequestClarificationTool.ttftEmit.test.ts) + `request_clarification`.
    expect(emit).toHaveBeenCalledTimes(2);
    const clarifyCall = emit.mock.calls.find((c: any[]) => c[0] === 'request_clarification');
    expect(clarifyCall).toBeTruthy();
    const [, payload] = clarifyCall as [string, any];
    expect(payload.question).toBe('Did you want a cost breakdown by service or by resource group?');
    expect(typeof payload.clarification_id).toBe('string');
  });

  it('forwards options when provided (multiple-choice card)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    await executeRequestClarification(ctx, {
      question: 'Which cloud first?',
      options: [
        { value: 'azure', label: 'Azure' },
        { value: 'aws', label: 'AWS' },
      ],
    });
    const clarifyCall = emit.mock.calls.find((c: any[]) => c[0] === 'request_clarification');
    expect(clarifyCall).toBeTruthy();
    const [, payload] = clarifyCall as [string, any];
    expect(payload.options).toEqual([
      { value: 'azure', label: 'Azure' },
      { value: 'aws', label: 'AWS' },
    ]);
  });

  it('rejects empty question with structured tool error (no throw)', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const result = await executeRequestClarification(ctx, { question: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/question/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it('passes question verbatim — no rewriting / no regex', async () => {
    const emit = vi.fn();
    const ctx = makeCtx(emit);
    const exotic =
      "Should I 'render' a sankey or skip it? (mock-spec test 02-aware question)";
    await executeRequestClarification(ctx, { question: exotic });
    const clarifyCall = emit.mock.calls.find((c: any[]) => c[0] === 'request_clarification');
    expect(clarifyCall).toBeTruthy();
    const [, payload] = clarifyCall as [string, any];
    expect(payload.question).toBe(exotic);
  });
});
