/**
 * Summarization Agent — Behavior Tests (A3 + A4)
 *
 * Agent: summarization
 * Tools: none (empty whitelist — works on provided text)
 * Model tier: economical (no thinking)
 *
 * A3: Given a long document/text, the agent:
 *   - Receives text via the user prompt (no tool calls needed)
 *   - Returns a concise, non-empty summary
 *
 * A4: When the input is empty / tool context provides nothing, the agent
 *   must surface an explicit failure signal rather than returning empty output.
 *
 * Output schema (A2): non-empty text (markdown summary), at least 20 chars
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runAgentBehaviorSuite,
  buildMockLLMClient,
  hasFailureSignal,
  validateResponseShape,
  AGENT_EXPECTED_OUTPUT_SCHEMAS,
  type AgentFixture,
} from './agentBehavior.harness.js';
import { DEFAULT_MODEL_CONFIGS, DEFAULT_TOOLS_WHITELIST, DEFAULT_PROMPT_MODULES } from '../../AgentRegistry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUMMARIZATION_AGENT: AgentFixture = {
  name: 'summarization',
  display_name: 'Summarization Agent',
  agent_type: 'summarization',
  system_prompt: 'You are a summarization specialist. Distill complex information into clear summaries.',
  model_config: {
    primaryModel: 'auto',
    maxTokens: 8192,
    temperature: 0.5,
    preferredTier: 'economical',
  },
  tools_whitelist: DEFAULT_TOOLS_WHITELIST['summarization'],
  prompt_modules: DEFAULT_PROMPT_MODULES['summarization'],
};

const LONG_DOCUMENT = `
The history of computing spans several decades and involves contributions from thousands of researchers
and engineers across the globe. The ENIAC, completed in 1945, is often cited as one of the first
general-purpose electronic digital computers. It weighed 30 tons and occupied an 1800 square foot room.
Subsequent decades saw the invention of the transistor at Bell Labs in 1947, which replaced vacuum tubes
and made computers dramatically smaller and more reliable. The integrated circuit, invented independently
by Jack Kilby and Robert Noyce in 1958-1959, further miniaturized components onto a single chip.
The microprocessor era began with Intel's 4004 in 1971, which put a complete CPU on a single chip.
This led to the personal computer revolution of the late 1970s and 1980s, with Apple, IBM, and others
bringing computing power to homes and offices. The internet, originally ARPANET (1969), grew through
the 1980s and exploded in the 1990s with the invention of the World Wide Web by Tim Berners-Lee in 1989.
Modern computing now includes cloud computing, mobile devices, artificial intelligence, and quantum computing.
`.trim();

const SYNTHETIC_PROMPT = `Summarize the following document in 3-4 bullet points:\n\n${LONG_DOCUMENT}`;

const SUCCESS_LLM_RESPONSE = {
  content: `## Computing History Summary

- **Early computing (1945-1950s):** ENIAC was one of the first general-purpose digital computers; vacuum tubes were replaced by transistors invented at Bell Labs in 1947.
- **Miniaturization (1958-1971):** Integrated circuits (Kilby/Noyce) and then Intel's 4004 microprocessor brought computing power to a single chip.
- **Personal computer revolution (1970s-1980s):** Apple, IBM, and others democratized computing access for homes and offices.
- **Internet and beyond (1969-present):** ARPANET evolved into the internet; the Web (1989) transformed communication; today's computing includes cloud, AI, and quantum computing.`,
  model: 'test-model',
  usage: { input_tokens: 400, output_tokens: 180 },
};

const FAILURE_LLM_RESPONSE = {
  content: 'Failed to produce a summary. The input document was empty or could not be processed. Unable to summarize without source text.',
  model: 'test-model',
  usage: { input_tokens: 10, output_tokens: 30 },
};

// ---------------------------------------------------------------------------
// Run harness suite
// ---------------------------------------------------------------------------

runAgentBehaviorSuite({
  agent: SUMMARIZATION_AGENT,
  syntheticPrompt: SYNTHETIC_PROMPT,
  // No tools needed — summarization works on the prompt text directly
  successToolMocks: {},
  successLLMResponse: SUCCESS_LLM_RESPONSE,
  expectedOutputSchema: AGENT_EXPECTED_OUTPUT_SCHEMAS['summarization'],
  failureToolMocks: {},
  failureLLMResponse: FAILURE_LLM_RESPONSE,
});

// ---------------------------------------------------------------------------
// Additional summarization-specific assertions
// ---------------------------------------------------------------------------

describe('summarization agent — specific contract checks', () => {
  it('summarization has thinkingEnabled:false (economical path)', () => {
    expect(DEFAULT_MODEL_CONFIGS['summarization'].thinkingEnabled).toBe(false);
  });

  it('summarization preferredTier is economical', () => {
    expect(DEFAULT_MODEL_CONFIGS['summarization'].preferredTier).toBe('economical');
  });

  it('tools_whitelist is empty (no tools — works on provided text)', () => {
    expect(DEFAULT_TOOLS_WHITELIST['summarization']).toEqual([]);
  });

  it('prompt modules do NOT include tool-calling (no tools needed)', () => {
    const modules = DEFAULT_PROMPT_MODULES['summarization'];
    const hasToolCalling = modules.some((m: string) => m.includes('tool-calling') || m.includes('tool_calling'));
    expect(hasToolCalling).toBe(false);
  });

  it('prompt modules include identity-default, safety, continuation', () => {
    const modules = DEFAULT_PROMPT_MODULES['summarization'];
    expect(modules).toContain('identity-default');
    expect(modules).toContain('safety');
    expect(modules).toContain('continuation');
  });

  it('success response contains bullet points', () => {
    expect(SUCCESS_LLM_RESPONSE.content).toContain('- ');
  });

  it('success response passes schema validation', () => {
    const error = validateResponseShape(SUCCESS_LLM_RESPONSE.content, AGENT_EXPECTED_OUTPUT_SCHEMAS['summarization']);
    expect(error).toBeNull();
  });

  it('failure response is detected as having a failure signal', () => {
    expect(hasFailureSignal(FAILURE_LLM_RESPONSE.content)).toBe(true);
  });

  it('A4: "no relevant content found" without failure signal is an anti-pattern', () => {
    // A polite non-summary is NOT acceptable — must carry failure signal
    const politeNonSummary = 'There is no relevant content to summarize from the provided text.';
    // This passes hasFailureSignal because it's just a note — but does it contain "unable to"?
    // "There is no relevant content" does NOT match our failure patterns.
    // This documents the gap: summarization must return failed:true or include failure language.
    const signal = hasFailureSignal(politeNonSummary);
    // The polite version does NOT have a signal — documenting expected anti-pattern behavior
    expect(signal).toBe(false);
    // The correct version should be: "Failed to summarize: no content provided" → signal=true
    const correctFailure = 'Failed to summarize: unable to process the provided text.';
    expect(hasFailureSignal(correctFailure)).toBe(true);
  });

  describe('response quality checks', () => {
    it('summary is shorter than the input', () => {
      expect(SUCCESS_LLM_RESPONSE.content.length).toBeLessThan(LONG_DOCUMENT.length);
    });

    it('summary mentions key computing milestones', () => {
      const content = SUCCESS_LLM_RESPONSE.content.toLowerCase();
      expect(content.includes('transistor') || content.includes('integrated circuit') || content.includes('microprocessor')).toBe(true);
    });

    it('summary has at least 4 bullet points', () => {
      const bulletCount = (SUCCESS_LLM_RESPONSE.content.match(/^- /gm) || []).length;
      expect(bulletCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('edge cases', () => {
    it('very short response (under 20 chars) fails schema validation', () => {
      const error = validateResponseShape('OK.', AGENT_EXPECTED_OUTPUT_SCHEMAS['summarization']);
      expect(error).not.toBeNull();
    });

    it('empty response fails schema validation', () => {
      const error = validateResponseShape('', AGENT_EXPECTED_OUTPUT_SCHEMAS['summarization']);
      expect(error).not.toBeNull();
    });
  });
});
