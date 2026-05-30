/**
 * AgentSendTool — RED test for the meta-tool definition shape.
 *
 * chatmode-rip plan §Phase C task C.2: the model invokes `agent_send`
 * to push a follow-up message into a running sub-agent's chatLoop
 * (mid-task adjustment, e.g. "also check us-west-2 while you're at it").
 *
 * This test pins ONLY the tool-definition shape. Dispatcher and the
 * openagentic-proxy POST /sessions/:id/send endpoint are task C.2 proper and
 * land in a separate commit.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_SEND_TOOL, isAgentSendTool } from '../AgentSendTool.js';

describe('AGENT_SEND_TOOL definition (chatmode-rip Phase C.2)', () => {
  it('declares function-shape with name="agent_send"', () => {
    expect(AGENT_SEND_TOOL.type).toBe('function');
    expect(AGENT_SEND_TOOL.function.name).toBe('agent_send');
  });

  it('description explains follow-up vs spawn-fresh-Task', () => {
    const d = AGENT_SEND_TOOL.function.description;
    expect(typeof d).toBe('string');
    // Distinguish from Task (which spawns) — agent_send only targets
    // ALREADY-RUNNING agents.
    expect(d).toMatch(/running|active|live/i);
    expect(d).toMatch(/Task/);
  });

  it('input_schema requires agent_session_id + message', () => {
    const params = AGENT_SEND_TOOL.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(
      expect.arrayContaining(['agent_session_id', 'message']),
    );
    expect(params.required).toHaveLength(2);
    expect(params.properties.agent_session_id.type).toBe('string');
    expect(params.properties.message.type).toBe('string');
    expect(params.additionalProperties).toBe(false);
  });

  it('isAgentSendTool name guard returns true for "agent_send" only', () => {
    expect(isAgentSendTool('agent_send')).toBe(true);
    expect(isAgentSendTool('agent_list')).toBe(false);
    expect(isAgentSendTool('agent_search')).toBe(false);
    expect(isAgentSendTool('Task')).toBe(false);
  });
});
