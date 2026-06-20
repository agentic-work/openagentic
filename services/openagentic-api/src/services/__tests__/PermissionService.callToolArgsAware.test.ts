/**
 * Q1-blocker-9 — arg-aware auto-approve for generic CLI passthrough tools.
 *
 * Captured in <internal-upstream>/reports/verify-cadence/Q1-conversation-89cc2350/:
 *
 *   User asked for a per-day Bedrock invocation breakdown for the last 30
 *   days. Sonnet issued 30 sequential `call_aws` calls
 *   (`aws bedrock get-model-invocation-logs --start-time ... --end-time ...`),
 *   each one triggering a fresh HITL approval card because `call_aws` is
 *   one tool name regardless of the verb in its args. Tester approved 8
 *   in a row, gave up. UAT blocked.
 *
 * RED scenario (pre-fix):
 *   PermissionService.classifyName('call_aws') -> 'ask' for every call,
 *   no matter what CLI verb is in the command.
 *
 * GREEN scenario (post-fix):
 *   PermissionService inspects the `cli_command` / `command` / `cli` arg
 *   on the four call_* tools. Read verbs auto-approve. Mutators still
 *   gate. Compound commands always gate (security).
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

import { PermissionService, classifyCallTool } from '../PermissionService.js';

const logger = pino({ level: 'silent' });

describe('classifyCallTool — pure verb resolution', () => {
  // ─── call_aws ──────────────────────────────────────────────────────
  test('auto-approves "aws bedrock list-foundation-models"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws bedrock list-foundation-models',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws bedrock get-model-invocation-logs" (the Q1 capstone case)', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command:
          'aws bedrock get-model-invocation-logs --max-results 1000 --start-time 2026-04-12T00:00:00Z --end-time 2026-04-13T00:00:00Z',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws ce get-cost-and-usage" (Cost Explorer is intrinsically read-only)', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws ce get-cost-and-usage --time-period Start=2026-04-12,End=2026-05-12',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws sts get-caller-identity"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws sts get-caller-identity',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws s3 ls"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3 ls s3://my-bucket --recursive',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws s3api list-buckets"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3api list-buckets',
      }),
    ).toBe('allow');
  });

  test('auto-approves "aws logs filter-log-events"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws logs filter-log-events --log-group-name foo',
      }),
    ).toBe('allow');
  });

  test('STILL gates "aws iam create-user"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws iam create-user --user-name foo',
      }),
    ).toBe('ask');
  });

  test('STILL gates "aws iam delete-user"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws iam delete-user --user-name foo',
      }),
    ).toBe('ask');
  });

  test('STILL gates "aws s3 rm s3://bucket/key"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3 rm s3://bucket/key',
      }),
    ).toBe('ask');
  });

  test('STILL gates "aws ec2 terminate-instances"', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws ec2 terminate-instances --instance-ids i-0123',
      }),
    ).toBe('ask');
  });

  // ─── compound command guard ────────────────────────────────────────
  test('gates compound commands with && (even if head is read)', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3 ls && aws iam delete-user --user-name foo',
      }),
    ).toBe('ask');
  });

  test('gates compound commands with pipe', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3 ls | xargs -I {} aws s3 rm s3://bucket/{}',
      }),
    ).toBe('ask');
  });

  test('gates compound commands with redirect', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws s3 ls > /tmp/exfil.txt',
      }),
    ).toBe('ask');
  });

  test('gates command substitution', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'aws iam delete-user --user-name $(aws sts get-caller-identity --query Arn --output text)',
      }),
    ).toBe('ask');
  });

  // ─── call_azure ───────────────────────────────────────────────────
  test('auto-approves "az account show"', () => {
    expect(
      classifyCallTool('call_azure', {
        cli_command: 'az account show',
      }),
    ).toBe('allow');
  });

  test('auto-approves "az resource list"', () => {
    expect(
      classifyCallTool('call_azure', {
        cli_command: 'az resource list --resource-group foo',
      }),
    ).toBe('allow');
  });

  test('auto-approves "az consumption usage list"', () => {
    expect(
      classifyCallTool('call_azure', {
        cli_command: 'az consumption usage list --start-date 2026-04-12 --end-date 2026-05-12',
      }),
    ).toBe('allow');
  });

  test('STILL gates "az vm delete"', () => {
    expect(
      classifyCallTool('call_azure', {
        cli_command: 'az vm delete --name foo --resource-group bar',
      }),
    ).toBe('ask');
  });

  // ─── call_gcp ─────────────────────────────────────────────────────
  test('auto-approves "gcloud projects list"', () => {
    expect(
      classifyCallTool('call_gcp', {
        cli_command: 'gcloud projects list',
      }),
    ).toBe('allow');
  });

  test('auto-approves "gcloud billing accounts list"', () => {
    expect(
      classifyCallTool('call_gcp', {
        cli_command: 'gcloud billing accounts list',
      }),
    ).toBe('allow');
  });

  test('STILL gates "gcloud projects delete"', () => {
    expect(
      classifyCallTool('call_gcp', {
        cli_command: 'gcloud projects delete my-project',
      }),
    ).toBe('ask');
  });

  // ─── call_kubectl ─────────────────────────────────────────────────
  test('auto-approves "kubectl get pods"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl get pods -n openagentic',
      }),
    ).toBe('allow');
  });

  test('auto-approves "kubectl describe pod"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl describe pod my-pod -n openagentic',
      }),
    ).toBe('allow');
  });

  test('auto-approves "kubectl logs"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl logs -f my-pod -n openagentic',
      }),
    ).toBe('allow');
  });

  test('auto-approves "kubectl top nodes"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl top nodes',
      }),
    ).toBe('allow');
  });

  test('STILL gates "kubectl delete pod"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl delete pod foo -n openagentic',
      }),
    ).toBe('ask');
  });

  test('STILL gates "kubectl apply -f"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl apply -f manifest.yaml',
      }),
    ).toBe('ask');
  });

  test('STILL gates "kubectl rollout restart"', () => {
    expect(
      classifyCallTool('call_kubectl', {
        cli_command: 'kubectl rollout restart deployment/api -n openagentic',
      }),
    ).toBe('ask');
  });

  // ─── fallbacks ────────────────────────────────────────────────────
  test('gates empty command', () => {
    expect(classifyCallTool('call_aws', {})).toBe('ask');
    expect(classifyCallTool('call_aws', { cli_command: '' })).toBe('ask');
    expect(classifyCallTool('call_aws', { cli_command: '   ' })).toBe('ask');
  });

  test('gates command on unknown CLI', () => {
    expect(
      classifyCallTool('call_aws', {
        cli_command: 'rm -rf /',
      }),
    ).toBe('ask');
  });

  test('non-call_* tool name returns ask (defensive)', () => {
    expect(
      classifyCallTool('aws_list_buckets' as any, {
        cli_command: 'aws s3 ls',
      }),
    ).toBe('ask');
  });

  test('accepts alternative arg keys: command / cli / argv', () => {
    expect(
      classifyCallTool('call_aws', { command: 'aws bedrock list-foundation-models' }),
    ).toBe('allow');
    expect(
      classifyCallTool('call_aws', { cli: 'aws bedrock list-foundation-models' }),
    ).toBe('allow');
    expect(
      classifyCallTool('call_aws', { argv: ['aws', 'bedrock', 'list-foundation-models'] }),
    ).toBe('allow');
  });
});

describe('PermissionService.evaluate — integration: call_aws auto-approves through the gate', () => {
  test('evaluate returns allow on read-verb command, never emits hitl_approval', async () => {
    const svc = new PermissionService(logger);
    const emitted: Array<{ event: string; data: unknown }> = [];
    const decision = await svc.evaluate(
      {
        toolName: 'call_aws',
        arguments: {
          cli_command:
            'aws bedrock get-model-invocation-logs --start-time 2026-04-12T00:00:00Z --end-time 2026-04-13T00:00:00Z',
        },
        userId: 'test-user',
      },
      (event, data) => emitted.push({ event, data }),
    );
    expect(decision.approved).toBe(true);
    expect(decision.behavior).toBe('allow');
    expect(decision.approvedBy).toBe('rule:call-tool-args-aware');
    expect(emitted.find((e) => e.event === 'hitl_approval')).toBeUndefined();
  });

  test('evaluate gates mutator command — emits hitl_approval and resolves on deny', async () => {
    const svc = new PermissionService(logger, { timeoutMs: 50 });
    const emitted: Array<{ event: string; data: unknown }> = [];
    const decision = await svc.evaluate(
      {
        toolName: 'call_aws',
        arguments: { cli_command: 'aws iam delete-user --user-name foo' },
        userId: 'test-user',
      },
      (event, data) => emitted.push({ event, data }),
    );
    // No human responds -> timeout -> auto-deny.
    expect(decision.approved).toBe(false);
    expect(emitted.find((e) => e.event === 'hitl_approval')).toBeDefined();
  });
});
