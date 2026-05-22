/**
 * Model capability catalog — the SDK's source of truth for what canonical
 * events each (provider-endpoint, model) combination is expected to emit
 * on the wire.
 *
 * Without this, normalizer tests are "imagination-bound" — they assert
 * thinking_delta arrives even from models/endpoints that physically cannot
 * emit it (e.g. gpt-5.4 via AIF Chat Completions emits zero reasoning_content;
 * gemini-2.5-flash emits no thought parts). Capability-aware assertions
 * skip silently when a capability is `false`; they REQUIRE the corresponding
 * canonical event when `true`.
 *
 * The api's ModelCapabilityRegistry (DB-backed, live-discovered) supersedes
 * this static catalog at runtime. This file is the SDK fallback / test gate.
 *
 * Verified via live captures saved to reports/provider-probe/<date>/. When
 * a capability is added, the probe runner MUST re-capture against the live
 * provider and confirm the canonical event sequence matches the declared
 * capability before the catalog entry is trusted.
 */

import type { CanonicalEvent } from '../normalizers/CanonicalEvent.js';

/**
 * Provider+endpoint discriminator. A single model (e.g. gpt-5.4) can have
 * different capabilities depending on which API path is used (Chat Completions
 * vs Responses API). Keep them separate so capability lookups are explicit.
 */
export type ProviderEndpoint =
  | 'aif-chat-completions'   // Azure AI Foundry / Azure OpenAI Chat Completions
  | 'aif-responses'          // Azure AI Foundry Responses API (gpt-5 reasoning surface)
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'bedrock-anthropic'      // Anthropic Messages over AWS Bedrock event-stream
  | 'vertex-gemini'          // Google Vertex AI generative endpoint
  | 'ollama-chat'            // Ollama /api/chat
  | 'anthropic-direct';      // Direct Anthropic API (passthrough)

/**
 * Canonical event "kinds" a model is expected to produce. Granular enough
 * that we can assert e.g. "thinking_delta canonical events MUST appear at
 * least once when capability.reasoning is true and the prompt elicits it".
 */
export type CanonicalEventKind =
  | 'message_start'
  | 'message_delta'
  | 'message_stop'
  | 'content_block_start:text'
  | 'content_block_start:thinking'
  | 'content_block_start:tool_use'
  | 'content_block_delta:text_delta'
  | 'content_block_delta:thinking_delta'
  | 'content_block_delta:input_json_delta'
  | 'content_block_stop';

/** Visibility of model reasoning when capability.reasoning === true. */
export type ReasoningVisibility =
  | 'streamed'   // Chunked deltas during generation (Ollama gpt-oss, Anthropic extended thinking, AIF Responses summary)
  | 'summary'    // Single summary after generation (AIF Responses summary item, Vertex thought parts)
  | 'hidden'     // Reasoning tokens counted but content not exposed (OpenAI o1 Chat Completions)
  | 'none';      // No reasoning support on this endpoint

export interface ModelCapabilities {
  /** Provider+endpoint combo. */
  endpoint: ProviderEndpoint;
  /** Canonical model id (e.g. 'gpt-5.4', 'gpt-oss:20b', 'gemini-2.5-flash'). */
  modelId: string;
  /** Streaming is supported on this endpoint. */
  streaming: boolean;
  /** Model emits tool_use blocks on the canonical stream when given tools. */
  tool_use: boolean;
  /** Model can emit multiple tool_use blocks in a single turn. */
  parallel_tool_use: boolean;
  /**
   * Model emits reasoning content the SDK normalizer must surface as
   * canonical `content_block_delta:thinking_delta` events. When false,
   * absence of thinking_delta is silent (not a regression).
   */
  reasoning: boolean;
  reasoning_visibility: ReasoningVisibility;
  /** Accepts image inputs. */
  vision: boolean;
  /** Supports response_format=json_schema or equivalent. */
  structured_output: boolean;
  /** Provider-reported context window (input + output tokens). */
  context_window: number;
  /** Max output tokens the provider allows per request. */
  max_output_tokens: number;
  /**
   * Always-expected canonical event kinds — the minimum envelope every
   * turn emits (message_start, text deltas, message_stop). Asserted on
   * every probe regardless of prompt.
   */
  expectedCanonicalEventKinds: CanonicalEventKind[];
  /**
   * Conditionally-expected event kinds keyed by prompt intent. Reasoning
   * prompt → MUST emit thinking_delta IFF capability.reasoning. Tool prompt
   * → MUST emit tool_use IFF capability.tool_use AND tools were actually
   * passed to the provider. Chat prompt → neither.
   */
  intentExpectedEventKinds: {
    reasoning?: CanonicalEventKind[];
    tool?: CanonicalEventKind[];
  };
}

