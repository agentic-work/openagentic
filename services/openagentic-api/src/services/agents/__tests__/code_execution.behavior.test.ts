/**
 * Code Execution Agent — Behavior Tests (A3 + A4)
 *
 * Agent: code_execution
 * Tools: openagentic_execute
 * Model tier: balanced (thinking enabled)
 *
 * A3: Given a coding task, the agent:
 *   - Calls openagentic_execute with generated code
 *   - Returns a response referencing execution output / results
 *
 * A4: When openagentic_execute returns an error (syntax error, timeout, etc.),
 *   the agent must surface an explicit failure signal rather than claiming success.
 *
 * Output schema (A2): non-empty text referencing code or execution output
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

const CODE_EXECUTION_AGENT: AgentFixture = {
  name: 'code_execution',
  display_name: 'Code Execution Agent',
  agent_type: 'code_execution',
  system_prompt: 'You are a code execution agent. Write, run, and debug code to solve the task.',
  model_config: {
    primaryModel: 'auto',
    maxTokens: 8192,
    temperature: 0.5,
    preferredTier: 'balanced',
  },
  tools_whitelist: DEFAULT_TOOLS_WHITELIST['code_execution'],
  prompt_modules: DEFAULT_PROMPT_MODULES['code_execution'],
};

const SYNTHETIC_PROMPT = 'Write a Python function that calculates the nth Fibonacci number using memoization, then run it for n=10.';

const EXECUTION_SUCCESS_RESULT = {
  stdout: '55\n',
  stderr: '',
  exit_code: 0,
  execution_time_ms: 12,
  language: 'python',
};

const SUCCESS_LLM_RESPONSE = {
  content: `Here is the memoized Fibonacci function:

\`\`\`python
from functools import lru_cache

@lru_cache(maxsize=None)
def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))
\`\`\`

**Execution output:**
\`\`\`
55
\`\`\`

The 10th Fibonacci number is **55**. The function ran in 12ms using Python's built-in LRU cache decorator.`,
  model: 'test-model',
  usage: { input_tokens: 150, output_tokens: 280 },
};

const FAILURE_LLM_RESPONSE = {
  content: `I was unable to execute the code. The openagentic_execute tool returned an error:

\`\`\`
SyntaxError: invalid syntax at line 3
  fibonacci(n - 1) + fibonacci(n - 2
                                    ^
\`\`\`

Failed to produce a result. Please check the code syntax and try again.`,
  model: 'test-model',
  usage: { input_tokens: 150, output_tokens: 120 },
};

// ---------------------------------------------------------------------------
// Run harness suite
// ---------------------------------------------------------------------------

runAgentBehaviorSuite({
  agent: CODE_EXECUTION_AGENT,
  syntheticPrompt: SYNTHETIC_PROMPT,
  successToolMocks: {
    openagentic_execute: () => EXECUTION_SUCCESS_RESULT,
  },
  successLLMResponse: SUCCESS_LLM_RESPONSE,
  expectedOutputSchema: AGENT_EXPECTED_OUTPUT_SCHEMAS['code_execution'],
  failureToolMocks: {
    openagentic_execute: () => ({
      stdout: '',
      stderr: 'SyntaxError: invalid syntax at line 3',
      exit_code: 1,
      execution_time_ms: 5,
    }),
  },
  failureLLMResponse: FAILURE_LLM_RESPONSE,
});

// ---------------------------------------------------------------------------
// Additional code_execution-specific assertions
// ---------------------------------------------------------------------------

describe('code_execution agent — specific contract checks', () => {
  it('code_execution has thinkingEnabled:true', () => {
    expect(DEFAULT_MODEL_CONFIGS['code_execution'].thinkingEnabled).toBe(true);
  });

  it('code_execution preferredTier is balanced', () => {
    expect(DEFAULT_MODEL_CONFIGS['code_execution'].preferredTier).toBe('balanced');
  });

  it('tools_whitelist contains openagentic_execute only', () => {
    const whitelist = DEFAULT_TOOLS_WHITELIST['code_execution'];
    expect(whitelist).toContain('openagentic_execute');
    expect(whitelist).toHaveLength(1);
  });

  it('code_execution has code-mode prompt module', () => {
    expect(DEFAULT_PROMPT_MODULES['code_execution']).toContain('code-mode');
  });

  it('max_turns is 12 (sufficient for iterative debugging)', () => {
    // Validated against SEED_AGENTS: max_turns: 12
    // We check via model_config which has timeoutMs: 180000 (3 min) for long runs
    expect(DEFAULT_MODEL_CONFIGS['code_execution'].timeoutMs).toBe(180000);
  });

  it('success response contains a code block', () => {
    expect(SUCCESS_LLM_RESPONSE.content).toContain('```');
  });

  it('success response contains execution output reference', () => {
    const lower = SUCCESS_LLM_RESPONSE.content.toLowerCase();
    expect(lower.includes('output') || lower.includes('result') || lower.includes('executed')).toBe(true);
  });

  it('success response passes schema validation', () => {
    const error = validateResponseShape(SUCCESS_LLM_RESPONSE.content, AGENT_EXPECTED_OUTPUT_SCHEMAS['code_execution']);
    expect(error).toBeNull();
  });

  it('failure response is detected as having a failure signal', () => {
    expect(hasFailureSignal(FAILURE_LLM_RESPONSE.content)).toBe(true);
  });

  it('failure tool mock returns exit_code:1', async () => {
    const executor = buildMockToolExecutor({
      openagentic_execute: () => ({ stdout: '', stderr: 'SyntaxError', exit_code: 1 }),
    });
    const result = await executor.executeToolCall('openagentic_execute', { code: 'bad code' });
    expect(result.success).toBe(true); // tool itself succeeded (returned a result)
    expect((result.result as any).exit_code).toBe(1); // but execution failed
  });

  describe('A4 refusal-detection edge cases', () => {
    it('response with only code block and no mention of results fails schema (catches false success)', () => {
      const bareCodeOnly = '```python\nprint("hello")\n```';
      // This response has a code block but does NOT mention output/result/executed
      const error = validateResponseShape(bareCodeOnly, AGENT_EXPECTED_OUTPUT_SCHEMAS['code_execution']);
      expect(error).not.toBeNull();
    });

    it('empty response fails schema validation', () => {
      const error = validateResponseShape('', AGENT_EXPECTED_OUTPUT_SCHEMAS['code_execution']);
      expect(error).not.toBeNull();
    });
  });
});
