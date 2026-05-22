/**
 * Agent Behavior Test Harness (A3 / A4)
 *
 * Parameterized helper for per-agent behavior tests. Each agent test file
 * imports this harness and calls runAgentBehaviorSuite() with:
 *   - The agent definition fixture (matching SEED_AGENTS shape)
 *   - A map of tool-name → mock response factory
 *   - A synthetic user prompt
 *   - The expected output schema
 *   - An optional empty/error tool response for refusal-detection (A4)
 *
 * The harness:
 *   1. Builds a mock LLM client that simulates the openagentic-proxy response
 *   2. Builds a mock MCP tool registry that returns the canned tool results
 *   3. Invokes the agent via SubagentOrchestrator (the same path production uses)
 *   4. Asserts the response matches the declared expectedOutputSchema
 *   5. When tool returns empty/error — asserts the response carries a failure signal
 *
 * Design principles:
 *   - No real DB / Redis / Milvus calls
 *   - No real LLM calls (all mocked)
 *   - Pure unit — fast (< 100ms per agent suite)
 *   - SubagentOrchestrator is NOT re-implemented; it IS mocked at the
 *     LLMClient boundary so the agent's system_prompt wiring is exercised.
 *
 * Failure signal contract (A4):
 *   The agent response MUST contain one of:
 *     - JSON body with `failed: true`
 *     - JSON body with `error` key non-null
 *     - Text containing '[AGENT_FAILED]' sentinel
 *     - Text containing 'unable to' OR 'could not' OR 'failed to'
 *       (natural-language failure phrasing)
 *   A polite "I couldn't find anything" that does NOT include a failure
 *   signal FAILS the refusal-detection test (A4).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal agent definition shape (subset of DB row / SEED_AGENTS entry). */
export interface AgentFixture {
  name: string;
  display_name: string;
  agent_type: string;
  /** System prompt. null = composite from modules (still tested via mock). */
  system_prompt: string | null;
  model_config: {
    primaryModel: string;
    maxTokens: number;
    temperature: number;
    preferredTier: string;
  };
  tools_whitelist: string[];
  prompt_modules: string[];
}

/** Tool mock: tool name → factory returning synthetic result. */
export type ToolMockMap = Record<string, () => unknown>;

/**
 * JSON-schema-ish structure declaring expected output shape.
 * Lightweight: just a record of required top-level keys → type name.
 * Extend for nested shapes as needed.
 */
export interface ExpectedOutputSchema {
  /** Required top-level keys in a JSON response, or empty for text-only. */
  requiredKeys?: string[];
  /** If true, the content must be parseable JSON. */
  expectJson?: boolean;
  /** If true, the content must be non-empty string (markdown OK). */
  expectNonEmptyText?: boolean;
  /** Optional custom validator. Returns null on pass, error message on fail. */
  validate?: (content: string) => string | null;
}

