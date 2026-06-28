/**
 * unknownToolGuard — pure helper for chatLoop (#850, 2026-05-14).
 *
 * Live failure mode: gpt-oss:20b emitted a tool_use block with
 * `name: "list"` and `arguments: { k: 5, query: "azure list resource
 * groups tool" }`. The args matched `tool_search`'s schema; the name
 * field was corrupted/hallucinated to bare `list` (a name not in the
 * offered catalog). PermissionService correctly fell through to `ask`
 * (no rule matches bare `list`), HITL fired, the human got a useless
 * "approve list?" prompt that ultimately denied at the 120s timeout.
 *
 * Rule: a tool name the model invents that is NOT in the catalog we
 * offered should NEVER reach PermissionService.evaluate. The dispatch
 * layer short-circuits with a synthetic `tool_result` carrying an
 * error string that names known tools, so the model can self-correct
 * on the next turn (and the no-progress guard at #763 traps repeats).
 *
 * Behaviour:
 *   - returns null when the tool IS in the offered catalog (real call)
 *   - returns an error message when the tool is NOT in the catalog
 *   - returns null when no catalog is given (fail-open for tests +
 *     legacy paths that don't thread `tools`)
 */

export function findUnknownToolCallError(
  toolName: string,
  offeredToolNames: ReadonlySet<string> | readonly string[] | undefined,
): string | null {
  if (!toolName) return null;
  if (!offeredToolNames) return null;

  const set =
    offeredToolNames instanceof Set
      ? offeredToolNames
      : new Set(offeredToolNames);

  if (set.size === 0) return null;
  if (set.has(toolName)) return null;

  // Build a small preview of names to help the model self-correct.
  // Cap at 8 so the error message stays readable on the wire.
  const names = Array.from(set).slice(0, 8);
  const more = set.size > names.length ? `, …(+${set.size - names.length} more)` : '';
  return `no such tool '${toolName}'. available tools: [${names.join(', ')}${more}]`;
}

/**
 * Build the set of offered tool names from the chatLoop's `tools` array.
 * Tools follow the OpenAI-shape `{ type: 'function', function: { name } }`.
 * Skips entries whose name is not a non-empty string.
 */
export function buildOfferedToolNames(
  tools: ReadonlyArray<unknown>,
): Set<string> {
  const set = new Set<string>();
  for (const t of tools) {
    const name = (t as { function?: { name?: unknown } })?.function?.name;
    if (typeof name === 'string' && name.length > 0) set.add(name);
  }
  return set;
}
