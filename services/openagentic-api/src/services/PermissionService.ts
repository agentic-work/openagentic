/**
 * PermissionService — Claude-Code-style glob permission rules for tool dispatch.
 *
 * Replaces the regex-tier legacy gate (LOW/MEDIUM/HIGH/CRITICAL +
 * argument-escalation patterns + per-user trust scoring + DB pattern overrides)
 * with the simpler proven shape from /home/trent/anthropic/src/types/permissions.ts:
 *
 *   - 3 behaviors:  allow | deny | ask
 *   - 5 modes:      default | acceptEdits | bypassPermissions | dontAsk | plan
 *   - explicit glob rules keyed by toolName (NO regex)
 *
 * Resolution priority (first hit wins):
 *   1. Mode override (bypassPermissions → allow; plan/dontAsk demote ask → deny)
 *   2. Deny rules (most-specific glob first)
 *   3. Allow rules
 *   4. Ask rules (explicit)
 *   5. Default fallthrough → ask (default mode) or deny (plan/dontAsk)
 *
 * Rules are persisted in `system_configuration.permissions.rules` and loaded
 * at construction. User-added rules sit on top of the seeded defaults; `addRule`
 * persists via upsert. `clearAllUserRules` resets to seed.
 *
 * Wire reference: services/agenticwork-api/CLAUDE.md "V2 Cascade Architecture"
 * + spec docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md.
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';
import { EventEmitter } from 'events';
import { getDataAccessAuditService } from './DataAccessAuditService.js';

// ---------------------------------------------------------------------------
// Types — mirrored from /home/trent/anthropic/src/types/permissions.ts
// ---------------------------------------------------------------------------

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'plan';

export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const;

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session';

export interface PermissionRuleValue {
  /** Tool name — supports `*` glob, e.g. `azure_list_*` or `*_delete_*`. */
  toolName: string;
  /** Optional secondary content match (e.g. `Bash(npm:*)`); not used yet. */
  ruleContent?: string;
}

export interface PermissionRule {
  source: PermissionRuleSource;
  ruleBehavior: PermissionBehavior;
  ruleValue: PermissionRuleValue;
}

export interface ToolCallInfo {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  userId: string;
  sessionId?: string;
  messageId?: string;
}

/**
 * Evaluation result. Legacy `approved` / `reason` / `riskLevel` fields
 * preserved for backwards-compat with downstream call sites (chat dispatch,
 * built-in hooks) that already destructure these.
 */
export interface PermissionDecision {
  behavior: PermissionBehavior;
  /** Legacy alias: true iff behavior === 'allow'. */
  approved: boolean;
  reason: string;
  /** Legacy field for log/UI compat — mapped from behavior. */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /** 'rule' | 'mode' | 'default' | userId on human approval | 'timeout'. */
  approvedBy?: string;
  /** Approval round-trip latency in ms (set when behavior was ask). */
  approvalTimeMs?: number;
  /** The rule that matched, when behavior came from rules. */
  matchedRule?: PermissionRule;
}

export interface PermissionEvaluateOptions {
  mode?: PermissionMode;
}

interface PendingAsk {
  id: string;
  toolCall: ToolCallInfo;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Sev-0 #829 (2026-05-14) — within-session approval memoization entry.
 * After a user approves an `ask`-tier tool call, the (userId, sessionId,
 * toolName, argsFingerprint) tuple is cached so subsequent identical
 * retries within the same session short-circuit to `allow` without
 * re-emitting an approval card.
 */
interface ApprovalMemoEntry {
  approvedBy: string;
  approvedAt: number;
  expiresAt: number;
}

/** Default TTL for approval memo entries (1 hour). Long enough for the
 * typical retry-after-transient-failure flow, short enough that stale
 * approvals don't leak across day boundaries. */
const APPROVAL_MEMO_TTL_MS = 60 * 60 * 1000;

/**
 * Stable JSON-serialize for argsFingerprint: sort keys recursively so
 * `{a:1,b:2}` and `{b:2,a:1}` produce the same string. Arrays preserve
 * order (positional semantics). Non-finite numbers stringify as null
 * (JSON default). Cycles are not expected in tool args.
 */
function stableArgsFingerprint(args: Record<string, unknown>): string {
  const sortKeys = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  };
  try {
    return JSON.stringify(sortKeys(args ?? {}));
  } catch {
    // Defensive — non-serializable args (cycles, BigInt) fall back to a
    // best-effort string. Memo will not hit on these, which is fine.
    return String(args);
  }
}

function buildApprovalMemoKey(call: ToolCallInfo): string {
  const userId = String(call.userId ?? 'anonymous');
  const sessionId = String(call.sessionId ?? '__no_session__');
  const fp = stableArgsFingerprint(call.arguments ?? {});
  return `${userId}::${sessionId}::${call.toolName}::${fp}`;
}

// ---------------------------------------------------------------------------
// First-boot seed rules
//
// These ship ONLY on first boot when admin.system_configuration has no
// `permission_rules` row. From then on the admin console at /admin#permissions
// is the sole SoT — boots do NOT re-merge defaults over admin edits.
//
// allow:     chatmode meta-tools + agent primitives + cloud read-only patterns.
// ask:       destructive verbs (delete/drop/truncate/destroy/terminate) + bulk
//            ops. HITL is the runtime gate; admin can flip any of these to
//            `allow` or `deny` from the UI.
// (default): fall-through is `ask` (no explicit rule needed).
//
// These ship as `source: 'policySettings'` so they're visibly system-owned
// in the admin UI and distinct from user-added rules.
// ---------------------------------------------------------------------------

