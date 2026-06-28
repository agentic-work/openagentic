/**
 * MCP tool-name resolver — mirrors Claude Code's pattern at
 * `~/anthropic/src/Tool.ts` and `~/anthropic/src/services/mcp/normalization.ts`.
 *
 * Why this exists: model-emitted tool names are not always exact matches
 * for the registered MCP tools. Examples captured live 2026-04-30 from
 * gpt-oss:20b on Ollama:
 *
 *   - `aws.run`            (separator hallucination → should be aws_run)
 *   - `aws.iam.list.users` (dotted form of an existing tool)
 *   - `AWS_IAM_LIST_USERS` (case mismatch)
 *   - `kubectl_get_pods`   (alias for k8s_list_pods)
 *
 * Without this resolver, every variant returns `tool not found` from the
 * MCP proxy, the sub-agent loops 5×, and the assistant response is empty.
 *
 * Resolution pipeline (Claude Code mirror, exact order):
 *
 *   1. Direct match against `tool.name` (Tool.ts:352 `toolMatchesName`)
 *   2. Direct match against any `tool.aliases?[]` (Tool.ts:352)
 *   3. `normalizeNameForMCP` — replace `[^a-zA-Z0-9_-]` with `_`
 *      (services/mcp/normalization.ts), retry steps 1+2 against normalized
 *   4. Case-insensitive variant of steps 1-3
 *   5. NOT FOUND → return structured error with prefix-matched
 *      suggestions so the model can correct itself on the next turn.
 *      (Claude Code surfaces the registered tool list to the model
 *      so it can self-correct; we surface a short "did you mean" list
 *      since our 280-tool registry is too big to dump on every error.)
 *
 * Crucially, step 5 NEVER silently maps a hallucination (e.g. `aws_run`
 * with no `aws_run` registered) to a "close" tool like `aws_list_users`.
 * Silent fuzz-mapping is worse than a clear error — a wrong tool runs,
 * returns wrong data, and the user can't tell why. We fail loud with
 * a prefix-matched suggestion list so the LLM retries.
 */

export interface RegisteredTool {
  name: string;
  aliases?: string[];
}

export type RegisteredToolList =
  | string[]
  | ReadonlyArray<RegisteredTool | string>;

export type ResolveResult =
  | { ok: true; canonicalName: string }
  | { ok: false; error: string };

const MAX_SUGGESTIONS = 8;

/**
 * Normalize a name to API-compatible form (mirrors Claude Code's
 * `services/mcp/normalization.ts:normalizeNameForMCP`). Replaces every
 * character outside `[a-zA-Z0-9_-]` with `_`.
 *
 * - `aws.run`            → `aws_run`
 * - `k8s:list:pods`      → `k8s_list_pods`
 * - `gcp list projects`  → `gcp_list_projects`
 * - `aws-iam-list-users` → `aws-iam-list-users` (hyphens preserved)
 */
function normalizeNameForMCP(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Build the fast lookup table from a registered list. Accepts either a
 * flat string[] (just primary names) or an array of {name, aliases}
 * (Claude Code's Tool[] shape). Returns:
 *   - exactByName:  Map<exact-name, canonical-name>
 *   - exactByLower: Map<lowercase-name, canonical-name>
 *   - canonicalNames: string[] (used to derive prefix suggestions)
 */
function indexTools(registered: RegisteredToolList): {
  exactByName: Map<string, string>;
  exactByLower: Map<string, string>;
  canonicalNames: string[];
} {
  const exactByName = new Map<string, string>();
  const exactByLower = new Map<string, string>();
  const canonicalNames: string[] = [];

  for (const t of registered) {
    if (typeof t === 'string') {
      exactByName.set(t, t);
      exactByLower.set(t.toLowerCase(), t);
      canonicalNames.push(t);
    } else if (t && typeof t.name === 'string') {
      const canonical = t.name;
      exactByName.set(canonical, canonical);
      exactByLower.set(canonical.toLowerCase(), canonical);
      canonicalNames.push(canonical);
      if (Array.isArray(t.aliases)) {
        for (const alias of t.aliases) {
          if (typeof alias !== 'string' || alias.length === 0) continue;
          exactByName.set(alias, canonical);
          exactByLower.set(alias.toLowerCase(), canonical);
        }
      }
    }
  }
  return { exactByName, exactByLower, canonicalNames };
}

/**
 * Build a "did you mean" suggestion list. Splits the input on
 * `[._\-:\s]` separators, takes the first segment, and returns the
 * top-N registered tools whose lowercase name starts with that segment.
 */
function buildSuggestions(
  modelName: string,
  canonicalNames: string[],
): string[] {
  const firstSegment = modelName.split(/[._\-:\s]/)[0]?.toLowerCase() ?? '';
  if (firstSegment.length < 2) return [];
  return canonicalNames
    .filter(n => n.toLowerCase().startsWith(firstSegment))
    .slice(0, MAX_SUGGESTIONS);
}

export function resolveMcpToolName(
  modelName: string | null | undefined,
  registered: RegisteredToolList,
): ResolveResult {
  if (modelName == null) {
    return { ok: false, error: 'Tool name is required.' };
  }
  const trimmed = modelName.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Tool name is required.' };
  }

  // No registered list — pass through so the proxy can still attempt
  // resolution. Without it we'd block every call when the resolver
  // can't load the proxy index.
  if (!registered || registered.length === 0) {
    return { ok: true, canonicalName: trimmed };
  }

  const { exactByName, exactByLower, canonicalNames } = indexTools(registered);

  // 1. Direct match (Tool.ts:352)
  const direct = exactByName.get(trimmed);
  if (direct) return { ok: true, canonicalName: direct };

  // 2. Normalized-direct match (normalizeNameForMCP)
  const normalized = normalizeNameForMCP(trimmed);
  if (normalized !== trimmed) {
    const normHit = exactByName.get(normalized);
    if (normHit) return { ok: true, canonicalName: normHit };
  }

  // 3. Case-insensitive direct
  const lowerHit = exactByLower.get(trimmed.toLowerCase());
  if (lowerHit) return { ok: true, canonicalName: lowerHit };

  // 4. Case-insensitive normalized
  const lowerNormHit = exactByLower.get(normalized.toLowerCase());
  if (lowerNormHit) return { ok: true, canonicalName: lowerNormHit };

  // 5. NOT FOUND — fail loud with prefix-matched suggestions
  const suggestions = buildSuggestions(trimmed, canonicalNames);
  const suggestionLine =
    suggestions.length > 0
      ? ` Did you mean: ${suggestions.join(', ')}?`
      : '';
  return {
    ok: false,
    error: `Tool "${trimmed}" not found.${suggestionLine}`,
  };
}
