/**
 * Red-green lock for SoT fix at ChatService.generateTitle (plan task 3).
 *
 * Pre-fix code read:
 *   const titleModel = process.env.TITLE_GENERATION_MODEL || process.env.DEFAULT_MODEL;
 * and used that env value directly in the axios call model field.
 *
 * Fix: resolve from ModelConfigurationService.getServiceModel('titleGeneration')
 * with getDefaultChatModel() fall-through — no env reads on the live path.
 *
 * Scenarios:
 *   1. DB service assignment wins over poisoned env
 *   2. Null service assignment falls through to getDefaultChatModel()
 *   3. Both DB calls reject → method swallows error and returns 'New Chat'
 *      (existing catch block behaviour preserved)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn(),
    getDefaultChatModel: vi.fn(),
  },
}));

// Stub axios so we don't hit the network
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Stub prisma — ChatService reads chatMessage + chatSession tables
vi.mock('../../utils/prisma.js', () => ({
  prisma: {},
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import axios from 'axios';
import { ChatService } from '../ChatService.js';
import { TEST_PROVIDER_TYPE } from '../../test/sot-constants.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
};

function makeService() {
  const prisma: any = {
    chatMessage: {
      findMany: vi.fn().mockResolvedValue([
        { role: 'user', content: 'Hello, how are you?' },
      ]),
    },
    chatSession: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return { svc: new ChatService(prisma, silentLogger as any), prisma };
}

function mockAxiosSuccess(model: string) {
  (axios.post as any).mockResolvedValue({
    data: {
      choices: [{ message: { content: 'A Generated Title' } }],
    },
  });
}

describe('ChatService.generateTitle — DB is SoT for title model', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getServiceModel as any).mockReset();
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    (axios.post as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('uses DB service assignment and ignores poisoned env', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue({
      modelId: 'db-title-model',
      provider: TEST_PROVIDER_TYPE,
    });
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');
    mockAxiosSuccess('db-title-model');

    const { svc } = makeService();
    await svc.generateTitle('sess-1', 'user-1');

    // The axios call must carry the DB-assigned model, NOT env-poisoned-title
    expect(axios.post).toHaveBeenCalledOnce();
    const body = (axios.post as any).mock.calls[0][1];
    expect(body.model).toBe('db-title-model');
    expect(body.model).not.toBe('env-poisoned-title');
    expect(body.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getServiceModel).toHaveBeenCalledWith('titleGeneration');
  });

  it('falls through to getDefaultChatModel when service assignment is null', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';

    (ModelConfigurationService.getServiceModel as any).mockResolvedValue(null);
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');
    mockAxiosSuccess('db-chat');

    const { svc } = makeService();
    await svc.generateTitle('sess-1', 'user-1');

    expect(axios.post).toHaveBeenCalledOnce();
    const body = (axios.post as any).mock.calls[0][1];
    expect(body.model).toBe('db-chat');
    expect(body.model).not.toBe('env-poisoned-title');
    expect(body.model).not.toBe('env-poisoned-default');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('returns "New Chat" when both DB calls reject (catch block preserved)', async () => {
    process.env.TITLE_GENERATION_MODEL = 'env-poisoned-title';

    (ModelConfigurationService.getServiceModel as any).mockRejectedValue(new Error('DB down'));
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const { svc } = makeService();
    const result = await svc.generateTitle('sess-1', 'user-1');

    // ChatService.generateTitle has a top-level catch that returns 'New Chat'
    expect(result).toBe('New Chat');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
