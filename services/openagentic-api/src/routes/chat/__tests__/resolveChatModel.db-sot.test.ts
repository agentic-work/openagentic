/**
 * Red tests for SoT violation #2: routes/chat.ts persisted
 *   model: process.env.DEFAULT_MODEL || 'default'
 * at session-create (line 209) and message-save (lines 354, 406),
 * letting a pod env var override the admin-configured default model.
 *
 * Contract: the resolver reads ONLY (explicit | session | DB default),
 * never process.env. Even when DEFAULT_MODEL is set to garbage, the
 * DB default or session model must win.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../services/ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
  },
}));

import { resolveChatModel } from '../resolveChatModel.js';
import { ModelConfigurationService } from '../../../services/ModelConfigurationService.js';

describe('resolveChatModel — DB is SoT (never reads process.env)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('ignores process.env.DEFAULT_MODEL — falls through to DB-backed default', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'db-chosen-model',
    );

    const m = await resolveChatModel({});

    expect(m).toBe('db-chosen-model');
  });

  it('prefers explicitModel when present (user request body)', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'db-chosen-model',
    );

    const m = await resolveChatModel({ explicitModel: 'user-pinned' });

    expect(m).toBe('user-pinned');
  });

  it('prefers sessionModel when explicitModel missing', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'db-chosen-model',
    );

    const m = await resolveChatModel({ sessionModel: 'gpt-from-session' });

    expect(m).toBe('gpt-from-session');
  });

  it('does NOT fall through to process.env.DEFAULT_MODEL even when DB fails', async () => {
    process.env.DEFAULT_MODEL = 'env-poisoned-model';
    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(
      new Error('db down'),
    );

    const m = await resolveChatModel({});

    expect(m).not.toBe('env-poisoned-model');
    // emergency sentinel, NOT the env var
    expect(m).toBe('default');
  });

  it('treats whitespace-only explicit/session as missing', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'db-chosen-model',
    );

    const m = await resolveChatModel({
      explicitModel: '   ',
      sessionModel: '',
    });

    expect(m).toBe('db-chosen-model');
  });
});
