/**
 * activityAggregator — the unified "all activity" admin audit feed.
 *
 * The platform records activity across ~12 heterogeneous Postgres tables
 * (tool calls, user queries, admin actions, flow/agent/webhook/credential/DLP
 * events, workflow executions + approvals, and the new auth_audit_log). None of
 * them shared a feed. This service UNIONs them into ONE normalized stream of
 * AuditLogEntry rows for the admin Audit Logs page.
 *
 * Why a raw UNION ALL (not N findMany merged in JS):
 *   Merging N independently-paginated queries in JS cannot produce a correct
 *   global ORDER BY timestamp DESC + LIMIT/OFFSET — page 2 of the merged feed
 *   would be wrong. The only correct cross-source pagination is a single SQL
 *   UNION ALL that the database orders + slices as one set. So each source is
 *   projected to the SAME column list in SQL, UNION ALL'd, then ordered + sliced.
 *
 * Resilience:
 *   Each source is its own SELECT. If one source table errors (missing column
 *   after a partial migration, permission, etc.) the whole union would 500. To
 *   degrade gracefully we run the union, and on failure fall back to running
 *   each source SELECT independently, dropping (log + skip) only the offending
 *   source. A broken source never blanks the entire feed.
 *
 * Schemas: audit tables live in the `admin` Postgres schema; workflow_executions,
 * workflow_approvals, synth_capability_audit and agent_audit_events live in
 * `public`. The User table (for name/email enrichment) is in `public`. All
 * table references below are schema-qualified accordingly.
 */

import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

const log = loggers.admin;

// ─── The normalized shape the UI renders (AuditLogEntry) ────────────────────
export type ActivityType =
  | 'admin'
  | 'user'
  | 'tool-call'
  | 'flow'
  | 'agent'
  | 'webhook'
  | 'security'
  | 'auth';

export interface AuditLogEntry {
  id: string;
  type: ActivityType;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  query: string | null;
  intent: string | null;
  sessionId: string | null;
  messageId: string | null;
  mcpServer: string | null;
  toolsCalled: string[];
  success: boolean;
  error: string | null;
  ipAddress: string | null;
  timestamp: string; // ISO-8601
}

export interface QueryActivityParams {
  /** Restrict to these activity types. Undefined = all. */
  types?: ActivityType[];
  /** Substring match against resourceType (case-insensitive). */
  resourceType?: string;
  /** ISO start of the window (inclusive). */
  startDate?: string;
  /** ISO end of the window (inclusive). */
  endDate?: string;
  /** Only successes (true) or only failures (false). Undefined = both. */
  success?: boolean;
  /** Substring match against actor user_id / email / name. */
  actor?: string;
  page?: number;
  limit?: number;
}

export interface ActivityPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface QueryActivityResult {
  data: AuditLogEntry[];
  pagination: ActivityPagination;
}

export interface ActivityStats {
  total: number;
  byType: Record<string, number>;
  byOutcome: { success: number; error: number };
}

// ─── The unified projected column list ──────────────────────────────────────
// EVERY source SELECT must emit EXACTLY these columns, in this order, with these
// names. The DB UNION ALL requires positional type/arity agreement.
const UNIFIED_COLUMNS = [
  'id',
  'type',
  'user_id',
  'user_name',
  'user_email',
  'action',
  'resource_type',
  'resource_id',
  'query',
  'intent',
  'session_id',
  'message_id',
  'mcp_server',
  'tools_called',
  'success',
  'error',
  'ip_address',
  'ts',
] as const;

/**
 * A source = one audit table projected to the unified column list.
 *  - `type`    : the stable AuditLogEntry.type literal for this table
 *  - `select`  : a SQL SELECT projecting the table to UNIFIED_COLUMNS.
 *                It MUST select a `ts` timestamptz column and a boolean
 *                `success`, and already produce the per-table `type` literal.
 *                The trailing WHERE is appended by the builder (so each select
 *                ends right before its WHERE — see `whereTimeCol`).
 *  - `timeCol` : the real time column on the table (for the time-window filter).
 *  - `actorCols` : columns to OR-match the `actor` filter against.
 */
interface ActivitySource {
  type: ActivityType;
  /** Schema-qualified table, aliased `t`. */
  from: string;
  /** Projection body: everything between SELECT and FROM. */
  projection: string;
  /** Real timestamptz column on the table (alias `t`). */
  timeCol: string;
  /** Columns considered when filtering by `actor` (alias `t`). */
  actorCols: string[];
  /** Optional boolean SQL expression that is true for "success" rows. */
  successExpr: string;
}

