/**
 * Canonical request types — the SoT shape that future adapters (Phase 0.3)
 * accept and translate into provider-native wire bodies.
 *
 * Mirrors the Anthropic Messages API request shape because Anthropic is
 * the most expressive of the five wire formats we support — every other
 * provider's wire shape is a proper subset (e.g. OpenAI has no native
 * thinking-block; Gemini has no system role distinction; Bedrock-anthropic
 * IS Anthropic-shape; Ollama has no tool_use_id slot). Adapters DROP what
 * the target wire can't carry rather than the canonical shape having to
 * accommodate the lowest common denominator.
 *
 * Reference: ~/anthropic/src/entrypoints/sdk/coreTypes.ts (per-call request
 * shape Claude Code uses) and the Anthropic Messages API
 * (https://docs.anthropic.com/en/api/messages).
 *
 * Content-block types reuse the in-tree CanonicalContentBlock to keep the
 * inbound (normalizer) and outbound (adapter) sides on a single block-type
 * SoT. The request side extends that with tool_result + cache_control
 * which only appear on the request body, never on the model output stream.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */

/** Version stamp — bumped when the request shape gains/loses a field.
 * Adapters can refuse to translate a CanonicalRequest stamped with a
 * version they don't recognize. */
export const CANONICAL_REQUEST_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Content-block types — request body shape
// ---------------------------------------------------------------------------

/**
 * cache_control is Anthropic-native (`{ type: 'ephemeral' }`) and signals
 * a prefix cut for prompt-caching billing. Adapters for non-Anthropic
 * providers strip these (see `stripCacheControl.ts`).
 */
export interface CanonicalCacheControl {
  type: 'ephemeral';
}

export interface CanonicalRequestTextBlock {
  type: 'text';
  text: string;
  cache_control?: CanonicalCacheControl;
}

export interface CanonicalRequestThinkingBlock {
  type: 'thinking';
  thinking: string;
  /** Anthropic encrypts the thinking trace into an opaque base64 string for
   * multi-turn replay. Pass through verbatim when present. */
  signature?: string;
}

export interface CanonicalRequestToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  cache_control?: CanonicalCacheControl;
}

export interface CanonicalRequestToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** Anthropic accepts a plain string OR a content-block array; downstream
   * adapters that target string-only wires (Ollama, OpenAI) JSON.stringify
   * the array. We carry both shapes — the canonical shape stays expressive. */
  content: string | CanonicalRequestToolResultContentBlock[];
  is_error?: boolean;
  cache_control?: CanonicalCacheControl;
}

/** Subset of content blocks allowed inside a tool_result's content[]. */
export type CanonicalRequestToolResultContentBlock =
  | CanonicalRequestTextBlock
  | CanonicalRequestImageBlock;

export interface CanonicalRequestImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
  cache_control?: CanonicalCacheControl;
}

/**
 * Union of every content-block kind that can appear in a CanonicalRequest
 * message. The model output stream emits a smaller subset; see
 * `CanonicalContentBlock` in `normalizers/CanonicalEvent.ts`.
 */
export type CanonicalRequestContentBlock =
  | CanonicalRequestTextBlock
  | CanonicalRequestThinkingBlock
  | CanonicalRequestToolUseBlock
  | CanonicalRequestToolResultBlock
  | CanonicalRequestImageBlock;

// ---------------------------------------------------------------------------
// Message + Tool shapes
// ---------------------------------------------------------------------------

export interface CanonicalMessage {
  role: 'user' | 'assistant';
  content: CanonicalRequestContentBlock[];
}

export interface CanonicalTool {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's parameter shape. Passed
   * through to each provider's tool-schema slot verbatim. */
  input_schema: Record<string, unknown>;
  /**
   * A1 — Anthropic server-side tool search marker. When set on a tool AND
   * the request has `enable_server_tool_search` set, the Anthropic adapter
   * emits `defer_loading: true` on the tool's wire body. Anthropic then
   * keeps the tool definition out of the system prompt prefix and surfaces
   * it via the server tool_search response when the model invokes
   * `tool_search_tool_bm25` / `_regex`. Up to ~10,000 deferred tools
   * supported. Non-Anthropic adapters drop this flag silently.
   * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
   */
  defer_loading?: boolean;
  /**
   * Q2 — OpenAI structured-output strict mode. When true, the OpenAI
   * adapter emits `function.strict: true` so JSON-schema validation is
   * enforced server-side. OpenAI's contract: strict mode REQUIRES
   * `parallel_tool_calls: false` — when any tool has `strict: true`,
   * the OpenAI adapter auto-flips parallel-off for the whole request.
   * Non-OpenAI adapters ignore this flag.
   * Source: https://developers.openai.com/api/docs/guides/function-calling
   */
  strict?: boolean;
}

export type CanonicalToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string };

// ---------------------------------------------------------------------------
// Top-level request
// ---------------------------------------------------------------------------

export interface CanonicalRequest {
  /** Conversation history. System role is hoisted to the `system` field
   * separately because not every provider carries system as a message. */
  messages: CanonicalMessage[];

  /** System prompt. `null` for system-less requests. Adapters that target
   * providers with no system slot (Gemini classic, some Ollama models)
   * inline this as the first user message prefix. */
  system: string | null;