const DEFAULT_ALLOW_TOOLS = [
  // Chatmode T1 primitives — pure platform-owned, no destructive surface
  'tool_search',
  'agent_search',
  'agent_list',
  'agent_send',
  'agent_stop',
  'read_large_result',
  'web_search',
  'web_fetch',
  'web_*',
  'memorize',
  'memory_*',
  'synth',
  'synth_*',
  'request_clarification',
  'render_artifact',
  'compose_visual',
  'compose_app',
  'visualize.show_widget',
  'visualize.read_me',
  // Task / sub-agent dispatch is platform-owned
  'Task',
  // Generic read-verb prefixes — match read-only sniffs the model might
  // emit on any MCP server (list_*, get_*, describe_*, etc.). The deny
  // list above wins on tie-breaks for *_delete_* etc., so a destructive
  // tool nominally starting with a read verb still trips deny.
  'list_*',
  'get_*',
  'describe_*',
  'show_*',
  'find_*',
  'count_*',
  'query_*',
  'check_*',
  'status_*',
  'health_*',
  'info_*',
  'version_*',
  'whoami_*',
  'whoami',
  'read_*',
  'search_*',
  'inspect_*',
  'view_*',
  'lookup_*',
  'resolve_*',
  'history_*',
  'diff_*',
  'metadata_*',
  'doctor_*',
  'help_*',
  'identity_*',
  'account_*',
  'budget_*',
  'cost_*',
  'tag_*',
  // Q1-blocker-7 (2026-05-12) — bilateral read-verb globs that catch
  // server-prefixed read calls (aws_cost_by_service, kubectl_get_pods,
  // gcp_billing_get_cost, etc.). The autonomous chatmode flow was
  // halting at "Awaiting human approval" on aws_cost_by_service because
  // the seeded prefix globs only fire for names STARTING with the verb
  // (cost_*, get_*, describe_*). Bilateral patterns close that gap.
  //
  // Safety: the destructive deny list (*_delete_*, *_destroy_*,
  // *_terminate_*, etc.) is MORE SPECIFIC (longer non-star content) so
  // resolveByRules picks deny on overlap — a hypothetical
  // `aws_get_and_delete_*` still trips deny.
  '*_list',
  '*_list_*',
  '*_get',
  '*_get_*',
  '*_describe',
  '*_describe_*',
  '*_show',
  '*_show_*',
  '*_query',
  '*_query_*',
  '*_cost',
  '*_cost_*',
  '*_search',
  '*_search_*',
  '*_inventory',
  '*_inventory_*',
  '*_audit',
  '*_audit_*',
  '*_status',
  '*_status_*',
  '*_health',
  '*_health_*',
  '*_metrics',
  '*_metrics_*',
  '*_history',
  '*_history_*',
  // Cloud read-only patterns
  'azure_list_*',
  'azure_get_*',
  'azure_describe_*',
  'azure_show_*',
  'azure_query_*',
  'azure_resource_graph_*',
  'azure_advisor_*',
  'azure_security_list_*',
  'azure_security_get_*',
  'azure_monitor_query_*',
  'azure_monitor_list_*',
  'azure_cost_*',
  'azure_billing_list_*',
  'azure_billing_get_*',
  'azure_policy_list_*',
  'azure_policy_get_*',
  'azure_log_query_*',
  'azure_log_get_*',
  'aws_list_*',
  'aws_get_*',
  'aws_describe_*',
  'aws_search_*',
  'aws_identity',
  'aws_query_*',
  'aws_cost_*',
  'aws_billing_*',
  'aws___search_documentation',
  'gcp_list_*',
  'gcp_get_*',
  'gcp_describe_*',
  'gcp_query_*',
  'gcp_cost_*',
  'gcp_billing_*',
  'k8s_list_*',
  'k8s_get_*',
  'k8s_describe_*',
  'k8s_explain_*',
  'k8s_rollout_status_*',
  'k8s_rollout_history_*',
  'kubectl_get_*',
  'kubectl_describe_*',
  'kubectl_logs_*',
  'kubectl_top_*',
  'kubectl_explain_*',
  'kubectl_rollout_status_*',
  'kubectl_rollout_history_*',
  'helm_list',
  'helm_status',
  'helm_history',
  'helm_get_values',
  'loki_*',
  'prometheus_*',
  // GitHub read-only
  'get_repo*',
  'get_issue*',
  'get_pull*',
  'get_commit*',
  'get_branch*',
  'get_workflow*',
  'get_file*',
  'get_user*',
  'list_repo*',
  'list_issue*',
  'list_pull*',
  'search_repo*',
  'search_issue*',
  'search_pull*',
  'search_code*',
  // Vertex AI read-only
  'vertex_ai_list_*',
  'vertex_ai_get_*',
  'vertex_ai_usage_*',
  // Admin read-only
  'admin_list_*',
  'admin_get_*',
  'admin_show_*',
  'admin_check_*',
  'admin_status_*',
  'admin_health_*',
  'admin_metrics_*',
  'admin_version_*',
  'admin_info_*',
  'admin_system_*',
  // Render helpers
  'render_diagram_*',
  'render_table_*',
];

// Destructive-verb seed: ship as `ask` (HITL gate). Admin can flip any of
// these to `deny` or `allow` from the admin console. Pre-2026-05-13 this
// list was hardcoded `deny` and re-merged on every boot, which (a) couldn't
// be overridden by operators and (b) blocked legitimate CRUD-D flows.
const DEFAULT_ASK_TOOLS = [
  '*_delete_*',
  '*_drop_*',
  '*_truncate_*',
  '*_destroy_*',
  '*_terminate_*',
  '*_purge_*',
  '*_shutdown_*',
  'bulk_*',
  'mass_*',
  'batch_delete_*',
  'database_drop_*',
  'database_truncate_*',
  'database_delete_*',
  'db_drop_*',
  'iam_delete_*',
  'iam_revoke_*',
  'permission_delete_*',
  'policy_delete_*',
  'role_delete_*',
];

// ---------------------------------------------------------------------------
// Q1-blocker-9 (2026-05-12) — arg-aware classification for generic CLI
// passthrough tools (`call_aws`, `call_azure`, `call_gcp`, `call_kubectl`).
//
// These tools all share the same shape: ONE tool name, an `cli_command` (or
// `command` / `cli`) arg carrying the full shell-form invocation. The seeded
// glob rules can't help — the name `call_aws` is the same whether the model
// is running `aws bedrock list-foundation-models` (read) or
// `aws iam delete-user` (destructive).
//
// We inspect the args field, parse out the verb tokens, and decide:
//   - read-only verb prefix  -> 'allow' (auto-approve)
//   - mutating verb prefix   -> 'ask'   (HITL still gates)
//   - compound (|, &&, ;, >) -> 'ask'   (too risky to auto-approve)
//   - unrecognized           -> 'ask'   (fail-closed)
//
// This runs BEFORE the glob-rule resolver so for the 4 known passthrough
// tool names the arg-aware path wins. Every OTHER tool name falls through
// to the existing classifyName / resolveByRules path unchanged.
// ---------------------------------------------------------------------------

const CALL_TOOL_NAMES = new Set([
  'call_aws',
  'call_azure',
  'call_gcp',
  'call_kubectl',
]);

const CALL_TOOL_ARG_KEYS = ['cli_command', 'command', 'cli', 'argv'];

