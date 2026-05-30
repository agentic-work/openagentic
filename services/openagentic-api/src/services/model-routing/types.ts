/**
 * Model routing — public types.
 *
 * One contract for "which provider runs which model, for which request, in which mode".
 * Every pipeline stage that needs a model must call ModelRouter.resolve() with these
 * inputs and respect these outputs. No other shape exists for routing decisions.
 *
 * See docs/core/model-routing-rewrite.md for the architecture.
 */

/**
 * Operational mode. Determines which tenant default applies and which capabilities
 * the model must declare (chat → capabilities.chat, embedding → capabilities.embeddings,
 * etc). The mode never influences routing beyond that — no hidden rules.
 */
export type Mode = 'chat' | 'code' | 'embedding' | 'vision' | 'imageGen';

/**
 * Canonical provider type (matches admin.llm_providers.provider_type enum).
 * Kept loose (string) so adding a provider doesn't require updating this union —
 * the registry treats it as opaque.
 */
export type ProviderType =
  | 'aws-bedrock'
  | 'azure-ai-foundry'
  | 'azure-openai'
  | 'vertex-ai'
  | 'ollama'
  | 'anthropic'
  | 'openai';

/**
 * Model capabilities. Every model in the registry declares these explicitly —
 * no inference from names, no guessing. If a field is false/undefined, the model
 * cannot do that thing and router.resolve() will 400 if the caller required it.
 */
export interface ModelCapabilities {
  chat: boolean;
  tools: boolean;
  streaming: boolean;
  vision?: boolean;
  thinking?: boolean;
  embeddings?: boolean;
  imageGen?: boolean;
  /** Free-text capability markers (e.g. "cache-breakpoints", "structured-output") */
  extended?: string[];
}

/**
 * Token and context limits. All integers; zero means "unset" and router ignores.
 */
export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/**
 * Canonical registry entry — one per (provider, canonical-model-id).
 *
 * The SOLE routing source is admin.llm_providers.provider_config.models[]. Each
 * entry in that JSON array must match this shape (with providerName/providerType/
 * providerStatus set by the registry loader, not written in DB).
 */
export interface ModelEntry {
  /** Canonical model id as registered with the provider (e.g. "us.anthropic.claude-sonnet-4-6"). */
  id: string;
  /** Explicit aliases the router will also match. No fuzzy/prefix matching beyond this list. */
  aliases: string[];
  /** Provider-specific deployment label (AIF deployment name, Vertex endpoint, etc.) */
  deploymentId?: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  /** Free-text UI grouping ("premium", "balanced", "cheap"). Never drives routing. */
  tier?: string;
  costUsdPer1kIn?: number;
  costUsdPer1kOut?: number;
  /** Declarative fallback chain. On retryable failure, dispatch cascades down this list. */
  fallbackIds: string[];
  /** Per-mode enablement flags. Defaults to true for chat if capabilities.chat is true. */
  enabledForChat: boolean;
  enabledForCodemode: boolean;
  // ────────────────────────────────────────────────────────────────
  // Populated by registry loader from admin.llm_providers row
  // ────────────────────────────────────────────────────────────────
  providerName: string;     // e.g. "bedrock-us-east-1"
  providerType: ProviderType;
  providerStatus: 'active' | 'error' | 'paused';
  providerPriority: number; // lower = wins tiebreaker when the same id is registered on multiple providers
}

/**
 * Compact shape returned to the UI for model pickers. No internal fields
 * (no providerStatus, no fallbackChain) — UI cares about what it can show.
 */
export interface ModelSummary {
  id: string;
  aliases: string[];
  providerName: string;
  providerType: ProviderType;
  tier?: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  costUsdPer1kIn?: number;
  costUsdPer1kOut?: number;
  /** True iff provider is 'active' AND model is enabled for the requested mode. */
  available: boolean;
}

/**
 * Required capabilities for a single request. Optional — if omitted, the router
 * only checks the mode-level capability (e.g. 'chat' mode → capabilities.chat).
 */