  /** Available tools. Empty array signals "no tools". */
  tools: CanonicalTool[];

  /** Tool dispatch policy. Default at adapter level is `{ type: 'auto' }`. */
  tool_choice: CanonicalToolChoice;

  /** Hard ceiling on output tokens. Required — no "infinite" canonical
   * default. Adapters clamp to provider max. */
  max_tokens: number;

  /** Anthropic extended-thinking config. Adapters for providers that
   * don't support thinking simply drop this. */
  thinking?: { type: 'enabled'; budget_tokens: number };

  /** Anthropic-style early stop sequences. Adapters that target providers
   * with a different stop-sequence wire field (OpenAI `stop`, Vertex
   * `stopSequences`) translate the field name. */
  stop_sequences?: string[];

  /**
   * cache_control hint — list of message indices where the adapter should
   * attach `cache_control: { type: 'ephemeral' }` to the LAST content block
   * of that message on the outbound Anthropic body. Non-Anthropic adapters
   * ignore this field (see `stripCacheControl.ts` for the block-level strip).
   */
  cache_control_marker_indices?: number[];

  /**
   * Vertex AI Gemini context-cache resource name. When set, the Vertex Gemini
   * adapter emits a top-level `cachedContent` field on the wire body so
   * `generateContent` prepends the cached prefix. Resource name format:
   *   - Vertex AI: `projects/{P}/locations/{L}/cachedContents/{ID}`
   *   - Google AI Studio: `cachedContents/{ID}`
   * Other adapters ignore this field. Cache lifecycle (create/refresh/delete
   * via the `cachedContents` REST resource) is the caller's responsibility —
   * the adapter only emits the wire reference. Min cache size: 32k tokens
   * (Gemini 1.5) / 4k tokens (Gemini 2.5).
   * Source: https://ai.google.dev/gemini-api/docs/caching
   */
  cached_content?: string;

  /**
   * A1 — Anthropic native server-side tool search. When set, the Anthropic
   * adapter prepends a `tool_search_tool_*` server tool entry into the wire
   * tools[] array. Tools marked `defer_loading: true` are kept out of the
   * system prompt prefix; Anthropic auto-expands them when the model invokes
   * the server tool. Up to ~10k deferred tools supported.
   *
   * Variant choice:
   *   - 'bm25' (default): keyword search, better recall for explicit terms
   *   - 'regex': pattern match, better for structured tool names
   *
   * Non-Anthropic adapters ignore this field. The api should set this only
   * when routing to an Anthropic-family target (anthropic, bedrock-anthropic,
   * vertex-anthropic) — and only Anthropic direct currently supports the
   * server tool GA; Bedrock/Vertex parity is rolling out.
   * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
   */
  enable_server_tool_search?: 'bm25' | 'regex';

  /**
   * Q2 — per-turn parallel-tool-use override. When true:
   *   - Anthropic adapter emits `tool_choice.disable_parallel_tool_use: true`
   *   - OpenAI adapter emits `parallel_tool_calls: false`
   *   - Vertex Gemini adapter emits `toolConfig.parallelFunctionCalling: false`
   *
   * Use for the synthesis-retry turn, strict-output turns, or when the model
   * has shown spin behavior. Anthropic note: toggling this flag invalidates
   * the messages cache — set per-turn judiciously, not as a session default.
   *
   * Also automatically engages when ANY tool has `strict: true` (OpenAI
   * constraint: strict mode requires parallel-off).
   *
   * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
   *         https://developers.openai.com/api/docs/guides/function-calling
   */
  disable_parallel_tool_use?: boolean;

  /**
   * OpenAI reasoning-model effort dial. Threaded to the Responses API as
   * `reasoning.effort`. Higher effort = more internal CoT tokens consumed
   * before the model emits the final answer. Anthropic adapters ignore this
   * (Anthropic uses `thinking.budget_tokens` instead). Per MS Learn:
   * gpt-5-series accepts 'minimal'; o1/o3/o4-mini accept low|medium|high.
   * Source: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning
   */
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';

  /**
   * OpenAI reasoning-summary verbosity. Threaded to the Responses API as
   * `reasoning.summary`. Controls how the model exposes its chain-of-thought:
   *   - 'auto'      — provider-chosen (default; often near-empty for gpt-5)
   *   - 'concise'   — 1-2 sentence summary (NOT supported by gpt-5 series)
   *   - 'detailed'  — multi-paragraph summary (Claude-extended-thinking-like)
   *
   * Without this set the model frequently emits no summary content — the
   * symptom user-flagged as "empty thinking bubble" on AIF gpt-5.4 traffic.
   * Non-Responses adapters ignore this field.
   * Source: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning
   */
  reasoning_summary?: 'auto' | 'concise' | 'detailed';

  /**
   * OpenAI o-series prefers `role: 'developer'` for system instructions,
   * though the latest reasoning models accept `system` for backward
   * compatibility (per MS Learn). Setting this to 'developer' forward-proofs
   * against a future Azure tightening that already happened with o1-mini.
   * Non-OpenAI adapters ignore this field; default is 'system'.
   */
  system_role_hint?: 'system' | 'developer';
}
