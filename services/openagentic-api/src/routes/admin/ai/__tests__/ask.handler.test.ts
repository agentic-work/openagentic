/**
 * Tests for the Admin AI SSE handler. Mocks ProviderManager,
 * ModelConfigurationService, and the FastifyReply raw stream so we can
 * assert the SSE event sequence without standing up Fastify.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoisted stubs — vi.mock callbacks are hoisted; bind via factory.
const getProviderManagerMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock('../../../../services/llm-providers/ProviderManager.js', () => ({
  getProviderManager: () => getProviderManagerMock(),
}));

vi.mock('../../../../services/ModelConfigurationService.js', () => ({
  ModelConfigurationService: { getConfig: () => getConfigMock() },
}));

vi.mock('../../../../utils/logger.js', () => ({
  loggers: {
    routes: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

import { adminAiAskHandler } from '../ask.handler.js';

function makeReply() {
  const writes: string[] = [];
  const reply: any = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn(),
    raw: {
      writableEnded: false,
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      socket: { setNoDelay: vi.fn() },
      write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
      end: vi.fn(() => { reply.raw.writableEnded = true; }),
    },
    _writes: writes,
  };
  return reply;
}

function makeRequest(body: any) {
  const req: any = {
    body,
    raw: {
      on: vi.fn(),
    },
  };
  return req;
}

async function* asyncStream(tokens: string[]) {
  for (const t of tokens) {
    yield { choices: [{ delta: { content: t } }] };
  }
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

describe('adminAiAskHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('400 when message is missing', async () => {
    const req = makeRequest({ sessionId: 's1' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'BAD_REQUEST' }) })
    );
  });

  it('400 when sessionId is missing', async () => {
    const req = makeRequest({ message: 'hi' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it('503 when ProviderManager not ready', async () => {
    getProviderManagerMock.mockReturnValueOnce(null);
    const req = makeRequest({ message: 'hi', sessionId: 's1' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }) })
    );
  });

  it('503 when no default model is configured in Registry', async () => {
    getProviderManagerMock.mockReturnValueOnce({ createCompletion: vi.fn() });
    getConfigMock.mockResolvedValueOnce({ defaultModel: null });
    const req = makeRequest({ message: 'How do I add a model?', sessionId: 's1' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'NO_DEFAULT_MODEL' }) })
    );
  });

  it('streams completion_start → content → suggestions → done on success', async () => {
    const createCompletion = vi.fn().mockResolvedValueOnce(asyncStream(['Open ', '[Models]', '(#model-management)']));
    getProviderManagerMock.mockReturnValueOnce({ createCompletion });
    getConfigMock.mockResolvedValueOnce({ defaultModel: { modelId: 'global.anthropic.claude-sonnet-4-6' } });
    const req = makeRequest({ message: 'How do I add a model?', sessionId: 's1', currentSection: 'overview' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);

    const allWrites = reply._writes.join('');
    expect(allWrites).toContain('event: completion_start');
    expect(allWrites).toContain('global.anthropic.claude-sonnet-4-6');
    expect(allWrites).toContain('event: content');
    expect(allWrites).toContain('Open '); // first token streamed
    expect(allWrites).toContain('[Models]');
    expect(allWrites).toContain('event: suggestions');
    expect(allWrites).toContain('event: done');
    // SSE response code is set via writeHead, not reply.code
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }));
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('passes user message + corpus + currentSection in the LLM request', async () => {
    const createCompletion = vi.fn().mockResolvedValueOnce(asyncStream(['ok']));
    getProviderManagerMock.mockReturnValueOnce({ createCompletion });
    getConfigMock.mockResolvedValueOnce({ defaultModel: { modelId: 'm' } });
    const req = makeRequest({
      message: 'where do I configure DLP?',
      sessionId: 's2',
      currentSection: 'audit',
    });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    expect(createCompletion).toHaveBeenCalledTimes(1);
    const completionReq = createCompletion.mock.calls[0][0];
    const sysMsg = completionReq.messages.find((m: any) => m.role === 'system');
    expect(sysMsg.content).toContain('USER IS CURRENTLY ON: audit');
    expect(sysMsg.content).toContain('[DLP Configuration](#dlp-config)');
    const userMsg = completionReq.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toBe('where do I configure DLP?');
    expect(completionReq.stream).toBe(true);
  });

  it('emits error event when stream throws', async () => {
    const failingStream = (async function* () {
      yield { choices: [{ delta: { content: 'partial ' } }] };
      throw new Error('upstream blew up');
    })();
    const createCompletion = vi.fn().mockResolvedValueOnce(failingStream);
    getProviderManagerMock.mockReturnValueOnce({ createCompletion });
    getConfigMock.mockResolvedValueOnce({ defaultModel: { modelId: 'm' } });
    const req = makeRequest({ message: 'hi', sessionId: 's1' });
    const reply = makeReply();
    await adminAiAskHandler(req, reply);
    const allWrites = reply._writes.join('');
    expect(allWrites).toContain('event: error');
    expect(allWrites).toContain('upstream blew up');
    expect(reply.raw.end).toHaveBeenCalled();
  });
});
