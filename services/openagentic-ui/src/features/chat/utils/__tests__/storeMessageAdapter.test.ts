import { describe, it, expect } from 'vitest';
import { storeMessageToChatMessage, storeMessagesToChatMessages } from '../messageNormalizer';
import type { Message } from '@/stores/useChatStore';

describe('storeMessageToChatMessage', () => {
  it('coerces a Date timestamp to an ISO string (ChatMessage.timestamp is always string)', () => {
    const ts = new Date('2026-06-02T12:00:00.000Z');
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      timestamp: ts,
    };

    const out = storeMessageToChatMessage(msg);

    expect(typeof out.timestamp).toBe('string');
    expect(out.timestamp).toBe('2026-06-02T12:00:00.000Z');
  });

  it('passes a string timestamp through unchanged', () => {
    const msg: Message = {
      id: 'm2',
      role: 'user',
      content: 'hi',
      timestamp: '2026-06-02T12:00:00.000Z',
    };

    expect(storeMessageToChatMessage(msg).timestamp).toBe('2026-06-02T12:00:00.000Z');
  });

  it('preserves id / role / content and carried-over optional fields', () => {
    const msg: Message = {
      id: 'm3',
      role: 'assistant',
      content: 'answer',
      timestamp: '2026-06-02T12:00:00.000Z',
      model: 'auto',
      status: 'completed',
      content_blocks: [{ type: 'text', content: 'answer' } as any],
      mcpCalls: [{ name: 'web.search' } as any],
    };

    const out = storeMessageToChatMessage(msg);

    expect(out.id).toBe('m3');
    expect(out.role).toBe('assistant');
    expect(out.content).toBe('answer');
    expect(out.model).toBe('auto');
    expect(out.status).toBe('completed');
    expect(out.content_blocks).toHaveLength(1);
    expect(out.mcpCalls).toHaveLength(1);
  });

  it('carries inline render frames (visualizations) across without dropping them', () => {
    const msg: Message = {
      id: 'm4',
      role: 'assistant',
      content: 'chart',
      timestamp: '2026-06-02T12:00:00.000Z',
      visualizations: [{ type: 'visual_render', data: { kind: 'svg' } }],
    };

    const out = storeMessageToChatMessage(msg);

    expect(out.visualizations).toHaveLength(1);
    expect(out.visualizations?.[0]).toMatchObject({ type: 'visual_render' });
  });
});

describe('storeMessagesToChatMessages', () => {
  it('maps an array and returns a ChatMessage[] (string timestamps throughout)', () => {
    const msgs: Message[] = [
      { id: 'a', role: 'user', content: 'q', timestamp: new Date('2026-06-02T12:00:00.000Z') },
      { id: 'b', role: 'assistant', content: 'a', timestamp: '2026-06-02T12:00:01.000Z' },
    ];

    const out = storeMessagesToChatMessages(msgs);

    expect(out).toHaveLength(2);
    expect(out.every((m) => typeof m.timestamp === 'string')).toBe(true);
  });

  it('returns [] for nullish / non-array input', () => {
    expect(storeMessagesToChatMessages(undefined as any)).toEqual([]);
    expect(storeMessagesToChatMessages(null as any)).toEqual([]);
  });
});
