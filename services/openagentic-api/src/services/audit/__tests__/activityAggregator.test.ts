/**
 * activityAggregator — TDD spec for the unified admin audit feed.
 *
 * Covers the pure, DB-independent logic:
 *   1. mapRowToEntry: each source's raw union row → the AuditLogEntry shape
 *      (type literal, field mapping, tools_called coercion, success/error,
 *      ISO timestamp).
 *   2. selectedSources: the `types` filter narrows the union to matching tables.
 *   3. buildSourceSelect: time-window + actor + success filters emit correctly
 *      numbered positional params (injection-safe), and a missing filter emits
 *      no param.
 *   4. foldStats: by-type + by-outcome counts (the /stats math).
 *
 * The DB UNION execution itself is covered at the route level (admin-audit-logs
 * test) with a mocked $queryRawUnsafe; here we lock the normalization contract.
 */

import { describe, it, expect } from 'vitest';

import {
  mapRowToEntry,
  foldStats,
  __testables,
  type RawUnionRow,
  type ActivityType,
} from '../activityAggregator.js';

const { SOURCES, buildSourceSelect, selectedSources } = __testables;

// A base raw row with every unified column present.
function rawRow(overrides: Partial<RawUnionRow>): RawUnionRow {
  return {
    id: 'row-1',
    type: 'user',
    user_id: 'u1',
    user_name: 'Ada',
    user_email: 'ada@example.com',
    action: 'chat',
    resource_type: null,
    resource_id: null,
    query: null,
    intent: null,
    session_id: null,
    message_id: null,
    mcp_server: null,
    tools_called: [],
    success: true,
    error: null,
    ip_address: null,
    ts: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapRowToEntry', () => {
  it('normalizes a tool-call row (success derived, tools array kept)', () => {
    const e = mapRowToEntry(
      rawRow({
        id: 'tc-1',
        type: 'tool-call',
        action: 'aws_list_buckets',
        mcp_server: 'aws',
        resource_id: 'aws',
        tools_called: ['aws_list_buckets'],
        success: true,
      }),
    );
    expect(e.type).toBe('tool-call');
    expect(e.action).toBe('aws_list_buckets');
    expect(e.mcpServer).toBe('aws');
    expect(e.toolsCalled).toEqual(['aws_list_buckets']);
    expect(e.success).toBe(true);
    expect(e.error).toBeNull();
  });

  it('normalizes a failed tool-call (denied) → success:false + error set', () => {
    const e = mapRowToEntry(
      rawRow({ type: 'tool-call', success: false, error: 'denied' }),
    );
    expect(e.success).toBe(false);
    expect(e.error).toBe('denied');
  });

  it('normalizes a user query row → query/error/intent surfaced', () => {
    const e = mapRowToEntry(
      rawRow({
        type: 'user',
        query: 'how do I list pods',
        intent: 'kubernetes',
        error: null,
        success: true,
      }),
    );
    expect(e.type).toBe('user');
    expect(e.query).toBe('how do I list pods');
    expect(e.intent).toBe('kubernetes');
  });

  it('normalizes an admin row with resourceType/resourceId', () => {
    const e = mapRowToEntry(
      rawRow({
        type: 'admin',
        action: 'update',
        resource_type: 'LLMProvider',
        resource_id: 'prov-9',
        ip_address: '10.0.0.1',
      }),
    );
    expect(e.type).toBe('admin');
    expect(e.resourceType).toBe('LLMProvider');
    expect(e.resourceId).toBe('prov-9');
    expect(e.ipAddress).toBe('10.0.0.1');
  });

  it('normalizes a security (DLP) row → type security, success false on block', () => {
    const e = mapRowToEntry(
      rawRow({
        type: 'security',
        action: 'pii:rule-7',
        resource_type: 'DLP',
        success: false,
        error: 'block (high)',
      }),
    );
    expect(e.type).toBe('security');
    expect(e.success).toBe(false);
    expect(e.error).toBe('block (high)');
  });

  it('normalizes an auth row', () => {
    const e = mapRowToEntry(
      rawRow({
        type: 'auth',
        action: 'login_failed',
        resource_id: 'local',
        success: false,
        error: 'login_failed',
      }),
    );
    expect(e.type).toBe('auth');
    expect(e.action).toBe('login_failed');
    expect(e.success).toBe(false);
  });

  it('coerces a JSON-string tools_called into an array', () => {
    const e = mapRowToEntry(
      rawRow({ tools_called: '["a","b"]' as unknown as RawUnionRow['tools_called'] }),
    );
    expect(e.toolsCalled).toEqual(['a', 'b']);
  });

  it('coerces a null/garbage tools_called into []', () => {
    expect(mapRowToEntry(rawRow({ tools_called: null })).toolsCalled).toEqual([]);
    expect(mapRowToEntry(rawRow({ tools_called: 42 as unknown as never })).toolsCalled).toEqual([]);
  });

  it('emits an ISO-8601 timestamp from a Date or string ts', () => {
    const fromDate = mapRowToEntry(rawRow({ ts: new Date('2026-06-01T12:00:00Z') }));
    expect(fromDate.timestamp).toBe('2026-06-01T12:00:00.000Z');
    const fromStr = mapRowToEntry(rawRow({ ts: '2026-06-01T12:00:00.000Z' }));
    expect(fromStr.timestamp).toBe('2026-06-01T12:00:00.000Z');
  });

  it('treats success strictly: only literal false is a failure', () => {
    // PG returns boolean; guard against truthy coercion surprises.
    expect(mapRowToEntry(rawRow({ success: true })).success).toBe(true);
    expect(mapRowToEntry(rawRow({ success: false })).success).toBe(false);
  });
});

