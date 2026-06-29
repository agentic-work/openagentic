/**
 * ModelRouter.resolve() — the ONE function that decides which provider runs
 * which model for a single request. Every pipeline stage calls this. No stage
 * has its own routing logic. No capability gate silently swaps the answer.
 *
 * The algorithm is deliberately simple:
 *   1. Candidate = requestedModel ?? sessionModel ?? tenantDefault(mode)
 *   2. Look up the candidate in the registry (canonical or explicit alias)
 *   3. Verify capabilities + mode enablement
 *   4. If provider is unhealthy, cascade down declared fallbackIds (not a silent
 *      swap — caller sees resolvedBy:'fallback' and the reason)
 *   5. Return a frozen decision object
 *
 * Every step that can fail throws a typed RouterError with the right HTTP code.
 * Callers either propagate the error (preferred) or catch and surface to the user.
 *
 * See docs/core/model-routing-rewrite.md §6 for the full design.
 */

import type { Logger } from 'pino';
import type {
  Mode, ResolveInput, ResolveOutput, ModelEntry, ModelSummary, RequiredCapabilities,
} from './types.js';
import {
  UnknownModelError, CapabilityMismatchError, UnhealthyProviderError, DefaultNotConfiguredError,
} from './types.js';
import type { ModelRegistry } from './ModelRegistry.js';

export interface ModelRouterDeps {
  registry: ModelRegistry;
  logger: Logger;
}

export class ModelRouter {
  constructor(private readonly deps: ModelRouterDeps) {}

  /**
   * Resolve a model for a single request.
   *
   * Never returns a model that the caller can't use. If anything is off, throws
   * with a 400 (caller's fault — unknown model, capability mismatch) or 503
   * (platform's fault — provider down, default not configured).
   *
   * @throws UnknownModelError
   * @throws CapabilityMismatchError
   * @throws UnhealthyProviderError
   * @throws DefaultNotConfiguredError
   */
  async resolve(input: ResolveInput): Promise<ResolveOutput> {
    const t0 = Date.now();
    await this.deps.registry.ensureLoaded();

    const { candidate, resolvedBy, requestedAs } = this.pickCandidate(input);
    const entry = this.lookupStrict(candidate);

    this.verifyModeEnabled(entry, input.mode);
    this.verifyCapabilities(entry, input.mode, input.requires);

    // Provider health gate. If the picked provider is in error, try the declared
    // fallback chain. Only chain items that ALSO satisfy mode + capabilities
    // count — we never silently land on an incompatible fallback.
    const picked = entry.providerStatus === 'active'
      ? entry
      : this.cascadeToHealthyFallback(entry, input);

    if (!picked) {
      throw new UnhealthyProviderError(entry.providerName);
    }

    const reason = picked === entry
      ? this.reasonFor(resolvedBy, requestedAs, entry)
      : `${entry.providerName} unhealthy, cascaded to ${picked.providerName}/${picked.id}`;

    const output: ResolveOutput = Object.freeze({
      providerName: picked.providerName,
      providerType: picked.providerType,
      modelId: picked.id,
      deploymentId: picked.deploymentId,
      capabilities: picked.capabilities,
      limits: picked.limits,
      fallbackChain: picked.fallbackIds.slice(),
      resolvedBy: picked === entry ? resolvedBy : 'fallback',
      reason,
      requestedAs,
    });

    this.logDecision(input, output, picked, Date.now() - t0);
    return output;
  }

  /** List models available for a mode (for UI model picker). */
  async list(mode: Mode): Promise<ModelSummary[]> {
    await this.deps.registry.ensureLoaded();
    return this.deps.registry.list(mode);
  }

