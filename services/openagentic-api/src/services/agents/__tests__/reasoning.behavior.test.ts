/**
 * Reasoning Agent — Behavior Tests (A3 + A4)
 *
 * Agent: reasoning
 * Tools: web_search, web_fetch, sequential_thinking
 * Model tier: premium (thinking enabled)
 *
 * A3: Given a complex multi-step question, the reasoning agent:
 *   - Receives the synthetic prompt
 *   - (Optionally) calls web_search for grounding
 *   - Returns a structured analysis response (non-empty, substantive)
 *
 * A4: When web_search returns empty results, the agent must surface
 *   an explicit failure signal rather than a polite "I couldn't find anything."
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

const REASONING_AGENT: AgentFixture = {
  name: 'reasoning',
  display_name: 'Reasoning Agent',
  agent_type: 'reasoning',
  system_prompt: 'You are a deep reasoning agent. Analyze thoroughly and provide well-reasoned conclusions.',
  model_config: {
    primaryModel: 'auto',
    maxTokens: 8192,
    temperature: 0.7,
    preferredTier: 'premium',
  },
  tools_whitelist: DEFAULT_TOOLS_WHITELIST['reasoning'],
  prompt_modules: DEFAULT_PROMPT_MODULES['reasoning'],
};

const SYNTHETIC_PROMPT = 'Analyze the trade-offs between microservices and monolithic architecture for a startup with 3 engineers.';

const SUCCESS_WEB_SEARCH_RESULT = {
  results: [
    { title: 'Microservices vs Monolith', url: 'https://example.com/arch', snippet: 'Monoliths are simpler to deploy for small teams...' },
    { title: 'Martin Fowler on Microservices', url: 'https://martinfowler.com/micro', snippet: 'Start with a monolith then extract services as needed...' },
  ],
};

const SUCCESS_LLM_RESPONSE = {
  content: `## Architecture Analysis: Microservices vs. Monolith for a 3-Engineer Startup

**Recommendation: Monolith first.**

### Trade-offs

**Monolithic architecture advantages for small teams:**
1. Simpler deployment pipeline (single artifact)
2. Easier local development and debugging
3. Reduced operational complexity (no service mesh, no distributed tracing needed day 1)
4. Faster initial velocity

**Microservices risks at this team size:**
1. Operational overhead exceeds team capacity (k8s, service discovery, API gateways)
2. Network latency and distributed transactions increase complexity
3. Each service needs its own CI/CD, monitoring, and on-call rotation

**Conclusion:** Begin with a modular monolith. Extract services when a specific domain has independent scaling needs or a separate team owning it.`,
  model: 'test-model',
  usage: { input_tokens: 200, output_tokens: 450 },
};

const FAILURE_LLM_RESPONSE = {
  content: '[AGENT_FAILED] Unable to retrieve web search results. The search tool returned empty results and I could not ground my analysis.',
  model: 'test-model',
  usage: { input_tokens: 200, output_tokens: 50 },
};

// ---------------------------------------------------------------------------
// Run harness suite (covers A3 + A4 automatically)
// ---------------------------------------------------------------------------

runAgentBehaviorSuite({
  agent: REASONING_AGENT,
  syntheticPrompt: SYNTHETIC_PROMPT,
  successToolMocks: {
    web_search: () => SUCCESS_WEB_SEARCH_RESULT,
    web_fetch: () => ({ content: 'Monoliths are simpler for small teams...' }),
    sequential_thinking: () => ({ thought: 'Step 1: identify team constraints...', step: 1, totalSteps: 3 }),
  },
  successLLMResponse: SUCCESS_LLM_RESPONSE,
  expectedOutputSchema: AGENT_EXPECTED_OUTPUT_SCHEMAS['reasoning'],
  failureToolMocks: {
    web_search: () => null,           // null = empty result
    web_fetch: () => null,
    sequential_thinking: () => null,
  },
  failureLLMResponse: FAILURE_LLM_RESPONSE,
});

// ---------------------------------------------------------------------------
// Additional reasoning-specific assertions
// ---------------------------------------------------------------------------

describe('reasoning agent — specific contract checks', () => {
  it('reasoning agent has thinkingEnabled:true in DEFAULT_MODEL_CONFIGS', () => {
    expect(DEFAULT_MODEL_CONFIGS['reasoning'].thinkingEnabled).toBe(true);
  });

  it('reasoning agent has thinkingBudget >= 16384', () => {
    expect(DEFAULT_MODEL_CONFIGS['reasoning'].thinkingBudget).toBeGreaterThanOrEqual(16384);
  });

  it('reasoning agent preferredTier is premium', () => {
    expect(DEFAULT_MODEL_CONFIGS['reasoning'].preferredTier).toBe('premium');
  });

  it('tools_whitelist contains exactly the 3 expected tools', () => {
    const whitelist = DEFAULT_TOOLS_WHITELIST['reasoning'];
    expect(whitelist).toContain('web_search');
    expect(whitelist).toContain('web_fetch');
    expect(whitelist).toContain('sequential_thinking');
    expect(whitelist).toHaveLength(3);
  });

  it('success response passes schema validation', () => {
    const error = validateResponseShape(SUCCESS_LLM_RESPONSE.content, AGENT_EXPECTED_OUTPUT_SCHEMAS['reasoning']);
    expect(error).toBeNull();
  });

  it('failure response is detected as having a failure signal', () => {
    expect(hasFailureSignal(FAILURE_LLM_RESPONSE.content)).toBe(true);
  });

  it('success response does NOT trigger false-positive failure detection', () => {
    expect(hasFailureSignal(SUCCESS_LLM_RESPONSE.content)).toBe(false);
  });

  describe('mock LLM client integration', () => {
    let llmClient: ReturnType<typeof buildMockLLMClient>;

    beforeEach(() => {
      llmClient = buildMockLLMClient(SUCCESS_LLM_RESPONSE);
      vi.clearAllMocks();
    });

    it('passes system_prompt to LLM', async () => {
      await llmClient.createCompletion({ system: REASONING_AGENT.system_prompt!, prompt: SYNTHETIC_PROMPT });
      expect(llmClient.calls[0].system).toContain('reasoning agent');
    });

    it('passes user prompt verbatim', async () => {
      await llmClient.createCompletion({ system: REASONING_AGENT.system_prompt!, prompt: SYNTHETIC_PROMPT });
      expect(llmClient.calls[0].prompt).toBe(SYNTHETIC_PROMPT);
    });
  });

  describe('mock tool executor integration', () => {
    it('web_search mock returns synthetic results on success path', async () => {
      const executor = buildMockToolExecutor({ web_search: () => SUCCESS_WEB_SEARCH_RESULT });
      const result = await executor.executeToolCall('web_search', { query: 'microservices vs monolith' });
      expect(result.success).toBe(true);
      expect((result.result as any).results).toHaveLength(2);
    });

    it('web_search mock returns null on failure path', async () => {
      const executor = buildMockToolExecutor({ web_search: () => null });
      const result = await executor.executeToolCall('web_search', { query: 'anything' });
      expect(result.result).toBeNull();
    });

    it('unknown tool returns error shape', async () => {
      const executor = buildMockToolExecutor({});
      const result = await executor.executeToolCall('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