export interface RequiredCapabilities {
  tools?: boolean;
  vision?: boolean;
  thinking?: boolean;
  embeddings?: boolean;
  imageGen?: boolean;
}

/**
 * Input to ModelRouter.resolve(). Everything the router needs to pick a provider
 * and model for a single request.
 */
export interface ResolveInput {
  /** User id — used for logging + per-user budget checks downstream. Never drives routing. */
  userId: string;
  /**
   * Explicit pin from the caller. Takes priority over everything else.
   * Empty string / undefined means "no pin, use defaults".
   */
  requestedModel?: string;
  /**
   * Session-level default (from chat_sessions.model). Takes priority over tenant default
   * but is overridden by requestedModel.
   */
  sessionModel?: string;
  mode: Mode;
  requires?: RequiredCapabilities;
}

/**
 * Output of ModelRouter.resolve(). Callers pass this to dispatchLLM() or to the
 * provider instance directly. Never mutate. Never fall back to different routing
 * values between resolve and dispatch.
 */
export interface ResolveOutput {
  providerName: string;
  providerType: ProviderType;
  modelId: string;           // canonical, NOT the alias the caller passed
  deploymentId?: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  /** Remaining fallbacks after this resolution, in order. Consumed by dispatch retry. */
  fallbackChain: string[];
  resolvedBy: 'explicit-pin' | 'session' | 'tenant-default' | 'fallback';
  /** Human-readable for logs — "explicit pin honored", "session model", etc. */
  reason: string;
  /** The input the caller asked for — what they pinned or '(default)' when empty. */
  requestedAs: string;
}

/**
 * Tenant defaults loaded from admin.system_configuration.default_models.
 * Each mode has one default. Null means "admin hasn't configured" and the
 * router returns 503 for that mode if a caller doesn't pin explicitly.
 */
export interface TenantDefaults {
  chat: string | null;
  code: string | null;
  embedding: string | null;
  vision: string | null;
  imageGen: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Errors — distinct classes so callers can 400 vs 503 cleanly.
// ────────────────────────────────────────────────────────────────────────────

/** Parent class. All routing errors extend this. */
export class RouterError extends Error {
  constructor(message: string, public readonly http: 400 | 503) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Caller pinned a model that isn't in any registered provider. HTTP 400. */
export class UnknownModelError extends RouterError {
  constructor(
    public readonly requestedModel: string,
    public readonly suggestions: string[],
  ) {
    const tail = suggestions.length ? ` — did you mean: ${suggestions.join(', ')}?` : '';
    super(`Model "${requestedModel}" is not registered${tail}`, 400);
  }
}

/** Caller's required capabilities don't match the picked model. HTTP 400. */
export class CapabilityMismatchError extends RouterError {
  constructor(
    public readonly modelId: string,
    public readonly missing: (keyof RequiredCapabilities | 'mode')[],
  ) {
    super(
      `Model "${modelId}" is missing required capabilities: ${missing.join(', ')}`,
      400,
    );
  }
}

/** Picked provider is in error state and no fallback succeeded. HTTP 503. */
export class UnhealthyProviderError extends RouterError {
  constructor(
    public readonly providerName: string,
    public readonly lastTestError?: string,
  ) {
    const tail = lastTestError ? ` — ${lastTestError}` : '';
    super(`Provider "${providerName}" is unhealthy${tail}`, 503);
  }
}

/** No tenant default configured for the mode, caller didn't pin. HTTP 503. */
export class DefaultNotConfiguredError extends RouterError {
  constructor(public readonly mode: Mode) {
    super(
      `Admin has not configured a default ${mode} model (system_configuration.default_models.${mode})`,
      503,
    );
  }
}

/**
 * Structured log emitted on every resolve(). One line per routing decision —
 * makes post-incident debugging "grep for userId in logs" easy.
 */
export interface RouterLogEntry {
  event: 'router.resolve';
  userId: string;
  mode: Mode;
  requestedAs: string;
  resolvedModelId: string;
  resolvedProvider: string;
  resolvedBy: ResolveOutput['resolvedBy'];
  reason: string;
  durationMs: number;
  providerStatus: ModelEntry['providerStatus'];
}