// LEFT JOIN public.users u so we can surface name/email for tables that only
// store a user_id. Aliased `u`; null-safe (LEFT JOIN). The Prisma model is
// `User` but it @@map's to the physical table public.users (id/name/email) —
// quoting it as "User" referenced a non-existent relation, which errored every
// source query and made the resilient fallback return an empty feed.
const USER_JOIN = 'LEFT JOIN public.users u ON u.id = ';

/**
 * The source registry. One entry per activity table. The projection produces
 * the unified columns; the builder wraps each in `SELECT ... FROM ... <join>
 * WHERE <time + success>` then UNION ALLs them.
 *
 * NOTE on `type` literals: cast to text so the UNION's type column is uniform.
 */
const SOURCES: ActivitySource[] = [
  // tool_call_audit_log → 'tool-call'. success = decision NOT IN (denied,timed_out).
  {
    type: 'tool-call',
    from: `admin.tool_call_audit_log t ${USER_JOIN}t.user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.user_id', 'u.email', 'u.name'],
    successExpr: `(t.decision NOT IN ('denied','timed_out'))`,
    projection: `
      t.id::text                                    AS id,
      'tool-call'::text                             AS type,
      t.user_id::text                               AS user_id,
      u.name                                        AS user_name,
      u.email                                       AS user_email,
      t.tool_name                                   AS action,
      NULL::text                                    AS resource_type,
      t.server_name                                 AS resource_id,
      NULL::text                                    AS query,
      NULL::text                                    AS intent,
      t.session_id::text                            AS session_id,
      t.message_id::text                            AS message_id,
      t.server_name                                 AS mcp_server,
      to_jsonb(ARRAY[t.tool_name])                  AS tools_called,
      (t.decision NOT IN ('denied','timed_out'))    AS success,
      CASE WHEN t.decision IN ('denied','timed_out')
           THEN t.decision ELSE NULL END            AS error,
      NULL::text                                    AS ip_address,
      t.created_at                                  AS ts`,
  },

  // user_query_audit → 'user'. query=raw_query, error=error_message.
  {
    type: 'user',
    from: `admin.user_query_audit t ${USER_JOIN}t.user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.user_id', 'u.email', 'u.name'],
    successExpr: `t.success`,
    projection: `
      t.id::text                  AS id,
      'user'::text                AS type,
      t.user_id::text             AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      t.query_type                AS action,
      NULL::text                  AS resource_type,
      NULL::text                  AS resource_id,
      t.raw_query                 AS query,
      t.intent                    AS intent,
      t.session_id::text          AS session_id,
      t.message_id::text          AS message_id,
      t.mcp_server                AS mcp_server,
      COALESCE(t.tools_called, '[]'::jsonb) AS tools_called,
      t.success                   AS success,
      t.error_message             AS error,
      t.ip_address                AS ip_address,
      t.created_at                AS ts`,
  },

  // admin_audit_log → 'admin'.
  {
    type: 'admin',
    from: `admin.admin_audit_log t ${USER_JOIN}t.admin_user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.admin_user_id', 't.admin_email', 'u.name'],
    successExpr: `true`,
    projection: `
      t.id::text                  AS id,
      'admin'::text               AS type,
      t.admin_user_id::text       AS user_id,
      u.name                      AS user_name,
      COALESCE(t.admin_email, u.email) AS user_email,
      t.action                    AS action,
      t.resource_type             AS resource_type,
      t.resource_id               AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      true                        AS success,
      NULL::text                  AS error,
      t.ip_address                AS ip_address,
      t.created_at                AS ts`,
  },

  // credential_audit_log → 'admin' (config/credential CRUD is an admin action).
  {
    type: 'admin',
    from: `admin.credential_audit_log t ${USER_JOIN}t.user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.user_id', 't.user_email', 'u.name'],
    successExpr: `true`,
    projection: `
      t.id::text                  AS id,
      'admin'::text               AS type,
      t.user_id::text             AS user_id,
      u.name                      AS user_name,
      COALESCE(t.user_email, u.email) AS user_email,
      t.action                    AS action,
      t.entity_type               AS resource_type,
      t.entity_id                 AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      true                        AS success,
      NULL::text                  AS error,
      t.ip_address                AS ip_address,
      t.created_at                AS ts`,
  },

  // flow_audit_log → 'flow'. success = outcome = 'success'.
  {
    type: 'flow',
    from: `admin.flow_audit_log t ${USER_JOIN}t.actor_user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.actor_user_id', 't.actor_user_email', 'u.name'],
    successExpr: `(t.outcome = 'success')`,
    projection: `
      t.id::text                  AS id,
      'flow'::text                AS type,
      t.actor_user_id::text       AS user_id,
      u.name                      AS user_name,
      COALESCE(t.actor_user_email, u.email) AS user_email,
      t.action                    AS action,
      t.target_type               AS resource_type,
      t.target_id                 AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      (t.outcome = 'success')     AS success,
      CASE WHEN t.outcome <> 'success' THEN t.outcome ELSE NULL END AS error,
      t.actor_ip                  AS ip_address,
      t.created_at                AS ts`,
  },

  // agent_audit_events → 'agent'. success = riskLevel IS NULL OR riskLevel<>'HIGH'
  // is too opinionated; agent events have no explicit outcome, so treat all as
  // success (they are observations, not pass/fail). Errors stay null.
  {
    type: 'agent',
    from: `public.agent_audit_events t ${USER_JOIN}t."userId"`,
    timeCol: 't."createdAt"',
    actorCols: ['t."userId"', 'u.email', 'u.name'],
    successExpr: `true`,
    projection: `
      t.id::text                  AS id,
      'agent'::text               AS type,
      t."userId"::text            AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      t."eventType"               AS action,
      'Agent'::text               AS resource_type,
      t."agentId"::text           AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      t."sessionId"::text         AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      true                        AS success,
      NULL::text                  AS error,
      NULL::text                  AS ip_address,
      t."createdAt"               AS ts`,
  },

  // webhook_audit_logs → 'webhook'. success = status = 'accepted'.
  {
    type: 'webhook',
    from: `admin.webhook_audit_logs t`,
    timeCol: 't.created_at',
    actorCols: ['t.source_ip', 't.webhook_key'],
    successExpr: `(t.status = 'accepted')`,
    projection: `
      t.id::text                  AS id,
      'webhook'::text             AS type,
      NULL::text                  AS user_id,
      NULL::text                  AS user_name,
      NULL::text                  AS user_email,
      t.status                    AS action,
      'Webhook'::text             AS resource_type,
      t.webhook_key               AS resource_id,
      NULL::text                  AS query,
      t.platform                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      (t.status = 'accepted')     AS success,
      t.rejection_reason          AS error,
      t.source_ip                 AS ip_address,
      t.created_at                AS ts`,
  },

  // credential capability: synth_capability_audit → 'security'. success = allowed.
  {
    type: 'security',
    from: `public.synth_capability_audit t ${USER_JOIN}t.user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.user_id', 'u.email', 'u.name'],
    successExpr: `t.allowed`,
    projection: `
      t.id::text                  AS id,
      'security'::text            AS type,
      t.user_id::text             AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      t.capability                AS action,
      'Capability'::text          AS resource_type,
      t.synthesis_id              AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      t.allowed                   AS success,
      t.deny_reason               AS error,
      t.ip_address                AS ip_address,
      t.created_at                AS ts`,
  },

  // dlp_findings → 'security'. success = action_taken = 'allow'.
  {
    type: 'security',
    from: `admin.dlp_findings t ${USER_JOIN}t.user_id`,
    timeCol: 't.timestamp',
    actorCols: ['t.user_id', 'u.email', 'u.name'],
    successExpr: `(t.action_taken = 'allow')`,
    projection: `
      t.id::text                  AS id,
      'security'::text            AS type,
      t.user_id::text             AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      (t.category || ':' || t.rule_id) AS action,
      'DLP'::text                 AS resource_type,
      t.scan_point                AS resource_id,
      NULL::text                  AS query,
      t.severity                  AS intent,
      t.session_id::text          AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      (t.action_taken = 'allow')  AS success,
      CASE WHEN t.action_taken <> 'allow'
           THEN (t.action_taken || ' (' || t.severity || ')') ELSE NULL END AS error,
      NULL::text                  AS ip_address,
      t.timestamp                 AS ts`,
  },

  // workflow_executions → 'flow'. success = status = 'completed'.
  {
    type: 'flow',
    from: `public.workflow_executions t ${USER_JOIN}t.started_by`,
    timeCol: 't.started_at',
    actorCols: ['t.started_by', 'u.email', 'u.name'],
    successExpr: `(t.status = 'completed')`,
    projection: `
      t.id::text                  AS id,
      'flow'::text                AS type,
      t.started_by::text          AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      ('execution:' || t.status)  AS action,
      'WorkflowExecution'::text   AS resource_type,
      t.workflow_id::text         AS resource_id,
      NULL::text                  AS query,
      t.trigger_type              AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      (t.status = 'completed')    AS success,
      t.error                     AS error,
      NULL::text                  AS ip_address,
      t.started_at                AS ts`,
  },

  // workflow_approvals → 'flow'. success = status = 'approved'.
  {
    type: 'flow',
    from: `public.workflow_approvals t ${USER_JOIN}t.rejected_by`,
    timeCol: 't.created_at',
    actorCols: ['t.rejected_by', 'u.email', 'u.name'],
    successExpr: `(t.status = 'approved')`,
    projection: `
      t.id::text                  AS id,
      'flow'::text                AS type,
      t.rejected_by::text         AS user_id,
      u.name                      AS user_name,
      u.email                     AS user_email,
      ('approval:' || t.status)   AS action,
      'WorkflowApproval'::text    AS resource_type,
      t.execution_id::text        AS resource_id,
      NULL::text                  AS query,
      NULL::text                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      (t.status = 'approved')     AS success,
      CASE WHEN t.status IN ('rejected','timeout')
           THEN t.status ELSE NULL END AS error,
      NULL::text                  AS ip_address,
      t.created_at                AS ts`,
  },

  // auth_audit_log → 'auth'. success column already exists.
  {
    type: 'auth',
    from: `admin.auth_audit_log t ${USER_JOIN}t.user_id`,
    timeCol: 't.created_at',
    actorCols: ['t.user_id', 't.user_email', 'u.name'],
    successExpr: `t.success`,
    projection: `
      t.id::text                  AS id,
      'auth'::text                AS type,
      t.user_id::text             AS user_id,
      u.name                      AS user_name,
      COALESCE(t.user_email, u.email) AS user_email,
      t.event                     AS action,
      'Auth'::text                AS resource_type,
      t.provider                  AS resource_id,
      NULL::text                  AS query,
      t.provider                  AS intent,
      NULL::text                  AS session_id,
      NULL::text                  AS message_id,
      NULL::text                  AS mcp_server,
      '[]'::jsonb                 AS tools_called,
      t.success                   AS success,
      CASE WHEN NOT t.success THEN t.event ELSE NULL END AS error,
      t.ip_address                AS ip_address,
      t.created_at                AS ts`,
  },
];

