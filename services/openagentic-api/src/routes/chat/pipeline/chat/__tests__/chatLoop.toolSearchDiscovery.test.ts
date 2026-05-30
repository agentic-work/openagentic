/**
 * V3 chatLoop tool_search discovery side-channel (Plan §Tests #5).
 *
 * The 9 always-on meta-tools include `tool_search`. When the model invokes
 * it, the dispatcher returns `discoveredTools: [...]` (OpenAI-shape defs).
 * chatLoop appends those defs to the `tools` array on the NEXT iteration
 * so the model can call them directly without paying the 81k-token cost
 * of the full 270-tool catalog up front.
 *
 * This is THE mechanism that makes the cascade-rip viable. If tool_search
 * results don't make it into turn N+1's tool array, the model claims "I
 * don't have access to that" with empty MCP set (Risk 3).
 *
 * Mirrors V2 contract at runChatTurnV2.ts:199-213.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  const emitted: Array<{ op: string; payload: any }> = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

describe('chatLoop — tool_search discovery side-channel', () => {
  it('appends discovered tools to next turn`s tools array', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    let toolsSeenByTurn2: any[] = [];

    // Provider: turn 1 invokes tool_search; turn 2 calls a discovered tool.
    function streamProvider(req: any) {
      call++;
      if (call === 2) {
        // Capture what tools the model sees on turn 2.
        toolsSeenByTurn2 = [...req.tools];
      }
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'ts1',
            name: 'tool_search',
            input: { query: 'azure' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_ctx: any, c: any) => {
      if (c.name === 'tool_search') {
        return {
          ok: true,
          output: { matches: 2 },
          discoveredTools: [
            { type: 'function', function: { name: 'azure_list_subscriptions', description: 'list subs' } },
            { type: 'function', function: { name: 'azure_list_resource_groups', description: 'list rgs' } },
          ],
        };
      }
      return { ok: true, output: 'x' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'show me azure stuff',
        priorMessages: [],
        systemPrompt: 's',
        tools: [
          { type: 'function', function: { name: 'tool_search', description: 'search' } },
        ],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 2 must see BOTH the original tool_search def AND the 2 discovered tools.
    const names = toolsSeenByTurn2.map((t: any) => t.function?.name).sort();
    expect(names).toContain('tool_search');
    expect(names).toContain('azure_list_subscriptions');
    expect(names).toContain('azure_list_resource_groups');
  });

  it('dedupes discovered tools across multiple tool_search calls', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    let toolsSeenByTurn3: any[] = [];

    // turn 1: tool_search → returns A,B
    // turn 2: tool_search → returns B,C (B is dupe)
    // turn 3: end_turn — capture the tools seen
    function streamProvider(req: any) {
      call++;
      if (call === 3) {
        toolsSeenByTurn3 = [...req.tools];
      }
      if (call === 1 || call === 2) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: `ts${call}`,
            name: 'tool_search',
            input: { query: 'q' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'k' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    let searchCall = 0;
    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'tool_search') {
        searchCall++;
        return {
          ok: true,
          output: 'ok',
          discoveredTools:
            searchCall === 1
              ? [
                  { type: 'function', function: { name: 'A', description: 'a' } },
                  { type: 'function', function: { name: 'B', description: 'b' } },
                ]
              : [
                  { type: 'function', function: { name: 'B', description: 'b dupe' } },
                  { type: 'function', function: { name: 'C', description: 'c' } },
                ],
        };
      }
      return { ok: true, output: 'x' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'q',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 's' } }],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Should see A, B, C exactly once each + tool_search itself = 4 total.
    const names = toolsSeenByTurn3.map((t: any) => t.function?.name).sort();
    expect(names).toEqual(['A', 'B', 'C', 'tool_search']);
  });
});
