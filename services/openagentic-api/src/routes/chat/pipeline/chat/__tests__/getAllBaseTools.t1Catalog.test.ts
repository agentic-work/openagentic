/**
 * Phase C.1 — Pin the T1 chatmode catalog to exactly 12 primitives.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §C.1
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md §Layer-2
 *
 * Growth log:
 *   - Phase C.1 (2026-05-10): 10 primitives baseline.
 *   - 2026-05-11 pattern memory: +pattern_save, +pattern_recall → 12.
 *
 * The T1 list (canonical order):
 *   tool_search · agent_search · Task · agent_send · agent_list · agent_stop ·
 *   read_large_result · web_search · web_fetch ·
 *   pattern_save · pattern_recall
 *
 * Tools REMOVED from T1 (now discoverable via tool_search in mcp_tools index):
 *   compose_visual · compose_app · render_artifact · kb_search ·
 *   request_clarification · browser_sandbox_exec · memorize · memory_search ·
 *   delegate_to_agents
 *
 * The model's first turn surface is ALWAYS exactly these 12 primitives.
 * Discovery is the only path that surfaces MCP tools; the platform never
 * front-loads the full ~270-tool MCP catalog.
 */
import { describe, it, expect } from 'vitest';
import { getAllBaseTools } from '../toolRegistry.js';

const T1_NAMES = [
  'tool_search',
  'agent_search',
  'Task',
  'agent_send',
  'agent_list',
  'agent_stop',
  'read_large_result',
  'web_search',
  'web_fetch',
  'pattern_save',
  'pattern_recall',
] as const;

describe('getAllBaseTools — T1 catalog pinning (Phase C.1)', () => {
  it('returns exactly 12 primitives', () => {
    const tools = getAllBaseTools();
    expect(tools).toHaveLength(12);
  });

  it('contains every T1 name (set equality, order-agnostic)', () => {
    const tools = getAllBaseTools();
    const names = tools.map(t => t?.function?.name).sort();
    expect(names).toEqual([...T1_NAMES].sort());
  });

  it('emits T1 in canonical order (discovery → sub-agent → IO)', () => {
    const tools = getAllBaseTools();
    const names = tools.map(t => t?.function?.name);
    expect(names).toEqual([...T1_NAMES]);
  });

  it('does NOT include legacy meta-tools removed in rev-2', () => {
    const tools = getAllBaseTools();
    const names = new Set(tools.map(t => t?.function?.name));
    const removed = [
      'compose_visual',
      'compose_app',
      'render_artifact',
      'request_clarification',
      'browser_sandbox_exec',
      'memorize',
      'memory_search',
      'delegate_to_agents',
      'kb_search',
    ];
    for (const r of removed) {
      expect(names.has(r), `legacy tool '${r}' must NOT appear in T1 catalog`).toBe(false);
    }
  });

  it('every T1 entry has the OpenAI tool envelope shape', () => {
    const tools = getAllBaseTools();
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect(typeof t.function?.name).toBe('string');
      expect(typeof t.function?.description).toBe('string');
      expect(t.function?.parameters).toBeDefined();
    }
  });

  it('Task tool description merges injected description override when provided', () => {
    const customDesc = 'INJECTED-AGENT-LIST-FROM-REGISTRY';
    const tools = getAllBaseTools(customDesc);
    const task = tools.find(t => t.function?.name === 'Task');
    expect(task?.function?.description).toBe(customDesc);
  });
});