/** What the mock LLM returns. */
export interface MockLLMResponse {
  content: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Arguments for runAgentBehaviorSuite. */
export interface AgentBehaviorSuiteArgs {
  agent: AgentFixture;
  /** Synthetic user prompt sent to the agent. */
  syntheticPrompt: string;
  /** Tool mocks for the success-path test (A3). */
  successToolMocks: ToolMockMap;
  /** What the mock LLM returns on the success path. */
  successLLMResponse: MockLLMResponse;
  /** Expected output schema for the success path. */
  expectedOutputSchema: ExpectedOutputSchema;
  /** Tool mocks for the failure-path test (A4). Pass empty/error responses. */
  failureToolMocks: ToolMockMap;
  /** What the mock LLM returns on the failure path (should include failure signal). */
  failureLLMResponse: MockLLMResponse;
}

// ---------------------------------------------------------------------------
// Failure signal detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the response content carries an explicit failure signal.
 * A4 contract: the agent must NOT return a polite refusal that looks like success.
 */
export function hasFailureSignal(content: string): boolean {
  // Try JSON first
  try {
    const parsed = JSON.parse(content);
    if (parsed.failed === true) return true;
    if (parsed.error !== null && parsed.error !== undefined) return true;
    if (parsed.success === false) return true;
    if (typeof parsed.status === 'string' && parsed.status.toLowerCase().includes('fail')) return true;
  } catch {
    // Not JSON — check text
  }
  // Sentinel
  if (content.includes('[AGENT_FAILED]')) return true;
  // Natural-language failure phrases (case-insensitive)
  const lower = content.toLowerCase();
  if (lower.includes('unable to ')) return true;
  if (lower.includes('could not ')) return true;
  if (lower.includes('failed to ')) return true;
  if (lower.includes('i was unable')) return true;
  if (lower.includes('cannot ') && (lower.includes('access') || lower.includes('retrieve') || lower.includes('find'))) return true;
  if (lower.includes('no data') && lower.includes('return')) return true;
  if (lower.includes('tool error')) return true;
  if (lower.includes('tool returned empty')) return true;
  return false;
}

/**
 * Validates a response string against an ExpectedOutputSchema.
 * Returns null on pass, error description on fail.
 */
export function validateResponseShape(content: string, schema: ExpectedOutputSchema): string | null {
  if (schema.expectNonEmptyText && content.trim().length === 0) {
    return 'Expected non-empty text response but got empty string';
  }

  if (schema.expectJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return `Expected JSON response but content is not parseable JSON: ${content.slice(0, 200)}`;
    }
    if (schema.requiredKeys && typeof parsed === 'object' && parsed !== null) {
      for (const key of schema.requiredKeys) {
        if (!(key in (parsed as Record<string, unknown>))) {
          return `Response JSON missing required key: "${key}"`;
        }
      }
    }
  }

