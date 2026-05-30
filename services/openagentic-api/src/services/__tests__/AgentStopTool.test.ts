/**
 * AgentStopTool — RED test for the meta-tool definition shape.
 *
 * chatmode-rip plan §Phase C task C.4: the model invokes `agent_stop`
 * to tear down a running sub-agent session before it completes naturally.
 * Use cases: user changes mind, scope shrinks, agent looping or stuck,
 * resource cleanup at end of chat.
 *
 * This test pins ONLY the tool-definition shape. Dispatcher and the
 * openagentic-proxy DELETE /sessions/:id endpoint are task C.4 proper and
 * land in a separate commit.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_STOP_TOOL, isAgentStopTool } from '../AgentStopTool.js';

describe('AGENT_STOP_TOOL definition (chatmode-rip Phase C.4)', () => {
  it('declares function-shape with name="agent_stop"', () => {
    expect(AGENT_STOP_TOOL.type).toBe('function');
    expect(AGENT_STOP_TOOL.function.name).toBe('agent_stop');
  });

  it('description warns about destructive nature (sub-agent loses context)', () => {
    const d = AGENT_STOP_TOOL.function.description;
    expect(typeof d).toBe('string');
    // Stop is irreversible — sub-agent's accumulated context is gone.
    // Description must signal this so the model uses it sparingly.
    expect(d).toMatch(/destructive|irreversible|cannot be resumed|terminate|cancel/i);
  });

  it('input_schema requires agent_session_id only', () => {
    const params = AGENT_STOP_TOOL.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['agent_session_id']);
    expect(params.properties.agent_session_id.type).toBe('string');
    expect(params.additionalProperties).toBe(false);
  });

  it('isAgentStopTool name guard returns true for "agent_stop" only', () => {
    expect(isAgentStopTool('agent_stop')).toBe(true);
    expect(isAgentStopTool('agent_send')).toBe(false);
    expect(isAgentStopTool('agent_list')).toBe(false);
    expect(isAgentStopTool('Task')).toBe(false);
  });
});
