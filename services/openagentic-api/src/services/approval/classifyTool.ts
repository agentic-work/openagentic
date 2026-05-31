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
  'tool_search', 'request_clarification', 'compose_visual', 'render_artifact',
] as const;

const SEP = /[_\-:.\s/]+/;

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
  const isMutating = tokens.some(
    (t) => MUTATING_VERBS.includes(t) || MUTATING_VERBS.some((v) => t.startsWith(v) && v.length >= 3),
  );

  return isMutating ? 'MUTATING' : 'READ';
}