// ---------------------------------------------------------------------------
// Static seed catalog. Each entry must be verified by a live capture saved
// at reports/provider-probe/<date>/<provider>-<model>-<slug>.canonical.ndjson.
// ---------------------------------------------------------------------------

const KIND_BASE: CanonicalEventKind[] = [
  'message_start',
  'content_block_start:text',
  'content_block_delta:text_delta',
  'content_block_stop',
  'message_delta',
  'message_stop',
];

const KIND_TOOL_USE: CanonicalEventKind[] = [
  'content_block_start:tool_use',
  'content_block_delta:input_json_delta',
];

const KIND_REASONING: CanonicalEventKind[] = [
  'content_block_start:thinking',
  'content_block_delta:thinking_delta',
];

export const STATIC_CAPABILITIES: ModelCapabilities[] = [
  // ── AIF (Azure AI Foundry) ─────────────────────────────────────────────
  {
    // gpt-5.4 over Chat Completions does NOT emit reasoning_content
    // (verified 2026-05-10 — reports/provider-probe/2026-05-10/aif-gpt-5.4-*).
    // For thinking surface, use the Responses-API endpoint.
    endpoint: 'aif-chat-completions',
    modelId: 'gpt-5.4',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: false,
    structured_output: true,
    context_window: 128000,
    max_output_tokens: 16384,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'gpt-5.4',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: false,
    structured_output: true,
    context_window: 128000,
    max_output_tokens: 16384,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },

  // Gap 8 — additional AIF/OpenAI Claude-parity candidates (audit 2026-05-12)
  // gpt-5 = flagship general; same surface as gpt-5.4 but smaller context.
  {
    endpoint: 'aif-chat-completions',
    modelId: 'gpt-5',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 128000,
    max_output_tokens: 16384,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'gpt-5',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: true,
    structured_output: true,
    context_window: 128000,
    max_output_tokens: 16384,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },
  // o4-mini = fast reasoning model; Claude Sonnet 4.6 + thinking analog.
  // Reasoning is ONLY surfaced via the Responses API endpoint (Chat Completions
  // hides it as `reasoning_tokens` count without summary text).
  {
    endpoint: 'aif-chat-completions',
    modelId: 'o4-mini',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false, // reasoning HAPPENS but is not visible on Chat Completions
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'o4-mini',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: true,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },
  // o3 = strongest non-pro reasoning; Claude Opus + thinking analog.
  {
    endpoint: 'aif-chat-completions',
    modelId: 'o3',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'o3',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: true,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },
  // o3-mini = cheap reasoning; supports tool use but not vision.
  {
    endpoint: 'aif-chat-completions',
    modelId: 'o3-mini',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: false,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'o3-mini',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: false,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 100000,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },
  // gpt-4.1 = 1M-context flagship without reasoning. Closest to Sonnet 4.5.
  {
    endpoint: 'aif-chat-completions',
    modelId: 'gpt-4.1',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 1047576,
    max_output_tokens: 32768,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'aif-responses',
    modelId: 'gpt-4.1',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false, // gpt-4.1 is NOT a reasoning model; Responses API works but no reasoning items
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 1047576,
    max_output_tokens: 32768,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },

  // ── Ollama (host.docker.internal:11434) ─────────────────────────────────────────────────
  {
    endpoint: 'ollama-chat',
    modelId: 'gpt-oss:20b',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'streamed',
    vision: false,
    structured_output: false,
    context_window: 128000,
    max_output_tokens: 8192,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },

  // ── Vertex Gemini ──────────────────────────────────────────────────────
  {
    endpoint: 'vertex-gemini',
    modelId: 'gemini-2.5-flash',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: false,
    reasoning_visibility: 'none',
    vision: true,
    structured_output: true,
    context_window: 1048576,
    max_output_tokens: 8192,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE },
  },
  {
    endpoint: 'vertex-gemini',
    modelId: 'gemini-2.5-pro',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true,
    reasoning_visibility: 'summary',
    vision: true,
    structured_output: true,
    context_window: 2097152,
    max_output_tokens: 65536,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },

  // ── Bedrock Anthropic ──────────────────────────────────────────────────
  {
    endpoint: 'bedrock-anthropic',
    modelId: 'anthropic.claude-sonnet-4-6',
    streaming: true,
    tool_use: true,
    parallel_tool_use: true,
    reasoning: true, // extended thinking when enabled
    reasoning_visibility: 'streamed',
    vision: true,
    structured_output: true,
    context_window: 200000,
    max_output_tokens: 8192,
    expectedCanonicalEventKinds: KIND_BASE,
    intentExpectedEventKinds: { tool: KIND_TOOL_USE, reasoning: KIND_REASONING },
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getCapabilities(
  endpoint: ProviderEndpoint,
  modelId: string,
): ModelCapabilities | undefined {
  // Exact (endpoint, modelId) match first.
  const exact = STATIC_CAPABILITIES.find(
    (c) => c.endpoint === endpoint && c.modelId === modelId,
  );
  if (exact) return exact;
  // Substring fallback: handle prefix (gpt-5.4-mini → gpt-5.4) and
  // wrapper (global.anthropic.claude-sonnet-4-6 → anthropic.claude-sonnet-4-6,
  // us.anthropic.claude-sonnet-4-5-20250929-v1:0 → anthropic.claude-sonnet-4-5).
  return STATIC_CAPABILITIES.find(
    (c) => c.endpoint === endpoint && (modelId.includes(c.modelId) || c.modelId.startsWith(modelId)),
  );
}

/**
 * Map a canonical event to its capability kind. Used by the probe runner
 * to tally observed event kinds against declared capability expectations.
 */
export function canonicalEventKind(ev: CanonicalEvent): CanonicalEventKind | null {
  switch (ev.type) {
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    case 'content_block_stop':
      return ev.type;
    case 'content_block_start':
      return `content_block_start:${ev.content_block.type}` as CanonicalEventKind;
    case 'content_block_delta':
      return `content_block_delta:${ev.delta.type}` as CanonicalEventKind;
    default:
      return null;
  }
}

/**
 * Assertion shape returned by the probe runner / realCaptures helper.
 * `expected` lists kinds the capability says MUST appear at least once.
 * `unexpected` lists kinds that appeared but are not in the capability
 * (informational — not necessarily a regression; tolerated as no-ops).
 * `missing` lists kinds that SHOULD have appeared but didn't — that's
 * the actual regression signal.
 */
export interface CapabilityAssertion {
  endpoint: ProviderEndpoint;
  modelId: string;
  observedKinds: Record<CanonicalEventKind, number>;
  expected: CanonicalEventKind[];
  missing: CanonicalEventKind[];
  unexpected: CanonicalEventKind[];
  pass: boolean;
}

export type PromptIntent = 'chat' | 'reasoning' | 'tool';

export function assertCapabilities(
  capabilities: ModelCapabilities,
  events: readonly CanonicalEvent[],
  intent: PromptIntent = 'chat',
): CapabilityAssertion {
  const observedKinds: Partial<Record<CanonicalEventKind, number>> = {};
  for (const ev of events) {
    const k = canonicalEventKind(ev);
    if (!k) continue;
    observedKinds[k] = (observedKinds[k] || 0) + 1;
  }
  // Build expected set: base + intent-specific (but only if capability
  // supports it; otherwise absence is silent).
  const expected = [...capabilities.expectedCanonicalEventKinds];
  if (intent === 'reasoning' && capabilities.reasoning) {
    expected.push(...(capabilities.intentExpectedEventKinds.reasoning ?? []));
  }
  if (intent === 'tool' && capabilities.tool_use) {
    expected.push(...(capabilities.intentExpectedEventKinds.tool ?? []));
  }
  const missing = expected.filter((k) => !observedKinds[k]);
  const unexpected = Object.keys(observedKinds).filter(
    (k) => !expected.includes(k as CanonicalEventKind),
  ) as CanonicalEventKind[];
  return {
    endpoint: capabilities.endpoint,
    modelId: capabilities.modelId,
    observedKinds: observedKinds as Record<CanonicalEventKind, number>,
    expected,
    missing,
    unexpected,
    pass: missing.length === 0,
  };
}
