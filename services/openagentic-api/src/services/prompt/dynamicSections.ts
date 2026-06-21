/**
 * Dynamic sections — recomputed per turn from request-scope inputs.
 * Mirrors ~/anthropic/src/constants/prompts.ts §dynamic sections pattern,
 * minus the cache_control wiring (deferred).
 */

const MAX_TOOLS_IN_CATALOG = 100;

function firstSentence(desc: string | undefined | null): string {
  if (!desc) return '';
  const trimmed = desc.trim();
  if (!trimmed) return '';
  const idx = trimmed.search(/[.!?\n]/);
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

interface ToolLike {
  function?: { name?: string; description?: string };
  name?: string;
  description?: string;
}

export function getToolCatalogSection(tools: ReadonlyArray<ToolLike | null | undefined>): string {
  if (!tools || tools.length === 0) return '';

  // Pass 1: harvest valid (name, desc) pairs.
  const valid: Array<{ name: string; desc: string }> = [];
  for (const t of tools) {
    if (!t) continue;
    const name = t.function?.name ?? t.name;
    if (!name) continue;
    const desc = t.function?.description ?? t.description ?? '';
    valid.push({ name, desc });
  }
  if (valid.length === 0) return '';

  // Pass 2: take first N for the catalog body; remainder becomes the overflow count.
  const shown = valid.slice(0, MAX_TOOLS_IN_CATALOG);
  const overflowCount = valid.length - shown.length;

  const rows = shown.map(({ name, desc }) => {
    const hint = firstSentence(desc);
    return hint ? `- \`${name}\` — ${hint}` : `- \`${name}\``;
  });

  const overflow = overflowCount > 0
    ? `\n\n_${overflowCount} more tools available via \`tool_search\`._`
    : '';

  return `<tool-catalog>
${rows.join('\n')}${overflow}
</tool-catalog>`;
}

/**
 * #790 (2026-05-13) — global READ-ONLY mode notice.
 *
 * When the admin flips the platform-wide READ-ONLY kill-switch ON, the
 * chat pipeline must INFORM the model so it stops attempting mutations
 * (otherwise the model happily emits write tool_calls that the
 * PermissionService deny-overrides at evaluate() time, burning turns and
 * frustrating the user).
 *
 * Contract:
 *   - readOnlyMode=false → empty string (caller drops it).
 *   - readOnlyMode=true  → an `<read-only-mode>` block stating the policy
 *     and the verb categories to avoid. The block lives in the dynamic
 *     section pack (below the cache boundary) because the toggle can
 *     flip at any time and we don't want stale cached prompts.
 */
export function getReadOnlyModeSection(readOnlyMode: boolean): string {
  if (!readOnlyMode) return '';
  return `<read-only-mode>
READ-ONLY MODE ACTIVE — all write / mutation operations are blocked at the platform level.

Only call tools that READ or LIST data. Do NOT attempt the following operations — the platform will reject them before execution and the call will not run:
  - create, update, delete, modify, patch, replace
  - scale, deploy, rollout, restart, terminate, stop, start
  - apply, attach, detach, drain, evict, taint, label, annotate
  - put-*, set-*, remove-*, destroy-*

If the user asks for a mutation, explain that READ-ONLY mode is currently enabled and offer to surface the read/inspect equivalent (list / get / describe / query / show) instead.
</read-only-mode>`;
}

/**
 * #51 (2026-06-01) — connected-MCP + needs-auth availability section.
 *
 * Ground truth, injected per-turn so the model knows — BEFORE it searches —
 * which MCP servers are actually CONNECTED this session vs which are
 * unavailable because they require credentials or an Azure AD On-Behalf-Of
 * login the user doesn't have. On openagentic the connected set is just
 * `openagentic_web` + `aws_knowledge`; azure/gcp/github/k8s/etc. are not
 * connected (no OBO with local-admin). Without this the model loops
 * `tool_search` forever for an azure tool that does not exist, then leaks
 * raw args at max-turns.
 *
 * Dynamic (below the cache boundary) because connected-server state is
 * per-session, not cache-global. Empty string when both lists are empty so
 * partial-config deployments degrade gracefully.
 *
 * @param connected  server names that returned tools this session
 * @param needsAuth  known cloud/ops servers that are NOT connected (require
 *                   credentials / login / OBO) — derived by the caller as
 *                   the known-cloud set minus `connected`.
 */
export function getAvailabilitySection(
  connected: ReadonlyArray<string> | undefined,
  needsAuth: ReadonlyArray<string> | undefined,
): string {
  const conn = (connected ?? []).filter(Boolean);
  const auth = (needsAuth ?? []).filter(Boolean);
  if (conn.length === 0 && auth.length === 0) return '';

  const lines: string[] = [];
  lines.push('<connected-capabilities>');
  lines.push('Ground truth for THIS session — do not contradict it:');
  lines.push(
    conn.length
      ? `- CONNECTED (you can use these): ${conn.join(', ')}.`
      : '- CONNECTED: none beyond your always-on meta-tools.',
  );
  if (auth.length) {
    lines.push(
      `- NOT connected (require credentials or an Azure AD login / On-Behalf-Of — unavailable now): ${auth.join(', ')}.`,
    );
  }
  lines.push(
    '- If the user asks for a NOT-connected capability (e.g. Azure), do NOT loop `tool_search`. Tell them plainly it is not connected and that it needs its credentials / Azure login (OBO) configured, then answer from what IS connected.',
  );
  lines.push('</connected-capabilities>');
  return lines.join('\n');
}
