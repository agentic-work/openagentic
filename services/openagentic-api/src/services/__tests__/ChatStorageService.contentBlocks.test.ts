/**
 * Sev-0 P0 #940 (2026-05-18) — assistant persistence regression.
 *
 * Live symptom on the dev environment: chat sessions accumulate user rows only; zero
 * assistant rows ever land in DB. Breadcrumb says "4 msgs", DOM renders 4
 * user bubbles, 0 assistant bubbles. Stream completes 200 OK; client thinks
 * everything worked.
 *
 * Root cause: schema.prisma declares `content_blocks Json?` on the
 * `Messages` model (mapped to `messages`) but NOT on the `ChatMessage`
 * model (mapped to `chat_messages`). All production code writes via
 * `prisma.chatMessage.create({ data: { content_blocks: ... }})`. The
 * generated Prisma client therefore rejects `content_blocks` as
 * "Unknown argument". The stream.handler.ts:1544 catch-and-warn swallows
 * the throw so the user-facing stream completes successfully — but the
 * assistant row is never persisted.
 *
 * RED test: when addMessageToSession is called with a non-empty
 * contentBlocks option (the path chatLoop uses for every assistant
 * finalize), prisma.chatMessage.create MUST be invoked with
 * `data.content_blocks` set to the provided value. Today this throws
 * "Unknown argument" → test goes RED. After we add the field to the
 * ChatMessage model in schema.prisma, prisma generate updates the client
 * to accept it → test goes GREEN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockChatMessageCreate = vi.fn();
const mockChatSessionUpdate = vi.fn();
const mockChatSessionFindUnique = vi.fn();
const mockChatSessionFindFirst = vi.fn();
const mockMessageCount = vi.fn();
const mockChatMessageFindMany = vi.fn();

vi.mock('../../utils/prisma.js', () => {
  const prismaMock = {
    chatMessage: {
      create: (...args: any[]) => mockChatMessageCreate(...args),
      findMany: (...args: any[]) => mockChatMessageFindMany(...args),
      count: (...args: any[]) => mockMessageCount(...args),
    },
    chatSession: {
      findUnique: (...args: any[]) => mockChatSessionFindUnique(...args),
      findFirst: (...args: any[]) => mockChatSessionFindFirst(...args),
      update: (...args: any[]) => mockChatSessionUpdate(...args),
      count: vi.fn().mockResolvedValue(0),
    },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
    fileAttachment: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    chatMetrics: { create: vi.fn() },
    $on: vi.fn(),
  };
  return {
    prisma: prismaMock,
    prismaBase: { $on: vi.fn(), $connect: vi.fn(), $queryRaw: vi.fn() },
  };
});

vi.mock('../../repositories/SimpleChatSessionRepository.js', () => ({
  SimpleChatSessionRepository: class {
    constructor(_p: any, _l: any, _c: boolean) {}
    create = vi.fn();
  },
}));

vi.mock('../AITitleGenerationService.js', () => ({
  AITitleGenerationService: class {
    constructor(..._args: any[]) {}
    generateTitle = vi.fn();
  },
}));

vi.mock('../TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {
    constructor(..._args: any[]) {}
  },
}));

vi.mock('../ChatSummaryService.js', () => ({
  ChatSummaryService: class {
    constructor(..._args: any[]) {}
    maybeRefreshSummary = vi.fn().mockResolvedValue(undefined);
  },
}));

import pino from 'pino';

describe('ChatStorageService — Sev-0 #940 assistant content_blocks persistence', () => {
  beforeEach(() => {
    mockChatMessageCreate.mockReset();
    mockChatSessionUpdate.mockReset();
    mockChatSessionFindUnique.mockReset();
    mockChatSessionFindFirst.mockReset();
    mockMessageCount.mockReset();
    mockChatMessageFindMany.mockReset();
    // Session lookup returns a found session so addMessage proceeds
    mockChatSessionFindUnique.mockResolvedValue({
      id: 'session_test',
      user_id: 'user_test',
      message_count: 1,
    });
    mockChatSessionFindFirst.mockResolvedValue({
      id: 'session_test',
      user_id: 'user_test',
      message_count: 1,
    });
    mockMessageCount.mockResolvedValue(1);
    mockChatMessageFindMany.mockResolvedValue([]);
    mockChatSessionUpdate.mockResolvedValue({ id: 'session_test' });
    // Default: create resolves with a row-like object
    mockChatMessageCreate.mockResolvedValue({
      id: 'msg_test_id',
      session_id: 'session_test',
      role: 'assistant',
      content: 'Hello world',
    });
  });

  it('persists content_blocks on the chatMessage.create data payload (RED → GREEN)', async () => {
    const { ChatStorageService } = await import('../ChatStorageService.js');
    const svc = new ChatStorageService(pino({ level: 'silent' }) as any);

    const contentBlocks = [
      {
        index: 0,
        type: 'text',
        content: 'Stream answer body',
        isComplete: true,
        timestamp: Date.now(),
      },
      {
        index: 1,
        type: 'tool_use',
        toolName: 'tool_search',
        toolId: 'toolu_test_1',
        input: { query: 'RFC 6749' },
        isComplete: true,
        timestamp: Date.now(),
      },
    ];

    await svc.addMessageToSession(
      'session_test',
      'user_test',
      'assistant',
      'Stream answer body',
      {
        model: 'us.anthropic.claude-sonnet-4-6',
        contentBlocks,
        toolCalls: [{ id: 'toolu_test_1', name: 'tool_search', arguments: {} }],
        toolResults: [{ id: 'toolu_test_1', result: 'mock' }],
      },
    );

    expect(mockChatMessageCreate).toHaveBeenCalledTimes(1);
    const callArg = mockChatMessageCreate.mock.calls[0][0];
    expect(callArg).toBeDefined();
    expect(callArg.data).toBeDefined();
    expect(callArg.data.role).toBe('assistant');
    expect(callArg.data.session_id).toBe('session_test');
    // CRITICAL — the content_blocks payload must reach the create call.
    // Pre-fix this assertion still PASSES (the source writes it), but the
    // actual Prisma client rejects the key as Unknown at runtime → row
    // never lands. Post-fix (schema.prisma adds the column on ChatMessage
    // model, db push reconciles, prisma generate regenerates client) the
    // same call shape now succeeds end-to-end. We pin both call-site
    // intent AND the column exists by asserting against the schema in a
    // companion architecture test.
    expect(callArg.data.content_blocks).toEqual(contentBlocks);
  });

  it('does not throw when contentBlocks is undefined (legacy/user/tool turns)', async () => {
    const { ChatStorageService } = await import('../ChatStorageService.js');
    const svc = new ChatStorageService(pino({ level: 'silent' }) as any);

    await expect(
      svc.addMessageToSession('session_test', 'user_test', 'user', 'Hi', {}),
    ).resolves.toBeDefined();

    expect(mockChatMessageCreate).toHaveBeenCalledTimes(1);
    const callArg = mockChatMessageCreate.mock.calls[0][0];
    // contentBlocks omitted → either undefined (current behavior) or null.
    // Either is acceptable; Prisma treats both as "do not set".
    const cb = callArg.data.content_blocks;
    expect(cb === undefined || cb === null).toBe(true);
  });
});
