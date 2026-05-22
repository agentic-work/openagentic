/**
 * PermissionService — Claude Code-style glob permission rules.
 *
 * Replaces the old ToolApprovalGate regex-tier model (LOW/MEDIUM/HIGH/CRITICAL +
 * argument escalation + per-user trust scoring) with the simpler PermissionRule
 * model from /home/trent/anthropic/src/types/permissions.ts:
 *
 *   - 3 behaviors:  allow | deny | ask
 *   - 5 modes:      default | acceptEdits | bypassPermissions | dontAsk | plan
 *   - explicit glob rules keyed by toolName (no regex)
 *
 * Concurrency: allow → safe; ask/deny → not safe.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';

// Neutralise Prisma — most tests don't hit DB.
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  },
}));

import {
  PermissionService,
  type ToolCallInfo,
  type PermissionRule,
} from '../PermissionService.js';

const logger = pino({ level: 'silent' });

const mkToolCall = (toolName: string, overrides: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  toolName,
  userId: 'test-user',
  arguments: {},
  ...overrides,
});

const mkEmit = () => {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    emit: (event: string, data: unknown) => events.push({ event, data }),
    events,
  };
};

describe('PermissionService — Claude-Code-style glob rules', () => {
  // ───────────────────────────────────────────────────────────────────
  // Default seed rules
  // ───────────────────────────────────────────────────────────────────

  describe('default seed rules — allow.list', () => {
    test('tool_search is auto-approved by default allow.list', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const result = await svc.evaluate(mkToolCall('tool_search'), emit);
      expect(result.approved).toBe(true);
      expect(result.behavior).toBe('allow');
    });

    test('agent_search / agent_list / agent_send / agent_stop are auto-approved', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      expect((await svc.evaluate(mkToolCall('agent_search'), emit)).behavior).toBe('allow');
      expect((await svc.evaluate(mkToolCall('agent_list'), emit)).behavior).toBe('allow');
      expect((await svc.evaluate(mkToolCall('agent_send'), emit)).behavior).toBe('allow');
      expect((await svc.evaluate(mkToolCall('agent_stop'), emit)).behavior).toBe('allow');
    });

    test('read_large_result / web_search / web_fetch / compose_visual / render_artifact / request_clarification / memorize are auto-approved', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      for (const name of [
        'read_large_result', 'web_search', 'web_fetch',
        'compose_visual', 'compose_app', 'render_artifact',
        'request_clarification', 'memorize',
      ]) {
        const r = await svc.evaluate(mkToolCall(name), emit);
        expect(r.approved).toBe(true);
        expect(r.behavior).toBe('allow');
      }
    });

    test('glob match: azure_list_* matches azure_list_subscriptions', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('azure_list_subscriptions'), emit);
      expect(r.approved).toBe(true);
      expect(r.behavior).toBe('allow');
    });

    test('glob match: aws_get_* matches aws_get_caller_identity', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('aws_get_caller_identity'), emit);
      expect(r.approved).toBe(true);
      expect(r.behavior).toBe('allow');
    });

    test('glob match: k8s_list_* matches k8s_list_pods', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('k8s_list_pods'), emit);
      expect(r.approved).toBe(true);
      expect(r.behavior).toBe('allow');
    });

    test('glob match: gcp_list_* matches gcp_list_projects', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('gcp_list_projects'), emit);
      expect(r.approved).toBe(true);
      expect(r.behavior).toBe('allow');
    });
  });

  describe('default seed rules — destructive verbs gate via HITL (ask)', () => {
    // 2026-05-13 (#788): destructive verbs ship as `ask` in the first-boot
    // seed, not `deny`. HITL gate is the runtime check; admin can flip to
    // deny/allow via /admin#permissions. svc.evaluate without an emit-driven
    // reply times out → falls back to deny (mode='default' default-on-ask).
    test('azure_delete_vm seeds as ask (matches *_delete_* glob)', async () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('azure_delete_vm')).toBe('ask');
    });

    test('aws_drop_table seeds as ask (matches *_drop_* glob)', async () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('aws_drop_table')).toBe('ask');
    });

    test('bulk_delete_users seeds as ask (matches bulk_* glob)', async () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('bulk_delete_users')).toBe('ask');
    });

    test('database_truncate_logs seeds as ask (matches *_truncate_* glob)', async () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('database_truncate_logs')).toBe('ask');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Modes
  // ───────────────────────────────────────────────────────────────────

  describe('permission modes', () => {
    test('bypassPermissions mode skips all checks → behavior=allow', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('azure_delete_vm'), emit, { mode: 'bypassPermissions' });
      expect(r.approved).toBe(true);
      expect(r.behavior).toBe('allow');
      expect(r.reason).toMatch(/bypass/i);
    });

    test('default mode honors rules — destructive asks, listing allowed', async () => {
      // 2026-05-13 (#788): destructive seed is `ask`; classifyName returns
      // the raw resolver decision (no HITL pump).
      const svc = new PermissionService(logger);
      expect(svc.classifyName('azure_delete_vm')).toBe('ask');
      expect(svc.classifyName('azure_list_subscriptions')).toBe('allow');
    });

    test('dontAsk mode auto-denies "ask" decisions instead of prompting', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 50 });
      const { emit } = mkEmit();
      // "weird_unknown_tool" hits the default ASK rule
      const r = await svc.evaluate(mkToolCall('weird_unknown_tool'), emit, { mode: 'dontAsk' });
      expect(r.behavior).toBe('deny');
      expect(r.approved).toBe(false);
    });

    test('plan mode denies any tool not on allow.list (read-only plan)', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      // Plan mode: even default-ASK fall-through gets denied
      const r = await svc.evaluate(mkToolCall('weird_unknown_tool'), emit, { mode: 'plan' });
      expect(r.behavior).toBe('deny');
      expect(r.approved).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Custom admin rules
  // ───────────────────────────────────────────────────────────────────

  describe('admin custom rules', () => {
    test('admin can addRule that overrides default — adds an allow for a normally-ask tool', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();

      // Without rule: weird_unknown_tool → ask (which times out → deny)
      const before = await svc.evaluate(mkToolCall('weird_unknown_tool'), emit, { mode: 'dontAsk' });
      expect(before.behavior).toBe('deny');

      // Add allow rule
      svc.addRule({
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'weird_unknown_tool' },
      });

      const after = await svc.evaluate(mkToolCall('weird_unknown_tool'), emit);
      expect(after.behavior).toBe('allow');
    });

    test('admin can addRule with glob and it applies', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      svc.addRule({
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'custom_*' },
      });
      const r = await svc.evaluate(mkToolCall('custom_query'), emit);
      expect(r.behavior).toBe('allow');
    });

    test('addRule deny overrides default allow', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      svc.addRule({
        source: 'projectSettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'tool_search' },
      });
      const r = await svc.evaluate(mkToolCall('tool_search'), emit);
      expect(r.behavior).toBe('deny');
    });

    test('removeRule restores previous behavior', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      svc.addRule({
        source: 'userSettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'tool_search' },
      });
      expect((await svc.evaluate(mkToolCall('tool_search'), emit)).behavior).toBe('deny');
      svc.removeRule({ toolName: 'tool_search', behavior: 'deny' });
      expect((await svc.evaluate(mkToolCall('tool_search'), emit)).behavior).toBe('allow');
    });

    test('listRules returns the full rule set including defaults', () => {
      const svc = new PermissionService(logger);
      svc.addRule({
        source: 'userSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'custom_thing' },
      });
      const rules = svc.listRules();
      expect(rules.length).toBeGreaterThan(1);
      expect(rules.some((r: PermissionRule) => r.ruleValue.toolName === 'custom_thing')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Glob translator semantics
  // ───────────────────────────────────────────────────────────────────

  describe('glob matching (NOT regex)', () => {
    test('* matches one or more chars within a name segment', async () => {
      const svc = new PermissionService(logger);
      // Start from a minimal rule set so the defaults' `aws_list_*` doesn't
      // also match the negative case below.
      svc.replaceAllRules([
        {
          source: 'userSettings',
          ruleBehavior: 'allow',
          ruleValue: { toolName: 'azure_list_*' },
        },
      ]);
      const { emit } = mkEmit();
      expect((await svc.evaluate(mkToolCall('azure_list_subscriptions'), emit, { mode: 'dontAsk' })).behavior).toBe('allow');
      expect((await svc.evaluate(mkToolCall('azure_list_vms'), emit, { mode: 'dontAsk' })).behavior).toBe('allow');
      // No leading-azure: nothing in the rule set matches, falls through to
      // ask → deny under dontAsk.
      expect((await svc.evaluate(mkToolCall('aws_list_buckets'), emit, { mode: 'dontAsk' })).behavior).toBe('deny');
    });

    test('exact match works (no glob char)', async () => {
      const svc = new PermissionService(logger);
      svc.replaceAllRules([
        {
          source: 'userSettings',
          ruleBehavior: 'allow',
          ruleValue: { toolName: 'exact_tool' },
        },
      ]);
      const { emit } = mkEmit();
      expect((await svc.evaluate(mkToolCall('exact_tool'), emit, { mode: 'dontAsk' })).behavior).toBe('allow');
      expect((await svc.evaluate(mkToolCall('exact_tool_v2'), emit, { mode: 'dontAsk' })).behavior).toBe('deny');
    });

    test('leading wildcard *_delete_* matches azure_delete_vm and aws_delete_bucket (ask seed)', async () => {
      // 2026-05-13 (#788): destructive verbs seed as `ask` not `deny`.
      const svc = new PermissionService(logger);
      expect(svc.classifyName('azure_delete_vm')).toBe('ask');
      expect(svc.classifyName('aws_delete_bucket')).toBe('ask');
      expect(svc.classifyName('gcp_delete_project')).toBe('ask');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Synchronous classification for concurrency-safe set
  // ───────────────────────────────────────────────────────────────────

  describe('classifyName (sync) — used by concurrency-safe partitioning', () => {
    test('returns "allow" for default allow-list tools', () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('tool_search')).toBe('allow');
      expect(svc.classifyName('azure_list_subscriptions')).toBe('allow');
    });

    test('returns "ask" for destructive seed tools (HITL gate)', () => {
      // 2026-05-13 (#788): destructive verbs seed as `ask` not `deny`.
      const svc = new PermissionService(logger);
      expect(svc.classifyName('azure_delete_vm')).toBe('ask');
      expect(svc.classifyName('bulk_delete_users')).toBe('ask');
    });

    test('returns "ask" for unknown tools (default fall-through)', () => {
      const svc = new PermissionService(logger);
      expect(svc.classifyName('weird_unknown_thing')).toBe('ask');
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Human approval round-trip (the ask path)
  // ───────────────────────────────────────────────────────────────────

  describe('human approval path (ask behavior)', () => {
    test('ask behavior emits hitl_approval and waits for response', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      // Use a tool with no default match — falls through to ask
      const pending = svc.evaluate(mkToolCall('weird_unknown_tool'), emit);

      // Q1-fix-8 (2026-05-12) — canonical frame is `hitl_approval`. The
      // legacy `mcp_approval_required` dual-emit was ripped to stop the
      // double-card render on the dev environment.
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      // Sev-0 fix 2026-05-12 — submitter MUST match the toolCall's userId.
      // mkToolCall defaults userId to 'test-user'; pass that here.
      svc.submitApproval(req.requestId, true, 'test-user');

      const result = await pending;
      expect(result.approved).toBe(true);
      expect(result.behavior).toBe('allow');
      expect(result.approvedBy).toBe('test-user');
    });

    test('ask behavior times out → approved=false', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 50 });
      const { emit, events } = mkEmit();

      const result = await svc.evaluate(mkToolCall('weird_unknown_tool'), emit);
      expect(result.approved).toBe(false);
      // Timeout falls through to deny, not allow
      expect(result.behavior).toBe('deny');
      // Q1-fix-8 — canonical frame name.
      expect(events.find(e => e.event === 'hitl_approval')).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Logger shape tolerance — chat ctx.logger is a plain shim
  // ───────────────────────────────────────────────────────────────────

  describe('logger shape tolerance', () => {
    test('accepts plain {info,warn,error,debug} logger without .child()', () => {
      const plainLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
      expect(() => new PermissionService(plainLogger as any)).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Backwards-compat: legacy ToolApprovalGate result shape
  // ───────────────────────────────────────────────────────────────────

  describe('legacy result fields (approved / reason / riskLevel) preserved', () => {
    test('allow result has approved=true and reason set', async () => {
      const svc = new PermissionService(logger);
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('tool_search'), emit);
      expect(r.approved).toBe(true);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    });

    test('deny result has approved=false and reason set', async () => {
      // 2026-05-13 (#788): destructive verbs now seed as `ask` (HITL gate).
      // To exercise the deny code path use an explicit admin-added deny rule.
      const svc = new PermissionService(logger);
      svc.addRule({
        source: 'userSettings',
        ruleBehavior: 'deny',
        ruleValue: { toolName: 'azure_delete_vm' },
      });
      const { emit } = mkEmit();
      const r = await svc.evaluate(mkToolCall('azure_delete_vm'), emit);
      expect(r.approved).toBe(false);
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // Sev-0 #829 (2026-05-14) — within-session approval memoization
  //
  // Bug surface: after the user approves an `ask`-tier tool call, the model
  // retries the same tool with the same arguments (e.g. on a transient
  // Azure failure). PermissionService.evaluate() runs the full ask path
  // AGAIN, emits a new hitl_approval card with a new requestId, and blocks
  // dispatch until either (a) the user approves a second time or (b) the
  // 120s timeout fires → auto-deny → the retry never gets to run.
  //
  // Fix: memoize approved (sessionId, toolName, argsFingerprint) tuples on
  // submitApproval(approved=true). On subsequent evaluate() with a matching
  // fingerprint, return approved=true synchronously without emitting a new
  // hitl_approval frame. `argsFingerprint` is stable JSON-of-sorted-keys so
  // {a:1,b:2} matches {b:2,a:1}.
  // ───────────────────────────────────────────────────────────────────

  describe('within-session approval memoization (#829)', () => {
    test('approving once short-circuits subsequent identical tool calls in same session', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      const call: ToolCallInfo = mkToolCall('azure_create_resource_group', {
        sessionId: 'sess-1',
        arguments: { name: 'rg-test', location: 'eastus' },
      });

      // 1st call → ask → emit hitl_approval → user approves
      const first = svc.evaluate(call, emit);
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(req.requestId, true, 'test-user');
      const firstResult = await first;
      expect(firstResult.approved).toBe(true);

      // 2nd call with IDENTICAL (session, tool, args) — must NOT emit a
      // second hitl_approval. Result must be `allow` via the memo path.
      const eventsBeforeSecond = events.length;
      const secondResult = await svc.evaluate(call, emit);
      expect(secondResult.approved).toBe(true);
      expect(secondResult.behavior).toBe('allow');
      expect(secondResult.approvedBy).toMatch(/memo|cached|prior/i);
      // CRITICAL: no new hitl_approval frame
      const newApprovalEvents = events.slice(eventsBeforeSecond).filter(e => e.event === 'hitl_approval');
      expect(newApprovalEvents).toHaveLength(0);
    });

    test('memo is sensitive to args — different args re-prompt', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      // Approve with args {name:'rg-A'}
      const callA: ToolCallInfo = mkToolCall('azure_create_resource_group', {
        sessionId: 'sess-1',
        arguments: { name: 'rg-A', location: 'eastus' },
      });
      const first = svc.evaluate(callA, emit);
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(req.requestId, true, 'test-user');
      await first;

      // Now request {name:'rg-B'} — must re-prompt (different args).
      const callB: ToolCallInfo = mkToolCall('azure_create_resource_group', {
        sessionId: 'sess-1',
        arguments: { name: 'rg-B', location: 'eastus' },
      });
      const eventsBefore = events.length;
      const secondPending = svc.evaluate(callB, emit);
      await vi.waitFor(
        () => expect(events.slice(eventsBefore).find(e => e.event === 'hitl_approval')).toBeDefined(),
        { timeout: 2_000 },
      );
      // Resolve so the test cleanly exits
      const newReq = events.slice(eventsBefore).find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(newReq.requestId, true, 'test-user');
      await secondPending;
    });

    test('argsFingerprint is key-order invariant ({a:1,b:2} === {b:2,a:1})', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      const first = svc.evaluate(
        mkToolCall('azure_create_resource_group', {
          sessionId: 'sess-1',
          arguments: { name: 'rg-test', location: 'eastus' },
        }),
        emit,
      );
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(req.requestId, true, 'test-user');
      await first;

      // Same args, different key order — must hit memo.
      const eventsBefore = events.length;
      const secondResult = await svc.evaluate(
        mkToolCall('azure_create_resource_group', {
          sessionId: 'sess-1',
          arguments: { location: 'eastus', name: 'rg-test' },
        }),
        emit,
      );
      expect(secondResult.approved).toBe(true);
      const newApprovalEvents = events.slice(eventsBefore).filter(e => e.event === 'hitl_approval');
      expect(newApprovalEvents).toHaveLength(0);
    });

    test('memo is scoped to session — different sessionId re-prompts', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      const first = svc.evaluate(
        mkToolCall('azure_create_resource_group', {
          sessionId: 'sess-A',
          arguments: { name: 'rg-test' },
        }),
        emit,
      );
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(req.requestId, true, 'test-user');
      await first;

      // Different session, same tool + args — must re-prompt. Approvals
      // do NOT carry across chat sessions for safety.
      const eventsBefore = events.length;
      const secondPending = svc.evaluate(
        mkToolCall('azure_create_resource_group', {
          sessionId: 'sess-B',
          arguments: { name: 'rg-test' },
        }),
        emit,
      );
      await vi.waitFor(
        () => expect(events.slice(eventsBefore).find(e => e.event === 'hitl_approval')).toBeDefined(),
        { timeout: 2_000 },
      );
      const newReq = events.slice(eventsBefore).find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(newReq.requestId, true, 'test-user');
      await secondPending;
    });

    test('denied tools are NOT memoed — declining once does not auto-deny forever', async () => {
      const svc = new PermissionService(logger, { timeoutMs: 5_000 });
      const { emit, events } = mkEmit();

      const call: ToolCallInfo = mkToolCall('azure_create_resource_group', {
        sessionId: 'sess-1',
        arguments: { name: 'rg-test' },
      });

      // 1st call → ask → user DENIES
      const first = svc.evaluate(call, emit);
      await vi.waitFor(() => expect(events.find(e => e.event === 'hitl_approval')).toBeDefined(), { timeout: 2_000 });
      const req = events.find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(req.requestId, false, 'test-user');
      const firstResult = await first;
      expect(firstResult.approved).toBe(false);

      // 2nd call — user CAN be re-prompted (denials don't cache).
      const eventsBefore = events.length;
      const secondPending = svc.evaluate(call, emit);
      await vi.waitFor(
        () => expect(events.slice(eventsBefore).find(e => e.event === 'hitl_approval')).toBeDefined(),
        { timeout: 2_000 },
      );
      // Clean up
      const newReq = events.slice(eventsBefore).find(e => e.event === 'hitl_approval')!.data as any;
      svc.submitApproval(newReq.requestId, true, 'test-user');
      await secondPending;
    });
  });
});
