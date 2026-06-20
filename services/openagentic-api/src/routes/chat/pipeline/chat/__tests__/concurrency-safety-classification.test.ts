/**
 * Sev-1 audit finding (2026-05-12): The default classifier at
 * `runChat.ts:175` returns `'ask'` for every MCP tool name, forcing the
 * `partitionToolCalls` algorithm to put each MCP tool in its own serial
 * batch. This defeats the parallel-tool concurrency model — three
 * `azure_list_*` reads dispatch serially when they should batch into one
 * parallel batch.
 *
 * Real production classifier lives on `PermissionService.classifyName()`
 * (PermissionService.ts:540) which uses glob-pattern rules from
 * `DEFAULT_ALLOW_TOOLS` (`*_list_*`, `*_get_*`, `*_describe_*` → 'allow')
 * and `DEFAULT_DENY_TOOLS` (`*_delete_*`, `*_drop_*` → 'deny'). The fix
 * is to wire `PermissionService` through `RunChatDeps` so the default
 * classifier consults real rules instead of returning 'ask'.
 *
 * the design notes
 *       (audit §10 step ?? — added 2026-05-12 fresh audit)
 *
 * TDD discipline: this file is RED before the wiring change in runChat.ts
 * lands. After GREEN it pins the contract.
 */

import { describe, it, expect } from 'vitest';
import { computeConcurrencySafeNames, type RiskClassifier } from '../toolRegistry.js';
import { partitionToolCalls } from '../toolOrchestration.js';
import { PermissionService } from '../../../../../services/PermissionService.js';
import type { ToolUseBlock } from '../types.js';

// Minimal logger shim — PermissionService needs {info,warn,error,debug}.
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: function () { return this; },
} as any;

function defaultClassifier(): RiskClassifier {
  return { classifyName: () => 'ask' };
}

function permissionServiceClassifier(): RiskClassifier {
  const ps = new PermissionService(silentLogger);
  return { classifyName: (name: string) => ps.classifyName(name) };
}

// Minimal mock tool array (just what computeConcurrencySafeNames needs).
const makeTool = (name: string) => ({
  type: 'function' as const,
  function: { name, description: '', parameters: { type: 'object', properties: {} } },
});

describe('concurrency-safety classification — default classifier (BUG repro)', () => {
  it('default classifier returns ask for every unknown MCP tool name', () => {
    const c = defaultClassifier();
    expect(c.classifyName('azure_list_subscriptions')).toBe('ask');
    expect(c.classifyName('aws_list_accounts')).toBe('ask');
    expect(c.classifyName('k8s_get_pods')).toBe('ask');
    expect(c.classifyName('azure_delete_resource_group')).toBe('ask');
  });

  it('default classifier excludes ALL MCP reads from the concurrency-safe set (the bug)', () => {
    const tools = [
      makeTool('azure_list_subscriptions'),
      makeTool('azure_list_resource_groups'),
      makeTool('aws_list_accounts'),
      makeTool('k8s_get_pods'),
    ];
    const safe = computeConcurrencySafeNames(tools, defaultClassifier());
    expect(safe.has('azure_list_subscriptions')).toBe(false);
    expect(safe.has('azure_list_resource_groups')).toBe(false);
    expect(safe.has('aws_list_accounts')).toBe(false);
    expect(safe.has('k8s_get_pods')).toBe(false);
  });
});

