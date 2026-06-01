/**
 * Pure read/write classifier for the approval gate. MUTATING when the tool
 * name/verb implies a write/destructive op; otherwise READ. Unknown → READ
 * (do NOT over-gate — this deliberately diverges from ToolApprovalGate's
 * unknown→medium default).
 *
 * Consumed ONLY by the approval-gate hook (`builtin:approval-gate:before_tool_call`)
 * and the sub-agent tool-execution seam. The existing PermissionService /
 * ToolApprovalGate keep their own (stricter) logic on their own seams — the two
 * philosophies never run on the same audit row.
 */
export type ToolClassification = 'READ' | 'MUTATING';

/** Single source of truth for mutating verbs. Extend here only. */
export const MUTATING_VERBS: readonly string[] = [
  'apply', 'create', 'put', 'post', 'patch', 'update', 'set', 'write',
  'edit', 'modify', 'replace', 'upsert', 'merge',
  'delete', 'destroy', 'remove', 'rm', 'drop', 'purge', 'prune', 'truncate',
  'terminate', 'kill', 'stop', 'restart', 'reboot', 'reset', 'rollback', 'rollout',
  'scale', 'cordon', 'drain', 'uncordon', 'taint', 'evict', 'exec', 'attach',
  'run', 'start', 'launch', 'deploy', 'provision', 'deprovision',
  'enable', 'disable', 'detach', 'grant', 'revoke',
  'rename', 'move', 'mv', 'copy', 'cp', 'install', 'uninstall', 'upgrade',
  'add', 'insert', 'push', 'commit', 'revert',
] as const;

/** Read-only verbs that must NEVER be gated even if a mutating substring matches. */
const READ_OVERRIDE_PREFIXES: readonly string[] = [
  'get', 'list', 'describe', 'read', 'show', 'view', 'search', 'find',
  'query', 'fetch', 'inspect', 'count', 'status', 'logs', 'log',
  'history', 'diff', 'explain', 'check', 'validate', 'lint', 'analyze',
  // 2026-05-31 live-wiring fix — common READ verbs/nouns that surface as
  // MCP tool names now that the MCP-execution seam audits/gates every call.
  // Without these a benign health-check / metrics read would trip the gate
  // (e.g. `*_health_check`, `*_ping`, `*_metrics`) and HANG on human
  // approval. READS must NEVER be gated.
  'health', 'ping', 'info', 'summary', 'summarize', 'report', 'metrics',
  'usage', 'detail', 'details', 'scan', 'audit', 'tail', 'head', 'cat',
  'ls', 'top', 'ping', 'available', 'preview', 'render', 'verify', 'detect',
  'tool_search', 'request_clarification', 'compose_visual', 'render_artifact',
  'web_search',
] as const;

const SEP = /[_\-:.\s/]+/;

/**
 * Mutating verbs that are too short / too collision-prone to match by prefix
 * (`startsWith`) — they MUST match a token exactly. Without this, `post`
 * false-matches `postgres`, `set` would false-match `settings`, `add` would
 * false-match `address`, etc. — gating benign READ tools. The remaining
 * mutating verbs keep prefix-matching so `deployment`→`deploy`,
 * `instances`-style plurals, and `*_delete_*` still classify correctly.
 */
const EXACT_ONLY_MUTATING_VERBS = new Set<string>([
  'post', 'set', 'add', 'put', 'run', 'rm', 'mv', 'cp', 'merge', 'push',
]);

export function classifyTool(
  toolName: string,
  _args?: Record<string, unknown>,
): ToolClassification {
  if (!toolName || typeof toolName !== 'string') return 'READ';
  const name = toolName.toLowerCase();
  const tokens = name.split(SEP).filter(Boolean);

  // Strong READ override — if the FIRST token is a known read verb, it's READ.
  // (e.g. `get_resource`, `list_pods`, `describe_instances`.)
  const first = tokens[0] ?? name;
  if (READ_OVERRIDE_PREFIXES.some((p) => first === p || first.startsWith(p))) {
    return 'READ';
  }

  // MUTATING if ANY token exactly matches a mutating verb, OR a token starts
  // with one (covers kubectl/aws/azure/gcp `*_delete_*`, `apply_*`, etc.).
  // Collision-prone short verbs (post/set/add/...) match EXACTLY only — see
  // EXACT_ONLY_MUTATING_VERBS — so `postgres` is not misread as `post`.
  const exactMutating = tokens.some((t) => MUTATING_VERBS.includes(t));
  const prefixMutating = tokens.some((t) =>
    MUTATING_VERBS.some(
      (v) => !EXACT_ONLY_MUTATING_VERBS.has(v) && v.length >= 3 && t.startsWith(v),
    ),
  );

  // A real, EXACT mutating verb token anywhere always wins (`*_delete_*`,
  // `*_apply_*`) — never mask a genuine write.
  if (exactMutating) return 'MUTATING';

  // No exact mutating verb. A benign read noun anywhere in the name
  // (e.g. `admin_system_postgres_health_check`, `*_status`, `*_metrics`)
  // then beats a LOOSE prefix collision (`postgres`→`post` is already
  // excluded above, but this also catches e.g. `deployment_status` where
  // `deployment`→`deploy` would otherwise gate a status read).
  if (tokens.some((t) => READ_OVERRIDE_PREFIXES.includes(t as any))) {
    return 'READ';
  }

  return prefixMutating ? 'MUTATING' : 'READ';
}
