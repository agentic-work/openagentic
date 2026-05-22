/**
 * AgentListTool — RED test for the meta-tool definition shape.
 *
 * chatmode-rip plan (docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 * §Phase C — task C.3): the new T1 catalog includes `agent_list` as a
 * lifecycle primitive. The model invokes it to enumerate live sub-agent
 * sessions for the current chat (so it can subsequently `agent_send` to
 * one or `agent_stop` it).
 *
 * This test pins ONLY the tool-definition shape (name, description,
 * input_schema). The dispatcher / openagentic-proxy session API is task C.2-C.4
 * proper and lands in a separate commit.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_LIST_TOOL, isAgentListTool } from '../AgentListTool.js';

describe('AGENT_LIST_TOOL definition (chatmode-rip Phase C.3)', () => {
  it('declares function-shape with name="agent_list"', () => {
    expect(AGENT_LIST_TOOL.type).toBe('function');
    expect(AGENT_LIST_TOOL.function.name).toBe('agent_list');
  });

  it('description explains when to use vs agent_search/Task', () => {
    const d = AGENT_LIST_TOOL.function.description;
    expect(typeof d).toBe('string');
    // Prompt-engineering signal: the model needs to know agent_list
    // returns LIVE running sessions, not the catalog of available agents.
    expect(d).toMatch(/live|running|active/i);
    // Distinguish from agent_search (catalog) so the model picks correctly.
    expect(d).toMatch(/agent_search/);
  });

  it('input_schema has zero required parameters (list-everything by default)', () => {
    const params = AGENT_LIST_TOOL.function.parameters;
    expect(params.type).toBe('object');
    // No fields are required — agent_list is "show me all active sub-agents
    // for the current chat session."
    expect(params.required ?? []).toEqual([]);
    // additionalProperties: false to keep shape strict.
    expect(params.additionalProperties).toBe(false);
  });

  it('isAgentListTool name guard returns true for "agent_list"', () => {
    expect(isAgentListTool('agent_list')).toBe(true);
    expect(isAgentListTool('agent_search')).toBe(false);
    expect(isAgentListTool('agent_send')).toBe(false);
    expect(isAgentListTool('Task')).toBe(false);
  });
});