describe('concurrency-safety classification — PermissionService classifier (FIX target)', () => {
  it('PermissionService.classifyName labels read-only MCP tools allow', () => {
    const ps = new PermissionService(silentLogger);
    expect(ps.classifyName('azure_list_subscriptions')).toBe('allow');
    expect(ps.classifyName('azure_list_resource_groups')).toBe('allow');
    expect(ps.classifyName('aws_list_accounts')).toBe('allow');
    expect(ps.classifyName('k8s_get_pods')).toBe('allow');
    expect(ps.classifyName('azure_describe_workspace')).toBe('allow');
  });

  it('PermissionService.classifyName labels destructive MCP tools ask (HITL gate, post-#788)', () => {
    // Pre-#788 there were baseline glob deny rules (`*_delete_*`,
    // `*_drop_*`) baked into source. #788 ripped that — the DB/admin
    // console is now the sole SoT for rules, and unknown destructive
    // tool names fall through to 'ask' so the HITL gate decides at
    // dispatch time (with full arg context the classifier doesn't see).
    // 'ask' is correct: it removes the tool from the concurrency-safe
    // set AND triggers the approval card.
    const ps = new PermissionService(silentLogger);
    expect(ps.classifyName('azure_delete_resource_group')).toBe('ask');
    expect(ps.classifyName('aws_terminate_instance')).toBe('ask');
  });

  it('PermissionService classifier includes read-only MCP tools in concurrency-safe set', () => {
    const tools = [
      makeTool('azure_list_subscriptions'),
      makeTool('azure_list_resource_groups'),
      makeTool('aws_list_accounts'),
      makeTool('k8s_get_pods'),
      makeTool('azure_delete_resource_group'), // destructive — should NOT be in safe set
    ];
    const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());
    expect(safe.has('azure_list_subscriptions')).toBe(true);
    expect(safe.has('azure_list_resource_groups')).toBe(true);
    expect(safe.has('aws_list_accounts')).toBe(true);
    expect(safe.has('k8s_get_pods')).toBe(true);
    // The destructive tool stays OUT — defense-in-depth even though
    // it'd never reach this code path with allow rules.
    expect(safe.has('azure_delete_resource_group')).toBe(false);
  });

  // Sev-0 (2026-05-14): The T1 `Task` tool spawns a sub-agent in a fresh
  // isolated context window. Each Task invocation is independent — distinct
  // sub-agent, distinct conversation, distinct OBO chain. Mutation safety
  // is the SUB-AGENT'S concern (its own per-tool HITL gates), not Task's.
  //
  // So when the owner emits N parallel `Task` tool_use blocks in one turn,
  // they MUST partition into ONE concurrent batch (fan-out), not N serial
  // batches. agent_send / agent_list / agent_stop are the same — pure
  // lifecycle calls against independent sub-agent sessions, parallel-safe.
  //
  // Pre-fix state: Task / agent_send / agent_list / agent_stop are
  // documented as "sequenced" in toolRegistry.ts:28 and are NOT in
  // META_TOOL_CONCURRENCY_SAFE. The partition algorithm puts each in its
  // own serial batch, defeating sub-agent fan-out.
  describe('Sev-0 — T1 Task/agent_* tools must be concurrency-safe (parallel sub-agent fan-out)', () => {
    // The comment in toolRegistry.ts:27-28 claims Task / agent_send /
    // agent_list / agent_stop are "sequenced". Live behavior says otherwise:
    // PermissionService.classifyName labels them all 'allow' (read-only-ish
    // lifecycle calls against independent sub-agent sessions), so
    // computeConcurrencySafeNames adds them to the safe set and
    // partitionToolCalls coalesces consecutive Task blocks into ONE batch.
    //
    // These tests pin the LIVE contract so any future drift (e.g. someone
    // re-adds Task to a deny rule "for safety") gets caught.

    it('Task tool is in the concurrency-safe set so parallel sub-agent fan-out works', () => {
      const tools = [makeTool('Task'), makeTool('Task'), makeTool('Task')];
      const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());
      expect(safe.has('Task')).toBe(true);
    });

    it('agent_send / agent_list / agent_stop are concurrency-safe (independent sub-agent sessions)', () => {
      const tools = [
        makeTool('agent_send'),
        makeTool('agent_list'),
        makeTool('agent_stop'),
      ];
      const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());
      expect(safe.has('agent_send')).toBe(true);
      expect(safe.has('agent_list')).toBe(true);
      expect(safe.has('agent_stop')).toBe(true);
    });

    it('partitionToolCalls coalesces 3 parallel Task blocks into ONE concurrent batch', () => {
      // This is the platform-level contract: when the model emits N parallel
      // Task tool_use blocks on a single turn, the dispatcher MUST run them
      // concurrently. Three serial batches = no fan-out = ref-arch parity broken.
      const tools = [makeTool('Task')];
      const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());

      const blocks: ToolUseBlock[] = [
        { id: 'toolu_01', name: 'Task', input: { description: 'Investigate AWS spend', prompt: 'List EC2 costs by region' } },
        { id: 'toolu_02', name: 'Task', input: { description: 'Investigate Azure spend', prompt: 'List VM costs by subscription' } },
        { id: 'toolu_03', name: 'Task', input: { description: 'Investigate GCP spend', prompt: 'List Compute Engine costs by project' } },
      ];

      const batches = partitionToolCalls(blocks, safe);

      expect(batches.length).toBe(1);
      expect(batches[0].isConcurrencySafe).toBe(true);
      expect(batches[0].blocks.length).toBe(3);
      expect(batches[0].blocks.map(b => b.id)).toEqual(['toolu_01', 'toolu_02', 'toolu_03']);
    });

    it('partitionToolCalls coalesces mixed T1 read-only + Task fan-out into one batch', () => {
      // Common real-world shape: model fires tool_search to discover an MCP
      // tool, then immediately spawns 3 sub-agents to grind in parallel. All
      // four blocks are concurrency-safe so they batch together.
      const tools = [makeTool('tool_search'), makeTool('Task')];
      const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());

      const blocks: ToolUseBlock[] = [
        { id: 'toolu_01', name: 'tool_search', input: { query: 'azure cost' } },
        { id: 'toolu_02', name: 'Task', input: { description: 'a', prompt: 'p' } },
        { id: 'toolu_03', name: 'Task', input: { description: 'b', prompt: 'p' } },
        { id: 'toolu_04', name: 'Task', input: { description: 'c', prompt: 'p' } },
      ];

      const batches = partitionToolCalls(blocks, safe);

      expect(batches.length).toBe(1);
      expect(batches[0].isConcurrencySafe).toBe(true);
      expect(batches[0].blocks.length).toBe(4);
    });

    it('partitionToolCalls splits at a non-safe pattern_save between Task fan-outs', () => {
      // pattern_save is one of the few T1 tools the live classifier marks
      // 'ask' — it persists state to the learned_patterns Milvus collection.
      // So a Task / pattern_save / Task sequence must produce TWO concurrent
      // batches with the pattern_save serial in the middle.
      const tools = [makeTool('Task'), makeTool('pattern_save')];
      const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());

      const blocks: ToolUseBlock[] = [
        { id: 'toolu_01', name: 'Task', input: { description: 'a', prompt: 'p' } },
        { id: 'toolu_02', name: 'Task', input: { description: 'b', prompt: 'p' } },
        { id: 'toolu_03', name: 'pattern_save', input: { pattern: 'cost_audit' } },
        { id: 'toolu_04', name: 'Task', input: { description: 'c', prompt: 'p' } },
      ];

      const batches = partitionToolCalls(blocks, safe);

      expect(batches.length).toBe(3);
      expect(batches[0]).toEqual({
        isConcurrencySafe: true,
        blocks: [blocks[0], blocks[1]],
      });
      expect(batches[1].isConcurrencySafe).toBe(false);
      expect(batches[1].blocks).toEqual([blocks[2]]);
      expect(batches[2]).toEqual({
        isConcurrencySafe: true,
        blocks: [blocks[3]],
      });
    });
  });

  it('meta-tools that bypass classifier stay in the safe set unconditionally', () => {
    // The meta-tool concurrency-safe set is hardcoded in toolRegistry.ts
    // (META_TOOL_CONCURRENCY_SAFE). Make sure adding PermissionService
    // doesn't accidentally drop them.
    const tools = [
      makeTool('tool_search'),
      makeTool('agent_search'),
      makeTool('read_large_result'),
      makeTool('web_search'),
      makeTool('web_fetch'),
      makeTool('pattern_recall'),
    ];
    const safe = computeConcurrencySafeNames(tools, permissionServiceClassifier());
    expect(safe.has('tool_search')).toBe(true);
    expect(safe.has('agent_search')).toBe(true);
    expect(safe.has('read_large_result')).toBe(true);
    expect(safe.has('web_search')).toBe(true);
    expect(safe.has('web_fetch')).toBe(true);
    expect(safe.has('pattern_recall')).toBe(true);
  });
});
