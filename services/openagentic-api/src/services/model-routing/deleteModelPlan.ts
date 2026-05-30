/**
 * Pure planner for DELETE /admin/llm-providers/:id/models/:modelId.
 *
 * The old flow rejected with 409 when `model_config.chatModel` on the SAME
 * provider pointed at the model being deleted — but that's a self-reference
 * that's trivially resolvable by clearing the pointer. This planner splits
 * references into:
 *   - selfReferenceFields: can be auto-cleared on the target provider
 *   - crossProviderRefs:   BLOCK — another provider depends on this model
 *   - roleAssignmentCount: BLOCK — admin.model_role_assignments row uses it
 *   - sessionsAffected:    not a block; caller cascades (nulls chat_sessions.model)
 *
 * Only crossProviderRefs or roleAssignmentCount generate a 409. The caller
 * then writes the DB update that removes the entry, clears selfReferenceFields,
 * and nulls affected chat_sessions.
 */

export interface RawProviderRow {
  id: string;
  name: string;
  model_config?: Record<string, unknown> | null;
  provider_config?: Record<string, unknown> | null;
}

export interface DeletePlanInput {
  targetProviderId: string;
  modelId: string;
  targetProvider: RawProviderRow;
  otherEnabledProviders: RawProviderRow[];
  roleAssignmentCount: number;
  recentSessionCount: number;      // chat_sessions updated in last 24h referencing this model
  force: boolean;
}

export interface BlockingConflict {
  kind: 'role_assignment' | 'cross_provider_ref';
  description: string;
}

export interface DeletePlan {
  canDelete: boolean;
  blockers: BlockingConflict[];
  selfReferenceFields: string[];
  cascadeSessions: boolean;
  recentSessionCount: number;
}

const SCALAR_FIELDS = [
  'chatModel', 'defaultModel', 'embeddingModel', 'visionModel',
  'imageModel', 'compactionModel', 'toolModel', 'thinkingModel',
  'ultraPremiumModel', 'premiumModel', 'economicalModel',
] as const;

function selfReferences(provider: RawProviderRow, modelId: string): string[] {
  const mc = (provider.model_config as any) || {};
  const pc = (provider.provider_config as any) || {};
  const refs: string[] = [];
  for (const f of SCALAR_FIELDS) if (mc[f] === modelId) refs.push(`model_config.${f}`);
  if (pc.modelId === modelId) refs.push('provider_config.modelId');
  if (pc.deploymentName === modelId) refs.push('provider_config.deploymentName');
  return refs;
}

export function computeDeletePlan(input: DeletePlanInput): DeletePlan {
  const { targetProvider, otherEnabledProviders, roleAssignmentCount, recentSessionCount, force, modelId } = input;

  const blockers: BlockingConflict[] = [];

  // Role assignments (ModelRoleAssignment) — always block unless force
  if (roleAssignmentCount > 0) {
    blockers.push({
      kind: 'role_assignment',
      description: `${roleAssignmentCount} active model role assignment(s) reference "${modelId}"`,
    });
  }

  // Cross-provider refs — another enabled provider names this model in its config
  for (const p of otherEnabledProviders) {
    const refs = selfReferences(p, modelId);
    if (refs.length > 0) {
      blockers.push({
        kind: 'cross_provider_ref',
        description: `Referenced as ${refs.join(', ')} on provider "${p.name}"`,
      });
    }
  }

  // Self-reference fields on the target provider — ALWAYS auto-clear (not a blocker)
  const selfRefs = selfReferences(targetProvider, modelId);

  const canDelete = force || blockers.length === 0;

  return {
    canDelete,
    blockers,
    selfReferenceFields: selfRefs,
    // Cascade is informational; caller nulls chat_sessions.model regardless
    // (cheap and safer than leaving dangling pins).
    cascadeSessions: recentSessionCount > 0,
    recentSessionCount,
  };
}