// Compound-command shell metas. Any of these in the command string makes us
// gate — auto-approving a chained command means trusting the read part to
// validate the unread part, which we can't statically prove.
const COMPOUND_SHELL_METAS = ['|', '&&', ';', '>', '<', '`', '$('];

interface ReadVerbRule {
  /** First-token CLI name we're matching (aws, az, gcloud, bq, kubectl). */
  cli: string;
  /**
   * Service / sub-namespace tokens to allow in full when the next token after
   * the verb is a read verb. e.g. for `aws`: service token `ce` is always
   * read-only by API design.
   */
  intrinsicReadServices?: string[];
  /**
   * Read-verb prefixes (string prefix match on the verb token AFTER the
   * service token for AWS/GCP/Azure, or on the verb itself for kubectl).
   */
  readVerbPrefixes: string[];
  /**
   * Standalone read verbs (exact match, no prefix expansion).
   */
  readVerbsExact: string[];
}

const READ_VERB_RULES: ReadVerbRule[] = [
  {
    cli: 'aws',
    intrinsicReadServices: [
      'ce', // Cost Explorer
      'cost-optimization-hub',
      'cost-explorer',
      'pricing',
      'budgets',
      'savingsplans',
      'support',
    ],
    readVerbPrefixes: [
      'list-',
      'describe-',
      'get-',
      'head-',
      'filter-',
      'search-',
      'lookup-',
      'count-',
      'check-',
      'view-',
      'preview-',
      'export-',
      'estimate-',
      'simulate-',
    ],
    readVerbsExact: ['ls', 'cat', 'show', 'help', 'wait', 'history'],
  },
  {
    cli: 'az',
    readVerbPrefixes: [
      'list',
      'show',
      'get-',
      'query',
      'describe',
      'search',
      'check-',
      'view',
      'wait',
    ],
    readVerbsExact: ['version', 'account'],
  },
  {
    cli: 'gcloud',
    readVerbPrefixes: [
      'list',
      'describe',
      'get-',
      'show',
      'lookup',
      'search',
      'check-',
      'view',
      'export',
    ],
    readVerbsExact: ['version', 'help', 'info'],
  },
  {
    cli: 'kubectl',
    readVerbPrefixes: [],
    readVerbsExact: [
      'get',
      'describe',
      'logs',
      'top',
      'explain',
      'version',
      'cluster-info',
      'api-resources',
      'api-versions',
      'config',
      'auth',
      'wait',
      'diff',
      'events',
    ],
  },
];

// Explicit mutator verbs — even if some other heuristic would match, these
// always gate. Used for AWS service-name-as-verb shapes like `aws s3 rm` /
// `aws s3 mv` / `aws iam create-user` and `gcloud projects delete`.
const MUTATING_VERB_TOKENS = new Set([
  'create',
  'create-',
  'delete',
  'delete-',
  'remove',
  'remove-',
  'rm',
  'mv',
  'cp', // cp is dual-use; `aws s3 cp` to/from a bucket can be read or write
  'put',
  'put-',
  'update',
  'update-',
  'set',
  'set-',
  'modify',
  'modify-',
  'attach',
  'attach-',
  'detach',
  'detach-',
  'terminate',
  'terminate-',
  'destroy',
  'destroy-',
  'stop',
  'stop-',
  'start',
  'start-',
  'restart',
  'restart-',
  'reboot',
  'reboot-',
  'apply',
  'patch',
  'replace',
  'scale',
  'rollout',
  'cordon',
  'uncordon',
  'drain',
  'evict',
  'label',
  'annotate',
  'taint',
  'expose',
  'autoscale',
  'edit',
  'run',
  'exec',
  'cp',
  'sync',
  'mb', // make bucket
  'rb', // remove bucket
]);

// AWS services that are pure-read (everything under them is safe), in
// ADDITION to the per-rule `intrinsicReadServices`. Kept separate so we
// can audit easily.
const AWS_READ_ONLY_SUBCOMMANDS = new Set([
  'sts:get-caller-identity',
  'iam:get-account-summary',
  'iam:list-account-aliases',
]);

/**
 * Tokenize a CLI command string. Strips leading/trailing whitespace,
 * splits on runs of whitespace. Returns ['aws', 'bedrock', 'list-foundation-models']
 * for `aws bedrock list-foundation-models --region us-west-2 ...` (flags
 * after the verb are NOT in the verb-bearing prefix; we stop at the
 * first `--` flag).
 */
function tokenizeForVerbs(command: string): string[] {
  const tokens: string[] = [];
  const raw = command.trim().split(/\s+/);
  for (const t of raw) {
    if (t.startsWith('-')) break;
    tokens.push(t);
  }
  return tokens;
}

function hasCompoundMeta(command: string): boolean {
  for (const meta of COMPOUND_SHELL_METAS) {
    if (command.includes(meta)) return true;
  }
  return false;
}

function extractCommand(args: Record<string, unknown>): string | undefined {
  for (const key of CALL_TOOL_ARG_KEYS) {
    const v = args[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (Array.isArray(v)) return v.map(String).join(' ');
  }
  return undefined;
}

function startsWithAny(token: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (token === p) return true;
    if (p.endsWith('-') && token.startsWith(p)) return true;
    if (!p.endsWith('-') && token === p) return true;
  }
  return false;
}

/**
 * Inspect the args of a `call_aws` / `call_azure` / `call_gcp` /
 * `call_kubectl` invocation and decide whether the command is read-only.
 *
 * Returns:
 *   - 'allow' iff the parsed verb is a recognized read-only verb on its CLI
 *   - 'ask'   for compound commands, mutating verbs, or anything ambiguous
 *
 * EXPORTED for unit testing — production code reaches this via `evaluate()`.
 */
