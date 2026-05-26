/**
 * RegistryCandidatePool — the Smart Router's source-of-truth for which
 * (provider, model) pairs it's allowed to pick from. Reads directly from
 * admin.model_role_assignments (Registry) where enabled=true.
 *
 * Per task 7 of docs/superpowers/plans/2026-04-22-model-registry-sot.md,
 * the router previously filtered candidates through
 * ModelConfigurationService.availableModels — which reads from
 * llm_providers.provider_config.models[], a separate write path. That
 * caused drift between the Admin Models page (showed N models) and the
 * router's actual candidate pool (sometimes showed N+K or N-K).
 *
 * This helper kills that drift: one Prisma query, one Registry row per
 * pool entry, always.
 *
 * MC-I: Cross-checks provider.enabled before returning candidates.
 * If an admin disables a provider in admin.llm_providers, that provider's
 * model_role_assignments are excluded from the pool even if the assignment
 * rows themselves still have enabled=true.
 */

export interface RegistryCandidate {
  /** Registry row PK */
  id: string;
  /** Model identifier (e.g., 'us.anthropic.claude-sonnet-4-6') */
  model: string;
  /** Provider name as stored in admin.llm_providers.name */
  provider: string;
  /** Role the admin assigned — 'chat' / 'embeddings' / 'reasoning' / ... */
  role: string;
  /** Relative preference — lower is preferred */
  priority: number;
  /** Capability flags stamped by provider.discoverModels() */
  capabilities: Record<string, any>;
  /**
   * First-class per-model function-calling-accuracy column. SoT for the
   * router's FCA scoring (capabilities JSON is a legacy fallback). Null until
   * seeded/admin-set.
   */
  functionCallingAccuracy: number | null;
}

export interface RegistryCandidatePoolPrismaLike {
  lLMProvider: {
    findMany(args: {
      where: { enabled: boolean; deleted_at: null };
      select: { name: true };
    }): Promise<Array<{ name: string }>>;
  };
  modelRoleAssignment: {
    findMany(args: {
      where: { enabled: boolean; provider: { in: string[] } };
      orderBy?: Array<{ priority: 'asc' | 'desc' }>;
    }): Promise<Array<{
      id: string;
      model: string;
      provider: string;
      role: string;
      priority: number;
      capabilities: unknown;
      function_calling_accuracy?: number | null;
    }>>;
  };
}

/**
 * Return every enabled Registry row as a candidate pool entry, ordered
 * by priority (lower first), restricted to providers that are currently
 * enabled and not soft-deleted. Pure read — no side effects, safe to call
 * from SmartModelRouter.reload() on every admin provider-add.
 *
 * MC-I: Two-step query ensures provider.enabled=true AND
 * model_role_assignments.enabled=true, matching the SoTBanner promise.
 */
export async function listRegistryCandidatePool(
  prisma: RegistryCandidatePoolPrismaLike,
): Promise<RegistryCandidate[]> {
  // Step 1: fetch only enabled, non-deleted providers.
  const enabledProviders = await prisma.lLMProvider.findMany({
    where: { enabled: true, deleted_at: null },
    select: { name: true },
  });

  // If no providers are enabled, short-circuit — no candidates possible.
  if (enabledProviders.length === 0) {
    return [];
  }

  const enabledProviderNames = enabledProviders.map(p => p.name);

  // Step 2: fetch role assignments restricted to enabled providers.
  const rows = await prisma.modelRoleAssignment.findMany({
    where: { enabled: true, provider: { in: enabledProviderNames } },
    orderBy: [{ priority: 'asc' }],
  });

  return rows.map(r => ({
    id: r.id,
    model: r.model,
    provider: r.provider,
    role: r.role,
    priority: r.priority,
    capabilities: (r.capabilities as Record<string, any>) ?? {},
    functionCallingAccuracy:
      typeof r.function_calling_accuracy === 'number' ? r.function_calling_accuracy : null,
  }));
}
