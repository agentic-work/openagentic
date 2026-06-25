/**
 * nodeSummary.test.ts — RED-first tests for the human-readable post-run
 * summary string that surfaces in canvas hover tooltips when a node is in
 * the completed state.
 *
 * User directive 2026-05-14: hover on completed nodes must show a
 * human-readable rendered summary, NOT raw JSON or just "completed".
 *
 * Coverage targets: every node type registered in nodeConfigs.ts, plus
 * a `default` fallback. Each case asserts the summary string is short,
 * specific to the node-type, and references concrete output data.
 */

import { describe, it, expect } from 'vitest';
import { summarizeNodeRun } from '../nodeSummary';

describe('summarizeNodeRun', () => {
  describe('fallback', () => {
    it('returns "Completed" for unknown node types with empty output', () => {
      expect(summarizeNodeRun('some_unregistered_type', {})).toBe('Completed');
    });

    it('returns "Completed" for null output', () => {
      expect(summarizeNodeRun('mcp_tool', null)).toBe('Completed');
    });

    it('returns "Completed" for undefined output', () => {
      expect(summarizeNodeRun('mcp_tool', undefined)).toBe('Completed');
    });
  });

  describe('mcp_tool', () => {
    it('counts items in array output', () => {
      expect(summarizeNodeRun('mcp_tool', { items: [1, 2, 3, 4] })).toBe('Returned 4 items');
    });

    it('counts pods array (common k8s shape)', () => {
      expect(summarizeNodeRun('mcp_tool', { pods: [{}, {}, {}] })).toBe('Returned 3 items');
    });

    it('counts data field arrays', () => {
      expect(summarizeNodeRun('mcp_tool', { data: [1, 2] })).toBe('Returned 2 items');
    });

    it('parses content JSON string for items', () => {
      const out = { content: JSON.stringify({ pods: [{}, {}, {}, {}, {}] }) };
      expect(summarizeNodeRun('mcp_tool', out)).toBe('Returned 5 items');
    });

    it('reports field count when no array present', () => {
      expect(summarizeNodeRun('mcp_tool', { foo: 1, bar: 2, baz: 3 })).toBe('Returned data with 3 fields');
    });
  });

  describe('llm_completion / chat / reasoning / openagentic_llm', () => {
    it('reports word count for content', () => {
      const out = { content: 'one two three four five six' };
      expect(summarizeNodeRun('llm_completion', out)).toBe('Generated 6 words');
    });

    it('adds token usage when present', () => {
      const out = {
        content: 'a b c d e',
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
      expect(summarizeNodeRun('llm_completion', out)).toBe('Generated 5 words (100/50 tokens)');
    });

    it('falls back to total_tokens when prompt/completion absent', () => {
      const out = { content: 'a b c', usage: { total_tokens: 999 } };
      expect(summarizeNodeRun('llm_completion', out)).toBe('Generated 3 words (999 tokens)');
    });

    it('handles openagentic_llm shape', () => {
      const out = { content: 'hi there world' };
      expect(summarizeNodeRun('openagentic_llm', out)).toBe('Generated 3 words');
    });

    it('handles reasoning node', () => {
      expect(summarizeNodeRun('reasoning', { content: 'one two' })).toBe('Generated 2 words');
    });

    it('handles synth node', () => {
      expect(summarizeNodeRun('synth', { content: 'x y z' })).toBe('Generated 3 words');
    });

    it('handles structured_output as JSON-shape', () => {
      const out = { output: { foo: 1, bar: 2 } };
      expect(summarizeNodeRun('structured_output', out)).toBe('Produced structured output with 2 fields');
    });
  });

  describe('agent nodes', () => {
    it('reports words + tool calls for agent_single', () => {
      const out = { content: 'aa bb cc', toolCalls: 4 };
      expect(summarizeNodeRun('agent_single', out)).toBe('Agent produced 3 words (4 tool calls)');
    });

    it('reports words alone when no tool calls', () => {
      expect(summarizeNodeRun('agent_pool', { content: 'a b' })).toBe('Agent produced 2 words');
    });

    it('covers agent_spawn', () => {
      expect(summarizeNodeRun('agent_spawn', { content: 'a' })).toBe('Agent produced 1 words');
    });

    it('covers agent_supervisor with turn count', () => {
      expect(summarizeNodeRun('agent_supervisor', { content: 'x', turns: 5 })).toBe('Agent produced 1 words (5 turns)');
    });

    it('covers multi_agent', () => {
      const out = { content: 'a b c', agentCount: 3 };
      expect(summarizeNodeRun('multi_agent', out)).toBe('3 agents produced 3 words');
    });
  });

  describe('control flow', () => {
    it('condition reports branch', () => {
      expect(summarizeNodeRun('condition', { branch: 'true' })).toBe('Routed to true branch');
    });

    it('switch reports selected case', () => {
      expect(summarizeNodeRun('switch', { case: 'critical' })).toBe('Routed to critical case');
    });

    it('loop reports iteration count', () => {
      expect(summarizeNodeRun('loop', { iterations: 12 })).toBe('Iterated 12 times');
    });

    it('parallel reports branch count', () => {
      expect(summarizeNodeRun('parallel', { branches: 4 })).toBe('Ran 4 branches in parallel');
    });

    it('merge reports source count', () => {
      expect(summarizeNodeRun('merge', { sources: 3 })).toBe('Merged 3 inputs');
    });

    it('wait reports duration', () => {
      expect(summarizeNodeRun('wait', { waitedMs: 2500 })).toBe('Waited 2.5s');
    });
  });

  describe('http + webhook', () => {
    it('http_request reports status code', () => {
      expect(summarizeNodeRun('http_request', { statusCode: 200 })).toBe('HTTP 200');
    });

    it('http_request shows fallback when no statusCode', () => {
      expect(summarizeNodeRun('http_request', {})).toBe('HTTP request completed');
    });

    it('webhook_response reports body size + status', () => {
      const body = 'x'.repeat(2048);
      const result = summarizeNodeRun('webhook_response', { body, statusCode: 200 });
      expect(result).toContain('2.0 KB');
      expect(result).toContain('HTTP 200');
    });
  });

  describe('data nodes', () => {
    it('transform reports operations applied', () => {
      const out = { operations: [{ op: 'set' }, { op: 'set' }] };
      expect(summarizeNodeRun('transform', out)).toBe('Applied 2 transforms');
    });

    it('transform with applied keys list', () => {
      expect(summarizeNodeRun('transform', { keysSet: ['a', 'b', 'c'] })).toBe('Applied 3 transforms');
    });

    it('rag_query reports matches', () => {
      expect(summarizeNodeRun('rag_query', { matches: [1, 2, 3] })).toBe('Retrieved 3 matches');
    });

    it('data_source_query reports rows', () => {
      expect(summarizeNodeRun('data_source_query', { rows: [{}, {}, {}, {}] })).toBe('Returned 4 rows');
    });

    it('file_upload reports filename', () => {
      expect(summarizeNodeRun('file_upload', { filename: 'doc.pdf' })).toBe('Uploaded doc.pdf');
    });

    it('text_splitter reports chunks', () => {
      expect(summarizeNodeRun('text_splitter', { chunks: [1, 2, 3, 4, 5] })).toBe('Split into 5 chunks');
    });

    it('embedding reports vector count', () => {
      expect(summarizeNodeRun('embedding', { vectors: 8 })).toBe('Generated 8 embeddings');
    });

    it('vector_store reports stored count', () => {
      expect(summarizeNodeRun('vector_store', { stored: 12 })).toBe('Stored 12 vectors');
    });

    it('document_loader reports document count', () => {
      expect(summarizeNodeRun('document_loader', { documents: [1, 2] })).toBe('Loaded 2 documents');
    });
  });

  describe('integration / messaging nodes', () => {
    it('slack_message reports channel', () => {
      expect(summarizeNodeRun('slack_message', { channel: '#devops' })).toBe('Sent Slack message to #devops');
    });

    it('teams_message reports channel', () => {
      expect(summarizeNodeRun('teams_message', { channel: 'Engineering' })).toBe('Sent Teams message to Engineering');
    });

    it('discord_message reports channel', () => {
      expect(summarizeNodeRun('discord_message', { channel: 'general' })).toBe('Sent Discord message to general');
    });

    it('send_email reports recipient', () => {
      expect(summarizeNodeRun('send_email', { to: 'a@b.com' })).toBe('Sent email to a@b.com');
    });

    it('outlook_email reports recipient', () => {
      expect(summarizeNodeRun('outlook_email', { to: 'a@b.com' })).toBe('Sent email to a@b.com');
    });

    it('pagerduty_incident reports incident id', () => {
      expect(summarizeNodeRun('pagerduty_incident', { incidentId: 'PD123' })).toBe('Created PagerDuty incident PD123');
    });

    it('servicenow_ticket reports ticket id', () => {
      expect(summarizeNodeRun('servicenow_ticket', { ticketId: 'INC456' })).toBe('Created ServiceNow ticket INC456');
    });

    it('jira_issue reports key', () => {
      expect(summarizeNodeRun('jira_issue', { key: 'PROJ-789' })).toBe('Created Jira issue PROJ-789');
    });
  });

  describe('approval / human-in-the-loop', () => {
    it('approval reports decision', () => {
      expect(summarizeNodeRun('approval', { decision: 'approved' })).toBe('Decision: approved');
    });

    it('human_approval reports decision + approver', () => {
      const out = { decision: 'rejected', approver: 'alice' };
      expect(summarizeNodeRun('human_approval', out)).toBe('Decision: rejected by alice');
    });
  });

  describe('misc', () => {
    it('trigger reports trigger fired', () => {
      expect(summarizeNodeRun('trigger', { fired: true })).toBe('Trigger fired');
    });

    it('code reports lines executed', () => {
      expect(summarizeNodeRun('code', { stdout: 'a\nb\nc' })).toBe('Executed code (3 lines stdout)');
    });

    it('code with result reports return value type', () => {
      expect(summarizeNodeRun('code', { result: { foo: 1 } })).toBe('Executed code (returned object)');
    });

    it('sub_workflow reports nested workflow', () => {
      expect(summarizeNodeRun('sub_workflow', { workflowName: 'cleanup' })).toBe('Ran sub-workflow: cleanup');
    });

    it('user_context reports user identity', () => {
      expect(summarizeNodeRun('user_context', { userId: 'u_123' })).toBe('Loaded user context u_123');
    });

    it('error_handler reports caught error', () => {
      expect(summarizeNodeRun('error_handler', { handledError: 'TimeoutError' })).toBe('Handled error: TimeoutError');
    });

    it('guardrails reports passes/fails', () => {
      expect(summarizeNodeRun('guardrails', { passed: 4, failed: 1 })).toBe('Guardrails: 4 passed, 1 failed');
    });

    it('text reports char count', () => {
      expect(summarizeNodeRun('text', { content: 'hello world' })).toBe('11 characters');
    });
  });

  describe('output_parser split — typed processing primitives', () => {
    it('filter_data reports kept-of-total ratio', () => {
      expect(
        summarizeNodeRun('filter_data', {
          filtered: [{ x: 1 }, { x: 2 }],
          droppedCount: 3,
          totalCount: 5,
        }),
      ).toBe('Filtered to 2 of 5 items');
    });

    it('select_data on array reports row count', () => {
      expect(
        summarizeNodeRun('select_data', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
      ).toBe('Kept 3 rows with selected fields');
    });

    it('select_data on object reports field count', () => {
      expect(summarizeNodeRun('select_data', { name: 'a', status: 'b' })).toBe('Kept 2 fields');
    });

    it('extract_key found=true reports preview', () => {
      expect(
        summarizeNodeRun('extract_key', { value: 'openagentic-api', found: true }),
      ).toBe('Extracted: openagentic-api');
    });

    it('extract_key found=false reports fallback', () => {
      expect(
        summarizeNodeRun('extract_key', { value: 'default', found: false }),
      ).toBe('Path not found (used default)');
    });

    it('parse_json success reports key count', () => {
      expect(
        summarizeNodeRun('parse_json', { parsed: { a: 1, b: 2, c: 3 }, parseError: null }),
      ).toBe('Parsed 3 keys');
    });

    it('parse_json on array reports element count', () => {
      expect(
        summarizeNodeRun('parse_json', { parsed: [1, 2, 3, 4], parseError: null }),
      ).toBe('Parsed array (4 items)');
    });

    it('parse_json error reports parse failure', () => {
      expect(
        summarizeNodeRun('parse_json', { parsed: null, parseError: 'parse_json: Unexpected token' }),
      ).toMatch(/^Parse failed:/);
    });

    it('regex match mode reports count', () => {
      expect(
        summarizeNodeRun('regex', {
          matches: [
            { full: 'a@b.io', groups: ['a', 'b.io'] },
            { full: 'c@d.io', groups: ['c', 'd.io'] },
          ],
          count: 2,
        }),
      ).toBe('Found 2 matches');
    });

    it('regex replace mode reports replacement count', () => {
      expect(
        summarizeNodeRun('regex', { result: '...', replacedCount: 3 }),
      ).toBe('Replaced 3 occurrences');
    });

    it('regex test mode reports boolean', () => {
      expect(summarizeNodeRun('regex', { matches: true })).toBe('Pattern matched');
      expect(summarizeNodeRun('regex', { matches: false })).toBe('Pattern did not match');
    });
  });

  describe('gap-analysis P0 nodes — prompt_template / conversation_memory / flow_tool', () => {
    it('prompt_template prompt mode reports rendered length + variable count', () => {
      expect(
        summarizeNodeRun('prompt_template', {
          prompt: 'Summarize foo in bar.',
          variables: { x: '1', y: '2', z: '3' },
          outputAs: 'prompt',
        }),
      ).toBe('Rendered 21-char prompt with 3 variables');
    });

    it('prompt_template messages mode reports conversation length', () => {
      expect(
        summarizeNodeRun('prompt_template', {
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
          variables: { style: 'concise' },
          outputAs: 'messages',
        }),
      ).toBe('Built 2-message conversation with 1 variables');
    });

    it('conversation_memory write reports total', () => {
      expect(
        summarizeNodeRun('conversation_memory', {
          written: true,
          total: 5,
          operation: 'write',
        }),
      ).toBe('Wrote 1 message (total: 5)');
    });

    it('conversation_memory read reports count', () => {
      expect(
        summarizeNodeRun('conversation_memory', {
          messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
          count: 2,
          operation: 'read',
        }),
      ).toBe('Read 2 messages');
    });

    it('conversation_memory clear reports removed count', () => {
      expect(
        summarizeNodeRun('conversation_memory', {
          cleared: true,
          removedCount: 4,
          operation: 'clear',
        }),
      ).toBe('Cleared 4 messages');
    });

    it('conversation_memory summarize reports count + length', () => {
      expect(
        summarizeNodeRun('conversation_memory', {
          summary: 'A short summary string.',
          messagesSummarized: 12,
          operation: 'summarize',
        }),
      ).toBe('Summarized 12 messages (23 chars)');
    });

    it('flow_tool with toolName + extracted path reports both', () => {
      expect(
        summarizeNodeRun('flow_tool', {
          value: 'result',
          extracted: 'webhook_response.body',
          flowId: 'wf-leaf-1',
          toolName: 'analyze_logs',
          raw: { webhook_response: { body: 'result' } },
        }),
      ).toBe('Invoked analyze_logs; extracted webhook_response.body');
    });

    it('flow_tool without toolName falls back to flowId', () => {
      expect(
        summarizeNodeRun('flow_tool', {
          value: { x: 1 },
          extracted: '',
          flowId: 'wf-leaf-2',
          toolName: '',
          raw: { x: 1 },
        }),
      ).toBe('Invoked sub-flow wf-leaf-2');
    });

    it('flow_tool with neither toolName nor flowId returns generic message', () => {
      expect(summarizeNodeRun('flow_tool', { value: null, extracted: '', flowId: '', toolName: '', raw: null })).toBe(
        'Sub-flow invoked',
      );
    });
  });
});