export function classifyCallTool(
  toolName: string,
  args: Record<string, unknown>,
): PermissionBehavior {
  if (!CALL_TOOL_NAMES.has(toolName)) {
    // Defensive — caller shouldn't invoke this for non-call_* tools.
    return 'ask';
  }

  const command = extractCommand(args);
  if (!command) return 'ask';

  // Compound commands ALWAYS gate. Auto-approving "aws s3 ls && aws iam
  // delete-user" because the head reads is a textbook EVAL-vs-DROP attack.
  if (hasCompoundMeta(command)) return 'ask';

  const tokens = tokenizeForVerbs(command);
  if (tokens.length < 2) return 'ask';

  const cliToken = tokens[0].toLowerCase();
  const rule = READ_VERB_RULES.find((r) => r.cli === cliToken);
  if (!rule) return 'ask';

  // Mutator-token-anywhere gate. If ANY non-flag token in the command is in
  // MUTATING_VERB_TOKENS, gate. Catches `aws s3 rm`, `aws s3 mv`,
  // `aws iam create-user`, `kubectl rollout undo`. We exempt the cliToken
  // (token[0]) so a service called e.g. `rm` wouldn't break things, but
  // `rm` is not a service.
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (MUTATING_VERB_TOKENS.has(t)) {
      // `cp --dryrun` for aws s3 is read-only — special case.
      if (t === 'cp' && /--dryrun\b/.test(command)) continue;
      return 'ask';
    }
    // Token starts with a mutator prefix (e.g. `create-user`, `delete-vpc`).
    for (const mt of MUTATING_VERB_TOKENS) {
      if (mt.endsWith('-') && t.startsWith(mt)) return 'ask';
    }
  }

  // kubectl is verb-first: `kubectl get pods`. Look at tokens[1].
  if (cliToken === 'kubectl') {
    const verb = tokens[1].toLowerCase();
    if (rule.readVerbsExact.includes(verb)) {
      // Special-case `kubectl rollout status / history` — verb is `rollout`
      // (mutator) but sub-verb is read. Handled by the mutator pre-check
      // gating `rollout`. We can extend if needed; for now `rollout *` is
      // gated. Operators can add an explicit allow rule.
      return 'allow';
    }
    return 'ask';
  }

  // aws / az / gcloud are service-first: `aws bedrock list-foundation-models`.
  // az/gcloud often have multi-part service paths:
  //   `az consumption usage list`
  //   `gcloud billing accounts list`
  // so we scan the whole non-flag token sequence (after tokens[0]=cliToken)
  // for the FIRST recognized read verb. If the LAST non-flag token is itself
  // a read verb (common pattern: `<service-path> <verb>`), allow.

  const service = tokens[1].toLowerCase();

  // Intrinsic read-only services for AWS (Cost Explorer etc.) — single-
  // token match still works because these are top-level aws services.
  if (rule.intrinsicReadServices?.includes(service)) {
    return 'allow';
  }

  // Scan every non-flag token after tokens[0] for a read verb.
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (rule.readVerbsExact.includes(t)) return 'allow';
    if (startsWithAny(t, rule.readVerbPrefixes)) return 'allow';
  }

  // Explicit subcommand allowlist (service:verb pairs) — fallback for
  // aws-shape commands where tokens[1] is service and tokens[2] is verb.
  if (tokens.length >= 3) {
    const verb = tokens[2].toLowerCase();
    const pair = `${service}:${verb}`;
    if (cliToken === 'aws' && AWS_READ_ONLY_SUBCOMMANDS.has(pair)) return 'allow';
  }

  return 'ask';
}

function buildDefaultRules(): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const t of DEFAULT_ALLOW_TOOLS) {
    rules.push({
      source: 'policySettings',
      ruleBehavior: 'allow',
      ruleValue: { toolName: t },
    });
  }
  for (const t of DEFAULT_ASK_TOOLS) {
    rules.push({
      source: 'policySettings',
      ruleBehavior: 'ask',
      ruleValue: { toolName: t },
    });
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Glob translator — NOT regex.
//
// Supports:
//   `*`   matches any run of chars (zero or more), including underscores and dots
//   exact (no `*`) matches only the literal string
//
// All other regex meta-chars are escaped.
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  // Escape regex special chars, then turn `*` back into `.*`
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(pattern);
}

function matchesGlob(toolName: string, glob: string): boolean {
  if (!glob.includes('*')) return toolName === glob;
  try {
    return globToRegex(glob).test(toolName);
  } catch {
    return false;
  }
}

/**
 * Specificity ranking — used to prefer the tightest match when multiple
 * rules apply. Exact > prefix glob > suffix glob > bilateral glob.
 * Higher number = more specific.
 */
function ruleSpecificity(toolName: string): number {
  if (!toolName.includes('*')) return 1000;
  const starCount = (toolName.match(/\*/g) ?? []).length;
  // Length minus star count is a decent proxy for specificity.
  return toolName.length - starCount * 2;
}

// ---------------------------------------------------------------------------
// PermissionService
// ---------------------------------------------------------------------------

const SYSTEM_CONFIG_KEY = 'permission_rules';

// #790 (2026-05-13) — separate system_configuration row for the global
// READ-ONLY platform toggle. Keeps the kill-switch state OUT of
// `permission_rules` so admins can flip it independently of the per-rule
// allow/deny/ask cascade. When `true`, evaluate() forces deny on
// anything not matching an explicit `allow` rule — overriding the
// cascade's normal outcome. When `false`, evaluate is unchanged.
const READ_ONLY_MODE_CONFIG_KEY = 'tool_read_only_mode';

const READ_ONLY_MODE_DENY_REASON =
  'READ-ONLY mode is enabled — only allow-listed read operations are permitted';

export class PermissionService {
  private logger: Logger;
  private askEmitter = new EventEmitter();
  private pendingAsks = new Map<string, PendingAsk>();
  /**
   * Sev-0 #829 (2026-05-14) — within-session approval memo. Maps
   * `${userId}::${sessionId}::${toolName}::${argsFingerprint}` →
   * `{approvedBy, approvedAt, expiresAt}`. Written on `submitApproval`
   * with `approved=true`; read at the head of `evaluate()` so an
   * identical retry within the session short-circuits to `allow` without
   * re-prompting. Denials and timeouts are NOT memoed (retries are
   * legitimate). TTL: 1h.
   */
  private approvalMemo = new Map<string, ApprovalMemoEntry>();
  private defaultTimeoutMs: number;
  private rules: PermissionRule[];
  private rulesLoaded = false;
  /**
   * #790 (2026-05-13) — global READ-ONLY platform kill-switch.
   * When true, every tool resolves to `deny` UNLESS it matches an
   * explicit `allow` rule in the cascade. Default false (back-compat).
   */
  private readOnlyMode = false;

  constructor(logger: Logger, opts?: { timeoutMs?: number }) {
    // chat ctx.logger is a plain {info,warn,error,debug} shim built in
    // stream.handler.ts to keep RunCtx test-friendly — no .child() method.
    // Tolerate both: prefer pino's namespaced child when available, fall
    // back to the raw logger otherwise.
    this.logger = typeof (logger as any).child === 'function'
      ? (logger as any).child({ component: 'PermissionService' })
      : logger;
    this.defaultTimeoutMs = opts?.timeoutMs ?? 120_000;
    this.rules = buildDefaultRules();
    this.askEmitter.setMaxListeners(100);
  }

