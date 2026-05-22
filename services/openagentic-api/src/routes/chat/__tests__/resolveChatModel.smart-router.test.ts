/**
 * resolveChatModel — Smart-Router consultation for trivial chat.
 *
 * Plan ref: project_session_0505_pm_smart_router_agency_handoff.md (C5).
 *
 * Live-verify on the dev environment (2026-05-06) exposed: C1+C2+C3+C4 are all
 * deployed but the cheapest-for-chat branch in SmartModelRouter is
 * dormant because resolveChatModel returns the DB-backed default
 * (`us.anthropic.claude-sonnet-4-6`) WITHOUT consulting SmartModelRouter.
 * V2 pipeline runs AFTER, so the model is already locked to Sonnet.
 *
 * Contract: when neither explicit nor session model is set, BUT a
 * SmartModelRouter dep is supplied, ask the router for the best model
 * given the user message and tools. The router's `routeRequest()` will
 * call the IntentClassifier internally and apply the cheapest-for-chat
 * branch when intent is 'chat'/'unclear'/null. Falls back to the DB
 * default when the router dep is absent (pre-deploy contract preserved).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../services/ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
  },
}));

import { resolveChatModel } from '../resolveChatModel.js';
import { ModelConfigurationService } from '../../../services/ModelConfigurationService.js';

describe('resolveChatModel — SmartModelRouter consultation', () => {
  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('consults SmartModelRouter when no explicit + no session and router dep is present', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        selectedModel: { modelId: 'cheap-mini-from-router' },
        reason: 'Trivial chat (intent=chat) — cheapest chat-capable model',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      message: 'what time is it?',
      tools: [{ type: 'function', function: { name: 'tool_search' } }],
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('cheap-mini-from-router');
    expect(smartRouter.routeRequest).toHaveBeenCalledOnce();
    // The router must receive a CompletionRequest shape with the user
    // message + tools so its IntentClassifier branch can fire.
    // Q1-fix-10 — routeRequest signature is now (req, userId?, opts?);
    // first positional arg is the CompletionRequest shape.
    const callArgs = (smartRouter.routeRequest as any).mock.calls[0];
    expect(callArgs[0]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'what time is it?' }),
        ]),
        tools: expect.any(Array),
      }),
    );
  });

  it('explicit model still wins over SmartModelRouter (user override is sticky)', async () => {
    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        selectedModel: { modelId: 'cheap-mini-from-router' },
        reason: '',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      explicitModel: 'user-pinned-model',
      message: 'what time is it?',
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('user-pinned-model');
    expect(smartRouter.routeRequest).not.toHaveBeenCalled();
  });

  it('session model still wins over SmartModelRouter (per-session pin sticky)', async () => {
    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        selectedModel: { modelId: 'cheap-mini-from-router' },
        reason: '',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      sessionModel: 'session-pinned-model',
      message: 'what time is it?',
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('session-pinned-model');
    expect(smartRouter.routeRequest).not.toHaveBeenCalled();
  });

  it('falls through to DB default when router dep is absent (backwards-compat)', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const m = await resolveChatModel({
      message: 'what time is it?',
    });

    expect(m).toBe('sonnet-from-db');
  });

  it('falls through to DB default when SmartModelRouter throws', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockRejectedValue(new Error('router outage')),
    };

    const m = await resolveChatModel({
      message: 'what time is it?',
      smartRouter: smartRouter as any,
    });

    // Router failure is best-effort; never crash chat — always return a usable model.
    expect(m).toBe('sonnet-from-db');
  });

  it('falls through to DB default when SmartModelRouter returns no selectedModel', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        // Malformed: no selectedModel.modelId.
        selectedModel: undefined,
        reason: '',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      message: 'what time is it?',
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('sonnet-from-db');
  });
});
