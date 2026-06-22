/**
 * #790 — global READ-ONLY mode toggle.
 *
 * When the admin flips the platform-wide READ-ONLY toggle ON:
 *   - Tools matching an explicit `allow` rule still resolve `allow`.
 *   - Anything else (ask, deny, or fall-through) resolves `deny` with a
 *     READ-ONLY-flavored reason — regardless of what the per-rule cascade
 *     said. This is the SAFE-MODE override.
 *
 * Why it's separate from per-rule allow/deny/ask:
 *   - The per-rule editor is a long-lived policy surface (#788, c4bc4a52)
 *     where ops curate verb globs once and forget. Per-rule edits change
 *     defaults durably.
 *   - The READ-ONLY toggle is a SAFETY KILL-SWITCH — flip it on while a
 *     model is exhibiting risky behavior (or during a change-freeze /
 *     audit window) and ALL mutation surfaces shut off until you flip it
 *     off. No glob surgery required.
 *
 * Persistence: separate `system_configuration` row keyed by
 *   `tool_read_only_mode`. The `permission_rules` row is untouched.
 *
 * Spec ref: the design notes
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

import { PermissionService, type ToolCallInfo } from '../PermissionService.js';
import { prisma } from '../../utils/prisma.js';

const prismaMock = prisma as unknown as {
  systemConfiguration: {
    findFirst: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

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

describe('PermissionService — #790 global READ-ONLY mode', () => {
  test('readOnlyMode defaults to false on a fresh instance', () => {
    const svc = new PermissionService(logger);
    expect(svc.getReadOnlyMode()).toBe(false);
  });

  test('setReadOnlyMode flips the in-memory flag immediately', () => {
    const svc = new PermissionService(logger);
    svc.setReadOnlyMode(true);
    expect(svc.getReadOnlyMode()).toBe(true);
    svc.setReadOnlyMode(false);
    expect(svc.getReadOnlyMode()).toBe(false);
  });

  test('readOnlyMode=true + tool matches allow rule → allow (azure_list_subscriptions)', async () => {
    const svc = new PermissionService(logger);
    svc.setReadOnlyMode(true);
    const { emit } = mkEmit();
    const result = await svc.evaluate(mkToolCall('azure_list_subscriptions'), emit);
    expect(result.behavior).toBe('allow');
    expect(result.approved).toBe(true);
  });

  test('readOnlyMode=true + tool matches ask rule → deny with READ-ONLY reason (azure_delete_vm)', async () => {
    const svc = new PermissionService(logger);
    svc.setReadOnlyMode(true);
    const { emit } = mkEmit();
    const result = await svc.evaluate(mkToolCall('azure_delete_vm'), emit);
    expect(result.behavior).toBe('deny');
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/READ-ONLY/i);
    expect(result.approvedBy).toBe('mode:readOnly');
  });

  test('readOnlyMode=true + unknown tool (no rule match) → deny with READ-ONLY reason', async () => {
    const svc = new PermissionService(logger);
    svc.setReadOnlyMode(true);
    const { emit } = mkEmit();
    const result = await svc.evaluate(mkToolCall('totally_made_up_tool_xyz'), emit);
    expect(result.behavior).toBe('deny');
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/READ-ONLY/i);
    expect(result.approvedBy).toBe('mode:readOnly');
  });

  test('readOnlyMode=false (default) — regression: allow stays allow, ask stays ask', async () => {
    const svc = new PermissionService(logger);
    expect(svc.getReadOnlyMode()).toBe(false);

    // allow rule still fires
    expect(svc.classifyName('azure_list_subscriptions')).toBe('allow');

    // ask rule still resolves to ask (no read-only override)
    expect(svc.classifyName('azure_delete_vm')).toBe('ask');

    // unknown still falls through to ask
    expect(svc.classifyName('totally_made_up_tool_xyz')).toBe('ask');
  });

  test('classifyName respects readOnlyMode — non-allow tools resolve to deny', () => {
    const svc = new PermissionService(logger);
    svc.setReadOnlyMode(true);

    // Explicit allow rule still wins.
    expect(svc.classifyName('azure_list_subscriptions')).toBe('allow');

    // ask + unknown both become deny.
    expect(svc.classifyName('azure_delete_vm')).toBe('deny');
    expect(svc.classifyName('totally_made_up_tool_xyz')).toBe('deny');
  });

  test('loadConfig reads `tool_read_only_mode` row and sets the flag', async () => {
    // First findFirst → permission_rules row (null, force re-seed path).
    // Second findFirst → tool_read_only_mode row (true).
    prismaMock.systemConfiguration.findFirst
      .mockResolvedValueOnce(null) // permission_rules
      .mockResolvedValueOnce({
        key: 'tool_read_only_mode',
        value: { readOnlyMode: true },
      });

    const svc = new PermissionService(logger);
    await svc.loadConfig();
    expect(svc.getReadOnlyMode()).toBe(true);
  });

  test('loadConfig — `tool_read_only_mode` row absent → readOnlyMode stays false', async () => {
    prismaMock.systemConfiguration.findFirst
      .mockResolvedValueOnce(null) // permission_rules
      .mockResolvedValueOnce(null); // tool_read_only_mode

    const svc = new PermissionService(logger);
    await svc.loadConfig();
    expect(svc.getReadOnlyMode()).toBe(false);
  });

  test('loadConfig — explicit readOnlyMode=false row → flag stays false', async () => {
    prismaMock.systemConfiguration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        key: 'tool_read_only_mode',
        value: { readOnlyMode: false },
      });

    const svc = new PermissionService(logger);
    await svc.loadConfig();
    expect(svc.getReadOnlyMode()).toBe(false);
  });

  test('setReadOnlyMode persists to DB via upsert on the tool_read_only_mode key', async () => {
    const svc = new PermissionService(logger);
    prismaMock.systemConfiguration.upsert.mockClear();
    await svc.setReadOnlyMode(true);

    // Find the upsert call that targets the tool_read_only_mode key.
    const call = prismaMock.systemConfiguration.upsert.mock.calls.find(
      (c: any[]) => c[0]?.where?.key === 'tool_read_only_mode',
    );
    expect(call).toBeDefined();
    const writeValue = (call as any[])[0]?.create?.value ?? (call as any[])[0]?.update?.value;
    expect(writeValue).toEqual({ readOnlyMode: true });
  });
});