  /**
   * #790 (2026-05-13) — read the current state of the global READ-ONLY
   * platform toggle. UI + admin route call this to render the toggle.
   */
  getReadOnlyMode(): boolean {
    return this.readOnlyMode;
  }

  /**
   * #790 (2026-05-13) — flip the global READ-ONLY platform toggle.
   * Updates in-memory state immediately AND persists to the
   * `tool_read_only_mode` row so future boots pick it up. Persist
   * failures are logged but don't throw — the in-memory flip is the
   * load-bearing change for the current process.
   */
  async setReadOnlyMode(on: boolean): Promise<void> {
    this.readOnlyMode = Boolean(on);
    try {
      await prisma.systemConfiguration.upsert({
        where: { key: READ_ONLY_MODE_CONFIG_KEY },
        create: {
          key: READ_ONLY_MODE_CONFIG_KEY,
          value: { readOnlyMode: this.readOnlyMode } as any,
          description:
            'Global READ-ONLY platform toggle (#790). When true, all CRUD is blocked at the platform level.',
        },
        update: {
          value: { readOnlyMode: this.readOnlyMode } as any,
          updated_at: new Date(),
        },
      });
      this.logger.info(
        { readOnlyMode: this.readOnlyMode },
        '[Permissions] READ-ONLY mode persisted',
      );
    } catch (error) {
      this.logger.warn(
        { error, readOnlyMode: this.readOnlyMode },
        '[Permissions] Failed to persist READ-ONLY mode — in-memory flag still flipped',
      );
    }
  }