// ─── Row → AuditLogEntry normalization ──────────────────────────────────────
// The raw union row comes back with snake_case keys + a jsonb tools_called.
// This is intentionally a thin, pure mapper so it is unit-testable in isolation.
export interface RawUnionRow {
  id: string;
  type: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  action: string | null;
  resource_type: string | null;
  resource_id: string | null;
  query: string | null;
  intent: string | null;
  session_id: string | null;
  message_id: string | null;
  mcp_server: string | null;
  tools_called: unknown;
  success: boolean;
  error: string | null;
  ip_address: string | null;
  ts: Date | string;
}

function coerceTools(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.length > 0);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => typeof x === 'string' && x.length > 0);
      }
    } catch {
      /* not JSON — ignore */
    }
  }
  return [];
}

export function mapRowToEntry(row: RawUnionRow): AuditLogEntry {
  const ts =
    row.ts instanceof Date
      ? row.ts.toISOString()
      : new Date(row.ts).toISOString();
  return {
    id: String(row.id),
    type: (row.type as ActivityType) ?? 'user',
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    userEmail: row.user_email ?? null,
    action: row.action ?? null,
    resourceType: row.resource_type ?? null,
    resourceId: row.resource_id ?? null,
    query: row.query ?? null,
    intent: row.intent ?? null,
    sessionId: row.session_id ?? null,
    messageId: row.message_id ?? null,
    mcpServer: row.mcp_server ?? null,
    toolsCalled: coerceTools(row.tools_called),
    success: row.success !== false,
    error: row.error ?? null,
    ipAddress: row.ip_address ?? null,
    timestamp: ts,
  };
}

