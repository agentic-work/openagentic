/**
 * dedupeRegistryModels — collapse one-per-role registry rows into one-per-model.
 *
 * The Registry endpoint returns one row per (role, model, provider) tuple.
 * For a single Ollama host with `gpt-oss:20b` registered against both `chat`
 * AND `code` roles, that surfaces as TWO rows in the admin Models page —
 * which the user perceives as a duplicate ("two ollama gpt-oss20bs showing
 * up with one ollama host"). The DB rows are intentional (per-role tuning
 * lives at the row), but the LIST presentation should show one row per
 * (provider, model) with the roles aggregated into a chip group.
 *
 * Inputs are already-mapped ModelInfo objects (each carrying `config.roles`
 * with exactly one role from its source registry row). Output is a deduped
 * array where:
 *   - first occurrence wins for primary fields (id, temperature, maxTokens)
 *   - `config.roles` is the union of all source rows' roles
 *   - capabilities are OR-merged (any-source-true → true)
 *   - enabled is OR-merged (any-source-enabled → enabled)
 *   - `__secondaryRegistryIds` carries the other rows' ids for toggle fan-out
 *
 * The primary id remains the first row's PK so the existing edit/save
 * codepath still PATCHes a real registry row.
 */
import type { ModelInfo } from './constants';

export interface DedupedModelInfo extends ModelInfo {
  /** Other registry-row ids that share this (provider, model) tuple. Used by
   * toggle/save handlers to fan out PATCHes so all per-role rows stay in sync. */
  __secondaryRegistryIds?: string[];
}

const orMergeCaps = (
  a: ModelInfo['capabilities'],
  b: ModelInfo['capabilities'],
): ModelInfo['capabilities'] => ({
  chat: !!(a.chat || b.chat),
  embeddings: !!(a.embeddings || b.embeddings),
  tools: !!(a.tools || b.tools),
  vision: !!(a.vision || b.vision),
  thinking: !!(a.thinking || b.thinking),
  imageGeneration: !!(a.imageGeneration || b.imageGeneration),
  audio: !!(a.audio || b.audio),
  streaming: !!(a.streaming || b.streaming),
  grounding: !!(a.grounding || b.grounding),
});

export function dedupeRegistryModels(input: ModelInfo[]): DedupedModelInfo[] {
  const byKey = new Map<string, DedupedModelInfo>();
  const order: string[] = [];

  for (const m of input) {
    const key = `${m.providerName}::${m.name}`;
    const existing = byKey.get(key);
    if (!existing) {
      const seeded: DedupedModelInfo = {
        ...m,
        capabilities: { ...m.capabilities },
        config: m.config
          ? { ...m.config, roles: [...(m.config.roles ?? [])] }
          : undefined,
        __secondaryRegistryIds: [],
      };
      byKey.set(key, seeded);
      order.push(key);
      continue;
    }

    // Track the secondary id for fan-out PATCHes.
    if (m.id && m.id !== existing.id) {
      existing.__secondaryRegistryIds!.push(m.id);
    }

    // OR-merge enabled
    if (m.enabled) existing.enabled = true;
    if (existing.config) existing.config.enabled = existing.enabled;

    // Merge roles (union)
    const existingRoles = new Set(existing.config?.roles ?? []);
    for (const r of m.config?.roles ?? []) existingRoles.add(r);
    if (existing.config) existing.config.roles = [...existingRoles];

    // OR-merge capabilities
    existing.capabilities = orMergeCaps(existing.capabilities, m.capabilities);
    if (existing.config?.capabilities) {
      existing.config.capabilities = {
        chat: !!(existing.config.capabilities.chat || m.config?.capabilities?.chat),
        vision: !!(existing.config.capabilities.vision || m.config?.capabilities?.vision),
        tools: !!(existing.config.capabilities.tools || m.config?.capabilities?.tools),
        thinking: !!(existing.config.capabilities.thinking || m.config?.capabilities?.thinking),
        embeddings: !!(existing.config.capabilities.embeddings || m.config?.capabilities?.embeddings),
        imageGeneration: !!(existing.config.capabilities.imageGeneration || m.config?.capabilities?.imageGeneration),
        streaming: !!(existing.config.capabilities.streaming || m.config?.capabilities?.streaming),
      };
    }
  }

  return order.map((k) => byKey.get(k)!);
}
