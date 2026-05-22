/**
 * buildChatV2Deps Wave 5 — persistence callbacks + prior-message loader.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302 (Wave 5).
 *
 * V1 (`ChatPipeline`) loaded prior conversation messages, persisted the
 * incoming user message, and persisted the final assistant message. Wave
 * 4 cut over the chat stream to V2 but did NOT carry these three over;
 * every turn looked like a fresh conversation to the model and history
 * was not saved.
 *
 * Wave 5 wires three storage helpers through `buildChatV2Deps` so the
 * stream handler can call them without re-importing ChatStorageService:
 *   - `loadPriorMessages(sessionId, userId)` — wraps `chatStorage.getMessages`
 *   - `persistUserMessage(sessionId, content, opts)` — wraps `chatStorage.addMessage`
 *   - `persistAssistantMessage(sessionId, content, opts)` — wraps `chatStorage.addMessage`
 *
 * The helpers are pure adapters: the chat plugin owns the chatStorage
 * singleton; the deps struct just exposes named callbacks the handler
 * can call without re-acquiring the storage instance.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildChatV2Deps, type BuildChatV2DepsOptions } from '../buildChatV2Deps.js';

function makeFakeStorage(over: any = {}) {
  return {
    getMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockResolvedValue({ id: 'msg-id-1' }),
    ...over,
  };
}

function makeBaseOpts(): BuildChatV2DepsOptions {
  return {
    providerManager: { createCompletion: vi.fn() },
    getOrchestrator: () => null,
  };
}

describe('buildChatV2Deps — Wave 5 persistence wiring', () => {
  it('returns a loadPriorMessages callback when chatStorage is supplied', () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    expect(typeof deps.loadPriorMessages).toBe('function');
  });

  it('loadPriorMessages calls chatStorage.getMessages and translates rows to V2 shape', async () => {
    const rows = [
      { id: 'm1', role: 'user', content: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello' },
    ];
    const storage = makeFakeStorage({
      getMessages: vi.fn().mockResolvedValue(rows),
    });
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });

    const out = await deps.loadPriorMessages!('sess-1', 'user-1');
    expect(storage.getMessages).toHaveBeenCalledWith('sess-1', expect.any(Object));
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: 'user', content: 'hi' });
    expect(out[1]).toEqual({ role: 'assistant', content: 'hello' });
  });

  it('loadPriorMessages returns [] when chatStorage.getMessages throws', async () => {
    const storage = makeFakeStorage({
      getMessages: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    const out = await deps.loadPriorMessages!('sess-1', 'user-1');
    expect(out).toEqual([]);
  });

  it('loadPriorMessages returns undefined when chatStorage is omitted', () => {
    const deps = buildChatV2Deps(makeBaseOpts());
    expect(deps.loadPriorMessages).toBeUndefined();
  });

  it('returns a persistUserMessage callback when chatStorage is supplied', () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    expect(typeof deps.persistUserMessage).toBe('function');
  });

  it('persistUserMessage calls chatStorage.addMessage with role:user + userId', async () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    await deps.persistUserMessage!('sess-1', 'show me my azure subs', {
      userId: 'user-1',
    });
    expect(storage.addMessage).toHaveBeenCalledTimes(1);
    const call = storage.addMessage.mock.calls[0];
    expect(call[0]).toBe('sess-1');
    expect(call[1].role).toBe('user');
    expect(call[1].content).toBe('show me my azure subs');
    expect(call[1].userId).toBe('user-1');
  });

  it('persistUserMessage swallows errors so the live wire keeps streaming', async () => {
    const storage = makeFakeStorage({
      addMessage: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    // Must not throw.
    await deps.persistUserMessage!('sess-1', 'q', { userId: 'user-1' });
  });

  it('returns a persistAssistantMessage callback when chatStorage is supplied', () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    expect(typeof deps.persistAssistantMessage).toBe('function');
  });

  it('persistAssistantMessage calls chatStorage.addMessage with role:assistant + model + tokenUsage', async () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    await deps.persistAssistantMessage!('sess-1', 'hello world', {
      userId: 'user-1',
      model: 'gpt-oss:20b',
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      toolNamesUsed: ['azure_list_subscriptions'],
    });
    const call = storage.addMessage.mock.calls[0];
    expect(call[0]).toBe('sess-1');
    expect(call[1].role).toBe('assistant');
    expect(call[1].content).toBe('hello world');
    expect(call[1].model).toBe('gpt-oss:20b');
    expect(call[1].tokenUsage?.totalTokens).toBe(30);
    expect(call[1].toolNamesUsed).toEqual(['azure_list_subscriptions']);
  });

  it('persistAssistantMessage swallows errors so the live wire keeps streaming', async () => {
    const storage = makeFakeStorage({
      addMessage: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    await deps.persistAssistantMessage!('sess-1', 'hello', {
      userId: 'user-1',
      model: 'gpt-oss:20b',
    });
  });

  // Persistence Sev-1: inline widgets vanish on session reload because
  // visual_render / app_render / streaming_table / inline_widget /
  // sub_agent_complete frames are emitted as NDJSON only, never written to
  // chat_messages.visualizations. The accumulator in stream.handler.ts
  // collects them; persistAssistantMessage forwards as `visualizations`
  // to chatStorage.addMessage so the existing column gets populated.
  it('persistAssistantMessage forwards visualizations[] to chatStorage.addMessage', async () => {
    const storage = makeFakeStorage();
    const deps = buildChatV2Deps({
      ...makeBaseOpts(),
      chatStorage: storage as any,
    });
    const frames = [
      { type: 'visual_render', data: { template: 'kpi_grid', html: '<div>kpis</div>' } },
      { type: 'app_render', data: { template: 'mermaid_flow', appHtml: '<html>app</html>' } },
      { type: 'streaming_table', data: { rows: [['a', 1]] } },
    ];
    await deps.persistAssistantMessage!('sess-1', 'hello', {
      userId: 'user-1',
      model: 'gpt-oss:20b',
      visualizations: frames,
    });
    const call = storage.addMessage.mock.calls[0];
    expect(call[1].visualizations).toEqual(frames);
  });
});
