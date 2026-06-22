/**
 * RegistryModelGuard — enforces that any `body.model` reaching the chat
 * handler is either (a) a sentinel asking for Smart Router, or (b) a
 * concrete model id present + enabled in admin.model_role_assignments.
 *
 * This is the task-6 gate from the design notes.
 * Keeping the decision logic in its own module makes the handler code
 * a one-liner (`const r = await resolveRequestedModel(body.model, prisma)`)
 * and makes the gate unit-testable without Fastify.
 */

/** Minimal Prisma surface the guard consults. */
export interface RegistryGuardPrismaLike {
  modelRoleAssignment: {
    findFirst(args: {
      where: { model: string; enabled: boolean };
      orderBy?: Array<{ priority: 'asc' | 'desc' }>;
    }): Promise<{ id: string; model: string; provider: string; role: string; enabled: boolean; priority: number } | null>;
    count(args: { where: { enabled: boolean } }): Promise<number>;
  };
}

export type ResolvedRegistryModel =
  | { kind: 'smart-router' }
  | { kind: 'registry'; id: string; model: string; provider: string; role: string }
  | { kind: 'not-in-registry'; requested: string; availableCount: number };

/**
 * Synthetic model ids the UI + API use to mean "let the router pick". Anything
 * in this list should bypass the Registry check and go to Smart Router.
 */
const SMART_ROUTER_SENTINELS = new Set([
  '',
  'auto',
  'default',
  'smart-router',
  'model-router',
]);

/**
 * True when the caller's model selection means "let the Smart Router decide".
 * Case-insensitive; null/undefined/empty count as sentinel.
 */
export function isSmartRouterSentinel(model: string | null | undefined): boolean {
  if (model === null || model === undefined) return true;
  const normalized = String(model).trim().toLowerCase();
  return SMART_ROUTER_SENTINELS.has(normalized);
}

/**
 * Look up a concrete model id in the Registry and return a discriminated
 * union covering the 3 possible outcomes. Callers branch on `.kind`:
 *   - 'smart-router': the input was a sentinel, run Smart Router as usual.
 *   - 'registry':     hit — the handler should route directly to (provider, model),
 *                     skipping Smart Router entirely (per task-6 contract).
 *   - 'not-in-registry': the input was a concrete id but either missing from
 *                     the Registry or present-but-disabled. Handler should
 *                     emit HTTP 400 with `{error:'ModelNotInRegistry', model,
 *                     availableCount}` and NOT silently fall back to the
 *                     router (the user's selection should be visible).
 *
 * If multiple providers host the same model id (e.g., Anthropic claude-* via
 * Bedrock + AIF), the lowest `priority` wins (per existing Registry convention
 * where lower priority = higher preference).
 */
export async function resolveRequestedModel(
  requested: string | null | undefined,
  prisma: RegistryGuardPrismaLike,
): Promise<ResolvedRegistryModel> {
  if (isSmartRouterSentinel(requested)) {
    return { kind: 'smart-router' };
  }
  const normalized = String(requested).trim();
  const row = await prisma.modelRoleAssignment.findFirst({
    where: { model: normalized, enabled: true },
    orderBy: [{ priority: 'asc' }],
  });
  if (row) {
    return {
      kind: 'registry',
      id: row.id,
      model: row.model,
      provider: row.provider,
      role: row.role,
    };
  }
  const availableCount = await prisma.modelRoleAssignment.count({ where: { enabled: true } });
  return {
    kind: 'not-in-registry',
    requested: normalized,
    availableCount,
  };
}