describe('source registry', () => {
  it('covers every required activity type', () => {
    const types = new Set(SOURCES.map((s) => s.type));
    for (const t of [
      'tool-call',
      'user',
      'admin',
      'flow',
      'agent',
      'webhook',
      'security',
      'auth',
    ] as ActivityType[]) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('every source projects to all unified columns in order', () => {
    for (const src of SOURCES) {
      for (const col of __testables.UNIFIED_COLUMNS) {
        // each alias `AS <col>` (or `AS ts`) must appear in the projection
        expect(src.projection).toContain(`AS ${col}`);
      }
    }
  });

  it('selectedSources(undefined) returns all sources', () => {
    expect(selectedSources(undefined).length).toBe(SOURCES.length);
  });

  it('selectedSources filters to requested types only', () => {
    const only = selectedSources(['auth']);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((s) => s.type === 'auth')).toBe(true);
  });

  it('selectedSources(["flow"]) keeps every flow source (multiple tables map to flow)', () => {
    const flow = selectedSources(['flow']);
    // flow_audit_log + workflow_executions + workflow_approvals all map to flow
    expect(flow.length).toBeGreaterThanOrEqual(3);
    expect(flow.every((s) => s.type === 'flow')).toBe(true);
  });

  // ── Type-fidelity contract with the UI ────────────────────────────────────
  // The admin AuditLogsPage normalizes EVERY source into one AuditLogEntry whose
  // `type` is the 8-member union (mirrored in the UI as AuditLogType in
  // features/admin/hooks/useDashboardMetrics.ts). Pin that the source registry
  // never emits a type outside that union, so the UI's widened type can't drift.
  it('every source type is within the 8-member AuditLogType union the UI renders', () => {
    const UI_UNION: ReadonlySet<ActivityType> = new Set<ActivityType>([
      'admin',
      'user',
      'tool-call',
      'flow',
      'agent',
      'webhook',
      'security',
      'auth',
    ]);
    for (const src of SOURCES) {
      expect(
        UI_UNION.has(src.type),
        `source ${src.from} emits type "${src.type}" which is NOT in the UI AuditLogType union`,
      ).toBe(true);
    }
    // And the union is fully exercised — no UI type is dead (no row would ever
    // surface it). Each of the 8 must be produced by at least one source.
    const produced = new Set(SOURCES.map((s) => s.type));
    for (const t of UI_UNION) {
      expect(produced.has(t), `UI type "${t}" has no backing source`).toBe(true);
    }
  });
});

describe('buildSourceSelect — filters + positional params', () => {
  const auth = SOURCES.find((s) => s.type === 'auth')!;

  it('no filters → no params, no WHERE', () => {
    const { sql, params } = buildSourceSelect(auth, {}, 1);
    expect(params).toEqual([]);
    expect(sql).not.toContain('WHERE');
  });

  it('startDate/endDate produce 2 bound Date params numbered from the offset', () => {
    const { sql, params } = buildSourceSelect(
      auth,
      { startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-02T00:00:00Z' },
      1,
    );
    expect(params).toHaveLength(2);
    expect(params[0]).toBeInstanceOf(Date);
    expect(params[1]).toBeInstanceOf(Date);
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('WHERE');
  });

  it('honors the startParamIndex so concatenated unions stay contiguous', () => {
    const { sql, params } = buildSourceSelect(
      auth,
      { startDate: '2026-06-01T00:00:00Z' },
      5,
    );
    expect(params).toHaveLength(1);
    expect(sql).toContain('$5');
    expect(sql).not.toContain('$1');
  });

  it('success:false negates the source success expression', () => {
    const { sql } = buildSourceSelect(auth, { success: false }, 1);
    expect(sql).toContain('NOT (');
  });

  it('actor adds an ILIKE OR clause with a single % param', () => {
    const { sql, params } = buildSourceSelect(auth, { actor: 'ada' }, 1);
    expect(params).toEqual(['%ada%']);
    expect(sql).toContain('ILIKE');
  });

  it('never interpolates user input into the SQL string (injection-safe)', () => {
    const { sql } = buildSourceSelect(auth, { actor: "x'; DROP TABLE users;--" }, 1);
    expect(sql).not.toContain('DROP TABLE');
  });
});

describe('foldStats — /stats math', () => {
  it('counts by type and by outcome', () => {
    const stats = foldStats([
      { type: 'user', success: true, n: 3 },
      { type: 'user', success: false, n: 2 },
      { type: 'admin', success: true, n: 1 },
      { type: 'tool-call', success: false, n: 4 },
    ]);
    expect(stats.total).toBe(10);
    expect(stats.byType.user).toBe(5);
    expect(stats.byType.admin).toBe(1);
    expect(stats.byType['tool-call']).toBe(4);
    expect(stats.byOutcome.success).toBe(4); // 3 + 1
    expect(stats.byOutcome.error).toBe(6); // 2 + 4
  });

  it('handles bigint counts from postgres', () => {
    const stats = foldStats([{ type: 'auth', success: true, n: 5n as unknown as bigint }]);
    expect(stats.total).toBe(5);
    expect(stats.byType.auth).toBe(5);
  });

  it('empty input → zeroed stats', () => {
    const stats = foldStats([]);
    expect(stats.total).toBe(0);
    expect(stats.byOutcome).toEqual({ success: 0, error: 0 });
    expect(stats.byType).toEqual({});
  });
});