  /**
   * Load any persisted user rules from DB and merge over the seed.
   * Idempotent — safe to call multiple times.
   *
   * Q1-blocker-7 (2026-05-12): policySettings (system-owned) defaults must
   * be RE-MERGED into the DB rule set on every boot. The original
   * implementation replaced the in-memory seed with the DB row wholesale,
   * which meant any defaults added in later code releases never reached
   * runtime — the DB had stale policySettings frozen at first-boot time.
   *
   * Merge semantics:
   *   - DB rules win for any (toolName, behavior, source) tuple that
   *     already exists — operators can still edit / remove policySettings
   *     defaults via the admin UI, and their edits aren't blown away.
   *   - New policySettings rules from the latest seed are appended.
   *   - Non-policy sources (userSettings, projectSettings, etc.) are
   *     untouched.
   *   - When the merge result differs from DB, persist back so subsequent
   *     reloads are no-ops and the admin UI sees the canonical state.
   */
  async loadConfig(): Promise<void> {
    try {
      const row = await prisma.systemConfiguration.findFirst({
        where: { key: SYSTEM_CONFIG_KEY },
      });
      if (row?.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (Array.isArray(val.rules)) {
          // DB is sole SoT (#788, 2026-05-13). Load verbatim; do NOT merge
          // source defaults over admin edits.
          const dbRules = val.rules as PermissionRule[];
          const seedDefaults: PermissionRule[] = [];

          // Build a lookup of DB rule identities so we can detect missing
          // policySettings defaults without dropping operator-owned rules.
          const idOf = (r: PermissionRule) =>
            `${r.ruleValue.toolName} ${r.ruleBehavior} ${r.source}`;
          const dbSet = new Set(dbRules.map(idOf));
          const missingDefaults = seedDefaults.filter((r) => !dbSet.has(idOf(r)));

          this.rules = [...dbRules, ...missingDefaults];

          if (missingDefaults.length > 0) {
            this.logger.info(
              { dbCount: dbRules.length, addedDefaults: missingDefaults.length, total: this.rules.length },
              '[Permissions] Merged new policySettings defaults into DB-loaded rules',
            );
            // Write the merged set back so subsequent boots see the canonical
            // state and the admin UI shows the up-to-date defaults.
            await this.persist();
          } else {
            this.logger.info({ count: this.rules.length }, '[Permissions] Loaded rules from DB');
          }
        }
      } else {
        // Seed the row with current defaults so admin UI has something to edit.
        try {
          await prisma.systemConfiguration.create({
            data: {
              key: SYSTEM_CONFIG_KEY,
              value: { rules: this.rules } as any,
              description: 'Tool permission rules (Claude-Code-style allow/deny/ask globs)',
            },
          });
          this.logger.info({ count: this.rules.length }, '[Permissions] Seeded default rules in DB');
        } catch {
          // Race with another replica seeding — ignore.
        }
      }
      this.rulesLoaded = true;
    } catch (error) {
      this.logger.warn({ error }, '[Permissions] Failed to load rules; using in-memory defaults');
      this.rulesLoaded = true;
    }

    // #790 (2026-05-13) — load the global READ-ONLY toggle from its own
    // system_configuration row. Separate from `permission_rules` so the
    // kill-switch state survives a "reset to seed defaults" on rules and
    // can be flipped independently. Absent / unparseable row → false.
    try {
      const row = await prisma.systemConfiguration.findFirst({
        where: { key: READ_ONLY_MODE_CONFIG_KEY },
      });
      if (row?.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (val && typeof val.readOnlyMode === 'boolean') {
          this.readOnlyMode = val.readOnlyMode;
          this.logger.info(
            { readOnlyMode: this.readOnlyMode },
            '[Permissions] Loaded READ-ONLY mode from DB',
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        { error },
        '[Permissions] Failed to load READ-ONLY mode row — defaulting to false',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Public evaluation
  // -----------------------------------------------------------------------

  /**
   * Evaluate a tool call against the rule set + mode. Blocks for human
   * response when the resolved behavior is `ask`.
   *
   * `emit` is the SSE channel — used to publish `mcp_approval_required`
   * when the behavior is `ask`.
   */
  async evaluate(
    toolCall: ToolCallInfo,
    emit: (event: string, data: unknown) => void,
    opts?: PermissionEvaluateOptions,
  ): Promise<PermissionDecision> {
    const mode = opts?.mode ?? 'default';

    // 1. Mode-level shortcut
    if (mode === 'bypassPermissions') {
      this.logger.info({ tool: toolCall.toolName }, '[Permissions] bypassPermissions mode → allow');
      return {
        behavior: 'allow',
        approved: true,
        reason: 'bypassPermissions mode — all checks skipped',
        riskLevel: 'low',
        approvedBy: 'mode:bypassPermissions',
      };
    }

    // 1.5 Q1-blocker-9 (2026-05-12) — arg-aware classification for the four
    // generic CLI passthrough tools. The seeded glob rules can't help here
    // because `call_aws` is the same tool name regardless of whether the
    // verb in the args is read-only (`aws bedrock list-foundation-models`)
    // or destructive (`aws iam delete-user`). We inspect `cli_command` /
    // `command` / `cli` / `argv` and auto-approve read verbs only.
    //
    // The check is gated on the tool name being in CALL_TOOL_NAMES, so the
    // 270+ non-call_* tools fall straight through to the rule-driven
    // resolver and pay zero extra cost. Compound commands (|, &&, ;, >)
    // always gate.
    if (CALL_TOOL_NAMES.has(toolCall.toolName)) {
      const argBehavior = classifyCallTool(toolCall.toolName, toolCall.arguments ?? {});
      if (argBehavior === 'allow') {
        this.logger.info(
          {
            tool: toolCall.toolName,
            command: typeof toolCall.arguments?.cli_command === 'string'
              ? String(toolCall.arguments.cli_command).slice(0, 200)
              : undefined,
          },
          '[Permissions] call_* arg-aware: read-only verb → auto-approve',
        );
        return {
          behavior: 'allow',
          approved: true,
          reason: `Allowed by arg-aware read-verb match for ${toolCall.toolName}`,
          riskLevel: 'low',
          approvedBy: 'rule:call-tool-args-aware',
        };
      }
      // argBehavior === 'ask' falls through to the rule resolver below,
      // which will route to the HITL prompt path (default fall-through).
    }

    // 2. Rule-driven resolution
    const ruleResult = this.resolveByRules(toolCall.toolName);

    // 2.5 #790 (2026-05-13) — global READ-ONLY mode override.
    //
    // When the admin toggle is ON, ANY tool that doesn't resolve to an
    // explicit `allow` is forced to `deny` with a READ-ONLY-flavored
    // reason. This sits AFTER bypassPermissions (admins can still
    // override the kill-switch with bypassPermissions when needed) and
    // AFTER the arg-aware call_* path (which can still upgrade a read
    // verb to `allow` — those are read-only by construction). It sits
    // BEFORE the rest of the rule cascade so a per-rule `ask` rule
    // doesn't accidentally produce an HITL prompt during a kill-switch
    // event.
    if (this.readOnlyMode && ruleResult.behavior !== 'allow') {
      this.logger.info(
        {
          tool: toolCall.toolName,
          ruleBehavior: ruleResult.behavior,
        },
        '[Permissions] READ-ONLY mode override → deny',
      );
      return {
        behavior: 'deny',
        approved: false,
        reason: READ_ONLY_MODE_DENY_REASON,
        riskLevel: 'low',
        approvedBy: 'mode:readOnly',
        matchedRule: ruleResult.matchedRule,
      };
    }

    // 3. Mode-level demotion of ask → deny
    let behavior = ruleResult.behavior;
    if (behavior === 'ask' && (mode === 'plan' || mode === 'dontAsk')) {
      behavior = 'deny';
    }

    // 4. Plan mode is read-only — even allow stays allow (read-only ops),
    //    but ask-fallthroughs are denied above. acceptEdits is a no-op for
    //    tool dispatch (it gates file-edit prompts in Claude Code).

    if (behavior === 'allow') {
      const reason = ruleResult.matchedRule
        ? `Allowed by rule: ${ruleResult.matchedRule.ruleValue.toolName} (${ruleResult.matchedRule.source})`
        : 'Allowed (default)';
      return {
        behavior: 'allow',
        approved: true,
        reason,
        riskLevel: 'low',
        approvedBy: 'rule',
        matchedRule: ruleResult.matchedRule,
      };
    }

    if (behavior === 'deny') {
      const reason = ruleResult.matchedRule
        ? `Denied by rule: ${ruleResult.matchedRule.ruleValue.toolName} (${ruleResult.matchedRule.source})`
        : `Denied by mode: ${mode}`;
      this.logger.info({ tool: toolCall.toolName, mode }, '[Permissions] Tool denied');
      return {
        behavior: 'deny',
        approved: false,
        reason,
        riskLevel: 'high',
        approvedBy: ruleResult.matchedRule ? 'rule' : `mode:${mode}`,
        matchedRule: ruleResult.matchedRule,
      };
    }

    // 5. Ask path — first, check the within-session approval memo
    //    (Sev-0 #829, 2026-05-14). After the user approves a tool call,
    //    subsequent identical (user, session, tool, args) calls
    //    short-circuit to `allow` without re-prompting. This fixes the
    //    capstone scenario where a model retries a transient Azure
    //    failure and the user is forced to approve every retry.
    const memoKey = buildApprovalMemoKey(toolCall);
    const memoHit = this.approvalMemo.get(memoKey);
    if (memoHit) {
      if (Date.now() < memoHit.expiresAt) {
        this.logger.info(
          {
            tool: toolCall.toolName,
            sessionId: toolCall.sessionId,
            approvedBy: memoHit.approvedBy,
            ageMs: Date.now() - memoHit.approvedAt,
          },
          '[Permissions] memo hit — prior approval short-circuits ask',
        );
        return {
          behavior: 'allow',
          approved: true,
          reason: `Allowed by prior approval in this session (${memoHit.approvedBy})`,
          riskLevel: 'medium',
          approvedBy: `memo:${memoHit.approvedBy}`,
        };
      }
      // Stale entry — drop and fall through to a fresh prompt.
      this.approvalMemo.delete(memoKey);
    }

    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reason = `Tool '${toolCall.toolName}' requires approval`;
    const pending: PendingAsk = {
      id: requestId,
      toolCall,
      reason,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.defaultTimeoutMs,
    };
    this.pendingAsks.set(requestId, pending);

    const sanitizedArgs = this.sanitizeArgsForDisplay(toolCall.arguments);

    // Sev-0 fix #86 (2026-05-12) — wrap EVERY emit() in try/catch. If a
    // synchronous emit throws (stream-write failure, malformed UI
    // client, SSE writer in a bad state), the older code bailed out
    // of evaluate() with the exception propagating to the caller — the
    // askEmitter listener never armed and dispatch hung for the full
    // 120s timeout (or longer if upstream read-timeout is shorter,
    // which is what the 2026-05-12 36-cell matrix captured).
    //
    // Each emit is INDEPENDENT — a throw on one does NOT skip the
    // others. The approval state is in `pendingAsks`; the UI can
    // resolve via /api/permissions/approvals/:id even if every emit
    // failed (the legacy CLI-driven approval flow used this pattern).
    const safeEmit = (event: string, payload: unknown) => {
      try {
        emit(event, payload);
      } catch (err) {
        this.logger.warn(
          { err: (err as Error).message, event, requestId },
          '[Permissions] emit() threw on approval frame — continuing (in-memory ask state intact)',
        );
      }
    };

    // Q1-fix-8 (2026-05-12) — emit ONE canonical frame.
    //
    // Pre-fix the service emitted THREE frames per ask:
    //   - `mcp_approval_required` (legacy popup-modal path, UI arm RIPPED 2026-05-12)
    //   - `hitl_approval`         (canonical V3 inline-card path)
    //   - `e`                     (Vercel-compat opcode annotation, no UI arm)
    //
    // Both `mcp_approval_required` AND `hitl_approval` were in the
    // PERSISTABLE_INLINE_FRAMES allowlist, so every approval persisted
    // TWICE to `chat_messages.visualizations[]`. The UI persisted-
    // fallback path in ChatMessages.tsx then mapped both into the
    // `approvals` array → TWO cards rendered for one approval ask.
    //
    // Collapse to the single canonical `hitl_approval` frame. The
    // `mcp_approval_required` entry stays in PERSISTABLE_INLINE_FRAMES
    // only to gracefully render OLD persisted rows; new turns won't
    // produce it. The opcode-`e` annotation went unused on the UI
    // reducer so it's dropped too.
    safeEmit('hitl_approval', {
      kind: 'approval_required',
      requestId,
      toolName: toolCall.toolName,
      serverName: toolCall.serverName,
      arguments: sanitizedArgs,
      reason,
      timeoutMs: this.defaultTimeoutMs,
      riskLevel: 'medium',
    });

    this.logger.info({ requestId, tool: toolCall.toolName }, '[Permissions] Awaiting human approval');

    return this.waitForApproval(requestId);
  }

  /**
   * Synchronous classification for the concurrency-safe set. Returns the
   * resolved PermissionBehavior for a tool name with no arg context.
   *
   * Used by `computeConcurrencySafeNames` to decide which tools can run
   * in parallel (allow = safe; ask/deny = serial).
   */
  classifyName(toolName: string): PermissionBehavior {
    const behavior = this.resolveByRules(toolName).behavior;
    // #790 (2026-05-13) — READ-ONLY mode applies to the concurrency-safe
    // classifier too. Anything that isn't an explicit `allow` is forced
    // to `deny` so concurrency-set membership matches the runtime
    // evaluate() outcome — non-allow tools shouldn't appear safe in
    // parallel batches when the kill-switch is on.
    if (this.readOnlyMode && behavior !== 'allow') return 'deny';
    return behavior;
  }

  /**
   * Submit a human approval response (called from the UI via
   * POST /api/chat/tool-approval/:requestId).
   *
   * Sev-0 fix (2026-05-12 audit): enforce ownership. The submitting
   * `userId` MUST match the userId on the pending toolCall.
   * Previously any caller could resolve any pending request just by
   * knowing the requestId — combined with the un-authenticated route
   * shipped in cdfaf535, this was a cross-user authorization bypass.
   *
   * Empty / "unknown" / "anonymous" submitters are rejected even when
   * they match an empty toolCall.userId — defense-in-depth so an
   * un-authenticated POST can never resolve anything.
   */
  submitApproval(requestId: string, approved: boolean, userId: string): boolean {
    const pending = this.pendingAsks.get(requestId);
    if (!pending) {
      this.logger.warn({ requestId }, '[Permissions] Approval for unknown request');
      return false;
    }
    // Ownership check — Sev-0.
    const submitterId = String(userId ?? '').trim();
    const ownerId = String(pending.toolCall.userId ?? '').trim();
    const UNAUTHENTICATED_TOKENS = new Set(['', 'unknown', 'anonymous']);
    if (UNAUTHENTICATED_TOKENS.has(submitterId)) {
      this.logger.warn(
        { requestId, ownerId, submitterId },
        '[Permissions] Approval submit REJECTED — submitter is unauthenticated',
      );
      return false;
    }
    if (!ownerId || ownerId !== submitterId) {
      this.logger.warn(
        { requestId, ownerId, submitterId, tool: pending.toolCall.toolName },
        '[Permissions] Approval submit REJECTED — submitter does not own the pending toolCall (cross-user attempt)',
      );
      // Also audit-log the cross-user attempt so admins can see it.
      // Uses the existing `cross_user_reject` enum value (already used by
      // RLS rejections elsewhere) so we don't have to extend the union.
      void getDataAccessAuditService(this.logger).record({
        actorUserId: submitterId,
        targetUserId: ownerId,
        action: 'cross_user_reject',
        resource: `tool:${pending.toolCall.toolName}`,
        details: { requestId, approved, subkind: 'approval_cross_user_blocked' },
      });
      return false;
    }
    this.pendingAsks.delete(requestId);

    // Sev-0 #829 (2026-05-14) — memo approved tool calls so retries within
    // the same session short-circuit instead of re-prompting. Denials are
    // intentionally NOT memoed: a transient deny shouldn't permanently
    // block legitimate retries, and the user is already protected by the
    // ask path firing again.
    if (approved) {
      const memoKey = buildApprovalMemoKey(pending.toolCall);
      const now = Date.now();
      this.approvalMemo.set(memoKey, {
        approvedBy: userId,
        approvedAt: now,
        expiresAt: now + APPROVAL_MEMO_TTL_MS,
      });
    }

    this.askEmitter.emit(requestId, { approved, userId });
    this.logger.info({
      requestId,
      approved,
      userId,
      tool: pending.toolCall.toolName,
    }, `[Permissions] Approval response: ${approved ? 'APPROVED' : 'DENIED'}`);

    // Audit trail — every approve/deny decision is recorded so admins can
    // forensically answer "who approved this?".
    void getDataAccessAuditService(this.logger).record({
      actorUserId: userId,
      targetUserId: pending.toolCall.userId,
      action: 'approval_decision',
      resource: `tool:${pending.toolCall.toolName}`,
      details: {
        requestId,
        approved,
        toolCallArgs: this.sanitizeArgsForDisplay(pending.toolCall.arguments),
      },
    });

    return true;
  }

  // -----------------------------------------------------------------------
  // Rule CRUD
  // -----------------------------------------------------------------------

  /**
   * Add a rule. Persists to DB. Same `(toolName, behavior)` pair is
   * idempotent — adding twice doesn't duplicate.
   */
  addRule(rule: PermissionRule): void {
    // Drop any prior rule with identical (toolName, behavior, source) so
    // `addRule` is idempotent and operators can re-paste lists safely.
    this.rules = this.rules.filter(r =>
      !(r.ruleValue.toolName === rule.ruleValue.toolName &&
        r.ruleBehavior === rule.ruleBehavior &&
        r.ruleValue.ruleContent === rule.ruleValue.ruleContent),
    );
    this.rules.push(rule);
    this.persist().catch(() => {});
  }

  /**
   * Remove a rule by (toolName, behavior) match. Returns true if removed.
   */
  removeRule(match: { toolName: string; behavior?: PermissionBehavior }): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => {
      if (r.ruleValue.toolName !== match.toolName) return true;
      if (match.behavior && r.ruleBehavior !== match.behavior) return true;
      return false;
    });
    const removed = this.rules.length < before;
    if (removed) {
      this.persist().catch(() => {});
    }
    return removed;
  }

  /**
   * Return all currently active rules (seed + user-added).
   */
  listRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * Reset to the seeded defaults — drops every user-added rule. Used by
   * admin UI "reset to defaults" action and by tests.
   */
  clearAllUserRules(): void {
    this.rules = buildDefaultRules();
    this.persist().catch(() => {});
  }

  /**
   * Replace the entire rule set wholesale. Used by admin UI when an
   * operator pastes a new allow/deny block.
   */
  replaceAllRules(newRules: PermissionRule[]): void {
    this.rules = [...newRules];
    this.persist().catch(() => {});
  }

  /**
   * Active pending approvals — for admin monitoring + UI re-hydration on
   * page refresh.
   */
  getPendingApprovals(): PendingAsk[] {
    const now = Date.now();
    for (const [id, req] of this.pendingAsks) {
      if (now >= req.expiresAt) this.pendingAsks.delete(id);
    }
    return Array.from(this.pendingAsks.values());
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Find the matching rule for a tool name. Resolution rules:
   *   - deny beats allow when both match
   *   - more-specific glob beats less-specific
   *   - explicit ask rule beats default fall-through (which is ask)
   *
   * Returns `{ behavior: 'ask', matchedRule: undefined }` when nothing matches.
   */
  private resolveByRules(toolName: string): { behavior: PermissionBehavior; matchedRule?: PermissionRule } {
    let bestDeny: PermissionRule | undefined;
    let bestAllow: PermissionRule | undefined;
    let bestAsk: PermissionRule | undefined;

    for (const rule of this.rules) {
      if (!matchesGlob(toolName, rule.ruleValue.toolName)) continue;
      const spec = ruleSpecificity(rule.ruleValue.toolName);
      if (rule.ruleBehavior === 'deny') {
        if (!bestDeny || spec > ruleSpecificity(bestDeny.ruleValue.toolName)) {
          bestDeny = rule;
        }
      } else if (rule.ruleBehavior === 'allow') {
        if (!bestAllow || spec > ruleSpecificity(bestAllow.ruleValue.toolName)) {
          bestAllow = rule;
        }
      } else if (rule.ruleBehavior === 'ask') {
        if (!bestAsk || spec > ruleSpecificity(bestAsk.ruleValue.toolName)) {
          bestAsk = rule;
        }
      }
    }

    // Specificity-based merge: pick the most specific match, with ties
    // broken in favor of deny > allow > ask. This is the Claude Code
    // semantic — operators can write `azure_*: ask` and override with
    // `azure_list_*: allow` and the more-specific rule wins.
    const candidates: Array<{ rule?: PermissionRule; behavior: PermissionBehavior }> = [
      bestDeny ? { rule: bestDeny, behavior: 'deny' as PermissionBehavior } : { behavior: 'deny' as PermissionBehavior },
      bestAllow ? { rule: bestAllow, behavior: 'allow' as PermissionBehavior } : { behavior: 'allow' as PermissionBehavior },
      bestAsk ? { rule: bestAsk, behavior: 'ask' as PermissionBehavior } : { behavior: 'ask' as PermissionBehavior },
    ].filter(c => c.rule !== undefined);

    if (candidates.length === 0) {
      return { behavior: 'ask' };
    }

    // Sort by specificity desc; deny wins on tie.
    candidates.sort((a, b) => {
      const specA = ruleSpecificity(a.rule!.ruleValue.toolName);
      const specB = ruleSpecificity(b.rule!.ruleValue.toolName);
      if (specA !== specB) return specB - specA;
      const ord: Record<PermissionBehavior, number> = { deny: 3, allow: 2, ask: 1 };
      return ord[b.behavior] - ord[a.behavior];
    });

    return { behavior: candidates[0].behavior, matchedRule: candidates[0].rule };
  }

  private waitForApproval(requestId: string): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      const pending = this.pendingAsks.get(requestId);
      const start = pending?.createdAt ?? Date.now();

      const timer = setTimeout(() => {
        this.pendingAsks.delete(requestId);
        this.askEmitter.removeAllListeners(requestId);
        this.logger.warn({ requestId }, '[Permissions] Approval timed out — auto-denied');
        resolve({
          behavior: 'deny',
          approved: false,
          reason: 'Approval timed out — automatically denied',
          riskLevel: 'medium',
          approvedBy: 'timeout',
        });
      }, this.defaultTimeoutMs);

      this.askEmitter.once(requestId, (response: { approved: boolean; userId: string }) => {
        clearTimeout(timer);
        resolve({
          behavior: response.approved ? 'allow' : 'deny',
          approved: response.approved,
          reason: response.approved ? 'Human approved' : 'Human denied',
          riskLevel: 'medium',
          approvedBy: response.userId,
          approvalTimeMs: Date.now() - start,
        });
      });
    });
  }

  private async persist(): Promise<void> {
    try {
      await prisma.systemConfiguration.upsert({
        where: { key: SYSTEM_CONFIG_KEY },
        create: {
          key: SYSTEM_CONFIG_KEY,
          value: { rules: this.rules } as any,
          description: 'Tool permission rules (Claude-Code-style allow/deny/ask globs)',
        },
        update: {
          value: { rules: this.rules } as any,
          updated_at: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn({ error }, '[Permissions] Failed to persist rules');
    }
  }

  private sanitizeArgsForDisplay(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.slice(0, 200) + '...[truncated]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: PermissionService | null = null;

export function getPermissionService(logger: Logger): PermissionService {
  if (!_instance) {
    _instance = new PermissionService(logger);
    _instance.loadConfig().catch(() => {});
  }
  return _instance;
}

/**
 * Test seam — reset the singleton between test cases.
 */
export function _resetPermissionServiceForTesting(): void {
  _instance = null;
}
