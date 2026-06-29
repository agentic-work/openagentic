import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';
import { ToolApprovalGate, type ToolCallInfo } from '../services/ToolApprovalGate.js';

// Neutralise Prisma — the gate's loadConfig reaches for
// SystemConfiguration but these tests don't exercise DB state.
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

const logger = pino({ level: 'silent' });

const mkToolCall = (toolName: string, overrides: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  toolName,
  userId: 'test-user',
  arguments: {},
  ...overrides,
});

describe('ToolApprovalGate — HITL security (UC-A14, 0.6.6)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('azure_delete_* is classified HIGH risk', async () => {
    const gate = new ToolApprovalGate(logger);
    const risk = (gate as any).classifyRisk(mkToolCall('azure_delete_resource_group'));
    expect(risk).toBe('high');
  });

  test('aws_delete_* / aws_terminate_* / gcp_delete_* are HIGH risk', async () => {
    const gate = new ToolApprovalGate(logger);
    const classify = (name: string) => (gate as any).classifyRisk(mkToolCall(name));
    expect(classify('aws_delete_bucket')).toBe('high');
    expect(classify('aws_terminate_instance')).toBe('high');
    expect(classify('gcp_delete_project')).toBe('high');
  });

  test('HIGH-risk calls ALWAYS gate regardless of DISABLE_HITL_GATE env var', async () => {
    process.env.DISABLE_HITL_GATE = 'true';
    const gate = new ToolApprovalGate(logger, { timeoutMs: 50 }); // short timeout for test

    const emits: Array<{ event: string; data: unknown }> = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });

    // Gate will emit mcp_approval_required and block until timeout or resolve.
    // With no response, it auto-denies on timeout.
    const result = await gate.evaluate(mkToolCall('azure_delete_resource_group'), emit);

    expect(result.riskLevel).toBe('high');
    expect(result.approved).toBe(false); // timed out
    expect(result.requiresHuman).toBe(true);
    expect(result.approvedBy).toBe('timeout');
    // Critical assertion: the gate actually emitted an approval request —
    // it did NOT silently bypass via the env var.
    const approvalReq = emits.find(e => e.event === 'mcp_approval_required');
    expect(approvalReq).toBeDefined();
  });

  test('CRITICAL-risk calls ALWAYS gate regardless of DISABLE_HITL_GATE env var', async () => {
    process.env.DISABLE_HITL_GATE = 'true';
    const gate = new ToolApprovalGate(logger, { timeoutMs: 50 });
    const emits: Array<{ event: string }> = [];
    const emit = (event: string, _data: unknown) => emits.push({ event });

    // "bulk_delete_*" matches DEFAULT_CRITICAL_RISK_PATTERNS
    const result = await gate.evaluate(mkToolCall('bulk_delete_users'), emit);

    expect(result.riskLevel).toBe('critical');
    expect(result.approved).toBe(false);
    expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined();
  });

  test('DISABLE_HITL_GATE env var has NO effect — backdoor removed in 0.6.6', async () => {
    // This is the regression guard: prior code honored the flag at line
    // ~375 and auto-approved EVERY risk level, including destructive ops.
    // UC-A14 surfaced azure_delete_resource_group executing with no modal.
    // We test the flag is a no-op for high/critical/medium.
    process.env.DISABLE_HITL_GATE = 'true';
    const gate = new ToolApprovalGate(logger, { timeoutMs: 50 });
    const emit = (_event: string, _data: unknown) => {};

    // MEDIUM risk — e.g. azure_create_resource_group pattern would be medium.
    const mediumResult = await gate.evaluate(
      mkToolCall('azure_create_resource_group'),
      emit,
    );
    // MEDIUM defaults to requiring approval (mediumRiskRequiresApproval=true),
    // so with DISABLE_HITL_GATE set AND the backdoor present, the prior code
    // would have returned approved=true + approvedBy='auto'. With the
    // backdoor removed, medium should also gate.
    expect(mediumResult.approvedBy).not.toBe('auto');
  });

  test('LOW-risk calls auto-approve with approvedBy="auto" (no gate, no env flag needed)', async () => {
    // Verify the happy path still works — the gate doesn't become a
    // drag on every single tool call.
    const gate = new ToolApprovalGate(logger);
    const emit = (_event: string, _data: unknown) => {};

    // "azure_list_resource_groups" doesn't match any risk pattern → defaults to low.
    const result = await gate.evaluate(
      mkToolCall('azure_list_resource_groups'),
      emit,
    );

    expect(result.approved).toBe(true);
    expect(result.approvedBy).toBe('auto');
    expect(result.requiresHuman).toBe(false);
  });

  test('human APPROVE response resolves gate with approved=true', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 5_000 });
    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });

    // Kick off evaluation without awaiting so we can respond mid-flight.
    const pending = gate.evaluate(mkToolCall('azure_delete_resource_group'), emit);

    // Wait for the approval_required event, then approve.
    await vi.waitFor(() => expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined(), { timeout: 2_000 });
    const req = emits.find(e => e.event === 'mcp_approval_required')!.data as any;
    gate.submitApproval(req.requestId, true, 'reviewer-user');

    const result = await pending;
    expect(result.approved).toBe(true);
    expect(result.approvedBy).toBe('reviewer-user');
    expect(result.riskLevel).toBe('high');
  });

  test('human DENY response resolves gate with approved=false', async () => {
    const gate = new ToolApprovalGate(logger, { timeoutMs: 5_000 });
    const emits: any[] = [];
    const emit = (event: string, data: unknown) => emits.push({ event, data });

    const pending = gate.evaluate(mkToolCall('azure_delete_resource_group'), emit);
    await vi.waitFor(() => expect(emits.find(e => e.event === 'mcp_approval_required')).toBeDefined(), { timeout: 2_000 });
    const req = emits.find(e => e.event === 'mcp_approval_required')!.data as any;
    gate.submitApproval(req.requestId, false, 'reviewer-user');

    const result = await pending;
    expect(result.approved).toBe(false);
    expect(result.approvedBy).toBe('reviewer-user');
  });

  describe('generic-CLI read-only downgrade (UC-A16, 0.6.6)', () => {
    const call = (tool: string, args: unknown) => (new ToolApprovalGate(logger) as any)
      .classifyRisk(mkToolCall(tool, { arguments: args as any }));

    test('call_aws with read-only bedrock list verb downgrades HIGH → LOW', () => {
      const risk = call('call_aws', { cli_command: 'aws bedrock list-foundation-models --region us-east-1' });
      expect(risk).toBe('low');
    });

    test('call_aws with describe verb downgrades HIGH → LOW', () => {
      expect(call('call_aws', { cli_command: 'aws ec2 describe-instances' })).toBe('low');
    });

    test('call_aws with terminate verb STAYS HIGH (destructive wins)', () => {
      expect(call('call_aws', { cli_command: 'aws ec2 terminate-instances --instance-ids i-123' })).toBe('high');
    });

    test('call_aws with delete verb STAYS HIGH even if list appears', () => {
      // A pathological command that combines both — destructive verb forces HIGH.
      expect(call('call_aws', { cli_command: 'aws s3 delete-bucket --list-objects' })).toBe('high');
    });

    test('call_gcp gcloud list command downgrades to LOW', () => {
      expect(call('call_gcp', { cli_command: 'gcloud compute instances list --project foo' })).toBe('low');
    });

    test('call_gcp create command STAYS HIGH', () => {
      expect(call('call_gcp', { cli_command: 'gcloud compute instances create foo-vm --zone us-central1-a' })).toBe('high');
    });

    test('call_azure az aks show downgrades to LOW', () => {
      expect(call('call_azure', { cli_command: 'az aks show -n my-cluster -g my-rg' })).toBe('low');
    });

    test('call_azure with empty/missing command defaults to HIGH (safe)', () => {
      // Can't inspect — can't downgrade. HIGH stays.
      expect(call('call_azure', {})).toBe('high');
    });

    test('non-generic tool names are NOT downgraded even with list verb in args', () => {
      // azure_delete_resource_group is named-destructive; argument wording
      // doesn't matter — HIGH.
      expect(call('azure_delete_resource_group', { cmd: 'list' })).toBe('high');
    });
  });
});
