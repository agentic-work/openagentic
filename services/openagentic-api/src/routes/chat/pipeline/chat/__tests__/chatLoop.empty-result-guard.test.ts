/**
 * Sev-0 META #1105 — chatLoop empty-tool-result fabrication guard.
 *
 * Live evidence (2026-05-24): model dispatched `memory_search`, the
 * tool returned `[]`, and the model then INVENTED a full table of fake
 * values to fill the void (compute-prod $2,847 etc.). User caught the
 * fabrication. Latest in a Sev-0 META pattern (#826, #878, #883, #887,
 * #899, #1009, #1017).
 *
 * Root cause: an empty tool_result body — `[]` / `{}` / `null` /
 * `{rows:[]}` / `{count:0}` / `{results:[]}` / a wrapped MCP envelope
 * whose `.content[0].text` parses to one of the above — gets passed
 * through unchanged. gpt-oss:20b especially fills the void with
 * plausible-but-fabricated values.
 *
 * Fix contract (this test pins it): when ANY tool_result going into
 * the next turn is empty per the heuristic above, the loop MUST inject
 * a separate `{ role: 'system', content: ... }` message into the
 * `messages` array — placed AFTER the `role:'tool'` message and BEFORE
 * the next `streamProvider({ messages })` call — whose `content`
 * contains the literal substring `"Do NOT invent or fabricate"`.
 *
 * This is distinct from the existing
 * `EMPTY_TOOL_RESULT_SYSTEM_NOTE` (which prefixes the tool_result
 * content itself). Both layers run; this test pins only the new
 * separate-system-message layer.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

const REQUIRED_SUBSTRING = 'Do NOT invent or fabricate';

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
          name: 'memory_search',
          input: { query: 'gcp compute cost' },
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

async function driveOneTurn(dispatchResult: any): Promise<any[]> {
  const { ctx } = makeCtx();
  let modelMessagesOnTurn2: any[] = [];
  const streamProvider = makeStreamProvider((m) => (modelMessagesOnTurn2 = m));
  const dispatch = vi.fn(async () => dispatchResult);

  await chatLoop(
    ctx,
    {
      userMessage: 'find memories about gcp compute cost',
      priorMessages: [],
      systemPrompt: 's',
      tools: [
        {
          type: 'function',
          function: { name: 'memory_search', description: 'search memory' },
        },
      ],
      model: 'gpt-oss:20b',
      maxTurns: 3,
    } as any,
    { streamProvider, dispatch, hooks: undefined } as any,
  );

  return modelMessagesOnTurn2;
}

function findInjectedSystemMessage(messages: any[]): any | undefined {
  // The injected system message lands AFTER the role:'tool' message.
  // There may also be unrelated system messages elsewhere; we only count
  // the ones whose content includes the required substring.
  return messages.find(
    (m) =>
      m.role === 'system' &&
      typeof m.content === 'string' &&
      m.content.includes(REQUIRED_SUBSTRING),
  );
}

describe('Sev-0 META #1105 — chatLoop empty-result fabrication guard (separate system message injection)', () => {
  it('injects "Do NOT invent or fabricate" system message when tool returns []', async () => {
    const messages = await driveOneTurn({ ok: true, output: [] });
    const injected = findInjectedSystemMessage(messages);
    expect(injected, 'system message with refusal directive must be injected').toBeDefined();
  });

  it('injects guard system message when tool returns {} (empty object)', async () => {
    const messages = await driveOneTurn({ ok: true, output: {} });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when tool returns null', async () => {
    const messages = await driveOneTurn({ ok: true, output: null });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when tool returns {rows: []}', async () => {
    const messages = await driveOneTurn({ ok: true, output: { rows: [] } });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when tool returns {rows: [], count: 0}', async () => {
    const messages = await driveOneTurn({
      ok: true,
      output: { rows: [], count: 0 },
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when tool returns {count: 0}', async () => {
    const messages = await driveOneTurn({ ok: true, output: { count: 0 } });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when tool returns {results: []}', async () => {
    const messages = await driveOneTurn({ ok: true, output: { results: [] } });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when MCP envelope content[0].text parses to "[]"', async () => {
    // Wrapped MCP envelope shape: tool_result body is a string of JSON, or
    // the dispatcher's output looks like `{content: [{text: '[]'}]}`. This
    // shape comes back from python-MCP servers (the openagentic-* family).
    const messages = await driveOneTurn({
      ok: true,
      output: { content: [{ text: '[]' }] },
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injects guard system message when MCP envelope content[0].text parses to "{}"', async () => {
    const messages = await driveOneTurn({
      ok: true,
      output: { content: [{ text: '{}' }] },
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeDefined();
  });

  it('injected message lands AFTER the role:"tool" message (model sees results then directive)', async () => {
    const messages = await driveOneTurn({ ok: true, output: [] });
    const toolIdx = messages.findIndex((m) => m.role === 'tool');
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    const sysIdx = messages.findIndex(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes(REQUIRED_SUBSTRING),
    );
    expect(sysIdx).toBeGreaterThan(toolIdx);
  });

  // NEGATIVE — substantive tool results MUST NOT trigger the injection.
  it('does NOT inject guard system message when tool returns substantive rows', async () => {
    const messages = await driveOneTurn({
      ok: true,
      output: { rows: [{ id: 1 }, { id: 2 }] },
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeUndefined();
  });

  it('does NOT inject guard system message when tool returns substantive string', async () => {
    const messages = await driveOneTurn({
      ok: true,
      output: 'Pod openagentic-api-7d76 is Running with 0 restarts.',
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeUndefined();
  });

  it('does NOT inject guard system message when MCP envelope wraps substantive data', async () => {
    const messages = await driveOneTurn({
      ok: true,
      output: { content: [{ text: JSON.stringify([{ id: 1 }, { id: 2 }]) }] },
    });
    const injected = findInjectedSystemMessage(messages);
    expect(injected).toBeUndefined();
  });
});
