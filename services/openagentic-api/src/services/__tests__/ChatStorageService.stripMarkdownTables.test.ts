/**
 * ChatStorageService — Sev-0 #1069 dup-render: strips markdown tables from
 * persisted assistant content when the same turn emitted a streaming_table /
 * compose_visual({template:'table'}) artifact.
 *
 * Pins:
 *  - assistant role + visualizations[streaming_table] → table stripped from content
 *  - assistant role + visualizations[visual_render template=table] → stripped
 *  - assistant role + contentBlocks[viz_render template=table] → stripped
 *  - assistant role + NO table-artifact → content preserved verbatim
 *  - user/system/tool roles → never strip (assistant-only behavior)
 *  - text content_block with markdown table also stripped when gate fires
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AITitleGenerationService/TitleGenerationClient/ChatSummaryService
// so importing ChatStorageService doesn't crash trying to wire OpenAI/Bedrock.
vi.mock('../AITitleGenerationService.js', () => ({
  AITitleGenerationService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../TitleGenerationClient.js', () => ({
  TitleGenerationClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../ChatSummaryService.js', () => ({
  ChatSummaryService: vi.fn().mockImplementation(() => ({
    maybeRefreshSummary: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: () => ({ isConnected: () => false, get: vi.fn(), set: vi.fn(), del: vi.fn() }),
}));
// Capture-shared singleton so the test can read what was written.
const captured: { data: any } = { data: null };

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    chatMessage: {
      create: vi.fn().mockImplementation(async (args: any) => {
        captured.data = args.data;
        return { id: args.data.id, ...args.data, created_at: new Date(), updated_at: new Date() };
      }),
    },
    chatSession: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    fileAttachment: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-a' }) },
  },
  prismaBase: { $on: vi.fn() },
}));

import { ChatStorageService } from '../ChatStorageService.js';

function makeServiceWithCapturingPrisma() {
  captured.data = null;
  const svc = new ChatStorageService(
    { redis: undefined as any, providerManager: undefined as any } as any,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } as any,
  );
  return { svc, captured };
}

const TABLE_MD = [
  'Here are your subscriptions:',
  '',
  '| Subscription ID | RG Count |',
  '| --- | --- |',
  '| sub-1 | 3 |',
  '',
  'Total: 1 subscription.',
].join('\n');

describe('ChatStorageService.addMessageToSession — Sev-0 #1069 strip', () => {
  let svc: ChatStorageService;
  let captured: { data: any };

  beforeEach(() => {
    ({ svc, captured } = makeServiceWithCapturingPrisma());
  });

  it('strips markdown tables from assistant content when streaming_table emitted', async () => {
    await svc.addMessageToSession('sess-1', 'user-a', 'assistant', TABLE_MD, {
      visualizations: [{ type: 'streaming_table', data: { artifactId: 'art-1', columns: [], rows: [] } }],
    });
    expect(captured.data.content).toContain('Here are your subscriptions');
    expect(captured.data.content).toContain('Total: 1 subscription');
    expect(captured.data.content).not.toContain('| sub-1 |');
  });

  it('strips when visual_render with template:table emitted', async () => {
    await svc.addMessageToSession('sess-1', 'user-a', 'assistant', TABLE_MD, {
      visualizations: [{ type: 'visual_render', data: { template: 'table', artifactId: 'a' } }],
    });
    expect(captured.data.content).not.toContain('| sub-1 |');
  });

  it('strips when contentBlocks contain a viz_render block with template:table', async () => {
    await svc.addMessageToSession('sess-1', 'user-a', 'assistant', TABLE_MD, {
      contentBlocks: [
        { type: 'text', content: TABLE_MD, id: 't-1' } as any,
        { type: 'viz_render', template: 'table', id: 'v-1', isComplete: true, content: '' } as any,
      ],
    });
    expect(captured.data.content).not.toContain('| sub-1 |');
    // text content_block also stripped
    const textBlock = (captured.data.content_blocks as any[]).find(b => b.type === 'text');
    expect(textBlock.content).not.toContain('| sub-1 |');
    expect(textBlock.content).toContain('Total: 1 subscription');
  });

  it('preserves content verbatim when assistant turn emitted NO table-artifact', async () => {
    await svc.addMessageToSession('sess-1', 'user-a', 'assistant', TABLE_MD, {
      visualizations: [{ type: 'inline_widget', data: { kind: 'savings_card' } }],
    });
    expect(captured.data.content).toBe(TABLE_MD);
  });

  it('preserves content verbatim for user role even with streaming_table visualization', async () => {
    await svc.addMessageToSession('sess-1', 'user-a', 'user', TABLE_MD, {
      visualizations: [{ type: 'streaming_table', data: {} }],
    });
    expect(captured.data.content).toBe(TABLE_MD);
  });
});
