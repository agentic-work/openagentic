/**
 * Local, conservative READ/MUTATING heuristic for the mcp_tool executor's
 * FAIL-SAFE path ONLY (HIGH-severity approval-gate bypass fix, 2026-06-20).
 *
 * The AUTHORITATIVE classification + audit + approval happens in the api via
 * `ctx.gateMcpCall` → `runAuditAndGate` (services/openagentic-api/src/services/
 * approval/classifyTool.ts). This file is intentionally NOT a re-implementation
 * of that classifier — the workflow engine is a SEPARATE service and must not
 * import api internals. It exists solely so that when the WIRED gate hook
 * throws (api/DB outage), the executor can still fail SAFE: block anything that
 * even LOOKS mutating, and only let obvious reads through.
 *
 * Deliberately biased toward MUTATING (fail-closed): an unrecognized verb on a
 * cloud/infra server is treated as mutating. Mirrors the api classifier's
 * fail-closed philosophy without sharing code.
 */

const SEP = /[_\-:.\s/]+/;

/** Verbs that strongly imply a write/destructive op. Mirror of the api list's intent. */
const MUTATING_VERBS = new Set<string>([
  'apply', 'create', 'put', 'post', 'patch', 'update', 'set', 'write',
  'edit', 'modify', 'replace', 'upsert', 'merge', 'delete', 'destroy',
  'remove', 'rm', 'drop', 'purge', 'prune', 'truncate', 'terminate', 'kill',
  'stop', 'restart', 'reboot', 'reset', 'rollback', 'rollout', 'scale',
  'cordon', 'drain', 'uncordon', 'taint', 'evict', 'exec', 'attach', 'run',
  'start', 'launch', 'deploy', 'provision', 'deprovision', 'enable', 'disable',
  'detach', 'grant', 'revoke', 'rename', 'move', 'mv', 'copy', 'cp', 'install',
  'uninstall', 'upgrade', 'add', 'insert', 'push', 'commit', 'revert', 'invoke',
  'send', 'assume', 'sync', 'publish', 'rotate', 'restore', 'snapshot', 'import',
  'trigger', 'execute', 'cancel', 'abort', 'escalate', 'flush', 'expire',
  'deregister', 'sign', 'issue', 'register',
]);

/** First-token read verbs that always win (so a benign read never blocks). */
const READ_PREFIXES = [
  'get', 'list', 'describe', 'read', 'show', 'view', 'search', 'find', 'query',
  'fetch', 'inspect', 'count', 'status', 'logs', 'log', 'history', 'diff',
  'explain', 'check', 'validate', 'lint', 'analyze', 'health', 'ping', 'info',
  'summary', 'report', 'metrics', 'usage', 'detail', 'scan', 'audit', 'tail',
  'head', 'cat', 'ls', 'top', 'available', 'preview', 'render', 'verify',
  'detect', 'web',
];

/** Cloud/infra servers where an unknown verb fails CLOSED to mutating. */
const MUTATING_CAPABLE = new Set<string>([
  'aws', 'azure', 'gcp', 'kubernetes', 'k8s', 'github', 'gh',
]);

/**
 * Conservative: returns true when the tool name looks mutating (so the
 * fail-safe path blocks it). Reads (clear read-verb first token, no mutating
 * verb token, non-infra) return false.
 */
export function looksMutating(toolName: string, serverName?: string): boolean {
  if (!toolName || typeof toolName !== 'string') return false;
  const name = toolName.toLowerCase();
  const tokens = name.split(SEP).filter(Boolean);
  const first = tokens[0] ?? name;

  // Strong read override on the first token.
  if (READ_PREFIXES.some((p) => first === p || first.startsWith(p))) return false;

  // Any exact mutating verb token → mutating (a real write always wins).
  if (tokens.some((t) => MUTATING_VERBS.has(t))) return true;

  // No mutating verb. A clear read noun ANYWHERE (e.g. kubernetes_list_pods,
  // *_status, *_metrics) beats the infra fail-closed below — mirrors the api
  // classifier so a benign infra read isn't over-blocked.
  if (tokens.some((t) => READ_PREFIXES.includes(t))) return false;

  // Unknown verb on an infra-capable server (from tool name OR server) → fail closed.
  const serverTokens = (serverName ?? '').toLowerCase().split(SEP).filter(Boolean);
  if ([...tokens, ...serverTokens].some((t) => MUTATING_CAPABLE.has(t))) return true;

  return false;
}
