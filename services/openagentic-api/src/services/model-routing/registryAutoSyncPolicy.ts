/**
 * Registry auto-sync policy — single source of truth for "which provider
 * types get their Registry rows auto-populated vs. must-be-explicitly-added
 * by the admin".
 *
 * Rationale (from feedback_registry_explicit_add, 2026-04-22):
 *
 *   AIF / Ollama  →  curated-by-ops upstream; every discovered model is
 *                    already an intentional admin choice (AIF deployments
 *                    are created in the Azure portal; Ollama models are
 *                    `ollama pull`ed onto the host). Auto-add is correct.
 *
 *   Bedrock / Vertex / OpenAI / Anthropic / Azure OpenAI
 *                 →  bulk catalogs (100+ noisy foundation models). Auto-add
 *                    floods the Registry + chat toolbar with models no one
 *                    wants. Admin must use the "Add Model" UI to opt in
 *                    per-model.
 *
 * This module is consumed by:
 *   - routes/admin/llm-providers.ts (POST handler — gate auto-upsert)
 *   - services/model-routing/RegistrySyncJob.ts (periodic sync — same gate)
 *   - UI AddModelDialog (client-side filter showing which providers are
 *     eligible for explicit Add)
 *
 * Fail-closed: unknown / empty / nullish provider types → false, because
 * an unknown type is safer to treat as "needs explicit curation" than to
 * silently flood the Registry.
 */

/**
 * Provider types whose discovered models get auto-added to
 * admin.model_role_assignments on create and on periodic sync.
 */
export const AUTO_SYNC_PROVIDER_TYPES: ReadonlyArray<string> = Object.freeze([
  'azure-ai-foundry',
  'ollama',
]);

/**
 * Returns `true` if the given provider type should have its discovered
 * models auto-upserted into the Registry. Returns `false` for every
 * other value (explicit-add required, or unknown type).
 *
 * Case-sensitive by design — DB schema stores provider_type as kebab-case
 * lowercase; any upper-case variant is a bug and should fail the gate.
 */
export function shouldAutoSyncRegistry(providerType: string | null | undefined): boolean {
  if (typeof providerType !== 'string' || providerType.length === 0) return false;
  return AUTO_SYNC_PROVIDER_TYPES.includes(providerType);
}