// ─── SQL builder ────────────────────────────────────────────────────────────
// Params are bound positionally ($1, $2, …) — never string-interpolated — to
// keep this injection-safe even though the projections are static.
interface BuiltSource {
  sql: string;
  params: unknown[];
}

function buildSourceSelect(
  src: ActivitySource,
  p: QueryActivityParams,
  startParamIndex: number,
): BuiltSource {
  const params: unknown[] = [];
  const where: string[] = [];
  let idx = startParamIndex;

  if (p.startDate) {
    where.push(`${src.timeCol} >= $${idx++}`);
    params.push(new Date(p.startDate));
  }
  if (p.endDate) {
    where.push(`${src.timeCol} <= $${idx++}`);
    params.push(new Date(p.endDate));
  }
  if (typeof p.success === 'boolean') {
    where.push(p.success ? src.successExpr : `NOT (${src.successExpr})`);
  }
  if (p.resourceType) {
    // resource_type is produced inside the projection; filter via a subquery
    // wrapper is overkill — instead we OR the known per-source resource hint.
    // Most tables surface resource_type from a real column or a literal; we
    // match against the projection by wrapping. Simpler + correct: filter the
    // outer union (handled by caller). No-op here.
  }
  if (p.actor) {
    const actorOr = src.actorCols
      .map((c) => `${c} ILIKE $${idx}`)
      .join(' OR ');
    where.push(`(${actorOr})`);
    params.push(`%${p.actor}%`);
    idx++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT ${src.projection.trim()} FROM ${src.from} ${whereSql}`;
  return { sql, params };
}

/** The sources that match the requested `types` filter. */
function selectedSources(types?: ActivityType[]): ActivitySource[] {
  if (!types || types.length === 0) return SOURCES;
  const set = new Set(types);
  return SOURCES.filter((s) => set.has(s.type));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Cross-source, correctly-paginated activity feed. Builds ONE UNION ALL, orders
 * by timestamp DESC, slices with LIMIT/OFFSET. Falls back to per-source on union
 * failure so a single broken table never blanks the feed.
 */
export async function queryActivity(
  p: QueryActivityParams,
): Promise<QueryActivityResult> {
  const page = Math.max(p.page ?? 1, 1);
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const offset = (page - 1) * limit;
  const sources = selectedSources(p.types);

  // Build each source SELECT with its own bound params, renumbering positional
  // placeholders so the concatenated UNION has a single contiguous param list.
  const built: BuiltSource[] = [];
  const allParams: unknown[] = [];
  for (const src of sources) {
    const b = buildSourceSelect(src, p, allParams.length + 1);
    built.push(b);
    allParams.push(...b.params);
  }

  // resourceType is a post-union filter (it lives in the projected column).
  const outerWhere: string[] = [];
  let outerIdx = allParams.length + 1;
  if (p.resourceType) {
    outerWhere.push(`u.resource_type ILIKE $${outerIdx++}`);
    allParams.push(`%${p.resourceType}%`);
  }
  const outerWhereSql = outerWhere.length
    ? `WHERE ${outerWhere.join(' AND ')}`
    : '';

  const unionBody = built.map((b) => `(${b.sql})`).join('\nUNION ALL\n');

  // LIMIT/OFFSET are appended as the final two params.
  const limitParam = outerIdx++;
  const offsetParam = outerIdx++;
  const dataSql = `
    SELECT * FROM (
      ${unionBody}
    ) AS u
    ${outerWhereSql}
    ORDER BY u.ts DESC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam}`;
  const dataParams = [...allParams, limit, offset];

  const countSql = `
    SELECT COUNT(*)::bigint AS n FROM (
      ${unionBody}
    ) AS u
    ${outerWhereSql}`;
  const countParams = [...allParams];

  try {
    const [rows, countRows] = await Promise.all([
      prisma.$queryRawUnsafe<RawUnionRow[]>(dataSql, ...dataParams),
      prisma.$queryRawUnsafe<{ n: bigint }[]>(countSql, ...countParams),
    ]);
    const total = Number(countRows?.[0]?.n ?? 0);
    return {
      data: rows.map(mapRowToEntry),
      pagination: buildPagination(page, limit, total),
    };
  } catch (err) {
    log.warn(
      { err },
      '[ACTIVITY-AGG] union query failed — degrading to per-source merge',
    );
    return queryActivityResilient(p, page, limit, offset);
  }
}

/**
 * Fallback path: run each source SELECT independently so one broken table only
 * drops itself. Loses true cross-source LIMIT/OFFSET (we over-fetch each source
 * then merge+slice in JS), but keeps the feed alive. Only hit on union error.
 */
async function queryActivityResilient(
  p: QueryActivityParams,
  page: number,
  limit: number,
  offset: number,
): Promise<QueryActivityResult> {
  const sources = selectedSources(p.types);
  const overFetch = offset + limit; // enough rows to fill the requested page
  const collected: RawUnionRow[] = [];
  let total = 0;

  for (const src of sources) {
    const b = buildSourceSelect(src, p, 1);
    const outer: string[] = [];
    const params = [...b.params];
    let idx = params.length + 1;
    if (p.resourceType) {
      outer.push(`s.resource_type ILIKE $${idx++}`);
      params.push(`%${p.resourceType}%`);
    }
    const outerSql = outer.length ? `WHERE ${outer.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM (${b.sql}) AS s
      ${outerSql}
      ORDER BY s.ts DESC NULLS LAST
      LIMIT $${idx}`;
    try {
      const rows = await prisma.$queryRawUnsafe<RawUnionRow[]>(
        sql,
        ...params,
        overFetch,
      );
      collected.push(...rows);
      total += rows.length;
    } catch (err) {
      log.warn(
        { err, source: src.type, from: src.from },
        '[ACTIVITY-AGG] source dropped from feed (query error)',
      );
    }
  }

  collected.sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
  );
  const pageRows = collected.slice(offset, offset + limit);
  return {
    data: pageRows.map(mapRowToEntry),
    // total here is a lower bound (we capped per-source over-fetch); good enough
    // for a degraded feed. hasMore reflects whether we filled the page.
    pagination: buildPagination(page, limit, Math.max(total, collected.length)),
  };
}

/**
 * Counts by type + by outcome over the window. One UNION ALL aggregated in SQL.
 */
export async function activityStats(
  p: Pick<QueryActivityParams, 'startDate' | 'endDate' | 'types'>,
): Promise<ActivityStats> {
  const sources = selectedSources(p.types);
  const built: BuiltSource[] = [];
  const allParams: unknown[] = [];
  for (const src of sources) {
    // Only time filters apply to stats (no actor/resource/success narrowing —
    // we want the full outcome breakdown for the window).
    const b = buildSourceSelect(
      { ...src },
      { startDate: p.startDate, endDate: p.endDate },
      allParams.length + 1,
    );
    built.push(b);
    allParams.push(...b.params);
  }
  const unionBody = built.map((b) => `(${b.sql})`).join('\nUNION ALL\n');
  const sql = `
    SELECT u.type AS type,
           u.success AS success,
           COUNT(*)::bigint AS n
    FROM (
      ${unionBody}
    ) AS u
    GROUP BY u.type, u.success`;

  try {
    const rows = await prisma.$queryRawUnsafe<
      { type: string; success: boolean; n: bigint }[]
    >(sql, ...allParams);
    return foldStats(rows);
  } catch (err) {
    log.warn({ err }, '[ACTIVITY-AGG] stats union failed — degrading per-source');
    return statsResilient(sources, p);
  }
}

async function statsResilient(
  sources: ActivitySource[],
  p: Pick<QueryActivityParams, 'startDate' | 'endDate'>,
): Promise<ActivityStats> {
  const acc: { type: string; success: boolean; n: bigint }[] = [];
  for (const src of sources) {
    const b = buildSourceSelect(src, { startDate: p.startDate, endDate: p.endDate }, 1);
    const sql = `
      SELECT s.type AS type, s.success AS success, COUNT(*)::bigint AS n
      FROM (${b.sql}) AS s
      GROUP BY s.type, s.success`;
    try {
      const rows = await prisma.$queryRawUnsafe<
        { type: string; success: boolean; n: bigint }[]
      >(sql, ...b.params);
      acc.push(...rows);
    } catch (err) {
      log.warn({ err, source: src.type }, '[ACTIVITY-AGG] stats source dropped');
    }
  }
  return foldStats(acc);
}

export function foldStats(
  rows: { type: string; success: boolean; n: bigint | number }[],
): ActivityStats {
  const byType: Record<string, number> = {};
  let success = 0;
  let error = 0;
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    byType[r.type] = (byType[r.type] ?? 0) + n;
    if (r.success === false) error += n;
    else success += n;
  }
  return { total, byType, byOutcome: { success, error } };
}

function buildPagination(
  page: number,
  limit: number,
  total: number,
): ActivityPagination {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    hasMore: page * limit < total,
  };
}

// Exported for tests + the route layer.
export const __testables = {
  SOURCES,
  buildSourceSelect,
  selectedSources,
  UNIFIED_COLUMNS,
};
