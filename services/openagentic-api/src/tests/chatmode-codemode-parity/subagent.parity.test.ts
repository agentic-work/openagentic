/**
 * Sub-agent Parity — chat ↔ codemode for delegate_to_agents.
 *
 * Chat mode emits SubagentOrchestrator canonical events (subagent_started,
 * subagent_tool_call, subagent_completed) when the model invokes the
 * delegate_to_agents tool.
 *
 * Codemode renders sub-agents through the Task tool — openagentic's
 * TaskTool spawns the sub-agent and the bridge emits a normal
 * `tool_use` content_block with name='Task'. The matching tool_result
 * is echoed back as a synthetic user turn. The codemode UI's
 * streamReducer reads Task tool_use blocks to build sub-agent cards.
 *
 * Parity here means: both surfaces produce the same `subagent_spawn` /
 * `subagent_result` normalized observables, even though the wire
 * formats differ (chat: flat envelope frames; codemode: Task tool_use +
 * tool_result with sub-agent semantics). #297 closed 2026-05-07.
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

describe('Sub-agent parity — chat ↔ codemode', () => {
  test('subagent_spawn + subagent_result observables present on both surfaces (parity)', () => {
    const scenario: ParityScenario = {
      name: 'subagent-cloud-ops',
      userPrompt:
        "I'm Bob. Audit our Azure subs and tell me which VMs are wasting money.",
      availableTools: ['delegate_to_agents'],
      script: [
        {
          kind: 'subagent_spawn',
          agentName: 'cloud_operations',
          prompt: 'Audit Azure subscriptions for idle compute resources.',
        },
        { kind: 'tool_call', toolName: 'azure_resource_graph_query', input: { q: '...' } },
        { kind: 'tool_result', toolName: 'azure_resource_graph_query', result: { count: 3 } },
        {
          kind: 'subagent_result',
          agentName: 'cloud_operations',
          result: { summary: '3 idle VMs found' },
        },
        { kind: 'assistant_text', text: 'Bob, I found 3 idle VMs.' },
      ],
    };

    const run = runParity(scenario);

    // Chat side: top-level subagent_started + subagent_completed frames.
    expect(run.chat.parsed.some(f => f.type === 'subagent_started')).toBe(true);
    expect(run.chat.parsed.some(f => f.type === 'subagent_completed')).toBe(true);

    // Codemode side: Task tool_use content_block + tool_result echo.
    const codemodeTaskUse = run.codemode.parsed.find(f => {
      const ev = (f as any).event;
      return (
        ev?.type === 'content_block_start' &&
        ev?.content_block?.type === 'tool_use' &&
        ev?.content_block?.name === 'Task'
      );
    });
    expect(codemodeTaskUse).toBeTruthy();
    const codemodeTaskResult = run.codemode.parsed.find(f => {
      if ((f as any).type !== 'user') return false;
      const content = (f as any).message?.content;
      return Array.isArray(content) && content.some((c: any) => c?.type === 'tool_result');
    });
    expect(codemodeTaskResult).toBeTruthy();

    // Both surfaces produce subagent_spawn + subagent_result normalized
    // observables — diff has no subagent_* divergence.
    const subagentDivergences = run.diff.divergences.filter(d => {
      const k = d.chat?.kind ?? d.codemode?.kind;
      return k === 'subagent_spawn' || k === 'subagent_result';
    });
    expect(subagentDivergences).toHaveLength(0);
  });

  test('when codemode is updated to emit subagent events, tool_call inside the subagent is still visible', () => {
    // This test forward-looks: even today, the inner tool_call that the
    // sub-agent's underlying LLM invokes IS emitted on both surfaces
    // (because it's a plain tool_use in the wire). So a partial parity
    // exists — tool calls made during sub-agent work are observable even
    // though the spawn/result envelope is not.
    const scenario: ParityScenario = {
      name: 'subagent-inner-tool',
      userPrompt: 'Delegate an audit.',
      availableTools: ['delegate_to_agents', 'azure_resource_graph_query'],
      script: [
        { kind: 'tool_call', toolName: 'delegate_to_agents', input: { agent: 'cloud_ops' } },
        { kind: 'tool_result', toolName: 'delegate_to_agents', result: { spawned: true } },
      ],
    };

    const run = runParity(scenario);
    expect(run.diff.ok).toBe(true);
    expect(
      run.chat.parsed.some(f => f.type === 'tool_start' && (f as any).toolName === 'delegate_to_agents'),
    ).toBe(true);
  });
});