  /** Force a registry reload. Admin CRUD routes call this post-commit. */
  async invalidate(): Promise<void> {
    await this.deps.registry.invalidate();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private pickCandidate(input: ResolveInput): {
    candidate: string;
    resolvedBy: ResolveOutput['resolvedBy'];
    requestedAs: string;
  } {
    const explicit = nonEmpty(input.requestedModel);
    if (explicit) {
      return { candidate: explicit, resolvedBy: 'explicit-pin', requestedAs: explicit };
    }
    const session = nonEmpty(input.sessionModel);
    if (session) {
      return { candidate: session, resolvedBy: 'session', requestedAs: '(session)' };
    }
    const tenant = this.deps.registry.defaultFor(input.mode);
    if (tenant) {
      return { candidate: tenant, resolvedBy: 'tenant-default', requestedAs: '(default)' };
    }
    throw new DefaultNotConfiguredError(input.mode);
  }

  private lookupStrict(idOrAlias: string): ModelEntry {
    const entry = this.deps.registry.find(idOrAlias);
    if (entry) return entry;
    const suggestions = this.deps.registry.suggestSimilar(idOrAlias, 3);
    throw new UnknownModelError(idOrAlias, suggestions);
  }

  private verifyModeEnabled(entry: ModelEntry, mode: Mode): void {
    if (mode === 'chat' && !entry.enabledForChat) {
      throw new CapabilityMismatchError(entry.id, ['mode']);
    }
    if (mode === 'code' && !entry.enabledForCodemode) {
      throw new CapabilityMismatchError(entry.id, ['mode']);
    }
    if (mode === 'embedding' && !entry.capabilities.embeddings) {
      throw new CapabilityMismatchError(entry.id, ['embeddings']);
    }
    if (mode === 'vision' && !entry.capabilities.vision) {
      throw new CapabilityMismatchError(entry.id, ['vision']);
    }
    if (mode === 'imageGen' && !entry.capabilities.imageGen) {
      throw new CapabilityMismatchError(entry.id, ['imageGen']);
    }
  }

  private verifyCapabilities(
    entry: ModelEntry,
    _mode: Mode,
    required?: RequiredCapabilities,
  ): void {
    if (!required) return;
    const missing: (keyof RequiredCapabilities)[] = [];
    if (required.tools      && !entry.capabilities.tools)      missing.push('tools');
    if (required.vision     && !entry.capabilities.vision)     missing.push('vision');
    if (required.thinking   && !entry.capabilities.thinking)   missing.push('thinking');
    if (required.embeddings && !entry.capabilities.embeddings) missing.push('embeddings');
    if (required.imageGen   && !entry.capabilities.imageGen)   missing.push('imageGen');
    if (missing.length) throw new CapabilityMismatchError(entry.id, missing);
  }

  /**
   * Walk the declared fallback chain until a model is found whose provider is
   * active AND whose capabilities/mode still satisfy the original request.
   * Returns null if nothing works.
   */
  private cascadeToHealthyFallback(primary: ModelEntry, input: ResolveInput): ModelEntry | null {
    for (const fbId of primary.fallbackIds) {
      const fb = this.deps.registry.find(fbId);
      if (!fb) continue;
      if (fb.providerStatus !== 'active') continue;
      try {
        this.verifyModeEnabled(fb, input.mode);
        this.verifyCapabilities(fb, input.mode, input.requires);
      } catch {
        // fallback doesn't satisfy — try next
        continue;
      }
      return fb;
    }
    return null;
  }

  private reasonFor(
    resolvedBy: ResolveOutput['resolvedBy'],
    requestedAs: string,
    entry: ModelEntry,
  ): string {
    switch (resolvedBy) {
      case 'explicit-pin':    return `explicit pin honored (${requestedAs} → ${entry.id})`;
      case 'session':         return `session default (${entry.id})`;
      case 'tenant-default':  return `tenant default (${entry.id})`;
      case 'fallback':        return `fallback (${entry.id})`;  // set by caller
    }
  }

  private logDecision(
    input: ResolveInput,
    output: ResolveOutput,
    entry: ModelEntry,
    durationMs: number,
  ): void {
    this.deps.logger.info({
      event: 'router.resolve',
      userId: input.userId,
      mode: input.mode,
      requestedAs: output.requestedAs,
      resolvedModelId: output.modelId,
      resolvedProvider: output.providerName,
      resolvedBy: output.resolvedBy,
      reason: output.reason,
      durationMs,
      providerStatus: entry.providerStatus,
    }, '[ModelRouter] resolved');
  }
}

function nonEmpty(s: string | undefined): string | null {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}
