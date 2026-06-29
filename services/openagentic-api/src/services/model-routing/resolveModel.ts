import { ResolveModelError } from './ResolveModelError.js';

export { ResolveModelError } from './ResolveModelError.js';

export interface ResolveModelArgs {
  role: 'chat' | 'code' | 'embedding' | 'vision' | 'image';
  explicitRowId?: string;
  flowNodeId?: string;
  agentId?: string;
  taskComplexity?: 'simple' | 'medium' | 'complex';
  preferredTier?: 't1' | 't2' | 't3';
}

export interface ResolveModelDeps {
  prisma: any;
  /**
   * Optional Registry candidate pool — required when taskComplexity is provided.
   * F3 wires the production RegistryCandidatePool here.
   */
  registryCandidatePool?: {
    listForRole(args: { role: string }): Promise<any[]>;
  };
  /**
   * Optional scoring callback — required when taskComplexity is provided.
   * F3 wires the production SmartRouter here.
   */
  smartRouter?: {
    scoreAndPick(
      candidates: any[],
      hints: { taskComplexity: 'simple' | 'medium' | 'complex'; preferredTier?: 't1' | 't2' | 't3' },
    ): Promise<any>;
  };
}

export interface ResolvedModel {
  registryRowId: string;
  modelId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  role: string;
  qualifier: string;
  capabilities?: any;
}

/**
 * Hydrate a registry row's provider. The `model_role_assignments.provider`
 * column is a SCALAR provider NAME (e.g. "aws-bedrock") — NOT a Prisma relation
 * — so we look the provider up in `llm_providers` by name and attach it as
 * `row.provider` for the downstream guards / shaping to consume. Mirrors the
 * scalar-name pattern already used by ModelConfigurationService.
 *
 * Throws PROVIDER_DELETED when the named provider doesn't exist at all (a row
 * pointing at a missing provider is unusable).
 */
async function hydrateProvider(prisma: any, row: any): Promise<any> {
  if (!row) return row;
  // Already hydrated (provider is an object, not a scalar name)?
  if (row.provider && typeof row.provider === 'object') return row;
  const providerName = row.provider;
  const provider = await prisma.lLMProvider.findFirst({
    where: { name: providerName, deleted_at: null },
    select: { id: true, name: true, provider_type: true, enabled: true, deleted_at: true },
  });
  if (!provider) {
    throw new ResolveModelError(
      'PROVIDER_DELETED',
      `Registry row ${row.id} references provider '${providerName}' which is missing or deleted`,
      { providerName, rowId: row.id },
    );
  }
  return { ...row, provider };
}

/**
 * Validate a registry row against provider gates and role-match.
 * Guard order: REGISTRY_ROW_DISABLED → PROVIDER_DISABLED → PROVIDER_DELETED → ROLE_MISMATCH.
 * This ordering ensures a disabled row never silently passes through to a role check.
 */
function checkResolvedRow(row: any, requestedRole: string): void {
  if (!row.enabled) {
    throw new ResolveModelError(
      'REGISTRY_ROW_DISABLED',
      `Registry row ${row.id} is disabled`,
      { row },
    );
  }
  if (!row.provider.enabled) {
    throw new ResolveModelError(
      'PROVIDER_DISABLED',
      `Provider ${row.provider.name} is disabled`,
      { provider: row.provider },
    );
  }
  if (row.provider.deleted_at !== null && row.provider.deleted_at !== undefined) {
    throw new ResolveModelError(
      'PROVIDER_DELETED',
      `Provider ${row.provider.name} is deleted`,
      { provider: row.provider },
    );
  }
  if (row.role !== requestedRole) {
    throw new ResolveModelError(
      'ROLE_MISMATCH',
      `Registry row ${row.id} has role='${row.role}' but caller requested role='${requestedRole}' — Registry role column is the SoT, capabilities are advisory`,
      { row, requestedRole },
    );
  }
}

/**
 * Resolve the role-based default — Registry SoT for "what model serves this role
 * when no explicit/flow/agent/scoring hint applies". Filters by `role` column
 * (the SoT for routability), NEVER by `capabilities`. Closes Bug 3 by construction.
 */
async function resolveRoleDefault(
  prisma: any,
  role: string,
): Promise<ResolvedModel> {
  const raw = await prisma.modelRoleAssignment.findFirst({
    where: { role, enabled: true },
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }],
  });

  if (!raw) {
    throw new ResolveModelError(
      'NO_MODEL_FOR_ROLE',
      `No enabled Registry rows for role='${role}'. Bootstrap a model in admin or check Registry filtering.`,
      { role },
    );
  }

  const row = await hydrateProvider(prisma, raw);
  checkResolvedRow(row, role);
  return toResolvedModel(row);
}

