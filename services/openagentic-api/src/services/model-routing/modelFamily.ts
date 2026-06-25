/**
 * modelFamily — extract the canonical "family key" from a model ID, used by
 * the Add-Model admin route to prevent silent duplicates like
 * `us.anthropic.claude-sonnet-4-6` and `us.anthropic.claude-sonnet-4-5-...`
 * coexisting on the same provider.
 *
 * The function is deliberately lenient: if it can't classify, it returns null
 * and the caller SHOULD NOT dedupe (i.e. unknown families are allowed through).
 * A false-positive family match is worse than a false-negative here — the
 * admin can always force-add, but silently collapsing two legitimately
 * distinct models (e.g. `gpt-5.2` vs `gpt-5.3-codex`) would be destructive.
 */

export type ModelFamily =
  | 'anthropic:sonnet'
  | 'anthropic:opus'
  | 'anthropic:haiku'
  | 'anthropic:claude-other'
  | 'openai:gpt-5'
  | 'openai:gpt-4'
  | 'openai:gpt-oss'
  | 'google:gemini'
  | 'google:imagen'
  | 'meta:llama'
  | 'qwen:qwen'
  | 'deepseek:deepseek'
  | 'ollama:embed';

export function modelFamily(id: string | undefined | null): ModelFamily | null {
  if (!id || typeof id !== 'string') return null;
  const m = id.toLowerCase().trim();
  if (!m) return null;

  // Anthropic variants on Bedrock, AIF, or direct
  if (m.includes('claude-sonnet') || m.includes('claude-3-5-sonnet') || m.includes('claude-3-7-sonnet')) {
    return 'anthropic:sonnet';
  }
  if (m.includes('claude-opus')) return 'anthropic:opus';
  if (m.includes('claude-haiku') || m.includes('claude-3-5-haiku')) return 'anthropic:haiku';
  if (m.startsWith('anthropic.') || m.startsWith('us.anthropic.') || m.startsWith('global.anthropic.') || m.startsWith('claude-')) {
    return 'anthropic:claude-other';
  }

  // OpenAI families — gpt-5.X is a distinct family vs gpt-4.X, but we do
  // NOT subdivide by minor version (gpt-5.2 vs gpt-5.3 should collapse
  // is debatable, so we separate only by major: 5 vs 4)
  if (m.startsWith('gpt-5') || m.includes('gpt-5-') || m.startsWith('gpt5')) return 'openai:gpt-5';
  if (m.startsWith('gpt-4') || m.startsWith('gpt4')) return 'openai:gpt-4';
  if (m.startsWith('gpt-oss')) return 'openai:gpt-oss';

  // Google — imagen (image generation) MUST stay separate from gemini
  // (chat LLMs). Same-family means functionally interchangeable; an
  // image-gen model can never substitute for a chat model and vice versa.
  // Bug 2026-05-06: collapsing both into google:gemini caused
  // MODEL_FAMILY_CONFLICT 409 ("already in registry") whenever an admin
  // tried to add a Vertex chat model on a provider that had been
  // bootstrap-seeded with imagen-4.
  if (m.startsWith('imagen')) return 'google:imagen';
  if (m.startsWith('gemini') || m.startsWith('palm')) return 'google:gemini';

  // OSS via Ollama / HF
  if (m.startsWith('llama')) return 'meta:llama';
  if (m.startsWith('qwen')) return 'qwen:qwen';
  if (m.startsWith('deepseek')) return 'deepseek:deepseek';
  if (m.startsWith('nomic-embed') || m.includes('embed')) return 'ollama:embed';

  return null;
}

/**
 * Return true iff `a` and `b` resolve to the same non-null family. Used for
 * dedupe at Add-Model time.
 */
export function sameFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = modelFamily(a);
  const fb = modelFamily(b);
  if (!fa || !fb) return false;
  return fa === fb;
}

/**
 * Find the first existing model on a provider that shares a family with
 * `candidateId`. Returns the existing model's id, or null.
 */
export function findFamilyConflict(
  candidateId: string,
  existingIds: readonly string[],
): string | null {
  const candFamily = modelFamily(candidateId);
  if (!candFamily) return null;
  for (const existing of existingIds) {
    if (existing === candidateId) continue; // exact-id dedupe handled elsewhere
    if (modelFamily(existing) === candFamily) return existing;
  }
  return null;
}