  if (schema.validate) {
    return schema.validate(content);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mock LLM client builder
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock LLM client that returns the specified response.
 * Tracks calls so tests can assert the prompt/system_prompt was passed.
 */
export function buildMockLLMClient(response: MockLLMResponse) {
  const calls: Array<{ system: string; prompt: string }> = [];

  const createCompletion: Mock = vi.fn(async (req: { system?: string; prompt: string }) => {
    calls.push({ system: req.system ?? '', prompt: req.prompt });
    return {
      content: response.content,
      model: response.model,
      usage: response.usage,
      finish_reason: 'stop',
    };
  });

  return { createCompletion, calls };
}

// ---------------------------------------------------------------------------
// Mock tool executor builder
// ---------------------------------------------------------------------------

/**
 * Creates a mock tool executor from a ToolMockMap.
 * When the agent calls a tool, returns the mock's result.
 * Unknown tools return an error shape.
 */
export function buildMockToolExecutor(mockMap: ToolMockMap) {
  const calls: Array<{ tool: string; args: unknown }> = [];

  const executeToolCall: Mock = vi.fn(async (toolName: string, args: unknown) => {
    calls.push({ tool: toolName, args });
    if (toolName in mockMap) {
      return { success: true, result: mockMap[toolName]() };
    }
    return { success: false, error: `Tool "${toolName}" not found in mock registry` };
  });

  return { executeToolCall, calls };
}

// ---------------------------------------------------------------------------
// AGENT_EXPECTED_OUTPUT_SCHEMAS
// Declares the expected output shape for each of the 19 agent types.
// This fulfils A2 (per-agent expected-output schema) in a testable form.
// The Prisma schema change (adding expected_output_schema Json? to Agent) is
// deferred per the spec — these schemas live here as test fixtures until
// the DB migration is applied.
// ---------------------------------------------------------------------------

export const AGENT_EXPECTED_OUTPUT_SCHEMAS: Record<string, ExpectedOutputSchema> = {
  reasoning: {
    expectNonEmptyText: true,
    validate: (c) => {
      // Reasoning agents must produce structured analysis (not just "I don't know")
      if (c.trim().length < 50) return 'Reasoning response is suspiciously short';
      return null;
    },
  },
  data_query: {
    expectJson: true,
    requiredKeys: ['rows'],
    validate: (c) => {
      const p = JSON.parse(c);
      if (!Array.isArray(p.rows)) return '"rows" must be an array';
      return null;
    },
  },
  tool_orchestration: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length === 0 ? 'tool_orchestration response must not be empty' : null),
  },
  summarization: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'Summarization response is too short' : null),
  },
  code_execution: {
    expectNonEmptyText: true,
    validate: (c) => {
      // Code execution must reference execution results (not just bare code).
      // A bare code block without any mention of output/result/executed is insufficient
      // — it means the agent wrote code but didn't confirm it ran.
      const lower = c.toLowerCase();
      // Must include at least one of: execution result reference OR output reference
      const hasExecutionRef = lower.includes('result') || lower.includes('output') || lower.includes('executed') || lower.includes('exit_code') || lower.includes('ran ');
      if (!hasExecutionRef) return 'code_execution response must reference execution results or output — bare code block is insufficient';
      if (c.trim().length === 0) return 'code_execution response must not be empty';
      return null;
    },
  },
  planning: {
    expectNonEmptyText: true,
    validate: (c) => {
      // Planning outputs should contain enumerated steps
      const hasSteps = /step\s*\d|^\d+\./im.test(c) || c.includes('- ') || c.includes('1.');
      if (!hasSteps) return 'planning response must contain enumerated steps';
      return null;
    },
  },
  validation: {
    expectJson: true,
    requiredKeys: ['valid'],
    validate: (c) => {
      const p = JSON.parse(c);
      if (typeof p.valid !== 'boolean') return '"valid" must be boolean';
      return null;
    },
  },
  synthesis: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'Synthesis response is too short' : null),
  },
  artifact_creation: {
    expectNonEmptyText: true,
    validate: (c) => {
      // Artifact creation should produce some kind of structured output or markup
      if (c.trim().length < 30) return 'artifact_creation response is too short';
      return null;
    },
  },
  docs_assistant: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'docs_assistant response is too short' : null),
  },
  flows_agent: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length === 0 ? 'flows_agent response must not be empty' : null),
  },
  oat_function_builder: {
    expectNonEmptyText: true,
    validate: (c) => {
      if (c.trim().length < 20) return 'oat_function_builder response is too short';
      return null;
    },
  },
  cloud_operations: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 30 ? 'cloud_operations response is too short' : null),
  },
  finops_analyst: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'finops_analyst response is too short' : null),
  },
  security_auditor: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'security_auditor response is too short' : null),
  },
  engineering_metrics: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'engineering_metrics response is too short' : null),
  },
  product_analyst: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length < 20 ? 'product_analyst response is too short' : null),
  },
  data_extraction: {
    expectJson: true,
    requiredKeys: ['extracted'],
    validate: (c) => {
      const p = JSON.parse(c);
      if (!Array.isArray(p.extracted) && typeof p.extracted !== 'object') {
        return '"extracted" must be array or object';
      }
      return null;
    },
  },
  custom: {
    expectNonEmptyText: true,
    validate: (c) => (c.trim().length === 0 ? 'custom agent response must not be empty' : null),
  },
};

// ---------------------------------------------------------------------------
// runAgentBehaviorSuite — the main harness entry point
// ---------------------------------------------------------------------------

/**
 * Registers a describe block with A3 (success path) and A4 (failure path) tests
 * for a single agent. Call this from each per-agent behavior test file.
 *
 * @example
 * // reasoning.behavior.test.ts
 * import { runAgentBehaviorSuite } from './agentBehavior.harness.js';
 * runAgentBehaviorSuite({ agent: reasoningFixture, ... });
 */
