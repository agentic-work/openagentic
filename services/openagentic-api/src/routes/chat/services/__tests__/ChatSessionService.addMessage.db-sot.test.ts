/**
 * Red-green lock for SoT fix at ChatSessionService.addMessage (commit 5424d0f4).
 * The pre-fix code wrote:
 *   model: (message as any).model || process.env.DEFAULT_MODEL
 * into the message row, so a pod env var could silently override the admin-
 * configured default. The fix routes through resolveChatModel() which reads
 * ModelConfigurationService (DB) and NEVER process.env.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../services/ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
  },
}));

import { ChatSessionService } from '../ChatSessionService.js';
import { ModelConfigurationService } from '../../../../services/ModelConfigurationService.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
};

function makeStorage() {
  return {
    getSession: vi.fn(),
    addMessageToSession: vi.fn(),
  };
}

describe('ChatSessionService.addMessage — DB is SoT for message.model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('persists the DB-backed default when message+session have no model and env is poisoned', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chosen-model');

    const storage = makeStorage();
    storage.getSession.mockResolvedValue({ id: 'sess-1', model: null });
    const svc = new ChatSessionService(storage, silentLogger as any);

    await svc.addMessage('sess-1', 'user-1', {
      role: 'assistant',
      content: 'hi',
    } as any);

    expect(storage.addMessageToSession).toHaveBeenCalledOnce();
    const [, , , , opts] = storage.addMessageToSession.mock.calls[0];
    expect(opts.model).toBe('db-chosen-model');
    expect(opts.model).not.toBe('env-poisoned-model');
  });

  it('prefers the persisted session.model over the DB default when session has one', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-default');

    const storage = makeStorage();
    storage.getSession.mockResolvedValue({ id: 'sess-1', model: 'session-pinned' });
    const svc = new ChatSessionService(storage, silentLogger as any);

    await svc.addMessage('sess-1', 'user-1', { role: 'user', content: 'hi' } as any);

    const [, , , , opts] = storage.addMessageToSession.mock.calls[0];
    expect(opts.model).toBe('session-pinned');
  });

  it('prefers message.model over session.model and DB default', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-default');

    const storage = makeStorage();
    storage.getSession.mockResolvedValue({ id: 'sess-1', model: 'session-pinned' });
    const svc = new ChatSessionService(storage, silentLogger as any);

    await svc.addMessage('sess-1', 'user-1', {
      role: 'assistant',
      content: 'hi',
      model: 'caller-pinned',
    } as any);

    const [, , , , opts] = storage.addMessageToSession.mock.calls[0];
    expect(opts.model).toBe('caller-pinned');
  });

  it('falls back to emergency sentinel — NOT env — when DB and session are empty', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('db down'));

    const storage = makeStorage();
    storage.getSession.mockResolvedValue(null);
    const svc = new ChatSessionService(storage, silentLogger as any);

    await svc.addMessage('sess-1', 'user-1', { role: 'user', content: 'hi' } as any);

    const [, , , , opts] = storage.addMessageToSession.mock.calls[0];
    expect(opts.model).toBe('default');
    expect(opts.model).not.toBe('env-poisoned-model');
  });
});
