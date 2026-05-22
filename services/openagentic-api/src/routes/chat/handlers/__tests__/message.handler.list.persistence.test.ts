/**
 * Sev-0 #777 — GET /api/chat/sessions/:id/messages returns 0 messages
 * even when chat_messages rows exist in the DB.
 *
 * Live-capture proof 2026-05-12 (dev):
 *   - direct prisma.chatMessage.findMany({session_id, deleted_at:null}) → 2 rows
 *   - GET /api/chat/sessions/session_X/messages → { messages: [], total: 0 }
 *   - session.message_count = 2 (correct)
 *
 * Root cause: `messageHandler.list` reads `session.messages` from
 * `sessionService.getSession(sessionId, userId)`. `ChatSessionService.getSession`
 * caches the session payload in Redis (1h TTL). If a prior call populated the
 * cache when message persistence was racing the read (or if a different code
 * path bypassed cache invalidation), the cache returns `{ messages: [] }`
 * forever. The persistence-side `ChatStorageService.addMessageToSession`
 * never invalidates this cache — only `ChatSessionService.addMessage` does,
 * and the chat stream pipeline calls `chatStorage.addMessage` directly (via
 * `buildChatV2Deps.persistAssistantMessage`), bypassing the cache invalidator.
 *
 * Fix: handler must source messages from `chatStorage.getMessages(sessionId)`
 * directly (the authoritative DB read) rather than relying on the
 * possibly-stale cached session payload's `.messages` array.
 */
import { describe, it, expect, vi } from 'vitest';
import { messageHandler } from '../message.handler.js';

function makeReply() {
  const r: any = {};
  r.sent = { code: 200, body: null };
  r.code = vi.fn((c: number) => { r.sent.code = c; return r; });
  r.send = vi.fn((b: any) => { r.sent.body = b; return r; });
  return r;
}

describe('messageHandler.list — Sev-0 #777 persistence read path', () => {
  it('returns the actual DB rows even when the cached session.messages is empty', async () => {
    // Simulate stale cache: sessionService.getSession returns a session with
    // an empty messages[] (cached before persistence completed), but the
    // authoritative DB row count is 2.
    const cachedSessionWithEmptyMessages = {
      id: 'session_x',
      title: 't',
      messages: [], // STALE — bug observed live
      createdAt: '2026-05-12T12:56:45.222Z',
      updatedAt: '2026-05-12T13:00:59.167Z',
      userId: 'u1',
      messageCount: 2,
    };
    const dbRows = [
      { id: 'm1', role: 'user', content: 'list azure subs', timestamp: '2026-05-12T12:56:45.256Z' },
      { id: 'm2', role: 'assistant', content: 'Found 8 tools', timestamp: '2026-05-12T13:00:59.167Z' },
    ];

    const sessionService: any = {
      getSession: vi.fn().mockResolvedValue(cachedSessionWithEmptyMessages),
      // The fix path: handler must consult the storage layer's getMessages,
      // not the cached projection's `.messages` field.
      getMessages: vi.fn().mockResolvedValue(dbRows),
    };
    const reply = makeReply();
    const handler = messageHandler.list(sessionService);
    await handler(
      {
        user: { id: 'u1' },
        params: { sessionId: 'session_x' },
        query: {},
        log: { error: vi.fn() },
      } as any,
      reply,
    );

    expect(reply.sent.code).toBe(200);
    expect(reply.sent.body?.success).toBe(true);
    expect(reply.sent.body?.messages, 'authoritative DB messages, not stale cache').toHaveLength(2);
    expect(reply.sent.body?.messages[0].role).toBe('user');
    expect(reply.sent.body?.messages[1].role).toBe('assistant');
    expect(sessionService.getMessages).toHaveBeenCalledWith('session_x', expect.any(Object));
  });
});
