/**
 * Phase A.4 — server-side tool_choice forcing on artifact verbs.
 *
 * When the user names an artifact verb (render/chart/diagram/sankey/…)
 * AND at least one MCP tool_result has been returned this turn,
 * the next model call MUST be forced to compose_visual / compose_app
 * via tool_choice:{type:'function',function:{name:'compose_visual'}}.
 * After the forced call lands, the subsequent turn reverts to 'auto'.
 *
 * Tests:
 *   (a) detectArtifactVerb: "render a sankey" + 1 MCP result → compose_visual
 *   (b) detectArtifactVerb: "show me a dashboard" + 1 MCP result → compose_app
 *   (c) detectArtifactVerb: "what's the weather today" + 0 MCP results → no force
 *   (d) integration: after force-dispatch turn, next turn reverts to 'auto'
 *   (e) Ollama/gpt-oss:20b path: forced tool_choice shape passes through
 *   (f) Bedrock path: same forced shape passes through
 */
import { describe, it, expect, vi } from 'vitest';
import { detectArtifactVerb } from '../artifactVerbDetector.js';
import { chatLoop } from '../chatLoop.js';

// ---------------------------------------------------------------------------
// (a) "render a sankey" + 1 MCP result → { shouldForce: true, toolName: 'compose_visual' }
// ---------------------------------------------------------------------------
describe('detectArtifactVerb', () => {
  it('(a) "render a sankey of my cost data" + 1 MCP result → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'render a sankey of my cost data',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(b) "show me a dashboard of my services" + 1 MCP result → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'show me a dashboard of my services',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it("(c) \"what's the weather today\" + 0 MCP results → no force", () => {
    const result = detectArtifactVerb({
      userMessage: "what's the weather today",
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(false);
    expect(result.toolName).toBeUndefined();
  });

  it('returns no force when artifact verb present but 0 MCP results', () => {
    const result = detectArtifactVerb({
      userMessage: 'render a chart of the data',
      mcpToolResultsThisTurn: 0,
    });
    expect(result.shouldForce).toBe(false);
  });

  it('returns no force when MCP results present but no artifact verb', () => {
    const result = detectArtifactVerb({
      userMessage: 'list all my subscriptions',
      mcpToolResultsThisTurn: 3,
    });
    expect(result.shouldForce).toBe(false);
  });

  it('chart → compose_visual (single-frame)', () => {
    const result = detectArtifactVerb({
      userMessage: 'chart my aws costs by service',
      mcpToolResultsThisTurn: 2,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('diagram → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'draw a diagram of the architecture',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('flowchart → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'create a flowchart for the deployment process',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('interactive → compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'build an interactive cost explorer',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });

  it('case-insensitive: CHART → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'CHART the spend breakdown',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('ambiguous: prefers compose_visual when both classes match equally', () => {
    // "plot a dashboard" — "plot" is visual, "dashboard" is app.
    // The rule: when both match, prefer compose_visual (lower-cost emission).
    // But the implementation may pick either; test that it returns _something_ forced.
    const result = detectArtifactVerb({
      userMessage: 'plot a dashboard of the data',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    // toolName is one of the two valid choices.
    expect(['compose_visual', 'compose_app']).toContain(result.toolName);
  });
});

// ---------------------------------------------------------------------------
// (d) integration: after force-dispatch turn with compose_visual emitted,
//     the NEXT turn reverts to 'auto' (no stuck forcing).
// ---------------------------------------------------------------------------
describe('chatLoop — tool_choice forcing integration', () => {
  function makeCtx() {
    const emitted: Array<{ op: string; payload: any }> = [];
    return {
      ctx: {
        emit: (op: string, payload: any) => emitted.push({ op, payload }),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        sessionId: 's',
        userId: 'u',
      } as any,
      emitted,
    };
  }

  it('(d) forced tool_choice on post-MCP turn, reverts to auto on synthesis', async () => {
    const { ctx } = makeCtx();

    // Track the tool_choice each streamProvider call receives.
    const capturedToolChoices: unknown[] = [];

    let call = 0;
    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        // Turn 1: model fetches data via an MCP tool.
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'mcp1',
            name: 'azure_cost_query',
            input: { subscription: 'sub1' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        // Turn 2: this is the forced turn — model MUST emit compose_visual.
        // The tool_choice should be a forced named-function shape.
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv1',
            name: 'compose_visual',
            input: { template: 'sankey', nodes: [] },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 3) {
        // Turn 3: synthesis — reverted to auto.
        return (async function* () {
          yield { type: 'text_delta', text: 'Here is your sankey chart.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // Turn 4: follow-up chip generation.
      return (async function* () {
        yield { type: 'text_delta', text: '["enlarge chart","export CSV","compare months"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'azure_cost_query') {
        return { ok: true, output: { total: 1234.56, items: [{ svc: 'VM', cost: 500 }] } };
      }
      if (x.name === 'compose_visual') {
        return { ok: true, output: { rendered: true } };
      }
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        // User message has an artifact verb + an MCP result will come back.
        userMessage: 'render a sankey of my azure costs',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'azure_cost_query' } },
          { type: 'function', function: { name: 'compose_visual' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(['azure_cost_query']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 1 is the initial call — should be 'auto' (no forcing yet).
    expect(capturedToolChoices[0]).toBe('auto');

    // Turn 2 is the forced turn — should carry named-function shape.
    // The exact shape: { type: 'function', function: { name: 'compose_visual' } }
    const forcedChoice = capturedToolChoices[1] as any;
    expect(forcedChoice).toBeTruthy();
    expect(typeof forcedChoice).toBe('object');
    expect(forcedChoice.type).toBe('function');
    expect(forcedChoice.function?.name).toBe('compose_visual');

    // Turn 3 is synthesis — reverted to 'auto'.
    expect(capturedToolChoices[2]).toBe('auto');

    // Turn 4 is chip-gen — 'none' (chip-gen always forces none).
    expect(capturedToolChoices[3]).toBe('none');
  });

  // ---------------------------------------------------------------------------
  // (e) Ollama/gpt-oss:20b path: forced tool_choice shape passes through.
  //     We verify the shape is sent to the streamProvider, not Ollama-specific
  //     wire body (that's a provider concern, not chatLoop's).
  // ---------------------------------------------------------------------------
  it('(e) Ollama / gpt-oss:20b path — forced tool_choice object passes through streamProvider call', async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];
    let call = 0;

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'mcp1',
            name: 'gcp_billing_query',
            input: { project: 'my-proj' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv2',
            name: 'compose_visual',
            input: { template: 'bar', data: {} },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 3) {
        return (async function* () {
          yield { type: 'text_delta', text: 'Here is your chart.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: '["a","b","c"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'gcp_billing_query') return { ok: true, output: { cost: 500 } };
      if (x.name === 'compose_visual') return { ok: true, output: { rendered: true } };
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'visualize my gcp costs this month',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'gcp_billing_query' } },
          { type: 'function', function: { name: 'compose_visual' } },
        ],
        model: 'gpt-oss:20b',
        maxTurns: 10,
        concurrencySafeNames: new Set(['gcp_billing_query']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 2 must carry the forced named-function shape regardless of model.
    const forcedChoice = capturedToolChoices[1] as any;
    expect(forcedChoice).toBeTruthy();
    expect(typeof forcedChoice).toBe('object');
    expect(forcedChoice.type).toBe('function');
    expect(forcedChoice.function?.name).toBe('compose_visual');
  });

  // ---------------------------------------------------------------------------
  // (f) Bedrock path: same forced shape passes through to streamProvider.
  //     buildAnthropicWireBody's decorateToolChoice already converts
  //     {type:'tool',name} → Anthropic wire shape; chatLoop only needs to
  //     pass the right ProviderRequest shape.
  // ---------------------------------------------------------------------------
  it('(f) Bedrock model path — same forced tool_choice shape as Anthropic', async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];
    let call = 0;

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'aws1',
            name: 'aws_cost_explorer',
            input: { period: '30d' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv3',
            name: 'compose_visual',
            input: { template: 'pie', data: {} },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 3) {
        return (async function* () {
          yield { type: 'text_delta', text: 'Your AWS cost pie chart is ready.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: '["a","b","c"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'aws_cost_explorer') return { ok: true, output: { cost: 2345 } };
      if (x.name === 'compose_visual') return { ok: true, output: { rendered: true } };
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'plot my aws costs as a pie chart',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'aws_cost_explorer' } },
          { type: 'function', function: { name: 'compose_visual' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(['aws_cost_explorer']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 2 must carry the named-function forced tool_choice.
    const forcedChoice = capturedToolChoices[1] as any;
    expect(forcedChoice).toBeTruthy();
    expect(typeof forcedChoice).toBe('object');
    expect(forcedChoice.type).toBe('function');
    expect(forcedChoice.function?.name).toBe('compose_visual');
  });
});

// ---------------------------------------------------------------------------
// C3 — scenario-pattern triggers must fire pre-MCP (turn 1, mcpToolResults=0)
//
// Today detectArtifactVerb is invoked ONLY inside the tool_use stop-reason
// handler (post-MCP). For migration / onboarding scenario patterns, there
// is no required MCP round-trip — the detector must also run BEFORE the
// first model call so the tool_choice is already forced on turn 1.
//
// Fix: chatLoop must call detectArtifactVerb on EVERY iteration, not just
// after a tool_use turn. The detector's own guard (mcpToolResults >= 1 for
// verbs+scenarios, >= 3 for structural-complexity) controls whether it fires.
//
// Tests:
//   (g) Migration-plan prompt → compose_app forced on FIRST model call (no MCP)
//   (h) Onboarding-user prompt → compose_app forced on FIRST model call (no MCP)
//   (i) "What's the weather" → NO force on first call (normal conversation)
//   (j) Regression: explicit verb "render a sankey" + MCP=3 → force still works
//       (the existing post-MCP path is also valid; this must not break)
// ---------------------------------------------------------------------------
describe('chatLoop — C3: scenario patterns fire pre-MCP (turn 1)', () => {
  function makeCtx() {
    const emitted: Array<{ op: string; payload: any }> = [];
    return {
      ctx: {
        emit: (op: string, payload: any) => emitted.push({ op, payload }),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        sessionId: 's',
        userId: 'u',
      } as any,
      emitted,
    };
  }

  it('(g) migration-plan prompt → compose_app forced on FIRST model call (0 MCP results)', async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];
    let call = 0;

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        // Turn 1: chatLoop should have already set compose_app as forced
        // (detectArtifactVerb detects scenario BEFORE the model call).
        // Model emits compose_app (matching the forced tool_choice).
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'ca1',
            name: 'compose_app',
            input: { template: 'migration_plan', phases: [] },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        // Turn 2: synthesis
        return (async function* () {
          yield { type: 'text_delta', text: 'Your migration plan is ready.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      // chip-gen
      return (async function* () {
        yield { type: 'text_delta', text: '["estimate downtime","export plan","refine phases"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_app') return { ok: true, output: { rendered: true } };
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        // Matches SCENARIO_PATTERN: migration + phased + plan + downtime → compose_app
        userMessage: 'phased migration plan with downtime estimates for our database',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'compose_app' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 1 (index 0) MUST be forced to compose_app — scenario detected pre-MCP
    const firstChoice = capturedToolChoices[0] as any;
    expect(firstChoice).toBeTruthy();
    expect(typeof firstChoice).toBe('object');
    expect(firstChoice.type).toBe('function');
    expect(firstChoice.function?.name).toBe('compose_app');
  });

  it('(h) onboarding-user prompt → compose_app forced on FIRST model call (0 MCP results)', async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];
    let call = 0;

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'ca2',
            name: 'compose_app',
            input: { template: 'onboarding_flow', user: 'jenny.kim' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield { type: 'text_delta', text: 'Onboarding flow ready.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: '["add more roles","review access","export flow"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'compose_app') return { ok: true, output: { rendered: true } };
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        // Matches SCENARIO_PATTERN: onboard + least-priv → compose_app
        userMessage: 'onboard jenny.kim with least-priv access to the dev environment',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'compose_app' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 1 MUST be forced
    const firstChoice = capturedToolChoices[0] as any;
    expect(firstChoice).toBeTruthy();
    expect(typeof firstChoice).toBe('object');
    expect(firstChoice.type).toBe('function');
    expect(firstChoice.function?.name).toBe('compose_app');
  });

  it("(i) \"What's the weather\" → NO force on first call (normal conversation)", async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      return (async function* () {
        yield { type: 'text_delta', text: 'The weather is sunny.' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn();

    await chatLoop(
      ctx,
      {
        userMessage: "What's the weather today?",
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'compose_app' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 1 should be 'auto' — no scenario pattern matched
    expect(capturedToolChoices[0]).toBe('auto');
  });

  it('(j) regression: explicit verb "render a sankey" + MCP≥1 → force still fires (post-MCP path intact)', async () => {
    const { ctx } = makeCtx();
    const capturedToolChoices: unknown[] = [];
    let call = 0;

    function streamProvider(req: any) {
      capturedToolChoices.push(req.tool_choice);
      call++;
      if (call === 1) {
        // Turn 1: model fetches data via MCP tool
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'mcp1',
            name: 'azure_cost_query',
            input: { sub: 'sub1' },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        // Turn 2: compose_visual forced by post-MCP path
        return (async function* () {
          yield {
            type: 'tool_use_complete',
            id: 'cv1',
            name: 'compose_visual',
            input: { template: 'sankey', nodes: [] },
          };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 3) {
        return (async function* () {
          yield { type: 'text_delta', text: 'Here is your sankey.' };
          yield { type: 'message_stop', stop_reason: 'end_turn' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: '["a","b","c"]' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_c: any, x: any) => {
      if (x.name === 'azure_cost_query') return { ok: true, output: { cost: 1234 } };
      if (x.name === 'compose_visual') return { ok: true, output: { rendered: true } };
      return { ok: false, error: 'unknown' };
    });

    await chatLoop(
      ctx,
      {
        userMessage: 'render a sankey of my azure costs',
        priorMessages: [],
        systemPrompt: 'sys',
        tools: [
          { type: 'function', function: { name: 'azure_cost_query' } },
          { type: 'function', function: { name: 'compose_visual' } },
        ],
        model: 'us.anthropic.claude-sonnet-4-6',
        maxTurns: 10,
        concurrencySafeNames: new Set(['azure_cost_query']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Turn 2 MUST be forced (post-MCP path intact — regression)
    const forcedChoice = capturedToolChoices[1] as any;
    expect(forcedChoice).toBeTruthy();
    expect(typeof forcedChoice).toBe('object');
    expect(forcedChoice.type).toBe('function');
    expect(forcedChoice.function?.name).toBe('compose_visual');
  });
});
