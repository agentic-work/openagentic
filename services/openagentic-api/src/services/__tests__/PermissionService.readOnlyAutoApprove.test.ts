/**
 * Q1-blocker-7 — read-only cloud tools must auto-approve.
 *
 * The chatmode autonomous flow halts at "Awaiting human approval" when the
 * model invokes a read-only Cost Explorer / list / describe / query tool
 * that the seeded permission rules don't cover.
 *
 * RED scenario (pre-fix):
 *   aws_cost_by_service / azure_cost_query / gcp_list_billing_accounts
 *   fall through to the default `ask` behavior because the seed rules only
 *   cover `aws_get_*`, `aws_list_*`, `aws_describe_*`, `aws_search_*`,
 *   `aws_query_*`. There is no rule that matches `aws_cost_by_service`
 *   (the `cost_*` glob requires the name to START with `cost_`).
 *
 * GREEN scenario (post-fix):
 *   PermissionService.DEFAULT_ALLOW_TOOLS gains `aws_cost_*`, `gcp_cost_*`,
 *   `gcp_billing_*`, `kubectl_get_*`, `kubectl_describe_*`, and bilateral
 *   read-only verb patterns (`*_list_*`, `*_get_*`, `*_describe_*`,
 *   `*_query`, `*_query_*`, `*_show_*`, `*_inventory*`, `*_audit*`).
 *
 * REGRESSION: destructive verbs (*_delete_*, *_drop_*, *_destroy_*,
 * *_terminate_*) STILL match the deny list and remain blocked.
 *
 * DEFAULT: an unknown tool (no rule matches) falls through to `ask` —
 * fail-closed for safety.
 */
import { describe, test, expect, vi } from 'vitest';
import pino from 'pino';

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

import { PermissionService } from '../PermissionService.js';
import { prisma } from '../../utils/prisma.js';
const prismaMock = prisma as unknown as {
  systemConfiguration: {
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

const logger = pino({ level: 'silent' });

describe('PermissionService — Q1 read-only auto-approve patterns', () => {
  test('aws_cost_by_service is allowed (Cost Explorer read)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('aws_cost_by_service')).toBe('allow');
  });

  test('aws_cost_and_usage / aws_cost_forecast are allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('aws_cost_and_usage')).toBe('allow');
    expect(svc.classifyName('aws_cost_forecast')).toBe('allow');
  });

  test('azure_cost_query is allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('azure_cost_query')).toBe('allow');
  });

  test('azure_list_subscriptions is allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('azure_list_subscriptions')).toBe('allow');
  });

  test('gcp_list_billing_accounts is allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('gcp_list_billing_accounts')).toBe('allow');
  });

  test('gcp_billing_get_cost is allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('gcp_billing_get_cost')).toBe('allow');
  });

  test('kubectl_get_pods is allowed (bilateral *_get_* match)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('kubectl_get_pods')).toBe('allow');
  });

  test('kubectl_describe_pod is allowed', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('kubectl_describe_pod')).toBe('allow');
  });

  test('REGRESSION: aws_create_vpc is still denied/asked (NOT auto-approved)', () => {
    const svc = new PermissionService(logger);
    const behavior = svc.classifyName('aws_create_vpc');
    expect(behavior).not.toBe('allow');
  });

  test('REGRESSION: azure_delete_vm seeds as ask (HITL gate, matches *_delete_*)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('azure_delete_vm')).toBe('ask');
  });

  test('REGRESSION: aws_terminate_instance seeds as ask (HITL gate, matches *_terminate_*)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('aws_terminate_instance')).toBe('ask');
  });

  test('REGRESSION: aws_destroy_bucket seeds as ask (HITL gate, matches *_destroy_*)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('aws_destroy_bucket')).toBe('ask');
  });

  test('REGRESSION: iam_delete_user seeds as ask (HITL gate)', () => {
    // 2026-05-13 (#788): destructive verbs seed as `ask`; admin can flip to
    // deny/allow via /admin#permissions.
    const svc = new PermissionService(logger);
    expect(svc.classifyName('iam_delete_user')).toBe('ask');
  });

  test('DEFAULT: aws_random_unknown_tool is fail-closed (ask)', () => {
    const svc = new PermissionService(logger);
    expect(svc.classifyName('aws_random_unknown_tool')).toBe('ask');
  });
});

describe('PermissionService — #788 loadConfig: DB is sole SoT, no merge on boot', () => {
  test('admin-edited DB rule set is loaded verbatim — source defaults are NOT merged in', async () => {
    // 2026-05-13 (#788): admin owns the rule set. If admin removed the
    // *_delete_* rule from the DB (to allow CRUD-D flows via HITL prompt),
    // the boot path must NOT re-inject it from source defaults. Pre-#788
    // every restart wiped admin edits by re-merging source seeds.
    const adminEditedRules = [
      { source: 'policySettings', ruleBehavior: 'allow', ruleValue: { toolName: 'tool_search' } },
      { source: 'policySettings', ruleBehavior: 'allow', ruleValue: { toolName: 'aws_list_*' } },
      // NOTE: admin has explicitly REMOVED the *_delete_* rule. Source seed
      // would re-inject it pre-#788; post-#788 it must stay gone.
    ];
    prismaMock.systemConfiguration.findFirst.mockResolvedValueOnce({
      key: 'permission_rules',
      value: { rules: adminEditedRules },
    });

    const svc = new PermissionService(logger);
    await svc.loadConfig();

    // In-memory rule set === DB rule set (no merge).
    expect(svc.listRules()).toHaveLength(adminEditedRules.length);

    // Admin's allow rules work.
    expect(svc.classifyName('tool_search')).toBe('allow');
    expect(svc.classifyName('aws_list_buckets')).toBe('allow');

    // Source seeds did NOT re-inject — `azure_delete_vm` falls through to
    // default ask (no matching rule), it does NOT match a re-injected
    // `*_delete_*` ask/deny rule.
    expect(svc.classifyName('azure_delete_vm')).toBe('ask');

    // No persist-back when DB-load is verbatim.
    expect(prismaMock.systemConfiguration.upsert).not.toHaveBeenCalled();
  });

  test('first boot (no DB row) writes the source-defined seed once', async () => {
    // Empty DB → seed once via create(). Subsequent boots see the row and
    // load verbatim (covered by the test above).
    prismaMock.systemConfiguration.findFirst.mockResolvedValueOnce(null);
    const createMock = (prisma as any).systemConfiguration.create as ReturnType<typeof vi.fn>;
    createMock.mockClear();
    createMock.mockResolvedValueOnce({});

    const svc = new PermissionService(logger);
    await svc.loadConfig();

    // create() was called once with the seed (data is the first arg's `data` field).
    expect(createMock).toHaveBeenCalledTimes(1);
    const writeArg = createMock.mock.calls[0][0]?.data ?? createMock.mock.calls[0][0];
    expect(writeArg.key).toBe('permission_rules');
    expect(Array.isArray(writeArg.value.rules)).toBe(true);
    expect(writeArg.value.rules.length).toBeGreaterThan(0);

    // The seed marks destructive verbs as `ask` (not `deny`) so admins can
    // unlock CRUD-D from /admin#permissions without surgery on the source.
    const deleteRule = writeArg.value.rules.find(
      (r: any) => r.ruleValue?.toolName === '*_delete_*',
    );
    expect(deleteRule).toBeDefined();
    expect(deleteRule.ruleBehavior).toBe('ask');
  });
});