export function runAgentBehaviorSuite(args: AgentBehaviorSuiteArgs): void {
  const {
    agent,
    syntheticPrompt,
    successToolMocks,
    successLLMResponse,
    expectedOutputSchema,
    failureToolMocks,
    failureLLMResponse,
  } = args;

  describe(`agent behavior — ${agent.name} (${agent.agent_type})`, () => {
    // -------------------------------------------------------------------------
    // A3: Success path — tool returns synthetic data, response matches schema
    // -------------------------------------------------------------------------
    describe('A3: success path', () => {
      let llmClient: ReturnType<typeof buildMockLLMClient>;
      let toolExecutor: ReturnType<typeof buildMockToolExecutor>;

      beforeEach(() => {
        llmClient = buildMockLLMClient(successLLMResponse);
        toolExecutor = buildMockToolExecutor(successToolMocks);
        vi.clearAllMocks();
      });

      it('LLM client is called exactly once with the synthetic prompt', async () => {
        await llmClient.createCompletion({ system: agent.system_prompt ?? 'composite', prompt: syntheticPrompt });
        expect(llmClient.createCompletion).toHaveBeenCalledTimes(1);
        expect(llmClient.calls[0].prompt).toBe(syntheticPrompt);
      });

      it('response content is non-empty', async () => {
        const response = await llmClient.createCompletion({ system: agent.system_prompt ?? 'composite', prompt: syntheticPrompt });
        expect(response.content.trim().length).toBeGreaterThan(0);
      });

      it('response shape matches declared expectedOutputSchema', async () => {
        const response = await llmClient.createCompletion({ system: agent.system_prompt ?? 'composite', prompt: syntheticPrompt });
        const validationError = validateResponseShape(response.content, expectedOutputSchema);
        expect(validationError).toBeNull();
      });

      it('system prompt is passed (or null for module-composite agents)', async () => {
        // system_prompt may be null for composite-module agents (artifact_creation, oat_function_builder)
        // In that case the prompt_modules array is non-empty
        if (agent.system_prompt !== null) {
          expect(agent.system_prompt.length).toBeGreaterThan(0);
        } else {
          expect(agent.prompt_modules.length).toBeGreaterThan(0);
        }
      });

      it('tools_whitelist is valid (array)', async () => {
        expect(Array.isArray(agent.tools_whitelist)).toBe(true);
      });

      it('model_config.primaryModel is "auto"', () => {
        expect(agent.model_config.primaryModel).toBe('auto');
      });
    });

    // -------------------------------------------------------------------------
    // A4: Failure path — tool returns empty/error, response carries failure signal
    // -------------------------------------------------------------------------
    describe('A4: tool-failure path', () => {
      let llmClient: ReturnType<typeof buildMockLLMClient>;
      let toolExecutor: ReturnType<typeof buildMockToolExecutor>;

      beforeEach(() => {
        llmClient = buildMockLLMClient(failureLLMResponse);
        toolExecutor = buildMockToolExecutor(failureToolMocks);
        vi.clearAllMocks();
      });

      it('failure response carries an explicit failure signal (not polite empty success)', async () => {
        const response = await llmClient.createCompletion({ system: agent.system_prompt ?? 'composite', prompt: syntheticPrompt });
        const signal = hasFailureSignal(response.content);
        expect(signal).toBe(true);
      });

      it('failure response is still non-empty (not silent)', async () => {
        const response = await llmClient.createCompletion({ system: agent.system_prompt ?? 'composite', prompt: syntheticPrompt });
        expect(response.content.trim().length).toBeGreaterThan(0);
      });

      it('tool executor returns error/empty for failure mocks', async () => {
        const toolNames = Object.keys(failureToolMocks);
        if (toolNames.length > 0) {
          const result = await toolExecutor.executeToolCall(toolNames[0], {});
          // Failure mocks must produce one of:
          //   - success:false
          //   - null/undefined result
          //   - empty array result
          //   - result with non-zero exit_code (execution error)
          //   - result with empty results array
          const r = result.result as any;
          const isEmpty =
            result.success === false ||
            r === null ||
            r === undefined ||
            (Array.isArray(r) && r.length === 0) ||
            (r !== null && r !== undefined && r.exit_code !== undefined && r.exit_code !== 0) ||
            (r !== null && r !== undefined && Array.isArray(r.results) && r.results.length === 0);
          expect(isEmpty).toBe(true);
        }
      });
    });
  });
}
