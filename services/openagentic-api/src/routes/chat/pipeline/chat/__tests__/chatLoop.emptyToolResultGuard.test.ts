/**
 * Sev-0 META #826 / #983 / #899 — chatLoop empty-tool-result guard.
 *
 * Layer 2 of the two-layer defense. When a tool result lands at the
 * chatLoop's tool_result accumulator and is "empty" (per the criteria
 * below), the loop prepends a SYSTEM NOTE to the model-facing content
 * so the model has an unambiguous, in-band signal that:
 *   - The tool returned no usable data.
 *   - It MUST acknowledge the gap explicitly.
 *   - It MUST refuse to fabricate substitute claims.
 *
 * "Empty" criteria (any of):
 *   - result === null
 *   - result === undefined
 *   - result === ''
 *   - result is {} (zero own keys)
 *   - result is []
 *   - is_error === true (errored result, regardless of content)
 *   - result.error !== undefined AND result.success !== true
 *   - result.rows / result.items / result.data is []
 *
 * The SYSTEM NOTE is server-side, NOT visible to the user but visible
 * to the model in its next turn. Required prefix text:
 *
 *   "[SYSTEM NOTE: This tool returned no usable data. Per your
 *    instructions you MUST acknowledge this gap explicitly and refuse
 *    to fabricate substitute claims.]"
 *
 * Companion layer 1 (system-prompt clause) lives in
 * getGroundingDisciplineSection.emptyToolResult.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

const SYSTEM_NOTE_PREFIX =
  '[SYSTEM NOTE: This tool returned no usable data. Per your instructions you MUST acknowledge this gap explicitly and refuse to fabricate substitute claims.]';

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

function makeStreamProvider(captureTurn2: (msgs: any[]) => void) {
  let call = 0;
  return function streamProvider(req: any) {
    call++;
    if (call === 2) captureTurn2(req?.messages ?? []);
    if (call === 1) {
      return (async function* () {
        yield {
          type: 'tool_use_complete',
          id: 't1',
          name: 'k8s_list_pods',
          input: { ns: 'default' },
        };
        yield { type: 'message_stop', stop_reason: 'tool_use' };
      })();
    }
    return (async function* () {
      yield { type: 'text_delta', text: 'Synth done.' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    })();
  };
}

async function driveOneTurn(dispatchResult: any): Promise<string> {
  const { ctx } = makeCtx();
  let modelMessagesOnTurn2: any[] = [];
  const streamProvider = makeStreamProvider((m) => (modelMessagesOnTurn2 = m));
  const dispatch = vi.fn(async () => dispatchResult);

  await chatLoop(
    ctx,
    {
      userMessage: 'list pods',
      priorMessages: [],
      systemPrompt: 's',
      tools: [
        { type: 'function', function: { name: 'k8s_list_pods', description: 'list pods' } },
      ],
      model: 'gpt-oss:20b',
      maxTurns: 3,
    } as any,
    { streamProvider, dispatch, hooks: undefined } as any,
  );

  const toolMsg = modelMessagesOnTurn2.find((m: any) => m.role === 'tool');
  expect(toolMsg, 'tool message must be pushed to history').toBeDefined();
  const toolResults = toolMsg!.content;
  expect(Array.isArray(toolResults)).toBe(true);
  expect(toolResults.length).toBeGreaterThan(0);
  const content = toolResults[0].content;
  // Normalize to string for inspection — content may be string OR object.
  return typeof content === 'string' ? content : JSON.stringify(content);
}

describe('Sev-0 META #826/#983/#899 — chatLoop empty-tool-result SYSTEM NOTE guard', () => {
  it('prepends SYSTEM NOTE when tool returns null', async () => {
    const content = await driveOneTurn({ ok: true, output: null });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when tool returns undefined output', async () => {
    const content = await driveOneTurn({ ok: true, output: undefined });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when tool returns empty string', async () => {
    const content = await driveOneTurn({ ok: true, output: '' });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when tool returns {} via envelope.structuredContent', async () => {
    const content = await driveOneTurn({
      ok: true,
      output: 'should be replaced by envelope',
      envelope: { ok: true, structuredContent: {}, _meta: {} },
    });
    // Note: envelope.{} triggers the existing L3-6 fallback to r.result.output,
    // and the SYSTEM NOTE guard inspects the final model-facing content.
    // If r.result.output is also empty/stub, guard fires; here output is non-empty
    // so the empty envelope is dropped — guard should NOT fire on this case.
    // This test pins that envelope-empty alone is not enough; the FINAL content must be empty.
    expect(content).not.toContain(SYSTEM_NOTE_PREFIX);
    expect(content).toContain('should be replaced by envelope');
  });

  it('prepends SYSTEM NOTE when final content is [] (empty array)', async () => {
    const content = await driveOneTurn({ ok: true, output: [] });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when final content is {} (empty object)', async () => {
    const content = await driveOneTurn({ ok: true, output: {} });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when tool errored (is_error true)', async () => {
    const content = await driveOneTurn({ ok: false, error: 'connection refused' });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when result has empty rows array', async () => {
    const content = await driveOneTurn({ ok: true, output: { rows: [] } });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when result has empty items array', async () => {
    const content = await driveOneTurn({ ok: true, output: { items: [] } });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when result has empty data array', async () => {
    const content = await driveOneTurn({ ok: true, output: { data: [] } });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  it('prepends SYSTEM NOTE when result.error set and success not true', async () => {
    const content = await driveOneTurn({
      ok: true,
      output: { error: 'subscription not found', success: false },
    });
    expect(content).toContain(SYSTEM_NOTE_PREFIX);
  });

  // NEGATIVE — non-empty results MUST NOT be augmented (regression guard).
  it('does NOT prepend SYSTEM NOTE on a substantive string result', async () => {
    const content = await driveOneTurn({
      ok: true,
      output: 'Pod openagentic-api-7d76 is Running with 0 restarts.',
    });
    expect(content).not.toContain(SYSTEM_NOTE_PREFIX);
    expect(content).toContain('Pod openagentic-api-7d76');
  });

  it('does NOT prepend SYSTEM NOTE on a substantive object result with rows', async () => {
    const content = await driveOneTurn({
      ok: true,
      output: { rows: [{ name: 'pod-a' }, { name: 'pod-b' }] },
    });
    expect(content).not.toContain(SYSTEM_NOTE_PREFIX);
    expect(content).toContain('pod-a');
  });
});