/** Shape a validated registry row into a ResolvedModel. */
function toResolvedModel(row: any): ResolvedModel {
  return {
    registryRowId: row.id,
    modelId: row.model,
    providerId: row.provider.id,
    providerName: row.provider.name,
    providerType: row.provider.provider_type,
    role: row.role,
    qualifier: `${row.provider.provider_type} · ${row.provider.name} · ${row.model}`,
    capabilities: row.capabilities,
  };
}

export async function resolveModel(
  args: ResolveModelArgs,
  deps: ResolveModelDeps,
): Promise<ResolvedModel> {
  const { explicitRowId, flowNodeId, agentId, taskComplexity, preferredTier } = args;
  const { prisma } = deps;

  if (explicitRowId !== undefined) {
    const raw = await prisma.modelRoleAssignment.findUnique({
      where: { id: explicitRowId },
    });

    if (!raw) {
      throw new ResolveModelError(
        'UNKNOWN_REGISTRY_ROW',
        `Registry row id ${explicitRowId} not found`,
        { explicitRowId },
      );
    }

    const row = await hydrateProvider(prisma, raw);
    checkResolvedRow(row, args.role);
    return toResolvedModel(row);
  }

  if (flowNodeId !== undefined) {
    // The flowNode → modelRoleAssignment FK IS a real relation; the assignment's
    // `provider` is a scalar name, hydrated separately below.
    const node = await prisma.flowNode.findUnique({
      where: { id: flowNodeId },
      include: { modelRoleAssignment: true },
    });

    if (!node) {
      throw new ResolveModelError(
        'UNKNOWN_FLOW_NODE',
        `Flow node id ${flowNodeId} not found`,
        { flowNodeId },
      );
    }

    if (node.modelRoleAssignment) {
      const row = await hydrateProvider(prisma, node.modelRoleAssignment);
      checkResolvedRow(row, args.role);
      return toResolvedModel(row);
    }

    // FK is null → fall through to role-based default (F1.6).
    return resolveRoleDefault(prisma, args.role);
  }

  if (agentId !== undefined) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: { modelRoleAssignment: true },
    });

    if (!agent) {
      throw new ResolveModelError(
        'UNKNOWN_AGENT',
        `Agent id ${agentId} not found`,
        { agentId },
      );
    }

    if (agent.modelRoleAssignment) {
      const row = await hydrateProvider(prisma, agent.modelRoleAssignment);
      checkResolvedRow(row, args.role);
      return toResolvedModel(row);
    }

    // Agent has no override → fall through to role-based default (F1.6).
    return resolveRoleDefault(prisma, args.role);
  }

  if (taskComplexity !== undefined) {
    if (!deps.registryCandidatePool || !deps.smartRouter) {
      throw new Error(
        'resolveModel: taskComplexity hint provided but registryCandidatePool + smartRouter not injected. F3 wires the production deps.',
      );
    }

    const candidates = await deps.registryCandidatePool.listForRole({ role: args.role });
    if (candidates.length === 0) {
      throw new ResolveModelError(
        'NO_MODEL_FOR_ROLE',
        `No enabled Registry rows for role='${args.role}' — Registry is empty for this role. Bootstrap a model in admin or check Registry filtering.`,
        { role: args.role, taskComplexity, preferredTier },
      );
    }

    const pickedRaw = await deps.smartRouter.scoreAndPick(candidates, {
      taskComplexity,
      preferredTier,
    });

    // Defense-in-depth: even if the scorer somehow returns a wrong-role row,
    // checkResolvedRow rejects via ROLE_MISMATCH. Registry role column is SoT.
    const picked = await hydrateProvider(prisma, pickedRaw);
    checkResolvedRow(picked, args.role);
    return toResolvedModel(picked);
  }

  // No hints provided → role-based default (F1.6).
  return resolveRoleDefault(prisma, args.role);
}

/**
 * Canonical chat model id (Registry SoT). Resolves the highest-priority enabled
 * role='chat' row's model id. Used by the chat-capable fallback (#1274) so a
 * `model:"auto"` request can NEVER be routed to an embedding-only model.
 */
export async function resolveChatModelId(): Promise<string> {
  const { prisma } = await import('../../utils/prisma.js');
  const resolved = await resolveRoleDefault(prisma as any, 'chat');
  return resolved.modelId;
}
