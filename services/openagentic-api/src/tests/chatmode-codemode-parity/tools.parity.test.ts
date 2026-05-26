/**
 * Tools Parity — chat ↔ codemode for MCP-style tool calls.
 *
 * One test per representative MCP tool. Each test drives the same scripted
 * tool invocation through both surfaces and asserts the diff engine finds
 * zero divergences (given the ignoreLifecycle flag that filters the
 * surface-specific envelope events).
 *
 * The scripted scenarios use realistic tool names + arguments + results
 * pulled from production use cases (azure_resource_graph_query for Bob's
 * cloud audit, k8s_get_pods for k8s ops, docs_search for RAG, etc.).
 *
 * ## What we're NOT testing here
 *
 *   - The actual MCP proxy reachability (that's a live-verification job).
 *   - Per-provider argument-schema translation (that's
 *     AnthropicProvider.convertMessages / OpenAI tool_calls tests).
 *   - Authorization (PermissionService has its own tests).
 *
 * What we ARE testing: given the same tool catalog and the same scripted
 * invocation, both surfaces emit an equivalent observable event sequence.
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

/**
 * Canonical MCP tool inventory — the tools that appear in both chat and
 * codemode prompts in production. Keep this list in sync with the
 * parity-matrix.md evidence doc.
 */
const MCP_TOOLS: Array<{ name: string; input: Record<string, unknown>; result: unknown }> = [
  {
    name: 'azure_resource_graph_query',
    input: {
      query:
        "Resources | where type =~ 'microsoft.compute/virtualmachines' | project name, location",
      subscriptions: ['sub-123'],
    },
    result: {
      count: 2,
      data: [
        { name: 'vm-dev-01', location: 'eastus' },
        { name: 'vm-prod-01', location: 'westus2' },
      ],
    },
  },
  {
    name: 'aws_ec2_describe',
    input: { region: 'us-east-1', instanceIds: ['i-abc123'] },
    result: { instances: [{ id: 'i-abc123', state: 'running', type: 't3.medium' }] },
  },
  {
    name: 'gcp_compute_instances',
    input: { project: 'openagentic-prod', zone: 'us-central1-a' },
    result: { instances: [{ name: 'gce-prod-01', status: 'RUNNING' }] },
  },
  {
    name: 'k8s_get_pods',
    input: { namespace: 'agentic-dev', labelSelector: 'app=openagentic-api' },
    result: {
      pods: [
        { name: 'openagentic-api-abc', status: 'Running', ready: '1/1' },
        { name: 'openagentic-api-def', status: 'Running', ready: '1/1' },
      ],
    },
  },
  {
    name: 'docs_search',
    input: { query: 'NDJSON contract', topK: 5 },
    result: {
      hits: [
        { title: 'streaming-contract.md', score: 0.94 },
        { title: 'ndjson.ts', score: 0.89 },
      ],
    },
  },
  {
    name: 'admin_user_activity',
    input: { userId: 'u-123', days: 7 },
    result: { messages: 42, tools: 18, sessions: 5 },
  },
];

describe('Tools parity — chat ↔ codemode', () => {
  for (const tool of MCP_TOOLS) {
    test(`${tool.name}: chat and codemode emit equivalent tool_call + tool_result`, () => {
      const scenario: ParityScenario = {
        name: `tool-${tool.name}`,
        userPrompt: `Please run ${tool.name}`,
        availableTools: [tool.name],
        script: [
          { kind: 'tool_call', toolName: tool.name, input: tool.input, toolId: 'fixed-id-1' },
          {
            kind: 'tool_result',
            toolName: tool.name,
            result: tool.result,
            toolId: 'fixed-id-1',
          },
          { kind: 'assistant_text', text: `Here is the ${tool.name} result.` },
        ],
      };

      const run = runParity(scenario);

      if (!run.diff.ok) {
        // Surface divergences in the failure message so the test log
        // tells a reviewer exactly what broke, rather than forcing them
        // to dig into a JSON dump.
        const msg = run.diff.divergences
          .map(
            (d, i) =>
              `#${i} line ${d.line} (${d.reason}):\n  chat=${JSON.stringify(d.chat)}\n  codemode=${JSON.stringify(d.codemode)}`,
          )
          .join('\n');
        throw new Error(`Parity diff failed for ${tool.name}:\n${msg}`);
      }

      expect(run.diff.ok).toBe(true);
    });
  }

  test('each tool emits exactly one tool_call + one tool_result on each surface', () => {
    for (const tool of MCP_TOOLS) {
      const scenario: ParityScenario = {
        name: `count-${tool.name}`,
        userPrompt: `Run ${tool.name}`,
        availableTools: [tool.name],
        script: [
          { kind: 'tool_call', toolName: tool.name, input: tool.input },
          { kind: 'tool_result', toolName: tool.name, result: tool.result },
        ],
      };
      const run = runParity(scenario);

      const chatToolCalls = run.chat.parsed.filter(f => f.type === 'tool_start').length;
      const chatToolResults = run.chat.parsed.filter(f => f.type === 'tool_complete').length;
      expect(chatToolCalls).toBe(1);
      expect(chatToolResults).toBe(1);

      // Codemode has tool_use inside stream_event.content_block_start with
      // type='tool_use', and tool_result inside a user frame content array.
      const codeToolUses = run.codemode.parsed.filter(f => {
        const ev = (f as any).event;
        return (
          ev?.type === 'content_block_start' &&
          ev?.content_block?.type === 'tool_use'
        );
      }).length;
      const codeToolResults = run.codemode.parsed.filter(f => {
        if (f.type !== 'user') return false;
        const content = (f as any).message?.content;
        return Array.isArray(content) && content.some((c: any) => c.type === 'tool_result');
      }).length;
      expect(codeToolUses).toBe(1);
      expect(codeToolResults).toBe(1);
    }
  });

  test('error results propagate is_error flag on both surfaces', () => {
    const scenario: ParityScenario = {
      name: 'tool-error',
      userPrompt: 'Run a failing tool',
      availableTools: ['k8s_get_pods'],
      script: [
        { kind: 'tool_call', toolName: 'k8s_get_pods', input: { namespace: 'missing' } },
        {
          kind: 'tool_result',
          toolName: 'k8s_get_pods',
          result: 'namespace not found',
          isError: true,
        },
      ],
    };
    const run = runParity(scenario);

    // chat: tool_complete carries is_error:true
    const chatResult = run.chat.parsed.find(f => f.type === 'tool_complete') as any;
    expect(chatResult.is_error).toBe(true);

    // codemode: the tool_result block in the synthetic user frame carries is_error:true
    const codeUserFrame = run.codemode.parsed.find(f => f.type === 'user') as any;
    const toolResultBlock = codeUserFrame.message.content.find((c: any) => c.type === 'tool_result');
    expect(toolResultBlock.is_error).toBe(true);
  });
});
