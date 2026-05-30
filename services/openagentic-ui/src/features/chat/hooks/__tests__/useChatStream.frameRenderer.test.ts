/**
 * Phase 4 / Task 4.6 — useChatStream tool_result reducer arm wires
 * `_meta.outputTemplate` onto the matching ContentBlock so the UI render
 * path (ToolCard / message rendering) can look the component up via
 * FrameRendererRegistry.
 *
 * Tests the exported pure reducer `applyRoundFrame` because it's the
 * authoritative round-aware tool_result handler. The inline switch-case
 * arm at useChatStream.ts:3296 is structurally identical and shares the
 * same ContentBlock shape — it stamps `outputTemplate` the same way.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6.3
 */
import { describe, it, expect } from 'vitest';
import {
  applyRoundFrame,
  type ContentBlock,
  type RoundFrame,
} from '../useChatStream.js';
import { FrameRendererRegistry } from '../../components/v2/FrameRendererRegistry.js';
import { StreamingTable } from '../../components/v2/StreamingTable.js';

function makeRoundWithChild(): ContentBlock[] {
  // Pre-existing tool_round with one open tool_use child.
  return [
    {
      id: 'tr-1',
      index: 0,
      type: 'tool_round',
      content: '',
      isComplete: false,
      roundId: 'r1',
      toolIds: ['tu-a'],
      children: [
        {
          id: 'child-tu-a',
          index: 0,
          type: 'tool_use',
          content: '{}',
          isComplete: false,
          toolName: 'k8s_list_pods',
          toolId: 'tu-a',
          startTime: Date.now(),
        },
      ],
    },
  ];
}

describe('applyRoundFrame — outputTemplate forwarding (Phase 4 / Task 4.6)', () => {
  it('stamps outputTemplate onto the matching child when tool_result carries _meta', () => {
    const before = makeRoundWithChild();
    const frame: RoundFrame = {
      type: 'tool_result',
      roundId: 'r1',
      toolCallId: 'tu-a',
      name: 'k8s_list_pods',
      result: { count: 3 },
      // Phase 4 — the V3 chatLoop attaches _meta on the tool_result frame.
      _meta: { outputTemplate: 'k8s_pod_list', size: 256, elapsed: 12 },
    } as any;

    const after = applyRoundFrame(before, frame);

    const round = after[0];
    expect(round.type).toBe('tool_round');
    const child = round.children![0];
    expect(child.isComplete).toBe(true);
    expect(child.outputTemplate).toBe('k8s_pod_list');
  });

  it('does not stamp outputTemplate when frame carries no _meta', () => {
    const before = makeRoundWithChild();
    const frame: RoundFrame = {
      type: 'tool_result',
      roundId: 'r1',
      toolCallId: 'tu-a',
      name: 'k8s_list_pods',
      result: { count: 3 },
    };

    const after = applyRoundFrame(before, frame);
    const child = after[0].children![0];
    expect(child.isComplete).toBe(true);
    expect(child.outputTemplate).toBeUndefined();
  });

  it('FrameRendererRegistry resolves the stamped outputTemplate to its component', () => {
    const before = makeRoundWithChild();
    const frame = {
      type: 'tool_result' as const,
      roundId: 'r1',
      toolCallId: 'tu-a',
      name: 'k8s_list_pods',
      result: { count: 3 },
      _meta: { outputTemplate: 'k8s_pod_list', size: 256, elapsed: 12 },
    };

    const after = applyRoundFrame(before, frame as any);
    const child = after[0].children![0];
    const Component = FrameRendererRegistry.lookup(child.outputTemplate);
    expect(Component).toBe(StreamingTable);
  });
});
