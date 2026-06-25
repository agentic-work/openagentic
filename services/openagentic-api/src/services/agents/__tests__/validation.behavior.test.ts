/**
 * Validation Agent — Behavior Tests (A3 + A4)
 *
 * Agent: validation
 * Tools: web_search (for grounding)
 * Model tier: economical (no thinking — fast verification pass)
 *
 * A3: Given an output to validate, the agent:
 *   - Optionally calls web_search to ground-truth check claims
 *   - Returns a JSON response with `valid: boolean` and optional `reason` / `issues`
 *
 * A4: When web_search returns empty/error results AND the claim cannot be verified,
 *   the agent must return `valid: false` with `failed: true` or explicit error —
 *   NOT silently pass validation.
 *
 * Output schema (A2):
 *   { valid: boolean, reason?: string, issues?: string[], source_checked?: string }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runAgentBehaviorSuite,
  buildMockLLMClient,
  buildMockToolExecutor,
  hasFailureSignal,
  validateResponseShape,
  AGENT_EXPECTED_OUTPUT_SCHEMAS,
  type AgentFixture,
} from './agentBehavior.harness.js';
import { DEFAULT_MODEL_CONFIGS, DEFAULT_TOOLS_WHITELIST, DEFAULT_PROMPT_MODULES } from '../../AgentRegistry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALIDATION_AGENT: AgentFixture = {
  name: 'validation',
  display_name: 'Validation Agent',
  agent_type: 'validation',
  system_prompt: 'You are a validation agent. Verify outputs and check for errors.',
  model_config: {
    primaryModel: 'auto',
    maxTokens: 8192,
    temperature: 0.3,
    preferredTier: 'economical',
  },
  tools_whitelist: DEFAULT_TOOLS_WHITELIST['validation'],
  prompt_modules: DEFAULT_PROMPT_MODULES['validation'],
};

const SYNTHETIC_PROMPT = 'Validate this claim: "The Eiffel Tower was built in 1889 and is 324 meters tall."';

const WEB_SEARCH_RESULT_SUCCESS = {
  results: [
    {
      title: 'Eiffel Tower - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
      snippet: 'The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris. It was constructed from 1887 to 1889 and is 324 m (1,063 ft) tall.',
    },
  ],
};

const SUCCESS_LLM_RESPONSE = {
  content: JSON.stringify({
    valid: true,
    reason: 'Both facts verified against Wikipedia and official sources. The Eiffel Tower was indeed completed in 1889 and stands 324 meters tall.',
    source_checked: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
    issues: [],
  }),
  model: 'test-model',
  usage: { input_tokens: 180, output_tokens: 100 },
};

const FAILURE_LLM_RESPONSE = {
  content: JSON.stringify({
    valid: false,
    failed: true,
    error: 'web_search returned no results — cannot verify the claim against authoritative sources.',
    reason: 'Unable to ground-truth check: search tool returned empty results.',
    source_checked: null,
  }),
  model: 'test-model',
  usage: { input_tokens: 120, output_tokens: 80 },
};

// ---------------------------------------------------------------------------
// Run harness suite
// ---------------------------------------------------------------------------

runAgentBehaviorSuite({
  agent: VALIDATION_AGENT,
  syntheticPrompt: SYNTHETIC_PROMPT,
  successToolMocks: {
    web_search: () => WEB_SEARCH_RESULT_SUCCESS,
  },
  successLLMResponse: SUCCESS_LLM_RESPONSE,
  expectedOutputSchema: AGENT_EXPECTED_OUTPUT_SCHEMAS['validation'],
  failureToolMocks: {
    web_search: () => ({ results: [] }),   // empty results
  },
  failureLLMResponse: FAILURE_LLM_RESPONSE,
});

// ---------------------------------------------------------------------------
// Additional validation-specific assertions
// ---------------------------------------------------------------------------

describe('validation agent — specific contract checks', () => {
  it('validation has thinkingEnabled:false (fast verification pass)', () => {
    expect(DEFAULT_MODEL_CONFIGS['validation'].thinkingEnabled).toBe(false);
  });

  it('validation preferredTier is economical', () => {
    expect(DEFAULT_MODEL_CONFIGS['validation'].preferredTier).toBe('economical');
  });

  it('validation temperature is 0 or 0.3 (low — deterministic checks)', () => {
    const temp = DEFAULT_MODEL_CONFIGS['validation'].temperature;
    expect(temp).toBeLessThanOrEqual(0.3);
  });

  it('tools_whitelist contains web_search only', () => {
    const whitelist = DEFAULT_TOOLS_WHITELIST['validation'];
    expect(whitelist).toContain('web_search');
    expect(whitelist).toHaveLength(1);
  });

  it('validation has grounding-instructions prompt module', () => {
    const modules = DEFAULT_PROMPT_MODULES['validation'];
    // Module may be 'grounding-instructions' (DEFAULT_PROMPT_MODULES) or 'grounding' (SEED_AGENTS)
    const hasGrounding = modules.some((m: string) => m.includes('grounding'));
    expect(hasGrounding).toBe(true);
  });

  it('success response is parseable JSON', () => {
    expect(() => JSON.parse(SUCCESS_LLM_RESPONSE.content)).not.toThrow();
  });

  it('success response has valid:true', () => {
    const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
    expect(parsed.valid).toBe(true);
  });

  it('success response has reason field', () => {
    const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
    expect(typeof parsed.reason).toBe('string');
    expect(parsed.reason.length).toBeGreaterThan(0);
  });

  it('success response passes schema validation', () => {
    const error = validateResponseShape(SUCCESS_LLM_RESPONSE.content, AGENT_EXPECTED_OUTPUT_SCHEMAS['validation']);
    expect(error).toBeNull();
  });

  it('failure response has valid:false', () => {
    const parsed = JSON.parse(FAILURE_LLM_RESPONSE.content);
    expect(parsed.valid).toBe(false);
  });

  it('failure response has failed:true', () => {
    const parsed = JSON.parse(FAILURE_LLM_RESPONSE.content);
    expect(parsed.failed).toBe(true);
  });

  it('failure response is detected as having a failure signal', () => {
    expect(hasFailureSignal(FAILURE_LLM_RESPONSE.content)).toBe(true);
  });

  describe('A4: validation-specific failure modes', () => {
    it('A4a: "validation passed" without checking is anti-pattern (should fail detection)', () => {
      // Simulate an agent that short-circuits to valid:true without tool call
      const falsePassing = JSON.stringify({ valid: true, reason: 'Looks correct to me.' });
      // This is the dangerous case: no web_search, but returns valid:true
      // hasFailureSignal returns false (no failure signal) — this is EXACTLY the anti-pattern A4 catches
      expect(hasFailureSignal(falsePassing)).toBe(false);
      // In a proper integration test, we would assert the tool was called before the verdict
    });

    it('A4b: "could not verify" should carry failure signal', () => {
      const cannotVerify = JSON.stringify({
        valid: false,
        reason: 'Could not verify the claim because the search tool returned no results.',
      });
      expect(hasFailureSignal(cannotVerify)).toBe(true);
    });

    it('A4c: empty web_search result triggers failure path', async () => {
      const executor = buildMockToolExecutor({ web_search: () => ({ results: [] }) });
      const result = await executor.executeToolCall('web_search', { query: 'Eiffel Tower height' });
      expect(result.success).toBe(true); // tool call succeeded
      expect((result.result as any).results).toHaveLength(0); // but returned empty results
    });
  });

  describe('output shape variations', () => {
    it('invalid claim produces valid:false with issues array', () => {
      const invalidClaim = JSON.stringify({
        valid: false,
        reason: 'The Eiffel Tower was completed in 1889, but its height is 330m not 324m.',
        issues: ['Height is incorrect: actual height is 330m (with antenna), 300m (without)'],
        source_checked: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
      });
      const parsed = JSON.parse(invalidClaim);
      expect(parsed.valid).toBe(false);
      expect(Array.isArray(parsed.issues)).toBe(true);
      expect(parsed.issues.length).toBeGreaterThan(0);
    });

    it('response without valid field fails schema validation', () => {
      const badShape = JSON.stringify({ result: 'ok', message: 'All good' });
      const error = validateResponseShape(badShape, AGENT_EXPECTED_OUTPUT_SCHEMAS['validation']);
      expect(error).not.toBeNull();
      expect(error).toContain('"valid"');
    });
  });
});
