/**
 * Data Query Agent — Behavior Tests (A3 + A4)
 *
 * Agent: data_query
 * Tools: admin_postgres_raw_query, query_data
 * Model tier: economical (no thinking, fast)
 *
 * A3: Given a data query prompt, the agent:
 *   - Calls query_data or admin_postgres_raw_query
 *   - Returns a JSON response with a "rows" array
 *
 * A4: When query_data returns empty results / DB error, the agent must
 *   surface an explicit failure signal (not silently return empty rows).
 *
 * Output schema (A2): { rows: Array<Record<string, unknown>> }
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

const DATA_QUERY_AGENT: AgentFixture = {
  name: 'data_query',
  display_name: 'Data Query Agent',
  agent_type: 'data_query',
  system_prompt: 'You are a data query specialist. Extract and return structured data efficiently.',
  model_config: {
    primaryModel: 'auto',
    maxTokens: 8192,
    temperature: 0.3,
    preferredTier: 'economical',
  },
  tools_whitelist: DEFAULT_TOOLS_WHITELIST['data_query'],
  prompt_modules: DEFAULT_PROMPT_MODULES['data_query'],
};

const SYNTHETIC_PROMPT = 'List the top 5 users by message count in the last 7 days.';

const SYNTHETIC_DB_ROWS = [
  { user_id: 'u001', username: 'alice', message_count: 142 },
  { user_id: 'u002', username: 'bob', message_count: 98 },
  { user_id: 'u003', username: 'carol', message_count: 87 },
  { user_id: 'u004', username: 'dave', message_count: 65 },
  { user_id: 'u005', username: 'eve', message_count: 43 },
];

const SUCCESS_LLM_RESPONSE = {
  content: JSON.stringify({
    rows: SYNTHETIC_DB_ROWS,
    query: 'SELECT user_id, username, COUNT(*) as message_count FROM messages WHERE created_at > NOW() - INTERVAL \'7 days\' GROUP BY user_id, username ORDER BY message_count DESC LIMIT 5',
    row_count: 5,
  }),
  model: 'test-model',
  usage: { input_tokens: 120, output_tokens: 200 },
};

const FAILURE_LLM_RESPONSE = {
  content: JSON.stringify({
    rows: [],
    error: 'query_data tool returned an error: relation "messages" does not exist',
    failed: true,
    query_attempted: 'SELECT user_id, username, COUNT(*) as message_count FROM messages...',
  }),
  model: 'test-model',
  usage: { input_tokens: 120, output_tokens: 80 },
};

// ---------------------------------------------------------------------------
// Run harness suite
// ---------------------------------------------------------------------------

runAgentBehaviorSuite({
  agent: DATA_QUERY_AGENT,
  syntheticPrompt: SYNTHETIC_PROMPT,
  successToolMocks: {
    query_data: () => ({ rows: SYNTHETIC_DB_ROWS, row_count: 5 }),
    admin_postgres_raw_query: () => ({ rows: SYNTHETIC_DB_ROWS, row_count: 5 }),
  },
  successLLMResponse: SUCCESS_LLM_RESPONSE,
  expectedOutputSchema: AGENT_EXPECTED_OUTPUT_SCHEMAS['data_query'],
  failureToolMocks: {
    query_data: () => null,                 // tool returns null = DB error
    admin_postgres_raw_query: () => null,
  },
  failureLLMResponse: FAILURE_LLM_RESPONSE,
});

// ---------------------------------------------------------------------------
// Additional data_query-specific assertions
// ---------------------------------------------------------------------------

describe('data_query agent — specific contract checks', () => {
  it('data_query agent has thinkingEnabled:false (fast path)', () => {
    expect(DEFAULT_MODEL_CONFIGS['data_query'].thinkingEnabled).toBe(false);
  });

  it('data_query agent preferredTier is economical', () => {
    expect(DEFAULT_MODEL_CONFIGS['data_query'].preferredTier).toBe('economical');
  });

  it('tools_whitelist contains admin_postgres_raw_query and query_data', () => {
    const whitelist = DEFAULT_TOOLS_WHITELIST['data_query'];
    expect(whitelist).toContain('admin_postgres_raw_query');
    expect(whitelist).toContain('query_data');
  });

  it('data_query agent has data-efficiency prompt module', () => {
    expect(DEFAULT_PROMPT_MODULES['data_query']).toContain('data-efficiency');
  });

  it('success response is valid JSON with rows array', () => {
    const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.rows).toHaveLength(5);
  });

  it('success response passes schema validation', () => {
    const error = validateResponseShape(SUCCESS_LLM_RESPONSE.content, AGENT_EXPECTED_OUTPUT_SCHEMAS['data_query']);
    expect(error).toBeNull();
  });

  it('failure response JSON has failed:true', () => {
    const parsed = JSON.parse(FAILURE_LLM_RESPONSE.content);
    expect(parsed.failed).toBe(true);
  });

  it('failure response is detected as having a failure signal', () => {
    expect(hasFailureSignal(FAILURE_LLM_RESPONSE.content)).toBe(true);
  });

  it('A4: polite "no results" response WITHOUT failure signal fails the detector', () => {
    // This verifies the detector is not over-permissive
    const politeButFailing = JSON.stringify({ rows: [], message: 'I found no matching records.' });
    // rows is empty and no failure signal — hasFailureSignal should return false
    expect(hasFailureSignal(politeButFailing)).toBe(false);
    // This is the "polite success" anti-pattern A4 rejects.
    // The agent MUST include failed:true or error key in such cases.
  });

  describe('query_data tool mock', () => {
    it('success path mock returns rows', async () => {
      const executor = buildMockToolExecutor({ query_data: () => ({ rows: SYNTHETIC_DB_ROWS, row_count: 5 }) });
      const result = await executor.executeToolCall('query_data', { sql: 'SELECT...' });
      expect(result.success).toBe(true);
      expect((result.result as any).rows).toHaveLength(5);
    });

    it('failure path mock returns null', async () => {
      const executor = buildMockToolExecutor({ query_data: () => null });
      const result = await executor.executeToolCall('query_data', { sql: 'SELECT...' });
      expect(result.result).toBeNull();
    });

    it('tool not in whitelist is handled as unknown-tool error', async () => {
      const executor = buildMockToolExecutor({ query_data: () => ({ rows: [] }) });
      // web_search is NOT in data_query's whitelist
      const result = await executor.executeToolCall('web_search', {});
      expect(result.success).toBe(false);
    });
  });

  describe('output shape variations', () => {
    it('response with row_count matches rows array length', () => {
      const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
      expect(parsed.row_count).toBe(parsed.rows.length);
    });

    it('each row has user_id, username, message_count', () => {
      const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
      for (const row of parsed.rows) {
        expect(row).toHaveProperty('user_id');
        expect(row).toHaveProperty('username');
        expect(row).toHaveProperty('message_count');
      }
    });

    it('rows are in descending order by message_count', () => {
      const parsed = JSON.parse(SUCCESS_LLM_RESPONSE.content);
      for (let i = 1; i < parsed.rows.length; i++) {
        expect(parsed.rows[i].message_count).toBeLessThanOrEqual(parsed.rows[i - 1].message_count);
      }
    });
  });
});
