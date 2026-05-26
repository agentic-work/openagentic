import { describe, it, expect } from 'vitest';

import { reduce, createInitialState } from '../streamReducer';
import type { AssistantChatMessage, UiPreviewBlock } from '../../types/uiState';

const SESSION_ID = 'sess-preview-1';

function previewReadyEvent(data: {
  port: number;
  url: string;
  framework: string;
  toolUseId?: string;
}): any {
  return {
    type: 'system',
    subtype: 'preview_ready',
    data,
    session_id: SESSION_ID,
    uuid: 'uuid-preview-' + data.port,
  };
}

/** Seed a streaming assistant turn — mirrors streamReducer.test.ts pattern. */
function seedStreamingAssistant() {
  const msgId = 'asst-preview-1';
  const seed: AssistantChatMessage = {
    id: msgId,
    role: 'assistant',
    blocks: [],
    streaming: true,
    createdAt: 1000,
  };
  return {
    state: {
      ...createInitialState(),
      messages: [seed],
      streamingMessageId: msgId,
    },
    msgId,
  };
}

describe('reducer — system/preview_ready', () => {
  it('appends a preview block to the streaming assistant message', () => {
    let { state } = seedStreamingAssistant();

    state = reduce(state, {
      type: 'event',
      event: previewReadyEvent({
        port: 5173,
        url: 'http://localhost:5173',
        framework: 'vite',
        toolUseId: 'toolu_VITE',
      }),
    } as any);

    const last = state.messages[state.messages.length - 1] as AssistantChatMessage;
    const previewBlocks = last.blocks.filter((b): b is UiPreviewBlock => b.kind === 'preview');
    expect(previewBlocks).toHaveLength(1);
    expect(previewBlocks[0]).toMatchObject({
      kind: 'preview',
      port: 5173,
      url: 'http://localhost:5173',
      framework: 'vite',
      toolUseId: 'toolu_VITE',
    });
  });

  it('dedupes per port — same port emitted twice creates one block', () => {
    let { state } = seedStreamingAssistant();
    const ev = previewReadyEvent({ port: 5173, url: 'http://localhost:5173', framework: 'vite', toolUseId: 't1' });
    state = reduce(state, { type: 'event', event: ev } as any);
    state = reduce(state, { type: 'event', event: ev } as any);

    const last = state.messages[state.messages.length - 1] as AssistantChatMessage;
    expect(last.blocks.filter((b) => b.kind === 'preview')).toHaveLength(1);
  });

  it('emits separate blocks for distinct ports', () => {
    let { state } = seedStreamingAssistant();
    state = reduce(state, {
      type: 'event',
      event: previewReadyEvent({ port: 5173, url: 'http://localhost:5173', framework: 'vite', toolUseId: 'a' }),
    } as any);
    state = reduce(state, {
      type: 'event',
      event: previewReadyEvent({ port: 8000, url: 'http://localhost:8000', framework: 'uvicorn', toolUseId: 'b' }),
    } as any);
    const last = state.messages[state.messages.length - 1] as AssistantChatMessage;
    const ports = last.blocks
      .filter((b): b is UiPreviewBlock => b.kind === 'preview')
      .map((b) => b.port)
      .sort();
    expect(ports).toEqual([5173, 8000]);
  });

  it('drops the event silently if no assistant turn is in flight', () => {
    let state = createInitialState();
    state = reduce(state, {
      type: 'event',
      event: previewReadyEvent({ port: 5173, url: 'http://localhost:5173', framework: 'vite' }),
    } as any);
    expect(state.messages).toEqual([]);
  });
});
