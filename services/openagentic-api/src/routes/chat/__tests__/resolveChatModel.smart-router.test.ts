/**
 * resolveChatModel — Smart-Router consultation for trivial chat.
 *
 * Plan ref: project_session_0505_pm_smart_router_agency_handoff.md (C5).
 *
 * Live-verify on chat-dev (2026-05-06) exposed: C1+C2+C3+C4 are all
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

  // FCA-FLOOR ROUTING CONTRACT (2026-05-24, user direction): the router's
  // pick wins in BOTH directions — DOWN to a cheap model for trivial prompts
  // (and trivial follow-ups like "thanks") and UP for hard prompts — because
  // the SmartModelRouter only returns a candidate that PASSES the RouterTuning
  // FCA floor for the prompt's complexity. The DB default is now the FALLBACK
  // (router absent / errored / no pick), not an override that discards a
  // floor-passing cheap pick. This is what makes "what is 2+2" actually use
  // gpt-oss:20b instead of burning Sonnet. Reverses the prior escalate-only-up
  // contract now that per-model FCA is populated and the floors gate safely.
  it('non-escalated router pick → returns the router\'s cheap model (downward routing)', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        // Router scored the cheap pool winner (passes the chat-pool FCA floor)
        // but did NOT escalate — trivial prompt.
        selectedModel: { modelId: 'gpt-oss:20b' },
        escalated: false,
        resolvedBy: 'cost_quality_score',
        reason: 'Simple chat — using cost-effective gpt-oss:20b',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      message: 'what is 2+2?',
      tools: [{ type: 'function', function: { name: 'tool_search' } }],
      smartRouter: smartRouter as any,
    });

    // The router's floor-passing cheap pick wins — NOT the Sonnet default.
    expect(m).toBe('gpt-oss:20b');
    expect(smartRouter.routeRequest).toHaveBeenCalledOnce();
    const callArgs = (smartRouter.routeRequest as any).mock.calls[0];
    expect(callArgs[0]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'what is 2+2?' }),
        ]),
        tools: expect.any(Array),
      }),
    );
    // The DB default is NOT consulted when the router produced a valid pick.
    expect(ModelConfigurationService.getDefaultChatModel).not.toHaveBeenCalled();
  });

  it('escalated router pick → returns the router\'s bigger model (upward routing)', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        // Structural T3/agentic gate fired — router escalated to a bigger model.
        selectedModel: { modelId: 'opus-big-from-router' },
        escalated: true,
        resolvedBy: 't3_capability_gate',
        reason: 'T3 gate (architecture-design-agentic) — capability floor',
        alternativeModels: [],
        analysisResults: {},
      }),
    };

    const m = await resolveChatModel({
      message: 'design a multi-region FedRAMP failover architecture for our stack',
      smartRouter: smartRouter as any,
    });

    // Escalation wins over the default.
    expect(m).toBe('opus-big-from-router');
    expect(smartRouter.routeRequest).toHaveBeenCalledOnce();
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

  // ──────────────────────────────────────────────────────────────────────
  // Sev-0 (live on api 0.7.1-179ffea2): Auto-Routing kept the Q1 Azure
  // multi-tool prompt on gpt-oss:20b, which leaks chain-of-thought into the
  // Ollama tool-call channel → HTTP 500 → "I had trouble continuing".
  //
  // Ground truth (live registry, 2026-05-23): ONLY gpt-oss:20b is enabled.
  // The PromptClassifier correctly scores the prompt as multi-system-agentic
  // (a T3-trigger taskType), so SmartModelRouter's T3 capability gate fires
  // and DELIBERATELY THROWS `NO_T3_MODEL_IN_REGISTRY` — it refuses to route
  // because no candidate clears the FCA + context floor (gpt-oss has FCA 0).
  //
  // The defeating gap: resolveChatModel's catch-all swallowed that
  // deliberate refusal and downgraded to ModelConfigurationService's cheap
  // DB default — which is the very gpt-oss:20b the router just excluded. The
  // turn then dispatched on gpt-oss and died.
  //
  // Contract: when the router throws a CAPABILITY-REFUSAL sentinel
  // (`NO_T3_MODEL_IN_REGISTRY` / `No models available for routing`),
  // resolveChatModel MUST propagate it — never silently downgrade to the
  // cheap default the router just refused. The stream handler's pickModel
  // catch then aborts the turn with a clear error instead of dispatching a
  // doomed cheap-model turn. This is capability-driven: the refusal
  // originates from the router's RouterTuning FCA/context floors vs the
  // registry, with no model-name literal or hardcoded floor in this layer.
  it('PROPAGATES NO_T3_MODEL_IN_REGISTRY refusal — never downgrades to the cheap DB default', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'gpt-oss:20b-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockRejectedValue(
        new Error(
          'NO_T3_MODEL_IN_REGISTRY: prompt requires T3 (FCA≥0.93, context≥200000) ' +
            'but no candidate registry row qualifies. taskType=multi-system-agentic',
        ),
      ),
    };

    await expect(
      resolveChatModel({
        message: 'show me my Azure subscriptions and what is in each resource group',
        smartRouter: smartRouter as any,
      }),
    ).rejects.toThrow(/NO_T3_MODEL_IN_REGISTRY/);

    // The cheap DB default must NOT be consulted — the router's refusal is
    // authoritative; downgrading would re-admit the excluded model.
    expect(ModelConfigurationService.getDefaultChatModel).not.toHaveBeenCalled();
  });

  it('PROPAGATES "No models available for routing" refusal — never downgrades', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'gpt-oss:20b-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockRejectedValue(
        new Error('No models available for routing'),
      ),
    };

    await expect(
      resolveChatModel({
        message: 'audit our AWS + Azure estate and roll up findings',
        smartRouter: smartRouter as any,
      }),
    ).rejects.toThrow(/No models available for routing/);
    expect(ModelConfigurationService.getDefaultChatModel).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // VISION ROUTING (sev1): an image-bearing turn MUST steer the router to a
  // vision-capable model. The router keys vision detection on an ARRAY
  // content block with `type:'image_url'` (SmartModelRouter.analyzeRequest).
  // resolveChatModel previously sent `content: params.message` as a plain
  // STRING, so analyzeRequest computed requiresVision=false on every turn and
  // the vision candidate filter was dead code on the chat path — an image-
  // only prompt routed by FCA/cost to the default chat model (no vision).
  it('image turn (hasVision) → router request content is an array WITH an image_url block', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('sonnet-from-db');

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        selectedModel: { modelId: 'vision-model-from-router' },
        escalated: false,
        resolvedBy: 'cost_quality_score',
      }),
    };

    const m = await resolveChatModel({
      message: 'what is in this image?',
      hasVision: true,
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('vision-model-from-router');
    expect(smartRouter.routeRequest).toHaveBeenCalledOnce();

    const reqArg = (smartRouter.routeRequest as any).mock.calls[0][0];
    const userMsg = reqArg.messages.find((x: any) => x.role === 'user');
    expect(userMsg).toBeDefined();
    // The content MUST be an array (not a plain string) so the router's
    // analyzeRequest vision detector sees it.
    expect(Array.isArray(userMsg.content)).toBe(true);
    // And it MUST contain an image_url part — that is the EXACT shape
    // analyzeRequest keys requiresVision on.
    expect(
      (userMsg.content as any[]).some((c: any) => c.type === 'image_url'),
    ).toBe(true);
    // The text is preserved alongside the image so length/intent analysis
    // still works.
    expect(
      (userMsg.content as any[]).some(
        (c: any) => c.type === 'text' && c.text === 'what is in this image?',
      ),
    ).toBe(true);
  });

  it('text-only turn (no hasVision) → router request content stays a plain string (no regression)', async () => {
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('sonnet-from-db');

    const smartRouter = {
      routeRequest: vi.fn().mockResolvedValue({
        selectedModel: { modelId: 'gpt-oss:20b' },
      }),
    };

    await resolveChatModel({
      message: 'what is 2+2?',
      smartRouter: smartRouter as any,
    });

    const reqArg = (smartRouter.routeRequest as any).mock.calls[0][0];
    const userMsg = reqArg.messages.find((x: any) => x.role === 'user');
    expect(userMsg.content).toBe('what is 2+2?');
  });

  it('still falls through to DB default on a TRANSIENT router outage (not a refusal)', async () => {
    // A generic router error (timeout / Milvus blip / unexpected throw) is
    // NOT a deliberate capability-refusal — chat must never crash on it.
    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue(
      'sonnet-from-db',
    );

    const smartRouter = {
      routeRequest: vi.fn().mockRejectedValue(new Error('router outage — milvus timeout')),
    };

    const m = await resolveChatModel({
      message: 'what time is it?',
      smartRouter: smartRouter as any,
    });

    expect(m).toBe('sonnet-from-db');
  });
});
